import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './core/api.service';
import { ResourcesService } from './core/resources.service';
import { SelectionModeService } from './core/selection-mode.service';

const NAV_GROUPS = [
  { label: 'WORK', items: [
    { label: 'Chat', path: '/chat', icon: '▤' },
    { label: 'Models', path: '/models', icon: '⬡' },
    { label: 'Create / Skills', path: '/skills', icon: '◇' },
    { label: 'Knowledge (RAG)', path: '/knowledge', icon: '▧' },
  ] },
  { label: 'ACTIVITY', items: [
    { label: 'Downloads', path: '/downloads', icon: '↓' },
  ] },
  { label: 'SETTINGS', items: [
    { label: 'Settings', path: '/settings', icon: '⚙' },
  ] },
];

// Keep every existing destination discoverable after reducing the permanent
// navigation surface. Deep links and route definitions remain unchanged.
const PALETTE_NAV_GROUPS = [
  { label: 'WORKSPACE', items: [
    { label: 'Chat', path: '/chat', icon: '▤' },
    { label: 'Agent', path: '/agent', icon: '◇' },
    { label: 'Models', path: '/models', icon: '⬡' },
    { label: 'Capability Map', path: '/capability-map', icon: '⌘' },
    { label: 'Setup Assistant', path: '/setup-assistant', icon: '◇' },
    { label: 'Skills', path: '/skills', icon: '◇' },
    { label: 'Runs', path: '/runs', icon: '≋' },
    { label: 'Canvas', path: '/canvas', icon: '▤' },
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
const PALETTE_NAV = PALETTE_NAV_GROUPS.flatMap(group => group.items);

@Component({
  selector: 'ai-root', standalone: true, imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host{--sidebar:340px}
    .mode-picker{display:flex;align-items:center;gap:5px;padding:4px 6px;border:1px solid #303744;border-radius:4px;color:#8994a7;font:8px ui-monospace,monospace}.mode-picker select{max-width:115px;border:0;background:transparent;color:#cbd7eb;font:9px ui-monospace,monospace}.mode-picker select:disabled{opacity:.6}.mode-error{flex:0 1 180px;max-width:180px;overflow:hidden;color:#ffb4ab;font-size:8px;white-space:nowrap;text-overflow:ellipsis}
    .resource-chip{display:flex;align-items:center;gap:5px;max-width:320px;padding:5px 7px;border:1px solid #303744;border-radius:4px;color:#aebbd0;font:8px ui-monospace,monospace;text-decoration:none;white-space:nowrap}.resource-chip:hover{border-color:#637797;color:#d9e5f8}.resource-chip span{overflow:hidden;text-overflow:ellipsis}@media(max-width:1400px){.resource-chip{max-width:300px}.search-trigger{width:190px}}
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
            <button class="search-trigger" (click)="openPalette()"><span>⌕</span><span>Search pages</span><kbd>Ctrl+K</kbd></button>
            <label class="mode-picker" [title]="modeDescription()"><span>MODE</span><select aria-label="Global orchestration mode" [value]="selectionMode()" [disabled]="modeLoading() || !api.connected()" (change)="setSelectionMode($any($event.target).value)"><option value="auto">Auto</option><option value="guided">Guided</option><option value="manual">Manual / pinned</option></select></label>
            <a class="resource-chip" routerLink="/resources" [attr.aria-label]="'Open Resources · ' + resourceIndicator()" [title]="'Measured free/total values · ' + resourceIndicator()"><span aria-hidden="true">▦</span><span>{{ resourceIndicator() }}</span></a>
            <a class="load-model-action" routerLink="/models"><span>＋</span><span>Models</span></a>
            <span class="connection-chip" [class.connected]="api.connected()" [title]="api.connected() ? 'Local API online' : api.connection() === 'checking' ? 'Checking local API' : 'Local API offline'"><span class="pulse" [class.online]="api.connected()"></span><span class="connection-label">{{ api.connected() ? 'API Online' : api.connection() === 'checking' ? 'API Checking' : 'API Offline' }}</span></span>
            @if (modeError()) { <span class="mode-error" role="alert" [title]="modeError()">Mode: {{ modeError() }}</span> }
          </div>
        </header>
        <main class="content"><router-outlet /></main>
      </section>
      <footer class="statusbar"><div><span class="status-key">LOCAL API</span><span class="pulse" [class.online]="api.connected()"></span><span>{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Connecting' : 'Unavailable' }}</span><span class="divider">|</span><span>LOCAL ONLY</span></div><div><span>ENDPOINT</span> <code>{{ api.baseUrl() }}</code><span class="divider">|</span><span>AI DREAM</span></div></footer>
      @if (paletteOpen()) {
        <div class="palette-backdrop" (click)="paletteOpen.set(false)" (keydown.escape)="paletteOpen.set(false)">
          <section class="palette" role="dialog" aria-label="Navigate to a page" (click)="$event.stopPropagation()" (keydown)="onPaletteKeydown($event)"><label class="palette-search"><span aria-hidden="true">⌕</span><input autofocus role="combobox" aria-expanded="true" aria-autocomplete="list" aria-label="Search all pages" aria-controls="palette-results" [attr.aria-activedescendant]="activePaletteItemId()" placeholder="Jump to any page..." [value]="query()" (input)="setPaletteQuery($any($event.target).value)" (keydown.escape)="paletteOpen.set(false)" (keydown.enter)="goActive()" /></label>
            <div class="palette-list" id="palette-results" role="listbox" aria-label="Available pages">@for (item of filteredNav(); track item.path; let i = $index) {<a role="option" [id]="paletteItemId(i)" [attr.aria-selected]="i === activePaletteIndex()" [routerLink]="item.path" (click)="paletteOpen.set(false)" [class.selected]="i === activePaletteIndex()"><span class="nav-icon">{{ item.icon }}</span>{{ item.label }}<kbd>↵</kbd></a>} @empty {<p class="muted" role="status">No matching page</p>}</div><div class="palette-hint">Navigate <kbd>↑</kbd><kbd>↓</kbd> <span>Open</span> <kbd>↵</kbd> <span>Close</span> <kbd>Esc</kbd></div>
          </section>
        </div>
      }
    </div>`
})
export class AppComponent {
  readonly api = inject(ApiService);
  private readonly resourceService = inject(ResourcesService);
  private readonly selectionModeService = inject(SelectionModeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly navGroups = NAV_GROUPS;
  readonly mobileNav = signal(false);
  readonly paletteOpen = signal(false);
  readonly query = signal('');
  readonly activePaletteIndex = signal(0);
  readonly selectionMode = this.selectionModeService.mode;
  readonly modeLoading = this.selectionModeService.loading;
  readonly modeError = this.selectionModeService.error;
  readonly filteredNav = computed(() => PALETTE_NAV.filter(item => item.label.toLowerCase().includes(this.query().toLowerCase())));
  readonly activePaletteItemId = computed(() => this.filteredNav().length ? this.paletteItemId(Math.min(this.activePaletteIndex(), this.filteredNav().length - 1)) : null);
  readonly title = signal('Chat (Loaded Model)');
  readonly resourceIndicator = computed(() => {
    const resources = this.resourceService.resources()?.resources;
    const available = resources?.ram?.available_bytes;
    const models = this.resourceService.residency()?.items ?? resources?.loaded_models;
    const ramLabel = typeof available === 'number' && Number.isFinite(available)
      ? `RAM ${this.formatBytes(available)} free` : 'RAM Unknown';
    const modelLabel = Array.isArray(models) ? `${models.length} loaded` : 'models Unknown';
    const gpus = resources?.gpus;
    const gpuLabel = Array.isArray(gpus) && gpus.length
      ? gpus.map((gpu, index) => {
        const free = typeof gpu.free_vram_bytes === 'number' && Number.isFinite(gpu.free_vram_bytes)
          ? this.formatBytes(gpu.free_vram_bytes) : 'Unknown';
        const total = typeof gpu.total_vram_bytes === 'number' && Number.isFinite(gpu.total_vram_bytes)
          ? this.formatBytes(gpu.total_vram_bytes) : 'Unknown';
        const gpuId = gpu.index ?? index;
        return `GPU${gpuId} ${free}/${total}`;
      }).join(' · ')
      : 'GPU Unknown';
    return `${gpuLabel} · ${ramLabel} · ${modelLabel}`;
  });
  constructor() {
    void this.selectionModeService.refresh();
    void this.resourceService.refresh();
    const timer = window.setInterval(() => {
      if (this.api.connected()) void this.resourceService.refresh();
    }, 30_000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(event => { this.title.set(PALETTE_NAV.find(item => event.urlAfterRedirects === item.path || event.urlAfterRedirects.startsWith(`${item.path}/`))?.label ?? 'Chat (Loaded Model)'); });
  }
  async setSelectionMode(value: string): Promise<void> {
    if (value !== 'auto' && value !== 'guided' && value !== 'manual') return;
    await this.selectionModeService.set(value);
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
  openPalette() { this.query.set(''); this.activePaletteIndex.set(0); this.paletteOpen.set(true); }
  setPaletteQuery(value: string) { this.query.set(value); this.activePaletteIndex.set(0); }
  paletteItemId(index: number): string { return `palette-option-${index}`; }
  onPaletteKeydown(event: KeyboardEvent) {
    const count = this.filteredNav().length;
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.activePaletteIndex.update(index => (index + delta + count) % count);
      requestAnimationFrame(() => document.getElementById(this.paletteItemId(this.activePaletteIndex()))?.scrollIntoView({ block: 'nearest' }));
    }
  }
  goActive() {
    const item = this.filteredNav()[this.activePaletteIndex()];
    if (item) { void this.router.navigateByUrl(item.path); this.paletteOpen.set(false); }
  }
}
