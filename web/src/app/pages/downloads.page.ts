import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ModelDownload, HubService } from '../core/hub.service';

@Component({ standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <div class="page-head"><div><div class="eyebrow">SYSTEM</div><h1>Downloads</h1><p>Track model transfers into your local model library.</p></div><span class="page-badge"><i></i>{{ activeCount() }} ACTIVE</span></div>
  @if (!hub.downloads().length) { <section class="surface hub-empty"><div class="empty-illustration">⇩</div><h2>No active downloads</h2><p>Choose a GGUF file in the model hub to start a transfer.</p><a class="primary-button" routerLink="/hub">Browse Model Hub <span>→</span></a></section> }
  @else { <section class="download-list">@for (item of hub.downloads(); track item.id) { <article class="surface download-card"><div class="download-top"><span class="download-icon">⇩</span><div class="download-title"><b>{{ item.file_name }}</b><small>{{ item.repo_id }}</small></div><span class="download-status" [class.done]="item.state === 'completed'" [class.failed]="item.state === 'error'">{{ label(item.state) }}</span></div><div class="download-progress"><div class="download-progress-meta"><span>{{ item.error || detail(item) }}</span><span>{{ percent(item) }}</span></div><div class="progress-track" role="progressbar" [attr.aria-valuenow]="value(item)" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="value(item)"></span></div></div>@if (item.state === 'queued' || item.state === 'downloading') { <div class="download-actions"><button class="secondary-button" [disabled]="cancelling() === item.id" (click)="cancel(item)">{{ cancelling() === item.id ? 'Cancelling…' : 'Cancel download' }}</button></div> } @if (cancelErrors()[item.id]) { <p class="error-line" role="alert">{{ cancelErrors()[item.id] }}</p> }</article> }</section> }
  <div class="page-note"><span>ⓘ</span><span>Progress is received live from the local download service. Transfers remain local to this device.</span></div>
` })
export class DownloadsPage {
  readonly cancelling = signal<string|null>(null); readonly cancelErrors = signal<Record<string,string>>({});
  constructor(readonly hub: HubService) { void this.hub.refreshDownloads(); }
  activeCount() { return this.hub.downloads().filter(x => x.state === 'queued' || x.state === 'downloading' || x.state === 'cancelling').length; }
  value(item: ModelDownload) { if (item.progress != null) return Math.max(0,Math.min(100,item.progress <= 1 ? item.progress*100 : item.progress)); return item.total_bytes ? Math.max(0,Math.min(100,item.downloaded_bytes/item.total_bytes*100)) : 0; }
  percent(item: ModelDownload) { return item.state === 'completed' ? '100%' : item.total_bytes || item.progress != null ? `${Math.round(this.value(item))}%` : item.state === 'downloading' ? 'Receiving data…' : ''; }
  detail(item: ModelDownload) { if (item.total_bytes) return `${bytes(item.downloaded_bytes)} of ${bytes(item.total_bytes)}`; if (item.downloaded_bytes) return `${bytes(item.downloaded_bytes)} received`; return item.state === 'queued' ? 'Waiting to start' : 'Preparing transfer…'; }
  label(state: ModelDownload['state']) { return state === 'completed' ? 'COMPLETED' : state === 'downloading' ? 'DOWNLOADING' : state === 'cancelling' ? 'CANCELLING' : state === 'queued' ? 'QUEUED' : state === 'cancelled' ? 'CANCELLED' : 'ERROR'; }
  async cancel(item: ModelDownload) { this.cancelling.set(item.id); this.cancelErrors.update(errors => ({...errors,[item.id]:''})); try { await this.hub.cancel(item.id); } catch (e) { this.cancelErrors.update(errors => ({...errors,[item.id]:e instanceof Error ? e.message : 'Could not cancel this download'})); } finally { this.cancelling.set(null); } }
}
function bytes(n: number) { return n >= 1e9 ? `${(n/1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n/1e6).toFixed(1)} MB` : `${Math.round(n/1e3)} KB`; }
