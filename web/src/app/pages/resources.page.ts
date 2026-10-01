import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResourcesService } from '../core/resources.service';
import type { ObservationStatus, ResidentModel } from '../core/resources.types';

type PendingReservationRow = {
  model_id?: string; runtime_id?: string; state?: string;
  estimated_ram_bytes?: number | null; estimated_ram_status?: ObservationStatus;
  estimated_vram_bytes?: number | null; estimated_vram_status?: ObservationStatus;
};

@Component({
  selector: 'ai-resources-page',
  standalone: true,
  imports: [RouterLink],
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
              <dl><div><dt>Total VRAM</dt><dd>{{ bytes(gpu.total_vram_bytes, gpu.total_vram_status) }}</dd></div><div><dt>Free VRAM</dt><dd>{{ bytes(gpu.free_vram_bytes, gpu.free_vram_status) }}</dd></div><div><dt>Backends</dt><dd>{{ gpu.backends?.join(', ') || statusLabel('unknown') }}</dd></div><div><dt>Runtime device mapping</dt><dd>{{ statusLabel(gpu.runtime_device_mappings?.status) }}@if (gpu.runtime_device_mappings?.items?.length) { · {{ gpu.runtime_device_mappings?.items?.length ?? 0 }} reported }</dd></div></dl>
            </article>
          }</div> } @else { <p class="empty">No GPU records were reported.</p> }
        </section>
        <section class="panel pending-reservations" aria-labelledby="pending-reservations-title">
          <header class="panel-head"><div><div class="eyebrow">RESOURCE QUEUE</div><h2 id="pending-reservations-title">Waiting models</h2><p>Reservation requests reported by the local scheduler.</p></div><span>{{ pendingReservationCount() }}</span></header>
          @if (pendingReservations().length) {
            <ul class="pending-list">@for (item of pendingReservations(); track $index) {
              <li><div class="pending-model"><b>{{ item.model_id || 'Model unknown' }}</b><small>{{ item.runtime_id || 'Runtime unknown' }} · {{ item.state || 'State unknown' }}</small></div><span>Est. RAM {{ bytes(item.estimated_ram_bytes, item.estimated_ram_status) }}</span><span>Est. VRAM {{ bytes(item.estimated_vram_bytes, item.estimated_vram_status) }}</span></li>
            }</ul>
          } @else { <p class="empty">{{ pendingReservationsMessage() }}</p> }
        </section>
        <section class="panel system-grid" aria-label="Other resources">
          <article><h2>CPU</h2><dl><div><dt>Logical cores</dt><dd>{{ count(snapshot.resources?.cpu?.logical_cores) }}</dd></div><div><dt>Physical cores</dt><dd>{{ count(snapshot.resources?.cpu?.physical_cores) }}</dd></div><div><dt>Active threads</dt><dd>{{ count(snapshot.resources?.cpu?.active_threads) }}</dd></div><div><dt>Thread pressure</dt><dd>{{ statusLabel(snapshot.resources?.cpu?.thread_pressure_status) }}</dd></div></dl></article>
          <article><h2>Temporary disk</h2><dl><div><dt>Available</dt><dd>{{ bytes(snapshot.resources?.temporary_disk?.available_bytes, snapshot.resources?.temporary_disk?.status) }}</dd></div><div><dt>Measurement</dt><dd>{{ statusLabel(snapshot.resources?.temporary_disk?.status) }}</dd></div></dl></article>
          <article><h2>Reservations &amp; leases</h2><dl><div><dt>Pending reservations</dt><dd>{{ reservationCount() }}</dd></div><div><dt>Active leases</dt><dd>{{ count(snapshot.resources?.active_lease_count) }}</dd></div><div><dt>Reservation data</dt><dd>{{ statusLabel(snapshot.resources?.pending_reservations_status) }}</dd></div></dl></article>
        </section>
        <section class="panel residency" aria-labelledby="residency-title"><header class="panel-head"><div><div class="eyebrow">MODEL LIFECYCLE</div><h2 id="residency-title">Model residency</h2><p>{{ residencySource() }}</p></div><span>{{ residencyCount() }}</span></header>
          <div class="eviction-policy"><label for="eviction-policy"><b>Default eviction policy</b><select id="eviction-policy" aria-label="Default model eviction policy" [value]="service.evictionPolicy() ?? ''" [disabled]="service.savingEvictionPolicy() || service.evictionPolicy() === null" (change)="setEvictionPolicy($any($event.target).value)"><option value="lru">LRU idle models</option><option value="never">Never evict automatically</option></select></label><p>LRU unloads the oldest idle, unpinned resident only when measured memory headroom is insufficient. Never keeps residents and can make a new route fail for lack of headroom.</p></div>
          @if (service.preferenceError()) { <p class="action-error" role="alert">Eviction policy: {{ service.preferenceError() }}</p> }
          @if (models().length) { <ul class="resident-list">@for (model of models(); track model.model_id) {
            <li><button type="button" class="resident-row" (click)="select(model)" [attr.aria-expanded]="selected()?.model_id === model.model_id" [attr.aria-controls]="selected()?.model_id === model.model_id ? 'residency-detail' : null"><span class="resident-main"><b>{{ model.model_id }}</b><small>{{ model.runtime_id || 'Runtime not reported' }} · {{ model.profile_id || 'Profile not reported' }}</small></span><span class="resident-state">{{ model.state || 'State unknown' }}</span><span class="resident-memory">{{ bytes(model.estimated_vram_bytes, model.estimated_vram_status) }}</span><span class="pin" [class.pinned]="model.pinned === true">{{ model.pinned === true ? 'Pinned' : model.pinned === false ? 'Not pinned' : 'Pin status unknown' }}</span></button></li>
          }</ul> } @else if (!hasResidencyItems()) { <p class="empty">{{ residencyEmptyMessage() }}</p> } @else { <p class="empty">No loaded model residency records were reported.</p> }
          @if (selected(); as model) {
            <aside id="residency-detail" class="detail-drawer" aria-label="Selected model residency details"><header><div><div class="eyebrow">RESIDENCY DETAILS</div><h3>{{ model.model_id }}</h3></div><button type="button" class="close" (click)="selectedId.set('')" aria-label="Close model residency details">×</button></header>
              <a class="open-profile" routerLink="/models" [attr.aria-label]="'Open model profiles to configure ' + model.model_id" title="Go to Models to select this model and view its saved profiles">Open model profile</a>
              <dl><div><dt>State</dt><dd>{{ model.state || statusLabel('unknown') }}</dd></div><div><dt>Runtime</dt><dd>{{ model.runtime_id || statusLabel('unknown') }}</dd></div><div><dt>Profile</dt><dd>{{ model.profile_id || statusLabel('unknown') }}</dd></div><div><dt>Active leases</dt><dd>{{ count(model.lease_count) }}</dd></div><div><dt>Residency pin</dt><dd>{{ model.pinned === true ? 'Pinned' : model.pinned === false ? 'Not pinned' : statusLabel('unknown') }}</dd></div><div><dt>Estimated RAM</dt><dd>{{ bytes(model.estimated_ram_bytes, model.estimated_ram_status) }}</dd></div><div><dt>Estimated VRAM</dt><dd>{{ bytes(model.estimated_vram_bytes, model.estimated_vram_status) }}</dd></div><div><dt>Loaded for</dt><dd>{{ duration(model.loaded_for_seconds) }}</dd></div><div><dt>Idle for</dt><dd>{{ duration(model.idle_for_seconds) }}</dd></div></dl>
              @if (controlRoute(model); as routeId) { <div class="residency-actions" aria-label="Residency controls"><button type="button" [disabled]="actionPending()" (click)="applyControl(routeId, model.pinned ? 'unpin' : 'pin')">{{ model.pinned ? 'Unpin model' : 'Pin model' }}</button><button type="button" [disabled]="actionPending() || !canUnload(model)" [title]="unloadAvailability(model)" (click)="applyControl(routeId, 'unload')">Unload idle model</button></div> }
              @if (actionMessage()) { <p class="action-message" role="status">{{ actionMessage() }}</p> }
              @if (actionError()) { <p class="action-error" role="alert">{{ actionError() }}</p> }
              @if (!canUnload(model)) { <p class="control-note" role="status">{{ unloadAvailability(model) }}</p> }
            </aside>
          }
        </section>
        @if (service.refreshedAt(); as refreshed) { <p class="updated">Snapshot updated {{ refreshed.toLocaleTimeString() }}</p> }
      }
      @if (!service.loading() && !service.resources() && !service.residencyError() && !service.resourcesError()) { <section class="empty-state"><b>No resource data</b><p>The local API returned no resource snapshot.</p></section> }
    </main>
  `,
  styles: [`
    .pending-list{list-style:none;margin:0;padding:0}.pending-list li{display:grid;grid-template-columns:minmax(150px,1.2fr) repeat(2,minmax(100px,1fr));align-items:center;gap:10px;padding:9px 6px;border-top:1px solid #2b3340;color:#c4ccda;font:8px ui-monospace,monospace}.pending-model{display:grid;gap:4px;min-width:0}.pending-model b{font-size:9px;overflow-wrap:anywhere}.pending-model small{color:#929eae;overflow-wrap:anywhere}.open-profile{display:inline-block;margin-top:10px;color:#adc6ff;font-size:9px}.open-profile:hover{text-decoration:underline}@media(max-width:650px){.pending-list li{grid-template-columns:minmax(0,1fr)}}
    .eviction-policy{display:grid;grid-template-columns:minmax(190px,auto) 1fr;align-items:center;gap:12px;margin:0 0 8px;padding:9px 10px;border:1px solid #323d4e;border-radius:4px;background:#121923}.eviction-policy label{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.eviction-policy b{color:#cbd8ec;font:9px ui-monospace,monospace}.eviction-policy select{max-width:220px;border:1px solid #39475d;border-radius:3px;background:#1a2230;color:#d6e0f1;padding:5px 7px;font:9px ui-monospace,monospace}.eviction-policy select:disabled{opacity:.6}.eviction-policy p{margin:0;color:#aebbd0;font-size:9px;line-height:1.5}@media(max-width:650px){.eviction-policy{grid-template-columns:1fr}}
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
  setEvictionPolicy(value: string): void { if (value === 'lru' || value === 'never') void this.service.setEvictionPolicy(value); }
  controlRoute(model: ResidentModel): string | null { return model.route_ids?.[0] ?? null; }
  canUnload(model: ResidentModel): boolean {
    return this.controlRoute(model) !== null && model.state === 'idle'
      && model.lease_count === 0 && model.pinned === false;
  }
  unloadAvailability(model: ResidentModel): string {
    if (model.state !== 'idle') return model.state ? `Unload unavailable while model state is ${model.state}.` : 'Unload unavailable: residency state is unknown.';
    if (model.lease_count !== 0) return model.lease_count == null ? 'Unload unavailable: active lease count is unknown.' : 'Unload unavailable while the model has active leases.';
    if (model.pinned !== false) return model.pinned === true ? 'Unpin this model before unloading it.' : 'Unload unavailable: pin status is unknown.';
    return 'Model is idle, has no active leases, and is unpinned.';
  }
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
  pendingReservations(): PendingReservationRow[] {
    const rows = this.service.resources()?.resources?.pending_reservations;
    if (!Array.isArray(rows)) return [];
    return rows.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      .map(item => ({
        model_id: typeof item.model_id === 'string' ? item.model_id : undefined,
        runtime_id: typeof item.runtime_id === 'string' ? item.runtime_id : undefined,
        state: typeof item.state === 'string' ? item.state : undefined,
        estimated_ram_bytes: typeof item.estimated_ram_bytes === 'number' ? item.estimated_ram_bytes : null,
        estimated_ram_status: typeof item.estimated_ram_status === 'string' ? item.estimated_ram_status : undefined,
        estimated_vram_bytes: typeof item.estimated_vram_bytes === 'number' ? item.estimated_vram_bytes : null,
        estimated_vram_status: typeof item.estimated_vram_status === 'string' ? item.estimated_vram_status : undefined,
      }));
  }
  pendingReservationCount(): string {
    if (this.pendingReservations().length) return String(this.pendingReservations().length);
    const status = this.service.resources()?.resources?.pending_reservations_status;
    if (status === 'not_supported' || status === 'unknown' || status == null) return this.statusLabel(status);
    return '0';
  }
  pendingReservationsMessage(): string {
    const status = this.service.resources()?.resources?.pending_reservations_status;
    if (status === 'not_supported') return 'Waiting models and their memory requirements are not reported by this API.';
    if (status === 'unknown' || status == null) return 'Pending reservation data: Unknown.';
    return 'No pending model reservations were reported.';
  }
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
