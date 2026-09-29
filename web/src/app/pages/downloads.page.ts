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
        <div class="eyebrow">SYSTEM / MODEL TRANSFERS</div>
        <h1>Downloads</h1>
        <p>Live transfer queue from the local model download service.</p>
      </div>
      <span class="page-badge" [title]="activeCount() + ' queued, downloading, or cancelling transfer(s) in the local queue'"><i [class.online]="activeCount() > 0"></i>{{ activeCount() }} ACTIVE</span>
    </div>

    <section class="download-summary" aria-label="Download queue summary">
      <div title="Queued, downloading, or cancelling jobs reported by the local service"><small>ACTIVE TRANSFERS</small><b>{{ activeCount() }}</b><span>Queued or in progress</span></div>
      <div title="Jobs whose state is completed"><small>COMPLETED</small><b>{{ completedCount() }}</b><span>Finished transfers</span></div>
      <div title="Sum of downloaded bytes for the jobs currently listed"><small>RECEIVED</small><b>{{ formatBytes(totalReceived()) }}</b><span>Across listed jobs</span></div>
      <a routerLink="/hub" aria-label="Browse model hub" title="Search the model hub for a GGUF file to download">Browse model hub <span aria-hidden="true">↗</span></a>
    </section>

    @if (hub.downloadsError()) {
      <section class="surface hub-empty" role="alert">
        <div class="empty-illustration error-icon" aria-hidden="true">!</div>
        <h2>Could not load downloads</h2>
        <p>{{ hub.downloadsError() }}</p>
        <button class="primary-button" type="button" [disabled]="hub.downloadsLoading()" (click)="retry()" title="Request the current transfer list from the local API">
          {{ hub.downloadsLoading() ? 'Retrying…' : 'Retry' }}
        </button>
      </section>
    }

    @if (hub.downloadsLoading() && !hub.downloads().length) {
      <section class="surface hub-empty" role="status" aria-live="polite">
        <div class="empty-illustration" aria-hidden="true">◌</div>
        <h2>Loading downloads</h2>
        <p>Checking for transfers on this device…</p>
      </section>
    } @else if (!hub.downloads().length && !hub.downloadsError()) {
      <section class="surface hub-empty">
        <div class="empty-illustration">⇩</div>
        <h2>No active downloads</h2>
        <p>Choose a GGUF file in the model hub to start a transfer.</p>
        <a class="primary-button" routerLink="/hub" title="Open the model hub to start a GGUF download">Browse Model Hub <span aria-hidden="true">→</span></a>
      </section>
    } @else if (hub.downloads().length) {
      <section class="dl-list">
        @for (item of hub.downloads(); track item.id) {
          <article class="surface dl-card">
            <div class="dl-top">
              <span class="dl-icon" aria-hidden="true" title="Model file transfer">⇩</span>
              <div class="dl-title">
                <b [title]="item.file_name">{{ item.file_name }}</b>
                <div class="dl-source-dest">
                  <span class="dl-source" [title]="'Hub repository: ' + item.repo_id"><span class="badge" title="Source repository for this transfer">SOURCE</span>{{ item.repo_id }}</span>
                  <span class="dl-dest" title="Destination is managed by the local model download service"><span class="badge" title="Local download destination">DESTINATION</span>Local Library</span>
                </div>
              </div>
              <span class="dl-status"
                    [class.done]="item.state === 'completed'"
                    [class.failed]="item.state === 'error' || item.state === 'cancelled'"
                    [title]="statusHelp(item.state)">
                {{ label(item.state) }}
              </span>
            </div>

            <div class="dl-progress">
              <div class="dl-progress-meta">
                <span [title]="item.error || 'Bytes received and total size are reported by the local download API'">{{ item.error || detail(item) }}</span>
                <span [title]="item.total_bytes ? 'Progress calculated from bytes received and total size' : 'Progress percentage is unavailable until the service reports total size'">{{ percent(item) }}</span>
              </div>
              <div class="progress-track" role="progressbar" [attr.aria-valuenow]="value(item)" aria-valuemin="0" aria-valuemax="100" [title]="percent(item) ? percent(item) + ' complete, based on local service byte counts' : 'Transfer size is not reported yet'">
                <span [style.width.%]="value(item)"></span>
              </div>
            </div>

            @if (item.state === 'queued' || item.state === 'downloading') {
              <div class="dl-actions">
                <button class="secondary-button" [disabled]="cancelling() === item.id" (click)="cancel(item)" title="Request cancellation from the local download service">
                  {{ cancelling() === item.id ? 'Cancelling…' : 'Cancel download' }}
                </button>
              </div>
            }

            @if (cancelErrors()[item.id]) {
              <p class="error-line" role="alert" [title]="cancelErrors()[item.id]">{{ cancelErrors()[item.id] }}</p>
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
    .dl-list { max-width:1050px; margin:10px auto 0; display:flex; flex-direction:column; gap:8px; }
    .page-head{padding:16px;background:#171c26;border:1px solid #2b3240;border-radius:6px;margin-bottom:12px}.page-head h1{font-size:22px;font-weight:600}.download-summary{max-width:1050px;margin:0 auto 12px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(140px,auto);align-items:stretch;gap:8px}.download-summary>div,.download-summary>a{min-width:0;padding:11px 13px;background:#171c26;border:1px solid #2b3240;border-radius:5px}.download-summary small,.download-summary b,.download-summary span{display:block}.download-summary small{color:#8692a6;font:8px ui-monospace,monospace}.download-summary b{margin-top:5px;color:#dfe6f3;font:15px ui-monospace,monospace;overflow-wrap:anywhere}.download-summary div span{margin-top:3px;color:#8792a4;font-size:9px}.download-summary>a{display:flex;align-items:center;justify-content:center;gap:8px;color:#b9d0ff;font-size:10px;text-decoration:none}.download-summary>a:hover{background:#202a39}
    .dl-card { padding:15px 16px; border:1px solid #323b49; background:#171c26; border-radius:5px; display:flex; flex-direction:column; gap:12px; }
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

    .hub-empty .primary-button { font:inherit; cursor:pointer; }
    .hub-empty .primary-button:disabled { opacity:0.65; cursor:wait; }
    .hub-empty .error-icon { color:var(--red); border-color:#68423f; background:#281a1c; font-weight:700; }

    .dl-list{max-width:none;margin:8px 0 0;gap:6px}.page-head{padding:0 0 11px!important;background:transparent!important;border:0!important;border-bottom:1px solid #29313e!important;border-radius:0!important}.page-head h1{font-size:24px!important}.page-head p{font-size:11px}.download-summary{max-width:none;margin:9px 0;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(150px,auto);gap:0;border:1px solid #2a3341;border-radius:5px;overflow:hidden;background:#171d27}.download-summary>div,.download-summary>a{padding:10px 12px;border:0;border-right:1px solid #2a3341;border-radius:0;background:transparent}.download-summary small{font-size:9px}.download-summary b{font-size:14px}.download-summary div span{font-size:10px}.download-summary>a{font-size:11px}.dl-card{display:grid;grid-template-columns:minmax(240px,1.1fr) minmax(220px,1fr) auto;align-items:center;gap:8px 16px;padding:10px 12px;border:0;border-bottom:1px solid #2a3341;border-radius:0;background:transparent}.dl-top{align-items:center;gap:9px;min-width:0}.dl-icon{flex:0 0 30px;width:30px;height:30px;border-radius:4px;font-size:14px}.dl-title b{font-size:11px;margin-bottom:4px}.dl-source-dest{font-size:10px;gap:0}.dl-source-dest .badge{padding:1px 4px;border-radius:3px;font-size:8px}.dl-source-dest .dl-dest{display:none}.dl-status{padding:4px 7px;border-radius:3px;font-size:9px}.dl-progress{gap:6px;padding:0}.dl-progress-meta{font-size:9px;gap:10px}.progress-track{height:5px;border-radius:2px}.dl-actions{padding:0}.dl-actions .secondary-button{padding:5px 8px;border-radius:3px;font-size:10px}.error-line{margin:0;padding:6px 9px;font-size:10px;grid-column:1/-1}.page-note{font-size:10px}
    @media (max-width: 600px) {
      .download-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.download-summary>a{min-height:38px}.dl-card { padding:14px; gap:12px; }
      .dl-top { gap:10px; }
      .dl-icon { width:32px; height:32px; font-size:16px; }
      .dl-title b { font-size:13px; }
      .dl-progress, .dl-actions, .error-line { padding-left:0; margin-left:0; }
      .dl-status { font-size:8px; padding:4px 7px; }
      .dl-card{grid-template-columns:minmax(0,1fr) auto;gap:8px}.dl-top{grid-column:1/-1}.dl-progress{grid-column:1/-1;padding-left:40px}.dl-actions{grid-column:1/-1;padding-left:40px}.error-line{grid-column:1/-1}.dl-source-dest { flex-direction:column; align-items:flex-start; gap:4px; }
    }
  `]
})
export class DownloadsPage {
  readonly cancelling = signal<string|null>(null);
  readonly cancelErrors = signal<Record<string,string>>({});

  constructor(readonly hub: HubService) {}

  async retry() {
    await this.hub.refreshDownloads();
  }

  activeCount() {
    return this.hub.downloads().filter(x => x.state === 'queued' || x.state === 'downloading' || x.state === 'cancelling').length;
  }

  completedCount() {
    return this.hub.downloads().filter(x => x.state === 'completed').length;
  }

  totalReceived() {
    return this.hub.downloads().reduce((total, item) => total + (item.downloaded_bytes || 0), 0);
  }

  formatBytes(value: number) { return bytes(value); }

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

  statusHelp(state: ModelDownload['state']) {
    return state === 'completed' ? 'The local service reports this transfer as complete.' :
           state === 'downloading' ? 'The local service is receiving this model file.' :
           state === 'cancelling' ? 'Cancellation has been requested from the local service.' :
           state === 'queued' ? 'Waiting for the local service to start this transfer.' :
           state === 'cancelled' ? 'The local service reports that this transfer was cancelled.' :
           'The local service reported an error for this transfer.';
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
