import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { ApiService } from './core/api.service';
import { ResourcesService } from './core/resources.service';

type SelectionMode = 'auto' | 'guided' | 'manual';
interface PreferenceResponse { data?: { selection_defaults?: { mode?: unknown } }; }

const NAV_GROUPS = [
  { label: 'WORKSPACE', items: [
    { label: 'Chat', path: '/chat', icon: '▤' },
    { label: 'Agent', path: '/agent', icon: '◇' },
    { label: 'Models', path: '/models', icon: '⬡' },
    { label: 'Capability Map', path: '/capability-map', icon: '⌘' },
    { label: 'Setup Assistant', path: '/setup-assistant', icon: '◇' },
    { label: 'Skills', path: '/skills', icon: '◇' },
    { label: 'Runs', path: '/runs', icon: '≋' },
    { label: 'Model Hubs', path: '/hub', icon: '⌕' },
    { label: 'Knowledge (RAG)', path: '/knowledge', icon: '▧' },
  ] },
  { label: 'SYSTEM', items: [
    { label: 'Resources', path: '/resources', icon: '▦' },
    { label: 'Hardware', path: '/hardware', icon: '▦' },
    { label: 'Load Model (Placement)', path: '/load-model', icon: '▣' },
    { label: 'Runtime Manager', path: '/runtime', icon: '⌘' },
    { label: 'Downloads', path: '/downloads', icon: '↓' },
  ] },
  { label: 'DEVELOPER', items: [
    { label: 'Local API', path: '/local-api', icon: '⌘' },
    { label: 'Tools & Permissions', path: '/tools-permissions', icon: '⛨' },
    { label: 'Logs & Traces', path: '/logs', icon: '≋' },
  ] },
  { label: 'SETTINGS', items: [
    { label: 'Settings', path: '/settings', icon: '⚙' },
  ] },
];
const NAV = NAV_GROUPS.flatMap(group => group.items);

@Component({
  selector: 'ai-root', standalone: true, imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host{--sidebar:340px}
    .mode-picker{display:flex;align-items:center;gap:5px;padding:4px 6px;border:1px solid #303744;border-radius:4px;color:#8994a7;font:8px ui-monospace,monospace}.mode-picker select{max-width:115px;border:0;background:transparent;color:#cbd7eb;font:9px ui-monospace,monospace}.mode-picker select:disabled{opacity:.6}.mode-error{max-width:240px;color:#ffb4ab;font-size:8px;overflow-wrap:anywhere}
    .resource-chip{display:flex;align-items:center;gap:5px;max-width:360px;padding:5px 7px;border:1px solid #303744;border-radius:4px;color:#aebbd0;font:8px ui-monospace,monospace;text-decoration:none;white-space:nowrap}.resource-chip:hover{border-color:#637797;color:#d9e5f8}.resource-chip span{overflow:hidden;text-overflow:ellipsis}@media(max-width:1000px){.resource-chip{max-width:190px}}
    .nav-group{margin:8px 0 13px}
    .nav-group-title{padding:7px 8px 4px;color:#788397;font:500 9px/1.4 ui-monospace,monospace;letter-spacing:0}
    @media(max-width:1500px){:host{--sidebar:300px}}
    @media(max-width:800px){:host{--sidebar:256px}}
  `],
  template: `
    <div class="app-frame">
      <aside class="sidebar" [class.mobile-open]="mobileNav()">
        <a routerLink="/chat" class="brand" (click)="mobileNav.set(false)">
          <span class="brand-lights" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-copy"><b>Local AI Studio</b><small>Workstation Local Node</small></span>
        </a>
        <nav class="nav-list" aria-label="Main navigation">
          @for (group of navGroups; track group.label) {
            <section class="nav-group"><div class="nav-group-title">{{ group.label }}</div>
              @for (item of group.items; track item.path) {
                <a [routerLink]="item.path" routerLinkActive="active" class="nav-item" (click)="mobileNav.set(false)"><span class="nav-icon">{{ item.icon }}</span><span class="nav-label">{{ item.label }}</span></a>
              }
            </section>
          }
        </nav>
        <div class="sidebar-bottom"><div class="backend-card">
          <div class="backend-heading"><span class="pulse" [class.online]="api.connected()"></span><b>LOCAL API</b><span class="backend-state" [class.offline]="!api.connected()">{{ api.connected() ? 'ONLINE' : api.connection() === 'checking' ? 'CHECKING' : 'OFFLINE' }}</span></div>
          <small>{{ api.baseUrl() }}</small><button title="Check connection" aria-label="Check API connection" (click)="api.check()">↻</button>
          <a routerLink="/settings" class="api-settings">Connection settings <span>→</span></a>
        </div></div>
      </aside>
      <div class="scrim" [class.visible]="mobileNav()" (click)="mobileNav.set(false)"></div>
      <section class="main-column">
        <header class="topbar">
          <button class="mobile-menu icon-button" (click)="mobileNav.set(!mobileNav())" aria-label="Toggle navigation">☰</button>
          <div class="breadcrumbs"><span>Studio</span><i>›</i><b>{{ title() }}</b></div>
          <div class="top-actions">
            <button class="search-trigger" (click)="openPalette()"><span>⌕</span><span>Search models, runtimes, commands</span><kbd>Ctrl+K</kbd></button>
            <label class="mode-picker" [title]="modeDescription()"><span>MODE</span><select aria-label="Global orchestration mode" [value]="selectionMode()" [disabled]="modeLoading() || !api.connected()" (change)="setSelectionMode($any($event.target).value)"><option value="auto">Auto</option><option value="guided">Guided</option><option value="manual">Manual / pinned</option></select></label>
            <a class="resource-chip" routerLink="/resources" [title]="'Resource snapshot: ' + resourceIndicator()"><span aria-hidden="true">▦</span><span>{{ resourceIndicator() }}</span></a>
            <a class="load-model-action" routerLink="/models"><span>＋</span><span>Models</span></a>
            <span class="connection-chip" [class.connected]="api.connected()"><span class="pulse" [class.online]="api.connected()"></span>{{ api.connected() ? 'API Online' : api.connection() === 'checking' ? 'API Checking' : 'API Offline' }}</span>
            @if (modeError()) { <span class="mode-error" role="alert">Mode: {{ modeError() }}</span> }
          </div>
        </header>
        <main class="content"><router-outlet /></main>
      </section>
      <footer class="statusbar"><div><span class="status-key">LOCAL API</span><span class="pulse" [class.online]="api.connected()"></span><span>{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Connecting' : 'Unavailable' }}</span><span class="divider">|</span><span>LOCAL ONLY</span></div><div><span>ENDPOINT</span> <code>{{ api.baseUrl() }}</code><span class="divider">|</span><span>AI DREAM</span></div></footer>
      @if (paletteOpen()) {
        <div class="palette-backdrop" (click)="paletteOpen.set(false)" (keydown.escape)="paletteOpen.set(false)">
          <section class="palette" (click)="$event.stopPropagation()"><label class="palette-search"><span>⌕</span><input autofocus placeholder="Jump to a page..." [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="paletteOpen.set(false)" (keydown.enter)="goFirst()" /></label>
            <div class="palette-list">@for (item of filteredNav(); track item.path; let i = $index) {<a [routerLink]="item.path" (click)="paletteOpen.set(false)" [class.selected]="i === 0"><span class="nav-icon">{{ item.icon }}</span>{{ item.label }}<kbd>↵</kbd></a>} @empty {<p class="muted">No matching page</p>}</div><div class="palette-hint">Navigate <kbd>↑</kbd><kbd>↓</kbd> <span>Open</span> <kbd>↵</kbd> <span>Close</span> <kbd>Esc</kbd></div>
          </section>
        </div>
      }
    </div>`
})
export class AppComponent {
  readonly api = inject(ApiService);
  private readonly resourceService = inject(ResourcesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly navGroups = NAV_GROUPS;
  readonly mobileNav = signal(false);
  readonly paletteOpen = signal(false);
  readonly query = signal('');
  readonly selectionMode = signal<SelectionMode>('auto');
  readonly modeLoading = signal(true);
  readonly modeError = signal('');
  readonly filteredNav = computed(() => NAV.filter(item => item.label.toLowerCase().includes(this.query().toLowerCase())));
  readonly title = signal('Chat (Loaded Model)');
  readonly resourceIndicator = computed(() => {
    const resources = this.resourceService.resources()?.resources;
    const available = resources?.ram?.available_bytes;
    const models = this.resourceService.residency()?.items ?? resources?.loaded_models;
    const ramLabel = typeof available === 'number' && Number.isFinite(available)
      ? `${this.formatBytes(available)} RAM free` : 'RAM Unknown';
    const modelLabel = Array.isArray(models) ? `${models.length} loaded` : 'models Unknown';
    const gpus = resources?.gpus;
    const gpuLabel = Array.isArray(gpus) && gpus.length
      ? gpus.map((gpu, index) => {
        const name = gpu.name || `GPU${gpu.index ?? index}`;
        const free = typeof gpu.free_vram_bytes === 'number' && Number.isFinite(gpu.free_vram_bytes)
          ? this.formatBytes(gpu.free_vram_bytes) : 'Unknown';
        const total = typeof gpu.total_vram_bytes === 'number' && Number.isFinite(gpu.total_vram_bytes)
          ? this.formatBytes(gpu.total_vram_bytes) : 'Unknown';
        return `${name} ${free}/${total} free`;
      }).join(' · ')
      : 'GPU Unknown';
    return `${gpuLabel} · ${ramLabel} · ${modelLabel}`;
  });
  constructor() {
    void this.loadSelectionMode();
    void this.resourceService.refresh();
    const timer = window.setInterval(() => {
      if (this.api.connected()) void this.resourceService.refresh();
    }, 30_000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(event => { this.title.set(NAV.find(item => event.urlAfterRedirects === item.path || event.urlAfterRedirects.startsWith(`${item.path}/`))?.label ?? 'Chat (Loaded Model)'); });
  }
  async loadSelectionMode(): Promise<void> {
    this.modeLoading.set(true); this.modeError.set('');
    try {
      const response = await firstValueFrom(this.api.get<PreferenceResponse>('/api/capability-preferences'));
      const mode = response?.data?.selection_defaults?.mode;
      if (mode !== 'auto' && mode !== 'guided' && mode !== 'manual') throw new Error('The local API returned an unsupported selection mode.');
      this.selectionMode.set(mode);
    } catch (error) { this.modeError.set(error instanceof Error ? error.message : 'The local API could not read selection defaults.'); }
    finally { this.modeLoading.set(false); }
  }
  async setSelectionMode(value: string): Promise<void> {
    if (value !== 'auto' && value !== 'guided' && value !== 'manual') return;
    this.modeLoading.set(true); this.modeError.set('');
    try {
      const response = await firstValueFrom(this.api.patch<PreferenceResponse>('/api/capability-preferences', { selection_defaults: { mode: value } }));
      if (response?.data?.selection_defaults?.mode !== value) throw new Error('The local API did not confirm the saved mode.');
      this.selectionMode.set(value);
    } catch (error) { this.modeError.set(error instanceof Error ? error.message : 'The local API could not save selection defaults.'); }
    finally { this.modeLoading.set(false); }
  }
  modeDescription(): string {
    return ({
      auto: 'Auto: resolve a compatible route from local capability evidence and saved preferences.',
      guided: 'Guided: resolve a route and review the plan before starting the skill.',
      manual: 'Manual / pinned: require explicit compatible model/profile choices; unresolved pins are not silently replaced.',
    } as const)[this.selectionMode()];
  }
  private formatBytes(value: number): string {
    if (!Number.isFinite(value) || value < 0) return 'Unknown';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let amount = value, unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }
  @HostListener('window:keydown', ['$event']) onKey(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); this.openPalette(); }
    if (event.key === 'Escape') { this.paletteOpen.set(false); this.mobileNav.set(false); }
  }
  openPalette() { this.query.set(''); this.paletteOpen.set(true); }
  goFirst() { const item = this.filteredNav()[0]; if (item) { void this.router.navigateByUrl(item.path); this.paletteOpen.set(false); } }
}
