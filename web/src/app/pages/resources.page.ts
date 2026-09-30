import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ResourcesService } from '../core/resources.service';
import type { ObservationStatus, ResidentModel } from '../core/resources.types';

@Component({
  selector: 'ai-resources-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="resources-page">
      <header class="page-head"><div><div class="eyebrow">SYSTEM / RESIDENCY</div><h1>Resources</h1><p>Current hardware measurements and model residency reported by the local API.</p></div>
        <button type="button" (click)="service.refresh()" [disabled]="service.loading()">{{ service.loading() ? 'Refreshing…' : '↻ Refresh' }}</button></header>
      @if (service.loading() && !service.resources() && !service.residency()) { <p class="state-message" role="status">Loading resource snapshots…</p> }
      @if (service.resourcesError()) { <section class="notice error" role="alert"><div><b>Resource snapshot unavailable</b><p>{{ service.resourcesError() }}</p></div><button type="button" (click)="service.refresh()" [disabled]="service.loading()">Retry</button></section> }
      @if (service.residencyError()) { <section class="notice warning" role="status"><div><b>Residency details unavailable</b><p>{{ service.residencyError() }}</p></div><button type="button" (click)="service.refresh()" [disabled]="service.loading()">Retry</button></section> }
      @if (service.resources(); as snapshot) {
        @if (snapshot.hardware_error) { <p class="notice warning" role="status">Hardware probe: {{ snapshot.hardware_error }}</p> }
        @if (snapshot.status && snapshot.status !== 'known' && snapshot.status !== 'observed') { <p class="snapshot-status" role="status">Snapshot status: {{ statusLabel(snapshot.status) }}</p> }
        <section class="overview" aria-label="Resource overview">
          <article class="metric"><span>RAM total</span><b>{{ bytes(snapshot.resources?.ram?.total_bytes, snapshot.resources?.ram?.total_status) }}</b><small>{{ statusLabel(snapshot.resources?.ram?.metrics_status) }}</small></article>
          <article class="metric"><span>RAM available</span><b>{{ bytes(snapshot.resources?.ram?.available_bytes, snapshot.resources?.ram?.available_status) }}</b><small>{{ statusLabel(snapshot.resources?.ram?.metrics_status) }}</small></article>
          <article class="metric"><span>GPUs reported</span><b>{{ gpuCount() }}</b><small>{{ gpuMetricsSummary() }}</small></article>
          <article class="metric"><span>Loaded models</span><b>{{ loadedModelCount() }}</b><small>{{ leaseSummary() }}</small></article>
        </section>
        <section class="panel" aria-labelledby="gpu-title"><header class="panel-head"><div><div class="eyebrow">DEVICE INVENTORY</div><h2 id="gpu-title">GPUs</h2></div><span>{{ snapshot.resources?.gpus?.length ?? 'Unknown' }}</span></header>
          @if (snapshot.resources?.gpus?.length) { <div class="gpu-grid">@for (gpu of snapshot.resources?.gpus; track gpu.id) {
            <article class="gpu-card"><header><div><h3>{{ gpu.name || (gpu.index !== null && gpu.index !== undefined ? 'GPU ' + gpu.index : gpu.id) }}</h3><code>{{ gpu.vendor || gpu.id }}</code></div><span class="observation" [class]="'observation ' + statusClass(gpu.metrics_status)">{{ statusLabel(gpu.metrics_status) }}</span></header>
              <dl><div><dt>Total VRAM</dt><dd>{{ bytes(gpu.total_vram_bytes, gpu.total_vram_status) }}</dd></div><div><dt>Free VRAM</dt><dd>{{ bytes(gpu.free_vram_bytes, gpu.free_vram_status) }}</dd></div><div><dt>Backends</dt><dd>{{ gpu.backends?.length ? gpu.backends.join(', ') : statusLabel('unknown') }}</dd></div><div><dt>Runtime device mapping</dt><dd>{{ statusLabel(gpu.runtime_device_mappings?.status) }}@if (gpu.runtime_device_mappings?.items?.length) { · {{ gpu.runtime_device_mappings?.items?.length }} reported }</dd></div></dl>
            </article>
          }</div> } @else { <p class="empty">No GPU records were reported.</p> }
        </section>
        <section class="panel system-grid" aria-label="Other resources">
          <article><h2>CPU</h2><dl><div><dt>Logical cores</dt><dd>{{ count(snapshot.resources?.cpu?.logical_cores) }}</dd></div><div><dt>Physical cores</dt><dd>{{ count(snapshot.resources?.cpu?.physical_cores) }}</dd></div><div><dt>Active threads</dt><dd>{{ count(snapshot.resources?.cpu?.active_threads) }}</dd></div><div><dt>Thread pressure</dt><dd>{{ statusLabel(snapshot.resources?.cpu?.thread_pressure_status) }}</dd></div></dl></article>
          <article><h2>Temporary disk</h2><dl><div><dt>Available</dt><dd>{{ bytes(snapshot.resources?.temporary_disk?.available_bytes, snapshot.resources?.temporary_disk?.status) }}</dd></div><div><dt>Measurement</dt><dd>{{ statusLabel(snapshot.resources?.temporary_disk?.status) }}</dd></div></dl></article>
          <article><h2>Reservations &amp; leases</h2><dl><div><dt>Pending reservations</dt><dd>{{ reservationCount() }}</dd></div><div><dt>Active leases</dt><dd>{{ count(snapshot.resources?.active_lease_count) }}</dd></div><div><dt>Reservation data</dt><dd>{{ statusLabel(snapshot.resources?.pending_reservations_status) }}</dd></div></dl></article>
        </section>
        <section class="panel residency" aria-labelledby="residency-title"><header class="panel-head"><div><div class="eyebrow">MODEL LIFECYCLE</div><h2 id="residency-title">Model residency</h2><p>{{ residencySource() }}</p></div><span>{{ residencyCount() }}</span></header>
          @if (models().length) { <ul class="resident-list">@for (model of models(); track model.model_id) {
            <li><button type="button" class="resident-row" (click)="select(model)" [attr.aria-expanded]="selected()?.model_id === model.model_id" [attr.aria-controls]="selected()?.model_id === model.model_id ? 'residency-detail' : null"><span class="resident-main"><b>{{ model.model_id }}</b><small>{{ model.runtime_id || 'Runtime not reported' }} · {{ model.profile_id || 'Profile not reported' }}</small></span><span class="resident-state">{{ model.state || 'State unknown' }}</span><span class="resident-memory">{{ bytes(model.estimated_vram_bytes, model.estimated_vram_status) }}</span><span class="pin" [class.pinned]="model.pinned === true">{{ model.pinned === true ? 'Pinned' : model.pinned === false ? 'Not pinned' : 'Pin status unknown' }}</span></button></li>
          }</ul> } @else if (!hasResidencyItems()) { <p class="empty">{{ residencyEmptyMessage() }}</p> } @else { <p class="empty">No loaded model residency records were reported.</p> }
          @if (selected(); as model) {
            <aside id="residency-detail" class="detail-drawer" aria-label="Selected model residency details"><header><div><div class="eyebrow">RESIDENCY DETAILS</div><h3>{{ model.model_id }}</h3></div><button type="button" class="close" (click)="selectedId.set('')" aria-label="Close model residency details">×</button></header>
              <dl><div><dt>State</dt><dd>{{ model.state || statusLabel('unknown') }}</dd></div><div><dt>Runtime</dt><dd>{{ model.runtime_id || statusLabel('unknown') }}</dd></div><div><dt>Profile</dt><dd>{{ model.profile_id || statusLabel('unknown') }}</dd></div><div><dt>Active leases</dt><dd>{{ count(model.lease_count) }}</dd></div><div><dt>Residency pin</dt><dd>{{ model.pinned === true ? 'Pinned' : model.pinned === false ? 'Not pinned' : statusLabel('unknown') }}</dd></div><div><dt>Estimated RAM</dt><dd>{{ bytes(model.estimated_ram_bytes, model.estimated_ram_status) }}</dd></div><div><dt>Estimated VRAM</dt><dd>{{ bytes(model.estimated_vram_bytes, model.estimated_vram_status) }}</dd></div><div><dt>Loaded for</dt><dd>{{ duration(model.loaded_for_seconds) }}</dd></div><div><dt>Idle for</dt><dd>{{ duration(model.idle_for_seconds) }}</dd></div></dl>
              @if (controlRoute(model); as routeId) { <div class="residency-actions" aria-label="Residency controls"><button type="button" [disabled]="actionPending()" (click)="applyControl(routeId, model.pinned ? 'unpin' : 'pin')">{{ model.pinned ? 'Unpin model' : 'Pin model' }}</button><button type="button" [disabled]="actionPending() || model.lease_count !== 0 || model.pinned === true" (click)="applyControl(routeId, 'unload')">Unload idle model</button></div> }
              @if (actionMessage()) { <p class="action-message" role="status">{{ actionMessage() }}</p> }
              @if (actionError()) { <p class="action-error" role="alert">{{ actionError() }}</p> }
            </aside>
          }
        </section>
        @if (service.refreshedAt(); as refreshed) { <p class="updated">Snapshot updated {{ refreshed.toLocaleTimeString() }}</p> }
      }
      @if (!service.loading() && !service.resources() && !service.residencyError() && !service.resourcesError()) { <section class="empty-state"><b>No resource data</b><p>The local API returned no resource snapshot.</p></section> }
    </main>
  `,
  styles: [`
    :host{display:block;color:var(--text,#e4e9f2)}.resources-page{max-width:1240px;margin:auto;padding:20px;display:grid;gap:12px}.page-head{display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:1px solid #2b3240;padding-bottom:12px}.eyebrow{color:#8793a8;font:9px ui-monospace,monospace;letter-spacing:.06em}.page-head h1{margin:4px 0;font-size:24px;font-weight:550}.page-head p{margin:4px 0 0;color:#929aaa;font-size:11px}.page-head button,.notice button,.close,.residency-actions button{border:1px solid #364050;border-radius:4px;background:#171c26;color:#c8d0de;padding:7px 10px;font:10px ui-monospace,monospace;cursor:pointer}.page-head button:disabled,.notice button:disabled,.residency-actions button:disabled{opacity:.55;cursor:wait}.notice{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 12px;border:1px solid #303744;border-radius:5px;background:#171c26}.notice b{font-size:10px}.notice p{margin:4px 0 0;color:#a2adbc;font-size:9px}.notice.error{border-color:#53323a;background:#2b2025;color:#ffb4ab}.notice.warning,.snapshot-status{border-color:#584a31;background:#28251d;color:#e6c981}.snapshot-status{margin:0;padding:8px;border:1px solid #584a31;border-radius:4px;font-size:9px}.state-message,.empty{padding:10px;color:#9aa5b7;font-size:10px}.overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid #2b3340;border-radius:5px;background:#2b3340}.metric{display:grid;gap:6px;min-width:0;padding:12px;background:#171c26}.metric span,.metric small{color:#8994a7;font:8px ui-monospace,monospace;text-transform:uppercase}.metric b{color:#dce4f2;font:15px ui-monospace,monospace;overflow-wrap:anywhere}.metric small{font-size:7px}.panel{min-width:0;padding:12px;border:1px solid #2b3340;border-radius:5px;background:#171c26}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.panel-head h2{margin:4px 0;font-size:13px;font-weight:550}.panel-head p{margin:4px 0 0;color:#929eae;font-size:9px}.panel-head>span{color:#9aa6b8;font:9px ui-monospace,monospace}.gpu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:8px}.gpu-card{min-width:0;padding:10px;border:1px solid #303947;border-radius:4px;background:#131923}.gpu-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.gpu-card h3{margin:0 0 4px;font-size:11px}.gpu-card code{color:#929eb1;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.observation{padding:3px 5px;border-radius:3px;background:#282d37;color:#bec6d3;font:7px ui-monospace,monospace;text-transform:uppercase}.observation.known,.observation.observed{background:#1c302d;color:#82dbac}.observation.not_supported{background:#252a32;color:#a0a9b8}.gpu-card dl,.system-grid dl,.detail-drawer dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:10px 0 0}.gpu-card dl>div,.system-grid dl>div,.detail-drawer dl>div{min-width:0;padding:6px;border-radius:3px;background:#10151e}.gpu-card dt,.system-grid dt,.detail-drawer dt{color:#8793a8;font:7px ui-monospace,monospace;text-transform:uppercase}.gpu-card dd,.system-grid dd,.detail-drawer dd{margin:4px 0 0;color:#ccd5e3;font-size:9px;overflow-wrap:anywhere}.system-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px}.system-grid article{min-width:0;padding:8px;border-radius:4px;background:#131923}.system-grid h2{margin:0;font-size:10px}.system-grid dl{margin-top:7px}.resident-list{list-style:none;margin:0;padding:0}.resident-list li+li{border-top:1px solid #2b3340}.resident-row{display:grid;grid-template-columns:minmax(170px,1.6fr) minmax(80px,.7fr) minmax(90px,.8fr) minmax(90px,.7fr);align-items:center;gap:9px;width:100%;padding:10px 7px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.resident-row:hover,.resident-row[aria-expanded=true]{background:#1e2633}.resident-main{display:grid;gap:4px;min-width:0}.resident-main b{font-size:10px;overflow-wrap:anywhere}.resident-main small{color:#8f9bad;font-size:8px;overflow-wrap:anywhere}.resident-state,.resident-memory,.pin{color:#c4ccda;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.pin{color:#98a3b3}.pin.pinned{color:#e4c981}.detail-drawer{margin-top:10px;padding:11px;border:1px solid #3b4a61;border-radius:4px;background:#111721}.detail-drawer>header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.detail-drawer h3{margin:4px 0 0;font-size:11px;overflow-wrap:anywhere}.detail-drawer dl{grid-template-columns:repeat(auto-fit,minmax(135px,1fr))}.residency-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.residency-actions button:hover:not(:disabled){border-color:#637797;background:#202938}.action-message,.action-error{margin:8px 0 0;font-size:9px}.action-message{color:#9fdbb7}.action-error{color:#ffb4ab}.close{font-size:14px;padding:3px 8px}.updated{margin:0;color:#7f8b9d;text-align:right;font:8px ui-monospace,monospace}.empty-state{padding:16px;border:1px solid #2b3340;border-radius:5px;background:#171c26}.empty-state b{font-size:11px}.empty-state p{margin:5px 0 0;color:#9aa5b7;font-size:9px}.resources-page button:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}@media(max-width:700px){.resources-page{padding:14px 11px}.overview{grid-template-columns:repeat(2,minmax(0,1fr))}.resident-row{grid-template-columns:minmax(0,1fr) auto;gap:6px}.resident-state,.resident-memory,.pin{text-align:right}.resident-main{grid-column:1}.resident-state{grid-column:2;grid-row:1}.resident-memory{grid-column:1;grid-row:2;text-align:left}.pin{grid-column:2;grid-row:2}}@media(max-width:420px){.page-head{align-items:flex-start}.system-grid{grid-template-columns:1fr}.gpu-card dl{grid-template-columns:1fr}.resident-row{grid-template-columns:minmax(0,1fr)}.resident-main,.resident-state,.resident-memory,.pin{grid-column:1;grid-row:auto;text-align:left}}
  `],
})
export class ResourcesPage implements OnInit {
  readonly service = inject(ResourcesService);
  readonly selectedId = signal('');
  readonly actionPending = signal(false);
  readonly actionMessage = signal('');
  readonly actionError = signal('');
  readonly models = computed(() => {
    const items = this.service.residency()?.items;
    return Array.isArray(items) ? items : this.service.resources()?.resources?.loaded_models ?? [];
  });
  readonly selected = computed(() => this.models().find(model => model.model_id === this.selectedId()) ?? null);

  ngOnInit(): void { void this.service.refresh(); }
  select(model: ResidentModel): void { this.selectedId.set(this.selectedId() === model.model_id ? '' : model.model_id); }
  controlRoute(model: ResidentModel): string | null { return model.route_ids?.[0] ?? null; }
  async applyControl(routeId: string, action: 'pin' | 'unpin' | 'unload'): Promise<void> {
    this.actionPending.set(true); this.actionMessage.set(''); this.actionError.set('');
    try { await this.service.control(routeId, action); this.actionMessage.set(`Model ${action} completed.`); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Residency action could not be completed.'); }
    finally { this.actionPending.set(false); }
  }
  gpuCount(): string { const gpus = this.service.resources()?.resources?.gpus; return Array.isArray(gpus) ? String(gpus.length) : this.statusLabel(this.service.resources()?.status === 'not_supported' ? 'not_supported' : 'unknown'); }
  loadedModelCount(): string { return this.hasResidencyItems() ? String(this.models().length) : this.residencyCount(); }
  residencyCount(): string {
    const residency = this.service.residency();
    const count = this.service.residency()?.count;
    if (typeof count === 'number' && Number.isFinite(count)) return String(count);
    if (Array.isArray(residency?.items)) return String(residency.items.length);
    const snapshotItems = this.service.resources()?.resources?.loaded_models;
    if (Array.isArray(snapshotItems)) return String(snapshotItems.length);
    return this.statusLabel(this.service.residency()?.status === 'not_supported' ? 'not_supported' : 'unknown');
  }
  hasResidencyItems(): boolean { return Array.isArray(this.service.residency()?.items) || Array.isArray(this.service.resources()?.resources?.loaded_models); }
  residencyEmptyMessage(): string { return this.service.residency()?.status === 'not_supported' ? 'Model residency is not supported by this backend.' : 'Model residency records are not reported by the available endpoints.'; }
  bytes(value: number | null | undefined, status?: ObservationStatus): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return this.statusLabel(status);
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let amount = value, index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
  }
  count(value: number | null | undefined): string { return typeof value === 'number' && Number.isFinite(value) ? String(value) : this.statusLabel('unknown'); }
  statusLabel(status?: ObservationStatus): string {
    if (status === 'not_supported') return 'Not supported';
    if (status === 'unknown' || status == null) return 'Unknown';
    if (status === 'known') return 'Known';
    if (status === 'observed') return 'Observed';
    return status.replaceAll('_', ' ');
  }
  statusClass(status?: ObservationStatus): string { return status?.replace(/[^a-z0-9_-]/gi, '_') || 'unknown'; }
  duration(seconds: number | null | undefined): string {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return this.statusLabel('unknown');
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m ${Math.floor(seconds % 60)}s`;
  }
  reservationCount(): string {
    const count = this.service.resources()?.resources?.pending_reservations?.length;
    return count === undefined ? this.statusLabel(this.service.resources()?.resources?.pending_reservations_status) : String(count);
  }
  gpuMetricsSummary(): string {
    const gpus = this.service.resources()?.resources?.gpus;
    return gpus?.length ? gpus.map(gpu => this.statusLabel(gpu.metrics_status)).join(' · ') : this.statusLabel('unknown');
  }
  leaseSummary(): string {
    const count = this.service.residency()?.active_lease_count ?? this.service.resources()?.resources?.active_lease_count;
    return count == null ? this.statusLabel('unknown') + ' active leases' : `${count} active leases`;
  }
  residencySource(): string {
    const residency = this.service.residency();
    if (this.service.residencyError()) return 'Dedicated residency endpoint unavailable; showing models from the resource snapshot when provided.';
    if (residency?.status === 'not_supported') return 'Residency details are not supported by this backend.';
    return residency?.source ? `Source: ${residency.source} · ${this.statusLabel(residency.status)}` : `Status: ${this.statusLabel(residency?.status)}`;
  }
}
