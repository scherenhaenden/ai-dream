import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ModelDownload, HubService } from '../core/hub.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">SYSTEM</div>
        <h1>Downloads</h1>
        <p>Track model transfers into your local model library.</p>
      </div>
      <span class="page-badge"><i [class.online]="activeCount() > 0"></i>{{ activeCount() }} ACTIVE</span>
    </div>

    @if (loading()) {
      <div class="downloads-loading">
        <div class="spinner"></div>
        <p>Loading active downloads…</p>
      </div>
    } @else if (apiError()) {
      <section class="surface hub-empty error-state">
        <div class="empty-illustration">⚠</div>
        <h2>Connection failed</h2>
        <p>{{ apiError() }}</p>
        <button class="primary-button" (click)="refresh()">Retry Connection</button>
      </section>
    } @else if (!hub.downloads().length) {
      <section class="surface hub-empty">
        <div class="empty-illustration">⇩</div>
        <h2>No active downloads</h2>
        <p>Choose a GGUF file in the model hub to start a transfer.</p>
        <a class="primary-button" routerLink="/hub">Browse Model Hub <span>→</span></a>
      </section>
    } @else {
      <section class="dl-list">
        @for (item of hub.downloads(); track item.id) {
          <article class="surface dl-card">
            <div class="dl-top">
              <span class="dl-icon">⇩</span>
              <div class="dl-title">
                <b>{{ item.file_name }}</b>
                <div class="dl-source-dest">
                  <span class="dl-source"><span class="badge">SOURCE</span>{{ item.repo_id }}</span>
                  <span class="dl-dest"><span class="badge">DESTINATION</span>Local Library</span>
                </div>
              </div>
              <span class="dl-status"
                    [class.done]="item.state === 'completed'"
                    [class.failed]="item.state === 'error' || item.state === 'cancelled'">
                {{ label(item.state) }}
              </span>
            </div>

            <div class="dl-progress">
              <div class="dl-progress-meta">
                <span>{{ item.error || detail(item) }}</span>
                <span>{{ percent(item) }}</span>
              </div>
              <div class="progress-track" role="progressbar" [attr.aria-valuenow]="value(item)" aria-valuemin="0" aria-valuemax="100">
                <span [style.width.%]="value(item)"></span>
              </div>
            </div>

            @if (item.state === 'queued' || item.state === 'downloading') {
              <div class="dl-actions">
                <button class="secondary-button" [disabled]="cancelling() === item.id" (click)="cancel(item)">
                  {{ cancelling() === item.id ? 'Cancelling…' : 'Cancel download' }}
                </button>
              </div>
            }

            @if (cancelErrors()[item.id]) {
              <p class="error-line" role="alert">{{ cancelErrors()[item.id] }}</p>
            }
          </article>
        }
      </section>
    }

    <div class="page-note">
      <span>ⓘ</span>
      <span>Progress is received live from the local download service. Transfers remain local to this device.</span>
    </div>
  `,
  styles: [`
    .dl-list { max-width:1050px; margin:0 auto; display:flex; flex-direction:column; gap:12px; }
    .dl-card { padding:18px 20px; border:1px solid #323b49; background:#1c222f; border-radius:10px; display:flex; flex-direction:column; gap:16px; }
    .dl-top { display:flex; align-items:flex-start; gap:14px; }
    .dl-icon { display:grid; place-items:center; width:38px; height:38px; border-radius:8px; background:#293345; color:#8eb7ff; font-size:18px; border:1px solid #3c485c; }
    .dl-title { flex:1; min-width:0; }
    .dl-title b { display:block; color:#e1e7f5; font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-bottom:6px; }
    .dl-source-dest { display:flex; align-items:center; gap:12px; color:#8d98ab; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-wrap:wrap; }
    .dl-source-dest > span { display:flex; align-items:center; gap:6px; }
    .dl-source-dest .badge { padding:2px 6px; background:#252d3c; border-radius:4px; color:#a1aebf; font-size:9px; letter-spacing:0.5px; text-transform:uppercase; font-weight:700; border:1px solid #323b49; }

    .dl-status { padding:5px 9px; border:1px solid #5b4c32; background:#292419; color:#e8c983; border-radius:6px; font:9px ui-monospace,monospace; font-weight:600; letter-spacing:0.5px; white-space:nowrap; }
    .dl-status.done { border-color:#275542; background:#162b24; color:var(--green); }
    .dl-status.failed { border-color:#68423f; background:#281a1c; color:var(--red); }

    .dl-progress { display:flex; flex-direction:column; gap:8px; padding-left:52px; }
    .dl-progress-meta { display:flex; justify-content:space-between; align-items:center; color:#9ba6ba; font:10px/1 ui-monospace,monospace; }
    .progress-track { height:6px; overflow:hidden; background:#252c37; border-radius:6px; box-shadow:inset 0 1px 2px rgba(0,0,0,0.2); }
    .progress-track span { display:block; height:100%; background:linear-gradient(90deg, #4f83e0, #8eb7ff); border-radius:6px; transition:width 0.3s ease; }

    .dl-actions { display:flex; padding-left:52px; }
    .dl-actions .secondary-button { padding:6px 12px; font-size:11px; border:1px solid #3c485c; background:#252d3c; color:#cdd5e0; border-radius:6px; cursor:pointer; font-weight:500; transition:all 0.2s; margin:0; }
    .dl-actions .secondary-button:hover:not(:disabled) { background:#2c3547; color:#fff; border-color:#4a5971; }
    .dl-actions .secondary-button:disabled { opacity:0.6; cursor:wait; }

    .error-line { margin:4px 0 0 52px; padding:8px 12px; background:#2c1b1c; border-left:3px solid #e06c60; color:#e8a49c; font-size:11px; border-radius:0 6px 6px 0; }

    .downloads-loading { display:flex; flex-direction:column; align-items:center; gap:16px; padding:60px 20px; color:#a1aebf; }
    .spinner { width:24px; height:24px; border:2px solid #293345; border-top-color:#8eb7ff; border-radius:50%; animation:spin 1s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .error-state h2 { color:#e06c60; }
    .error-state .empty-illustration { background:#2c1b1c; border-color:#68423f; color:#e06c60; }

    @media (max-width: 600px) {
      .dl-card { padding:14px; gap:12px; }
      .dl-top { gap:10px; }
      .dl-icon { width:32px; height:32px; font-size:16px; }
      .dl-title b { font-size:13px; }
      .dl-progress, .dl-actions, .error-line { padding-left:0; margin-left:0; }
      .dl-status { font-size:8px; padding:4px 7px; }
      .dl-source-dest { flex-direction:column; align-items:flex-start; gap:6px; }
    }
  `]
})
export class DownloadsPage {
  readonly loading = signal(true);
  readonly apiError = signal<string|null>(null);
  readonly cancelling = signal<string|null>(null);
  readonly cancelErrors = signal<Record<string,string>>({});

  constructor(readonly hub: HubService) {
    this.refresh();
  }

  async refresh() {
    this.loading.set(true);
    this.apiError.set(null);
    try {
      await this.hub.refreshDownloads();
    } catch (e) {
      this.apiError.set(e instanceof Error ? e.message : 'Could not reach the downloads service');
    } finally {
      this.loading.set(false);
    }
  }

  activeCount() {
    return this.hub.downloads().filter(x => x.state === 'queued' || x.state === 'downloading' || x.state === 'cancelling').length;
  }

  value(item: ModelDownload) {
    if (item.progress != null) return Math.max(0, Math.min(100, item.progress <= 1 ? item.progress * 100 : item.progress));
    return item.total_bytes ? Math.max(0, Math.min(100, item.downloaded_bytes / item.total_bytes * 100)) : 0;
  }

  percent(item: ModelDownload) {
    return item.state === 'completed' ? '100%' :
           item.total_bytes || item.progress != null ? `${Math.round(this.value(item))}%` :
           item.state === 'downloading' ? 'Receiving data…' : '';
  }

  detail(item: ModelDownload) {
    if (item.total_bytes) return `${bytes(item.downloaded_bytes)} of ${bytes(item.total_bytes)}`;
    if (item.downloaded_bytes) return `${bytes(item.downloaded_bytes)} received`;
    return item.state === 'queued' ? 'Waiting to start' : 'Preparing transfer…';
  }

  label(state: ModelDownload['state']) {
    return state === 'completed' ? 'COMPLETED' :
           state === 'downloading' ? 'DOWNLOADING' :
           state === 'cancelling' ? 'CANCELLING' :
           state === 'queued' ? 'QUEUED' :
           state === 'cancelled' ? 'CANCELLED' : 'ERROR';
  }

  async cancel(item: ModelDownload) {
    this.cancelling.set(item.id);
    this.cancelErrors.update(errors => ({...errors, [item.id]: ''}));
    try {
      await this.hub.cancel(item.id);
    } catch (e) {
      this.cancelErrors.update(errors => ({...errors, [item.id]: e instanceof Error ? e.message : 'Could not cancel this download'}));
    } finally {
      this.cancelling.set(null);
    }
  }
}

function bytes(n: number) {
  return n >= 1e9 ? `${(n/1e9).toFixed(2)} GB` :
         n >= 1e6 ? `${(n/1e6).toFixed(1)} MB` :
         `${Math.round(n/1e3)} KB`;
}
