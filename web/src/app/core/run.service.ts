import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { RunEvent, RunSnapshot, RunStreamState } from './run.types';

const RUN_EVENTS = [
  'run.created', 'plan.resolved', 'run.started', 'run.cancelling', 'run.completed',
  'run.succeeded', 'run.failed', 'run.cancelled', 'run.replay_gap', 'node.ready', 'node.started',
  'node.progress', 'node.completed', 'node.failed', 'node.cancelled', 'artifact.created', 'artifact.produced',
];
const MAX_VISIBLE_EVENTS = 200;
const MAX_RECONNECT_ATTEMPTS = 8;

@Injectable({ providedIn: 'root' })
export class RunService {
  readonly run = signal<RunSnapshot | null>(null);
  readonly events = signal<RunEvent[]>([]);
  readonly runs = signal<RunSnapshot[]>([]);
  readonly runsLoading = signal(false);
  readonly runsError = signal('');
  readonly streamState = signal<RunStreamState>('idle');
  readonly error = signal('');
  private readonly api: ApiService;
  private source: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private activeRunId = '';
  private lastSequence = 0;
  private reconnectAttempts = 0;

  constructor(api: ApiService) { this.api = api; }

  async listRuns(): Promise<void> {
    this.runsLoading.set(true);
    this.runsError.set('');
    try {
      const response = await firstValueFrom(this.api.get<{ data?: { runs?: RunSnapshot[] } }>('/api/runs'));
      this.runs.set(Array.isArray(response?.data?.runs) ? response.data.runs.filter(run => !!run && typeof run.id === 'string') : []);
    } catch (error) {
      this.runs.set([]);
      this.runsError.set(messageOf(error, 'Run orchestration is unavailable from the local API.'));
    } finally { this.runsLoading.set(false); }
  }

  async open(runId: string): Promise<void> {
    this.closeStream();
    this.activeRunId = runId;
    this.lastSequence = 0;
    this.reconnectAttempts = 0;
    this.run.set(null);
    this.events.set([]);
    this.error.set('');
    this.streamState.set('connecting');
    try {
      const response = await firstValueFrom(this.api.get<{ data?: { run?: RunSnapshot } }>(`/api/runs/${encodeURIComponent(runId)}`));
      const run = response?.data?.run;
      if (!run || run.id !== runId || !Array.isArray(run.current_nodes ?? []) || !Array.isArray(run.outputs ?? [])) {
        throw new Error('The local API returned an invalid run record.');
      }
      this.run.set(run);
      this.connect(0);
    } catch (error) {
      if (this.activeRunId !== runId) return;
      this.error.set(messageOf(error, 'Run orchestration is unavailable from the local API.'));
      this.streamState.set('error');
    }
  }

  async refresh(): Promise<void> {
    const id = this.activeRunId;
    if (!id) return;
    const response = await firstValueFrom(this.api.get<{ data?: { run?: RunSnapshot } }>(`/api/runs/${encodeURIComponent(id)}`));
    if (this.activeRunId === id && response?.data?.run?.id === id) this.run.set(response.data.run);
  }

  async cancel(): Promise<void> {
    const id = this.activeRunId;
    if (!id) throw new Error('No run is selected.');
    this.error.set('');
    try {
      const response = await firstValueFrom(this.api.post<{ data?: { run?: RunSnapshot } }>(`/api/runs/${encodeURIComponent(id)}/cancel`, {}));
      if (this.activeRunId === id && response?.data?.run?.id === id) this.run.set(response.data.run);
    } catch (error) {
      this.error.set(messageOf(error, 'The local API could not cancel this run.'));
      throw error;
    }
  }

  disconnect(): void {
    this.closeStream();
    this.streamState.set('closed');
  }

  private connect(after: number): void {
    if (!this.activeRunId) return;
    this.closeSourceOnly();
    this.streamState.set(this.reconnectAttempts ? 'reconnecting' : 'connecting');
    const url = `${this.api.baseUrl()}/api/runs/${encodeURIComponent(this.activeRunId)}/events?after=${after}`;
    const source = new EventSource(url);
    this.source = source;
    source.onopen = () => {
      if (this.source !== source) return;
      this.reconnectAttempts = 0;
      this.streamState.set('live');
    };
    const receive = (event: Event) => this.receive(source, event as MessageEvent<string>);
    for (const eventName of RUN_EVENTS) source.addEventListener(eventName, receive);
    source.onerror = () => {
      if (this.source !== source) return;
      source.close();
      this.source = null;
      this.reconnectAttempts += 1;
      if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        this.streamState.set('error');
        this.error.set('The run event stream could not reconnect. Retry to reconnect to this run.');
        return;
      }
      this.streamState.set('reconnecting');
      const delay = Math.min(8000, 500 * 2 ** (this.reconnectAttempts - 1));
      this.retryTimer = setTimeout(() => this.connect(this.lastSequence), delay);
    };
  }

  private receive(source: EventSource, event: MessageEvent<string>): void {
    if (this.source !== source) return;
    let item: unknown;
    try { item = JSON.parse(event.data); }
    catch { return; }
    if (!item || typeof item !== 'object') return;
    const value = item as Partial<RunEvent>;
    if (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence <= this.lastSequence
        || typeof value.type !== 'string' || typeof value.run_id !== 'string' || value.run_id !== this.activeRunId) return;
    const normalized: RunEvent = {
      run_id: value.run_id,
      sequence: value.sequence,
      timestamp: value.timestamp ?? '',
      type: value.type || event.type,
      data: value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : {},
    };
    this.lastSequence = normalized.sequence;
    this.events.update(events => [...events, normalized].slice(-MAX_VISIBLE_EVENTS));
    if (normalized.type === 'run.replay_gap') {
      void this.refresh().catch(error => this.error.set(messageOf(error, 'Could not refresh the run after event history expired.')));
    }
    if (normalized.type === 'run.started') this.run.update(run => run ? { ...run, state: 'running' } : run);
    if (['run.succeeded', 'run.failed', 'run.cancelled'].includes(normalized.type)) {
      void this.refresh().catch(error => this.error.set(messageOf(error, 'Could not refresh final run status.')));
      this.closeStream();
      this.streamState.set('closed');
    }
  }

  private closeStream(): void {
    this.closeSourceOnly();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private closeSourceOnly(): void {
    this.source?.close();
    this.source = null;
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}
