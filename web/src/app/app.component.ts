import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './core/api.service';
import { ResourcesService } from './core/resources.service';
import { SelectionModeService } from './core/selection-mode.service';
import { InterfaceModeService } from './core/interface-mode.service';

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

const ADVANCED_NAV_GROUP = { label: 'ADVANCED', items: [
  { label: 'Hardware', path: '/hardware', icon: '▦' },
  { label: 'Resources', path: '/resources', icon: '▦' },
  { label: 'Capability Map', path: '/capability-map', icon: '⌘' },
  { label: 'Runtime Manager', path: '/runtime', icon: '⌘' },
  { label: 'Local API', path: '/local-api', icon: '⌘' },
  { label: 'Tools & Permissions', path: '/tools-permissions', icon: '⛨' },
  { label: 'Logs & Traces', path: '/logs', icon: '≋' },
  { label: 'Setup Assistant', path: '/setup-assistant', icon: '◇' },
] };

@Component({
  selector: 'ai-root', standalone: true, imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host{--sidebar:340px}
    .mode-picker{display:flex;align-items:center;gap:5px;padding:4px 6px;border:1px solid #303744;border-radius:4px;color:#8994a7;font:8px ui-monospace,monospace}.mode-picker select{max-width:115px;border:0;background:transparent;color:#cbd7eb;font:9px ui-monospace,monospace}.mode-picker select:disabled{opacity:.6}.mode-error{flex:0 1 180px;max-width:180px;overflow:hidden;color:#ffb4ab;font-size:8px;white-space:nowrap;text-overflow:ellipsis}
    .resource-chip{display:flex;align-items:center;gap:5px;max-width:320px;padding:5px 7px;border:1px solid #303744;border-radius:4px;color:#aebbd0;font:8px ui-monospace,monospace;text-decoration:none;white-space:nowrap}.resource-chip:hover{border-color:#637797;color:#d9e5f8}.resource-chip span{overflow:hidden;text-overflow:ellipsis}@media(max-width:1400px){.resource-chip{max-width:300px}.search-trigger{width:190px}}
    .resource-chip.resource-alert{border-color:#8f514a;color:#ffb4ab}.resource-chip.resource-alert:hover{border-color:#ffb4ab}
    .connection-chip{display:flex;align-items:center;gap:6px;color:#9ba2b0;font:9px ui-monospace,monospace;white-space:nowrap;text-decoration:none}.connection-chip.connected{color:var(--green)}.connection-chip:not(.connected){color:#ffb4ab;border:1px solid #8f514a;border-radius:4px;padding:5px 7px}.connection-chip:hover{text-decoration:underline}
    @media(max-width:540px){.connection-chip:not(.connected){display:flex;max-width:102px;overflow:hidden}.connection-chip:not(.connected) .connection-label{overflow:hidden;text-overflow:ellipsis}}
    .nav-group{margin:8px 0 13px}
    .nav-group-title{margin:0;padding:7px 8px 4px;color:#788397;font:500 9px/1.4 ui-monospace,monospace;letter-spacing:0}
    @media(max-width:1500px){:host{--sidebar:300px}}
    @media(max-width:800px){:host{--sidebar:256px}}
  `],
  template: `
    <div class="app-frame">
      <aside class="sidebar" [class.mobile-open]="mobileNav()">
        <a routerLink="/chat" class="brand" (click)="mobileNav.set(false)">
          <span class="brand-lights" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-copy"><b>Local AI Studio</b><small>Workstation Local Node</small></span>
        </a>
        <nav id="main-navigation" class="nav-list" aria-label="Main navigation">
          @for (group of navGroups(); track group.label) {
            <section class="nav-group" [attr.aria-label]="group.label + ' navigation'"><h2 class="nav-group-title">{{ group.label }}</h2>
              @for (item of group.items; track item.path) {
                <a [routerLink]="item.path" routerLinkActive="active" class="nav-item" (click)="mobileNav.set(false)"><span class="nav-icon">{{ item.icon }}</span><span class="nav-label">{{ item.label }}</span></a>
              }
            </section>
          }
        </nav>
      </aside>
      <div class="scrim" [class.visible]="mobileNav()" (click)="mobileNav.set(false)"></div>
      <section class="main-column">
        <header class="topbar">
          <button class="mobile-menu icon-button" (click)="mobileNav.set(!mobileNav())" aria-label="Toggle navigation" aria-controls="main-navigation" [attr.aria-expanded]="mobileNav()">☰</button>
          <div class="breadcrumbs"><span>Studio</span><i>›</i><b>{{ title() }}</b></div>
          <div class="top-actions">
            <button class="search-trigger" (click)="openPalette()"><span>⌕</span><span>Search pages</span><kbd>Ctrl+K</kbd></button>
            <label class="mode-picker" [title]="modeDescription()"><span>MODE</span><select aria-label="Global orchestration mode" [value]="selectionMode()" [disabled]="modeLoading() || !api.connected()" (change)="setSelectionMode($any($event.target).value)"><option value="auto">Auto</option><option value="guided">Guided</option><option value="manual">Manual / pinned</option></select></label>
            <a class="resource-chip" [class.resource-alert]="resourceError()" routerLink="/resources" [attr.aria-label]="'Open Resources · ' + (resourceError() || resourceIndicator())" [title]="resourceError() || ('Measured free/total values · ' + resourceIndicator())"><span aria-hidden="true">▦</span><span>{{ resourceError() ? 'Resources need attention' : resourceIndicator() }}</span></a>
            <a class="load-model-action" routerLink="/models"><span>＋</span><span>Models</span></a>
            <a class="connection-chip" [class.connected]="api.connected()" routerLink="/settings" [attr.aria-label]="api.connected() ? 'Local API online' : 'Local API needs attention. Open connection settings'" [title]="api.connected() ? 'Local API online' : (api.error() || 'Local API unavailable · Open connection settings')"><span class="pulse" [class.online]="api.connected()"></span><span class="connection-label">{{ api.connected() ? 'API Online' : api.connection() === 'checking' ? 'API Checking' : 'API Offline · Settings' }}</span></a>
            @if (modeError()) { <span class="mode-error" role="alert" [title]="modeError()">Mode: {{ modeError() }}</span> }
          </div>
        </header>
        <main class="content"><router-outlet /></main>
      </section>
      <footer class="statusbar"><div><span class="status-key">LOCAL ONLY</span><span class="divider">|</span><span>AI DREAM</span></div></footer>
      @if (paletteOpen()) {
        <div class="palette-backdrop" (click)="closePalette()">
          <section class="palette" role="dialog" aria-modal="true" aria-label="Navigate to a page" tabindex="-1" (click)="$event.stopPropagation()" (keydown)="onPaletteKeydown($event)"><label class="palette-search"><span aria-hidden="true">⌕</span><input #paletteInput role="combobox" aria-expanded="true" aria-autocomplete="list" aria-label="Search all pages" aria-controls="palette-results" [attr.aria-activedescendant]="activePaletteItemId()" placeholder="Jump to any page..." [value]="query()" (input)="setPaletteQuery($any($event.target).value)" (keydown.enter)="goActive()" /></label>
            <div class="palette-list" id="palette-results" role="listbox" aria-label="Available pages">@for (item of filteredNav(); track item.path; let i = $index) {<a role="option" [id]="paletteItemId(i)" [attr.aria-selected]="i === activePaletteIndex()" [routerLink]="item.path" (click)="closePalette()" [class.selected]="i === activePaletteIndex()"><span class="nav-icon">{{ item.icon }}</span>{{ item.label }}<kbd>↵</kbd></a>} @empty {<p class="muted" role="status">No matching page</p>}</div><div class="palette-hint">Navigate <kbd>↑</kbd><kbd>↓</kbd> <span>Open</span> <kbd>↵</kbd> <span>Close</span> <kbd>Esc</kbd></div>
          </section>
        </div>
      }
    </div>`
})
export class AppComponent {
  readonly api = inject(ApiService);
  private readonly resourceService = inject(ResourcesService);
  private readonly selectionModeService = inject(SelectionModeService);
  private readonly interfaceModeService = inject(InterfaceModeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private paletteReturnFocus: HTMLElement | null = null;
  readonly navGroups = computed(() => this.interfaceModeService.mode() === 'advanced'
    ? [...NAV_GROUPS, ADVANCED_NAV_GROUP]
    : NAV_GROUPS);
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
  readonly resourceError = computed(() => this.resourceService.resourcesError() || this.resourceService.residencyError());
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
    if (event.key === 'Escape') { this.closePalette(); this.mobileNav.set(false); }
  }
  openPalette() {
    if (this.paletteOpen()) return;
    this.paletteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.query.set(''); this.activePaletteIndex.set(0); this.paletteOpen.set(true);
    requestAnimationFrame(() => {
      if (!this.paletteOpen()) return;
      const backdrop = document.querySelector('.palette-backdrop');
      if (!backdrop) return;
      for (const sibling of Array.from(backdrop.parentElement?.children ?? [])) {
        if (sibling !== backdrop) (sibling as HTMLElement).setAttribute('inert', '');
      }
      backdrop.querySelector<HTMLInputElement>('[role="combobox"]')?.focus();
    });
  }
  closePalette() {
    if (!this.paletteOpen()) return;
    this.paletteOpen.set(false);
    const backdrop = document.querySelector('.palette-backdrop');
    for (const sibling of Array.from(backdrop?.parentElement?.children ?? [])) {
      if (sibling !== backdrop) (sibling as HTMLElement).removeAttribute('inert');
    }
    if (this.paletteReturnFocus?.isConnected) this.paletteReturnFocus.focus();
    this.paletteReturnFocus = null;
  }
  setPaletteQuery(value: string) { this.query.set(value); this.activePaletteIndex.set(0); }
  paletteItemId(index: number): string { return `palette-option-${index}`; }
  onPaletteKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closePalette(); return; }
    if (event.key === 'Tab') {
      const dialog = event.currentTarget as HTMLElement;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('input:not([disabled]), a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
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
    if (item) { void this.router.navigateByUrl(item.path); this.closePalette(); }
  }
}
