import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './core/api.service';

const NAV_GROUPS = [
  { label: 'WORKSPACE', items: [
    { label: 'Chat', path: '/chat', icon: '▤' },
    { label: 'Agent', path: '/agent', icon: '◇' },
    { label: 'Models', path: '/models', icon: '⬡' },
    { label: 'Capability Map', path: '/capability-map', icon: '⌘' },
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
            <a class="load-model-action" routerLink="/models"><span>＋</span><span>Models</span></a>
            <span class="connection-chip" [class.connected]="api.connected()"><span class="pulse" [class.online]="api.connected()"></span>{{ api.connected() ? 'API Online' : api.connection() === 'checking' ? 'API Checking' : 'API Offline' }}</span>
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
  private readonly router = inject(Router);
  readonly navGroups = NAV_GROUPS;
  readonly mobileNav = signal(false);
  readonly paletteOpen = signal(false);
  readonly query = signal('');
  readonly filteredNav = computed(() => NAV.filter(item => item.label.toLowerCase().includes(this.query().toLowerCase())));
  readonly title = signal('Chat (Loaded Model)');
  constructor() { this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(event => { this.title.set(NAV.find(item => event.urlAfterRedirects === item.path || event.urlAfterRedirects.startsWith(`${item.path}/`))?.label ?? 'Chat (Loaded Model)'); }); }
  @HostListener('window:keydown', ['$event']) onKey(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); this.openPalette(); }
    if (event.key === 'Escape') { this.paletteOpen.set(false); this.mobileNav.set(false); }
  }
  openPalette() { this.query.set(''); this.paletteOpen.set(true); }
  goFirst() { const item = this.filteredNav()[0]; if (item) { void this.router.navigateByUrl(item.path); this.paletteOpen.set(false); } }
}
