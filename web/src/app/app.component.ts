import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './core/api.service';

const NAV = [
  { label: 'Chat', path: '/chat', icon: '◫', group: 'WORKSPACE' },
  { label: 'Agent', path: '/agent', icon: '✳', group: 'WORKSPACE' },
  { label: 'Models', path: '/models', icon: '⬡', group: 'LIBRARY' },
  { label: 'Model Hub', path: '/hub', icon: '⌕', group: 'LIBRARY' },
  { label: 'Hardware', path: '/hardware', icon: '▤', group: 'SYSTEM' },
  { label: 'Runtime', path: '/runtime', icon: '⌘', group: 'SYSTEM' },
  { label: 'Downloads', path: '/downloads', icon: '⇩', group: 'SYSTEM' },
  { label: 'Settings', path: '/settings', icon: '⚙', group: 'PREFERENCES' },
];

@Component({
  selector: 'ai-root', standalone: true, imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-frame">
      <aside class="sidebar" [class.mobile-open]="mobileNav()">
        <a routerLink="/chat" class="brand" (click)="mobileNav.set(false)">
          <span class="brand-mark">A</span><span><b>AI DREAM</b><small>LOCAL STUDIO</small></span>
        </a>
        <button class="project-switch" (click)="openPalette()"><span class="project-icon">◈</span><span>Local workspace<small>On this device</small></span><span class="chevron">⌄</span></button>
        @for (group of groups; track group) {
          <div class="nav-group"><div class="nav-heading">{{ group }}</div>
            @for (item of navFor(group); track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" class="nav-item" (click)="mobileNav.set(false)"><span class="nav-icon">{{ item.icon }}</span>{{ item.label }}</a>
            }
          </div>
        }
        <div class="sidebar-bottom"><div class="backend-card">
          <span class="pulse" [class.online]="api.connected()"></span><div><b>{{ api.connected() ? 'API connected' : 'Backend unavailable' }}</b><small>{{ api.baseUrl() }}</small></div><button title="Check connection" (click)="api.check()">↻</button>
        </div></div>
      </aside>
      <div class="scrim" [class.visible]="mobileNav()" (click)="mobileNav.set(false)"></div>
      <section class="main-column">
        <header class="topbar">
          <button class="mobile-menu icon-button" (click)="mobileNav.set(!mobileNav())" aria-label="Toggle navigation">☰</button>
          <div class="breadcrumbs"><span>Workspace</span><i>/</i><b>{{ title() }}</b></div>
          <div class="top-actions"><span class="connection-chip" [class.connected]="api.connected()"><span class="pulse"></span>{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Offline' }}</span><button class="search-trigger" (click)="openPalette()"><span>⌕</span><span>Search anything...</span><kbd>Ctrl K</kbd></button><button class="avatar">ED</button></div>
        </header>
        <main class="content"><router-outlet /></main>
        <footer class="statusbar"><div><span class="pulse" [class.online]="api.connected()"></span>{{ api.connected() ? 'Local API ready' : 'Waiting for local backend' }}<span class="divider">|</span><span>Privacy: local</span></div><div>AI DREAM <span class="divider">·</span> v0.1 console</div></footer>
      </section>
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
  readonly nav = NAV;
  readonly groups = ['WORKSPACE', 'LIBRARY', 'SYSTEM', 'PREFERENCES'];
  readonly mobileNav = signal(false);
  readonly paletteOpen = signal(false);
  readonly query = signal('');
  readonly filteredNav = computed(() => NAV.filter(item => item.label.toLowerCase().includes(this.query().toLowerCase())));
  readonly title = signal('Chat');
  constructor() { this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(event => { this.title.set(NAV.find(item => item.path === event.urlAfterRedirects)?.label ?? 'Chat'); }); }
  navFor(group: string) { return NAV.filter(item => item.group === group); }
  @HostListener('window:keydown', ['$event']) onKey(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); this.openPalette(); }
    if (event.key === 'Escape') { this.paletteOpen.set(false); this.mobileNav.set(false); }
  }
  openPalette() { this.query.set(''); this.paletteOpen.set(true); }
  goFirst() { const item = this.filteredNav()[0]; if (item) { void this.router.navigateByUrl(item.path); this.paletteOpen.set(false); } }
}
