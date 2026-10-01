import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CapabilityService, type CapabilityMapItem } from '../core/capability.service';

type SetupState = 'ready' | 'unknown' | 'unavailable';
type SetupAction = { path: '/models' | '/runtime' | '/resources' | '/skills'; label: string; detail: string };
type SetupSkill = NonNullable<CapabilityMapItem['skills']>[number];

@Component({
  selector: 'ai-setup-assistant-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="setup-page">
      <header class="page-heading">
        <div><span class="eyebrow">FIRST RUN / LOCAL READINESS</span><h1>Setup Assistant</h1>
          <p>Review what the local capability map reports and follow a concrete setup link for each capability.</p></div>
        <button type="button" (click)="load()" [disabled]="loading()" aria-controls="setup-results" [attr.aria-busy]="loading()">
          {{ loading() ? 'Checking…' : checked() ? '↻ Refresh status' : '↻ Check status' }}
        </button>
      </header>

      <p class="sr-only" role="status" aria-live="polite">{{ announcement() }}</p>

      <section class="read-only-note"><span class="lock" aria-hidden="true">◈</span><div><b>Read-only check</b>
        <p>This page reads <code>/api/capability-map</code> only. It does not start services, load models, or infer readiness.</p></div>
        @if (checkedAt()) { <small>Checked {{ checkedAt()!.toLocaleTimeString() }}</small> }
      </section>

      <div id="setup-results" aria-live="off">
      @if (loading() && !checked()) { <p class="state-message">Reading capability status from the local API…</p> }
      @if (error()) {
        <section class="fallback" role="alert"><div><b>Capability map unavailable</b>
          <p>The local API did not return capability data. Readiness is unknown until the API responds; this assistant will not probe or start runtimes.</p>
          <small>{{ error() }}</small></div><button type="button" (click)="load()" [disabled]="loading()">Retry</button></section>
        <section class="empty-map"><b>Setup actions remain available</b><p>Choose a destination directly while the map is unavailable.</p>
          <nav aria-label="Setup destinations"><a routerLink="/models">Review Models →</a><a routerLink="/runtime">Inspect Runtime →</a><a routerLink="/resources">Check Resources →</a><a routerLink="/skills">Browse Skills →</a></nav>
        </section>
      }
      @if (checked() && !error() && !items().length) {
        <section class="empty-map"><b>No capabilities reported</b><p>The API returned an empty map. No readiness is inferred.</p>
          <nav aria-label="Setup destinations"><a routerLink="/models">Review Models →</a><a routerLink="/runtime">Inspect Runtime →</a><a routerLink="/resources">Check Resources →</a><a routerLink="/skills">Browse Skills →</a></nav>
        </section>
      }
      @if (items().length) {
        <section class="summary" aria-label="Readiness counts">
          <div><b>{{ count('ready') }}</b><span>Ready</span></div><div><b>{{ count('unknown') }}</b><span>Unknown</span></div><div><b>{{ count('unavailable') }}</b><span>Unavailable</span></div>
        </section>
        @if (attentionItems().length) {
        <section class="capability-section" aria-labelledby="setup-attention-heading">
          <header><h2 id="setup-attention-heading">Needs attention</h2><p>Unknown or unavailable routes appear first so you can review setup gaps.</p></header>
          <div class="capability-list" aria-label="Capabilities needing attention">
          @for (item of attentionItems(); track item.id) {
            <article class="capability-row">
              <div class="capability-main"><span class="state-badge" [class]="'state-badge ' + stateOf(item)">{{ labelOf(item) }}</span>
                <div><h2>{{ item.id }}</h2><p>{{ explanation(item) }}</p></div></div>
              <div class="evidence"><span>{{ routeSummary(item) }}</span><small>{{ preferredRouteSummary(item) }}</small><small>{{ evidenceSummary(item) }}</small></div>
              <a class="setup-action" [routerLink]="actionFor(item).path"><span>{{ actionFor(item).label }}</span><small>{{ actionFor(item).detail }}</small><b aria-hidden="true">→</b></a>
              @if (relatedSkills(item).length) { <nav class="related-skills" aria-label="Related workflows">
                <span>Related workflows reported by API</span>
                @for (skill of relatedSkills(item); track skill.id) {
                  <a [routerLink]="['/skills']" [queryParams]="{ skill: skill.id }">{{ skill.name }} <small>{{ skill.status }}</small></a>
                }
              </nav> }
            </article>
          }
          </div>
        </section>
        }
        @if (readyItems().length) {
        <section class="capability-section" aria-labelledby="setup-ready-heading">
          <header><h2 id="setup-ready-heading">Ready capabilities</h2><p>These routes are reported ready by the local capability map.</p></header>
          <div class="capability-list" aria-label="Ready capabilities">
          @for (item of readyItems(); track item.id) {
            <article class="capability-row">
              <div class="capability-main"><span class="state-badge" [class]="'state-badge ' + stateOf(item)">{{ labelOf(item) }}</span>
                <div><h3>{{ item.id }}</h3><p>{{ explanation(item) }}</p></div></div>
              <div class="evidence"><span>{{ routeSummary(item) }}</span><small>{{ preferredRouteSummary(item) }}</small><small>{{ evidenceSummary(item) }}</small></div>
              <a class="setup-action" [routerLink]="actionFor(item).path"><span>{{ actionFor(item).label }}</span><small>{{ actionFor(item).detail }}</small><b aria-hidden="true">→</b></a>
              @if (relatedSkills(item).length) { <nav class="related-skills" aria-label="Related workflows">
                <span>Related workflows reported by API</span>
                @for (skill of relatedSkills(item); track skill.id) {
                  <a [routerLink]="['/skills']" [queryParams]="{ skill: skill.id }">{{ skill.name }} <small>{{ skill.status }}</small></a>
                }
              </nav> }
            </article>
          }
          </div>
        </section>
        }
      }
      </div>
    </main>
  `,
  styles: [`
    :host{display:block;color:var(--text,#e4e9f2)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.setup-page{max-width:1120px;margin:0 auto;padding:20px;display:grid;gap:12px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:12px;border-bottom:1px solid #2b3240}.eyebrow{color:#8793a8;font:9px ui-monospace,monospace;letter-spacing:.07em}.page-heading h1{margin:5px 0;font-size:23px}.page-heading p{margin:0;color:#98a3b5;font-size:11px;line-height:1.5}.page-heading button,.fallback button{padding:8px 10px;border:1px solid #3b4b63;border-radius:4px;background:#182334;color:#c8daf6;font-size:10px;cursor:pointer}.page-heading button:disabled,.fallback button:disabled{opacity:.55}.read-only-note{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid #304052;border-radius:5px;background:#141d29}.lock{color:#a6c7f6;font-size:17px}.read-only-note div{flex:1}.read-only-note b{color:#d6e4f8;font-size:10px}.read-only-note p{margin:4px 0 0;color:#9ba9bd;font-size:9px;line-height:1.5}.read-only-note code{color:#c6d7f2;font:9px ui-monospace,monospace}.read-only-note small{color:#8794a8;font:8px ui-monospace,monospace}.state-message{padding:12px;color:#a9b7cb;font-size:10px}.fallback,.empty-map{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px;border:1px solid #563c42;border-radius:5px;background:#241b20}.fallback b,.empty-map b{color:#f1d2d1;font-size:11px}.fallback p,.empty-map p{margin:5px 0;color:#bdafb2;font-size:10px;line-height:1.5}.fallback small{color:#de9da1;font-size:9px}.empty-map{display:block;border-color:#303b4b;background:#151b25}.empty-map b{color:#d8e2f1}.empty-map p{color:#9aa7ba}.empty-map nav{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.empty-map a{padding:7px 9px;border:1px solid #3a4a61;border-radius:4px;color:#c3d6f6;background:#192435;font-size:9px;text-decoration:none}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.summary div{display:grid;gap:3px;padding:10px;border:1px solid #2b3544;border-radius:4px;background:#151b25}.summary b{color:#dce7f7;font:16px ui-monospace,monospace}.summary span{color:#939fb2;font-size:9px}.capability-section{display:grid;gap:7px}.capability-section>header h2{margin:0;color:#d8e3f3;font-size:12px}.capability-section>header p{margin:3px 0 0;color:#929eb0;font-size:9px}.capability-list{display:grid;gap:7px}.capability-row{display:grid;grid-template-columns:minmax(190px,1.1fr) minmax(130px,.7fr) minmax(170px,.8fr);align-items:center;gap:14px;padding:11px;border:1px solid #2d3746;border-radius:5px;background:#151b25}.capability-main{display:flex;align-items:flex-start;gap:9px;min-width:0}.capability-main h2,.capability-main h3{margin:0;color:#dae4f3;font:10px ui-monospace,monospace;overflow-wrap:anywhere}.capability-main p{margin:5px 0 0;color:#929eb0;font-size:9px;line-height:1.45}.state-badge{flex:none;padding:4px 6px;border-radius:3px;background:#252b34;color:#bbc5d4;font:8px ui-monospace,monospace;text-transform:uppercase}.state-badge.ready{background:#1c302d;color:#5fe0a7}.state-badge.unknown{background:#302b20;color:#f0c979}.state-badge.unavailable{background:#342326;color:#ffaaa9}.evidence{display:grid;gap:4px;color:#b5c2d5;font:9px ui-monospace,monospace}.evidence small{color:#8794a8;font-size:8px;overflow-wrap:anywhere}.setup-action{display:grid;grid-template-columns:1fr auto;gap:3px 7px;align-items:center;padding:8px;border:1px solid #3a4b64;border-radius:4px;background:#1a2534;color:#caddfa;text-decoration:none}.setup-action span{font-size:9px}.setup-action small{grid-column:1;color:#93a3bb;font-size:8px}.setup-action b{grid-column:2;grid-row:1/3;color:#9bbbe8}.related-skills{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:5px 9px;padding-top:7px;border-top:1px solid #252f3d}.related-skills>span{width:100%;color:#8997aa;font-size:8px}.related-skills>a{display:inline-flex;gap:5px;align-items:center;color:#bdd2f4;font-size:9px;text-decoration:none}.related-skills>a small{color:#8c9bb0;font:8px ui-monospace,monospace}.related-skills>a:hover{text-decoration:underline}.setup-action:hover,.empty-map a:hover{border-color:#86a9db;color:#eff5ff}.setup-page button:focus-visible,.setup-page a:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}@media(max-width:760px){.setup-page{padding:14px 11px}.capability-row{grid-template-columns:1fr;gap:8px}.evidence{grid-template-columns:1fr 1fr}.page-heading{align-items:flex-start}.read-only-note{align-items:flex-start;flex-wrap:wrap}.read-only-note small{width:100%;margin-left:27px}}@media(max-width:440px){.page-heading{flex-direction:column}.summary{gap:5px}.summary div{padding:8px}}
  `],
})
export class SetupAssistantPage implements OnInit {
  private readonly capabilityService = inject(CapabilityService);
  readonly items = signal<CapabilityMapItem[]>([]);
  readonly loading = signal(false);
  readonly checked = signal(false);
  readonly checkedAt = signal<Date | null>(null);
  readonly error = signal('');
  readonly announcement = signal('');
  readonly sortedItems = computed(() => [...this.items()].sort((left, right) => left.id.localeCompare(right.id)));
  readonly attentionItems = computed(() => this.sortedItems().filter(item => this.stateOf(item) !== 'ready'));
  readonly readyItems = computed(() => this.sortedItems().filter(item => this.stateOf(item) === 'ready'));

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.announcement.set('Checking the local capability map.');
    try {
      this.items.set(await this.capabilityService.getMap());
      this.checkedAt.set(new Date());
      const count = this.items().length;
      this.announcement.set(`Capability map updated. ${count} ${count === 1 ? 'capability' : 'capabilities'} reported.`);
    } catch (error) {
      this.items.set([]);
      const message = error instanceof Error ? error.message : 'The local capability API did not respond.';
      this.error.set(message);
      this.announcement.set('Capability map could not be updated. Readiness is unknown.');
    } finally {
      this.checked.set(true);
      this.loading.set(false);
    }
  }

  stateOf(item: CapabilityMapItem): SetupState {
    if (item.status === 'ready') return 'ready';
    if (item.status === 'unavailable') return 'unavailable';
    return 'unknown';
  }
  labelOf(item: CapabilityMapItem): string { return this.stateOf(item); }
  count(state: SetupState): number { return this.sortedItems().filter(item => this.stateOf(item) === state).length; }

  explanation(item: CapabilityMapItem): string {
    if (item.status === 'ready') return 'The local capability map reports a ready route.';
    if (item.status === 'unavailable') return 'No compatible route is currently reported. Inspect local runtime setup.';
    if (item.status === 'degraded') return 'The route is partial or degraded; review its local setup evidence.';
    if (item.status === 'supported') return 'Support is declared, but readiness is not verified by the local map.';
    return 'The local map does not provide enough evidence to determine readiness.';
  }

  actionFor(item: CapabilityMapItem): SetupAction {
    const id = item.id.toLocaleLowerCase();
    if (/audio\.transcribe/.test(id)) return { path: '/runtime', label: 'Review speech-to-text setup', detail: 'Inspect locally reported audio routes' };
    if (/audio\.synthesize/.test(id)) return { path: '/runtime', label: 'Review text-to-speech setup', detail: 'Inspect locally reported voice routes' };
    if (/image\.(generate|edit)/.test(id)) return { path: '/runtime', label: 'Review image runtime setup', detail: 'Inspect local image route availability' };
    if (/vision|ocr/.test(id)) return { path: '/models', label: 'Review vision and OCR models', detail: 'Inspect compatible local model routes' };
    if (/knowledge|document/.test(id)) return { path: '/skills', label: 'Review document and knowledge workflows', detail: 'Browse installed workflows and their status' };
    if (/skill|workflow/.test(id)) return { path: '/skills', label: 'Browse related skills', detail: 'Review workflows that use this capability' };
    if (item.status === 'unavailable' || /runtime|backend|placement/.test(id)) return { path: '/runtime', label: 'Inspect runtime setup', detail: 'Review local runtime availability' };
    if (/resource|hardware|device|memory/.test(id)) return { path: '/resources', label: 'Check local resources', detail: 'Review reported machine capacity' };
    return { path: '/models', label: 'Review compatible models', detail: 'Inspect available model routes' };
  }

  relatedSkills(item: CapabilityMapItem): SetupSkill[] {
    return Array.isArray(item.skills) ? item.skills.filter(skill => !!skill?.id && !!skill?.name) : [];
  }

  routeSummary(item: CapabilityMapItem): string {
    const count = typeof item.routes === 'number' ? item.routes : item.route_count;
    return typeof count === 'number' ? `${count} route${count === 1 ? '' : 's'} reported` : 'Route count unknown';
  }
  preferredRouteSummary(item: CapabilityMapItem): string {
    return item.preferred_route_id ? `Preferred route: ${item.preferred_route_id}` : 'No preferred route reported';
  }
  evidenceSummary(item: CapabilityMapItem): string {
    const records = item.evidence;
    if (!Array.isArray(records) || !records.length) return 'No evidence reported';
    return records.map(record => `${record.source}: ${record.status || record.confidence}`).join(' · ');
  }
}
