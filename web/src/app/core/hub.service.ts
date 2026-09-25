import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';

export interface HubModel { repo_id: string; model_id?: string; downloads?: number; likes?: number; pipeline_tag?: string; last_modified?: string; }
export interface HubFile { file_name: string; size_bytes?: number; size_label?: string; quantization?: string; }
export interface ModelDownload { id: string; repo_id: string; file_name: string; state: 'queued'|'downloading'|'cancelling'|'completed'|'error'|'cancelled'; downloaded_bytes: number; total_bytes?: number; progress?: number; error?: string; }

@Injectable({ providedIn: 'root' })
export class HubService {
  readonly downloads = signal<ModelDownload[]>([]);
  private streams = new Map<string, EventSource>();
  constructor(private api: ApiService) { void this.refreshDownloads(); }

  async refreshDownloads() {
    try {
      const raw: any = await this.api.request<unknown>('/api/downloads');
      const data = raw?.data ?? raw;
      const restored = Array.isArray(data?.downloads) ? data.downloads.map((job: any) => this.normalizeJob(job)).filter(Boolean) as ModelDownload[] : [];
      const existing = new Map(this.downloads().map(job => [job.id, job]));
      for (const job of restored) {
        const current = existing.get(job.id);
        existing.set(job.id, current ? { ...job, ...current } : job);
      }
      this.downloads.set([...existing.values()]);
      for (const job of restored) if (job.state === 'queued' || job.state === 'downloading' || job.state === 'cancelling') this.watch(job.id);
    } catch { /* Keep the empty local list until the API is reachable. */ }
  }

  async search(query: string): Promise<HubModel[]> {
    const raw: any = await this.api.request<unknown>(`/api/hub/search?q=${encodeURIComponent(query)}&limit=30`);
    const data = raw?.data ?? raw;
    return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.models) ? data.models : [];
  }
  async files(repoId: string): Promise<HubFile[]> {
    const raw: any = await this.api.request<unknown>(`/api/hub/repos/${encodeURIComponent(repoId)}/files`);
    const data = raw?.data ?? raw;
    const files = Array.isArray(data) ? data : data?.files;
    return Array.isArray(files) ? files : [];
  }
  async start(repo_id: string, file_name: string): Promise<void> {
    const raw: any = await this.api.request<unknown>('/api/downloads', { repo_id, file_name });
    const data: any = raw?.data ?? raw;
    const id = typeof data === 'string' ? data : data?.id ?? data?.download_id;
    if (!id) throw new Error('The local API did not return a download id');
    const item: ModelDownload = this.normalizeJob({ ...data, id: String(id), repo_id, file_name })!;
    this.upsert(item);
    if (isActive(item.state)) this.watch(item.id);
  }
  async cancel(id: string): Promise<void> {
    const raw: any = await this.api.request<unknown>(`/api/downloads/${encodeURIComponent(id)}/cancel`, {});
    const data = raw?.data ?? raw;
    if (data?.state) this.patch(id, { state: normalizeState(data.state) });
    if (!isActive(this.get(id)?.state)) { this.streams.get(id)?.close(); this.streams.delete(id); }
  }
  private watch(id: string) {
    if (this.streams.has(id)) return;
    const source = new EventSource(`${this.api.baseUrl()}/api/downloads/${encodeURIComponent(id)}/events`);
    this.streams.set(id, source);
    const receive = (event: MessageEvent) => {
      let payload: any; try { payload = JSON.parse(event.data); } catch { return; }
      const state = normalizeState(payload.state ?? payload.status);
      this.patch(id, { state, downloaded_bytes: payload.downloaded_bytes ?? payload.received ?? payload.bytes_downloaded ?? this.get(id)?.downloaded_bytes ?? 0, total_bytes: payload.total_bytes ?? payload.total ?? payload.bytes_total, progress: payload.progress, file_name: payload.file_name, error: payload.error });
      if (!isActive(state)) { source.close(); this.streams.delete(id); }
    };
    source.onmessage = receive;
    source.addEventListener('progress', receive as EventListener);
    source.onerror = () => { if (source.readyState === EventSource.CLOSED) { this.patch(id, { state: 'error', error: 'Progress connection closed before completion' }); this.streams.delete(id); } };
  }
  private get(id: string) { return this.downloads().find(x => x.id === id); }
  private upsert(item: ModelDownload) { this.downloads.update(items => [item, ...items.filter(x => x.id !== item.id)]); }
  private normalizeJob(raw: any): ModelDownload | null {
    if (!raw || typeof raw.id !== 'string' || typeof raw.repo_id !== 'string' || typeof raw.file_name !== 'string') return null;
    const state = normalizeState(raw.state ?? raw.status);
    return { id: raw.id, repo_id: raw.repo_id, file_name: raw.file_name, state, downloaded_bytes: Number(raw.downloaded_bytes ?? raw.received ?? 0) || 0, total_bytes: numberOrUndefined(raw.total_bytes ?? raw.total), progress: numberOrUndefined(raw.progress), error: raw.error ?? undefined };
  }
  private patch(id: string, patch: Partial<ModelDownload>) { this.downloads.update(items => items.map(item => item.id === id ? { ...item, ...patch } : item)); }
}

function normalizeState(state: unknown): ModelDownload['state'] {
  if (state === 'complete' || state === 'completed') return 'completed';
  if (state === 'failed' || state === 'error') return 'error';
  if (state === 'cancelling') return 'cancelling';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'downloading') return 'downloading';
  return 'queued';
}
function isActive(state?: ModelDownload['state']) { return state === 'queued' || state === 'downloading' || state === 'cancelling'; }
function numberOrUndefined(value: unknown): number | undefined { const n = Number(value); return value == null || !Number.isFinite(n) ? undefined : n; }
