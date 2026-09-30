import React, { useEffect } from 'react';
import { ActiveScreen } from '../types';

interface SidebarProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  mobileOpen?: boolean;
  onClose?: () => void;
  // Kept in the interface for compatibility with the prototype shell. The
  // sidebar no longer presents synthetic telemetry as if it were live.
  gpu0Usage: number;
  gpu1Usage: number;
  hostRamUsage: number;
}

const navigationGroups: {
  label: string;
  items: { screen: ActiveScreen; label: string; icon: string }[];
}[] = [
  {
    label: 'Workspace',
    items: [{ screen: 'chat', label: 'Chat', icon: 'chat' }],
  },
  {
    label: 'Models',
    items: [
      { screen: 'models', label: 'Local Library', icon: 'inventory_2' },
      { screen: 'model-hubs', label: 'Model Hubs', icon: 'hub' },
      { screen: 'downloads', label: 'Downloads', icon: 'download' },
      { screen: 'load-model', label: 'Load & Placement', icon: 'memory' },
    ],
  },
  {
    label: 'Knowledge',
    items: [{ screen: 'knowledge', label: 'Knowledge (RAG)', icon: 'database' }],
  },
  {
    label: 'System',
    items: [
      { screen: 'hardware', label: 'Hardware', icon: 'developer_board' },
      { screen: 'providers-and-runtimes', label: 'Runtime Manager', icon: 'settings_input_component' },
      { screen: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { screen: 'local-api', label: 'Local API', icon: 'terminal' },
      { screen: 'tools-and-permissions', label: 'Tools & Permissions', icon: 'shield' },
      { screen: 'logs-and-traces', label: 'Logs & Traces', icon: 'dvr' },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeScreen, onNavigate, mobileOpen = false, onClose }) => {
  useEffect(() => {
    if (!mobileOpen || !onClose) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.matchMedia('(max-width: 1023px)').matches) {
        onClose();
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen, onClose]);

  const navigate = (screen: ActiveScreen) => {
    onNavigate(screen);
    if (mobileOpen) onClose?.();
  };

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}
      <aside
        id="primary-navigation-drawer"
        aria-label={mobileOpen ? 'Navigation menu' : undefined}
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col overflow-hidden border-r border-outline-variant/30 bg-surface-container-lowest shadow-[0_1px_8px_rgba(0,0,0,0.04)] transition-transform duration-200 ease-out motion-reduce:transition-none lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-outline-variant/20 bg-surface-container-low px-4">
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-high p-1 shadow-sm" aria-hidden="true">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <rect x="6" y="6" width="88" height="88" rx="22" fill="#131722" />
          <path d="M50 24 L50 35 M50 65 L50 76 M24 50 L35 50 M65 50 L76 50" stroke="#717a8e" strokeWidth="6" strokeLinecap="round" />
          <polygon points="50,32 74,50 50,68 26,50" fill="none" stroke="#3b82f6" strokeWidth="8" strokeLinejoin="round" />
          <circle cx="50" cy="50" r="13" fill="#60a5fa" />
          <circle cx="50" cy="24" r="6" fill="#10b981" />
          <circle cx="76" cy="50" r="6" fill="#3b82f6" />
          <circle cx="50" cy="76" r="6" fill="#a855f7" />
          <circle cx="24" cy="50" r="6" fill="#f59e0b" />
        </svg>
      </div>
      <div className="min-w-0">
        <span className="block truncate text-[14px] font-semibold tracking-tight text-on-surface">Local AI Studio</span>
        <span className="block truncate text-[11px] text-on-surface-variant">Local workstation</span>
      </div>
    </div>

    <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
      <div className="space-y-4">
        {navigationGroups.map((group) => (
          <section key={group.label} aria-labelledby={`nav-group-${group.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
            <h2
              id={`nav-group-${group.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
              className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-outline"
            >
              {group.label}
            </h2>
            <div className="space-y-0.5">
              {group.items.map(({ screen, label, icon }) => {
                const selected = activeScreen === screen;
                return (
                  <button
                    key={screen}
                    type="button"
                    onClick={() => navigate(screen)}
                    aria-current={selected ? 'page' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      selected
                        ? 'bg-surface-container-high font-semibold text-primary'
                        : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                    }`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{icon}</span>
                    <span className="truncate text-[13px]">{label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </nav>
      </aside>
    </>
  );
};
