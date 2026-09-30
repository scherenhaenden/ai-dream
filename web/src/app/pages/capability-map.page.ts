import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CapabilityService, type CapabilityMapItem } from '../core/capability.service';
import type { CapabilityDeclaration, CapabilityStatus } from '../core/capability.types';
import { ApiService } from '../core/api.service';
import { firstValueFrom } from 'rxjs';

type CapabilityCard = CapabilityMapItem & {
  routeDetails?: CapabilityDeclaration['routes'];
  evidenceDetails?: CapabilityDeclaration['evidence'];
  detailsUnavailable?: boolean;
};

@Component({
  selector: 'ai-capability-map-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="capability-map">
      <header class="page-heading">
        <div><div class="eyebrow">SYSTEM / DISCOVERY</div><h1>Capability Map</h1>
          <p>See what this machine reports as available, and inspect the declared inputs, outputs and evidence.</p></div>
        <button type="button" (click)="load()" [disabled]="loading()" title="Refresh capability data from the local API">
          {{ loading() ? 'Loading…' : '↻ Refresh' }}
        </button>
      </header>

      <section class="overview" aria-label="Capability overview">
        <div class="overview-heading"><div><b>LOCAL CAPABILITY SNAPSHOT</b><span>{{ api.connected() ? 'Read-only · refreshed from local API' : 'Local API unavailable' }}</span></div>
          <span class="connection" [class.offline]="!api.connected()"><i></i>{{ api.connected() ? 'CONNECTED' : 'OFFLINE' }}</span>
        </div>
        <div class="overview-stats">
          <button type="button" class="stat total" [class.selected]="statusFilter() === 'all'" (click)="setStatusFilter('all')" aria-label="Show all capabilities">
            <b>{{ items().length }}</b><span>Reported</span>
          </button>
          @for (status of statuses; track status) {
            <button type="button" class="stat" [class.selected]="statusFilter() === status" [attr.data-status]="status" (click)="setStatusFilter(status)" [attr.aria-label]="'Filter by ' + status + ' status'">
              <b>{{ statusCount(status) }}</b><span>{{ statusLabel(status) }}</span>
            </button>
          }
        </div>
      </section>

      @if (error()) {
        <div class="notice error" role="alert"><span>{{ error() }}</span><button type="button" (click)="load()" [disabled]="loading()">Retry</button></div>
      }
      @if (loading() && !items().length) { <p class="state-message">Loading reported capabilities…</p> }
      @if (!loading() && !error() && !items().length) {
        <section class="empty"><b>No capability data available</b><p>The local API returned an empty map. No capabilities are inferred by this page.</p></section>
      }

      @if (items().length) {
        <section class="catalog" aria-label="Capability catalog">
          <div class="catalog-toolbar">
            <div class="catalog-title"><div><h2>Capability catalog</h2><span aria-live="polite" aria-atomic="true">{{ visibleItems().length }} of {{ items().length }} shown</span></div></div>
            <label class="search-box"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search capabilities" placeholder="Search ID, input, output or route" [value]="query()" (input)="query.set($any($event.target).value)"/><kbd>LOCAL</kbd></label>
          </div>
          <div class="filter-row" aria-label="Current filters">
            <span>Filter</span>
            @for (filter of filterOptions; track filter.value) {
              <button type="button" [class.active]="statusFilter() === filter.value" (click)="setStatusFilter(filter.value)">{{ filter.label }}<small>{{ filter.count() }}</small></button>
            }
          </div>
          @if (!visibleItems().length) {
            <div class="empty filtered-empty"><b>No matching capabilities</b><p>Try another search term or clear the status filter.</p><button type="button" (click)="clearFilters()">Clear filters</button></div>
          }
          @for (group of groups(); track group.key) {
            <section class="capability-group" [attr.aria-label]="group.label + ' capabilities'">
              <header class="group-heading"><div><span class="group-mark">{{ group.label.slice(0, 2) }}</span><div><h3>{{ group.label }}</h3><small>{{ groupCount(group.items.length) }}</small></div></div><span>{{ group.items.length }}</span></header>
              <div class="capability-list">
                @for (item of group.items; track item.id) {
                  <article class="capability-card">
                    <header><div><div class="capability-id">{{ item.id }}</div><small class="capability-summary">{{ ioSummary(item) }}</small></div><span class="status" [class]="'status ' + item.status">{{ statusLabel(item.status) }}</span></header>
                    <div class="facts">
                      <div><span>Routes</span><b>{{ routeCount(item) }}</b></div>
                      <div><span>Preferred route</span><code>{{ item.preferred_route_id || 'None reported' }}</code></div>
                      <div><span>Route evidence</span><b>{{ evidenceSummary(item) }}</b></div>
                    </div>
                    <div class="types">
                      <div><span>Inputs</span><div>@for (input of item.inputs || []; track input) { <code>{{ artifactLabel(input) }} · {{ input }}</code> } @empty { <small>Not reported</small> }</div></div>
                      <div><span>Outputs</span><div>@for (output of item.outputs || []; track output) { <code>{{ artifactLabel(output) }} · {{ output }}</code> } @empty { <small>Not reported</small> }</div></div>
                    </div>
                    @if (item.detailsUnavailable) { <p class="detail-degraded">Detailed route records are unavailable; compact status is shown.</p> }
                    @if (item.routeDetails?.length) {
                      <div class="route-models" aria-label="Registered compatible routes"><span>COMPATIBLE ROUTES</span>
                        @for (route of item.routeDetails; track route.id) {<div><code>{{ route.model_id || 'Model not reported' }}</code><small>{{ route.runtime_id || 'Runtime not reported' }}</small>@if (route.id === item.preferred_route_id) {<b>Preferred</b>}</div>}
                      </div>
                    } @else if (item.status === 'unavailable') { <p class="route-reason">No compatible runtime route is currently reported for this capability.</p> }
                    @if (evidenceRecords(item).length) {
                      <details><summary>Evidence sources</summary>
                        @for (evidence of evidenceRecords(item); track $index) {
                          <div class="evidence"><code>{{ evidence.source }}</code><span>{{ evidence.status || evidence.confidence }}@if (evidence.confidence) { · {{ evidence.confidence }} }@if (evidence.verified_at) { · {{ evidence.verified_at }} }</span>@if (evidence.details) {<p>{{ evidence.details }}</p>}</div>
                        }
                      </details>
                    }
                  </article>
                }
              </div>
            </section>
          }
          <p class="catalog-note">Route records show discovered model/runtime compatibility, not successful inference. Capability status and evidence are reported separately; missing fields remain “Not reported”.</p>
        </section>
      }
    </main>
  `,
  styles: [`
    :host{display:block;color:var(--text,#dee2f1)}.capability-map{max-width:1240px;margin:auto;padding:20px;display:grid;gap:12px}.page-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:2px}.eyebrow{font:9px ui-monospace,monospace;letter-spacing:1.1px;color:#7e8ba5;margin-bottom:7px}h1{font-size:23px;font-weight:550;margin:0}.page-heading p{font-size:11px;color:var(--muted,#939aaa);margin:5px 0 0}.page-heading button,.notice button,.filtered-empty button{background:#171c26;border:1px solid var(--line,#303744);color:var(--muted-2,#c2c6d6);border-radius:4px;padding:7px 10px;font:10px ui-monospace,monospace;cursor:pointer}.page-heading button:hover,.notice button:hover,.filtered-empty button:hover{border-color:#566178;color:var(--text)}.page-heading button:disabled,.notice button:disabled{opacity:.55}
    .overview{overflow:hidden;background:var(--panel,#171c26);border:1px solid #2b3240;border-radius:5px}.overview-heading{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:10px 12px;border-bottom:1px solid #2b3240}.overview-heading>div{display:grid;gap:4px}.overview-heading b{font:9px ui-monospace,monospace;letter-spacing:.6px;color:#bdc8dc}.overview-heading>div>span{font-size:9px;color:#818da2}.connection{display:flex;align-items:center;gap:6px;color:var(--green,#4edea3);font:8px ui-monospace,monospace;white-space:nowrap}.connection i{width:6px;height:6px;border-radius:50%;background:currentColor}.connection.offline{color:var(--red,#ffb4ab)}
    .overview-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;background:#2b3240}.stat{display:grid;gap:3px;min-height:55px;align-content:center;padding:7px 11px;border:0;background:#141923;color:#9aa5b7;text-align:left;cursor:pointer}.stat:hover{background:#1d2532}.stat.selected{box-shadow:inset 0 -2px #adc6ff;background:#1a2230}.stat b{color:#e0e6f0;font:17px ui-monospace,monospace;font-weight:500}.stat span{font-size:9px;color:#8e99ab}.stat[data-status=ready] b{color:var(--green,#4edea3)}.stat[data-status=supported] b{color:var(--amber,#f3c97b)}.stat[data-status=degraded] b{color:var(--amber,#f3c97b)}.stat[data-status=unavailable] b{color:var(--red,#ffb4ab)}.stat[data-status=unknown] b{color:#b2bed0}
    .capability-map> .notice{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;font-size:11px}.error{background:#2b2025;border:1px solid #53323a;color:var(--red,#ffb4ab)}.state-message{padding:10px;color:var(--muted);font-size:11px}.empty{padding:18px;background:var(--panel-2,#1b202a);border:1px solid #2a303c;border-radius:4px}.empty b{font-size:12px}.empty p{color:var(--muted);font-size:10px;margin:6px 0 0}
    .catalog{display:grid;gap:8px}.catalog-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px}.catalog-title h2{margin:0;color:#d8dfeb;font-size:13px;font-weight:550}.catalog-title span{display:block;margin-top:3px;color:#818da2;font:9px ui-monospace,monospace}.search-box{width:min(380px,45%);height:31px;display:flex;align-items:center;gap:7px;padding:0 8px;border:1px solid #303744;border-radius:4px;background:#111721;color:#9aa5b7}.search-box:focus-within{border-color:#6c84ad;box-shadow:0 0 0 1px #354866}.search-box>span{font-size:17px}.search-box input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--text);font-size:10px}.search-box input::placeholder{color:#707c90}.search-box kbd{padding:2px 4px;background:#222834;border:1px solid #424958;border-radius:3px;color:#8994a6;font:7px ui-monospace,monospace}.filter-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:2px 0 8px;border-bottom:1px solid #2b3240}.filter-row>span{margin-right:3px;color:#818da2;font:8px ui-monospace,monospace;text-transform:uppercase}.filter-row button{display:flex;align-items:center;gap:6px;padding:4px 7px;border:1px solid transparent;border-radius:3px;background:transparent;color:#9da8b9;font-size:9px;cursor:pointer}.filter-row button:hover{background:#171c26}.filter-row button.active{border-color:#3b4a63;background:#1b2534;color:#d3e0f6}.filter-row small{color:#7f8b9f;font:8px ui-monospace,monospace}
    .capability-group{display:grid;gap:7px}.group-heading{display:flex;justify-content:space-between;align-items:center;padding:5px 1px}.group-heading>div{display:flex;align-items:center;gap:8px}.group-mark{display:grid;place-items:center;width:24px;height:24px;border:1px solid #3b4b66;border-radius:3px;background:#192334;color:#adc6ff;font:8px ui-monospace,monospace}.group-heading h3{margin:0;color:#cbd4e3;font-size:10px;font-weight:550}.group-heading small{display:block;margin-top:3px;color:#7e899d;font:8px ui-monospace,monospace}.group-heading>span{color:#8994a7;font:9px ui-monospace,monospace}
    .capability-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,370px),1fr));gap:8px}.capability-card{min-width:0;padding:11px 12px;background:var(--panel-2,#1b202a);border:1px solid #2a303c;border-radius:4px}.capability-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding-bottom:8px;border-bottom:1px solid #2a303b}.capability-id{font:11px ui-monospace,monospace;color:#d5def0;overflow-wrap:anywhere}.capability-summary{display:block;margin-top:4px;color:#7f899b;font-size:8px}.status{flex:none;padding:4px 6px;border-radius:3px;background:#252a34;color:#aab4c5;font:8px ui-monospace,monospace;text-transform:uppercase}.status.ready{color:var(--green,#4edea3);background:#1c302d}.status.supported{color:var(--amber,#f3c97b);background:#302b20}.status.degraded{color:var(--amber,#f3c97b);background:#302b20}.status.unavailable{color:var(--red,#ffb4ab);background:#342326}.status.unknown{color:#bbc3d1}.facts{display:grid;grid-template-columns:.55fr 1.4fr .7fr;gap:8px;padding:9px 0}.facts>div{display:grid;align-content:start;gap:4px;min-width:0}.facts span,.types>div>span{color:#8993a7;font:8px ui-monospace,monospace;text-transform:uppercase}.facts b,.facts code{color:#c6cede;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.types{display:grid;gap:7px}.types>div{display:grid;grid-template-columns:48px minmax(0,1fr);gap:7px;align-items:start}.types>div>div{display:flex;flex-wrap:wrap;gap:4px}.types code,.evidence code{padding:3px 5px;background:#141923;color:#b8c9e6;border-radius:2px;font:8px ui-monospace,monospace}.types small{color:#818b9d;font-size:9px}.capability-card details{margin-top:9px;border-top:1px solid #2a303b;padding-top:7px}.capability-card summary{cursor:pointer;color:#9da8ba;font-size:9px}.evidence{display:flex;justify-content:space-between;gap:8px;padding:5px 0;color:#8e99ab;font:8px ui-monospace,monospace}.catalog-note{margin:2px 0;color:#788499;font-size:8px;line-height:1.4}.filtered-empty{padding:14px}.filtered-empty button{margin-top:9px}.notice button:disabled{opacity:.55}@media(max-width:700px){.capability-map{padding:14px 11px}.page-heading{align-items:flex-start}.overview-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.stat:first-child{grid-column:span 3}.catalog-toolbar{align-items:flex-start;flex-direction:column}.search-box{width:100%}.facts{grid-template-columns:.5fr 1.3fr}.facts>div:last-child{grid-column:1/-1}.capability-list{grid-template-columns:1fr}}@media(max-width:430px){.overview-heading{align-items:flex-start;flex-direction:column}.overview-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat:first-child{grid-column:span 2}.filter-row{gap:2px}.filter-row button{padding:4px 5px}}
    .route-models{display:grid;gap:5px;padding-top:8px;margin-top:8px;border-top:1px solid #2a303b}.route-models>span{color:#8993a7;font:8px ui-monospace,monospace}.route-models>div{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}.route-models code{max-width:100%;overflow-wrap:anywhere;color:#c1d0e8;font:8px ui-monospace,monospace}.route-models small{color:#8d99ac;font:8px ui-monospace,monospace}.route-models b{padding:2px 4px;border-radius:2px;background:#1c302d;color:#87d5a7;font:7px ui-monospace,monospace;text-transform:uppercase}.route-reason,.detail-degraded{margin:7px 0 0;padding:7px 8px;border-left:2px solid #bd8059;background:#211f1b;color:#d8c2a6;font-size:9px;line-height:1.4}.detail-degraded{border-color:#7387a5;background:#1b222d;color:#b1bfd2}.evidence{display:grid;grid-template-columns:minmax(80px,auto) 1fr;align-items:start}.evidence p{grid-column:1/-1;margin:1px 0 3px;color:#b8c5da;font-size:9px;line-height:1.45}
    .capability-map button:focus-visible,.capability-map input:focus-visible,.capability-map summary:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}
  `],
})
export class CapabilityMapPage implements OnInit {
  private readonly capabilityService = inject(CapabilityService);
  readonly api = inject(ApiService);
  readonly items = signal<CapabilityCard[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly query = signal('');
  readonly statusFilter = signal<'all' | CapabilityStatus>('all');
  readonly statuses: CapabilityStatus[] = ['ready', 'supported', 'degraded', 'unavailable', 'unknown'];
  readonly filterOptions = [
    { value: 'all' as const, label: 'All', count: () => this.items().length },
    ...this.statuses.map(value => ({ value, label: this.statusLabel(value), count: () => this.statusCount(value) })),
  ];
  readonly visibleItems = computed(() => {
    const term = this.query().trim().toLocaleLowerCase();
    const status = this.statusFilter();
    return this.items().filter(item => {
      if (status !== 'all' && item.status !== status) return false;
      if (!term) return true;
      const searchable = [
        item.id,
        item.preferred_route_id || '',
        ...(item.inputs || []),
        ...(item.outputs || []),
        ...((item.evidence || []).flatMap(evidence => [
          evidence.source,
          evidence.status || '',
          evidence.confidence,
          evidence.verified_at || evidence.observedAt || '',
          ...Object.values(evidence.details || {}).map(value => String(value)),
        ])),
      ];
      return searchable.some(value => value.toLocaleLowerCase().includes(term));
    });
  });
  readonly groups = computed(() => {
    const grouped = new Map<string, CapabilityMapItem[]>();
    for (const item of this.visibleItems()) {
      const key = item.id.includes('.') ? item.id.split('.', 1)[0] : 'other';
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, items]) => ({
        key,
        label: key === 'other' ? 'Other' : key.toLocaleUpperCase(),
        items: items.sort((left, right) => left.id.localeCompare(right.id)),
      }));
  });

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const compact = await this.capabilityService.getMap();
      let details: CapabilityDeclaration[] | null = null;
      try {
        const response = await firstValueFrom(this.api.get<{ data?: { capabilities?: CapabilityDeclaration[] } }>('/api/capabilities'));
        if (Array.isArray(response?.data?.capabilities)) details = response.data.capabilities;
      } catch { details = null; }
      const byId = new Map((details ?? []).map(item => [item.id, item]));
      this.items.set(compact.map(item => {
        const detail = byId.get(item.id);
        return { ...item, routeDetails: detail?.routes, evidenceDetails: detail?.evidence,
          detailsUnavailable: details === null || !detail };
      }));
    } catch (error) {
      const candidate = error as { error?: { error?: string }; message?: string };
      this.error.set(candidate?.error?.error || candidate?.message || 'Could not load the capability map.');
    } finally {
      this.loading.set(false);
    }
  }

  routeCount(item: CapabilityCard): number | string {
    if (item.routeDetails) return item.routeDetails.length;
    if (typeof item.routes === 'number') return item.routes;
    return typeof item.route_count === 'number' ? item.route_count : 'Not reported';
  }

  statusCount(status: CapabilityStatus): number {
    return this.items().filter(item => item.status === status).length;
  }

  statusLabel(status: CapabilityStatus): string {
    return ({ ready: 'Ready', supported: 'Available · unverified', degraded: 'Degraded', unavailable: 'Unavailable', unknown: 'Unknown' })[status];
  }

  setStatusFilter(status: 'all' | CapabilityStatus): void { this.statusFilter.set(status); }

  clearFilters(): void { this.query.set(''); this.statusFilter.set('all'); }

  ioSummary(item: CapabilityCard): string {
    const inputs = item.inputs === undefined ? 'inputs not reported' : `${item.inputs.length} input${item.inputs.length === 1 ? '' : 's'}`;
    const outputs = item.outputs === undefined ? 'outputs not reported' : `${item.outputs.length} output${item.outputs.length === 1 ? '' : 's'}`;
    return `${inputs} · ${outputs}`;
  }

  groupCount(count: number): string { return `${count} ${count === 1 ? 'capability' : 'capabilities'}`; }

  evidenceSummary(item: CapabilityCard): string {
    const records = item.evidenceDetails ?? item.evidence;
    if (!records) return item.detailsUnavailable ? 'Details unavailable' : 'Not reported';
    if (!records.length) return 'No record reported';
    const statuses = [...new Set(records.map(record => record.status || record.confidence).filter(Boolean))];
    return statuses.length ? statuses.join(' · ') : `${records.length} record${records.length === 1 ? '' : 's'}`;
  }

  evidenceRecords(item: CapabilityCard): Array<{source:string;status?:string;confidence?:string;verified_at?:string;details?:string}> {
    return (item.evidenceDetails ?? item.evidence ?? []) as Array<{source:string;status?:string;confidence?:string;verified_at?:string;details?:string}>;
  }

  artifactLabel(kind: string): string {
    return ({ text: 'Text', image: 'Image', audio: 'Audio', document: 'Document', video: 'Video', json: 'Structured data', embedding: 'Embedding', file_reference: 'File reference', tool_result: 'Tool result' } as Record<string,string>)[kind] || 'Artifact';
  }
}
