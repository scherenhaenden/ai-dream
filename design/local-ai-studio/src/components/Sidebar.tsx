import React, { useEffect, useRef } from 'react';
import './accessibility.css';
import { ActiveScreen } from '../types';

interface SidebarProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeScreen,
  onNavigate,
  isOpen = false,
  onClose,
}) => {
  const asideRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const navigate = (screen: ActiveScreen) => {
    onNavigate(screen);
    onClose?.();
  };
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => asideRef.current?.querySelector<HTMLElement>('nav button')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
      } else if (event.key === 'Tab') {
        const focusable = asideRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!asideRef.current?.contains(active)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);
  return (
    <>
      {isOpen && <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-scrim/60 lg:hidden" />}
    <aside ref={asideRef} id="primary-navigation" aria-label="Primary navigation" className={`fixed left-0 top-0 h-dvh w-[min(18rem,88vw)] bg-surface-container-lowest z-50 flex flex-col justify-between overflow-hidden border-r border-outline-variant/30 pb-6 lg:pb-0 shadow-[0_1px_8px_rgba(0,0,0,0.04)] transition-transform duration-200 ease-out lg:translate-x-0 ${isOpen ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible'}`}>
      {/* Header and Nav Links */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between bg-surface-container-low border-b border-outline-variant/20">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Logo Icon SVG */}
            <div className="w-8 h-8 rounded-lg bg-surface-container-high border border-outline-variant/40 flex items-center justify-center p-1 relative shrink-0 shadow-sm">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {/* Outer frame */}
                <rect x="6" y="6" width="88" height="88" rx="22" fill="var(--color-surface-container-low)" />
                {/* Connecting nodes */}
                <path d="M50 24 L50 35 M50 65 L50 76 M24 50 L35 50 M65 50 L76 50" stroke="var(--color-outline)" strokeWidth="6" strokeLinecap="round" />
                {/* Eye Diamond */}
                <polygon points="50,32 74,50 50,68 26,50" fill="none" stroke="var(--color-primary)" strokeWidth="8" strokeLinejoin="round" />
                {/* Center pupil */}
                <circle cx="50" cy="50" r="13" fill="var(--color-primary)" />
                {/* Outer dots */}
                <circle cx="50" cy="24" r="6" fill="var(--color-tertiary)" />
                <circle cx="76" cy="50" r="6" fill="var(--color-primary)" />
                <circle cx="50" cy="76" r="6" fill="var(--color-secondary)" />
                <circle cx="24" cy="50" r="6" fill="var(--color-warning)" />
              </svg>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[14px] text-on-surface tracking-tight truncate">
                  Local AI Studio
                </span>
                <span className="text-[10px] px-1 py-0.2 rounded bg-surface-container-high text-primary font-mono font-medium">
                  DESIGN
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                <span className="text-[11px] text-on-surface-variant truncate">
                  Design reference · disconnected
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Categories */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          <nav aria-label="Main" className="space-y-4">
            {/* WORKSPACE */}
            <div className="space-y-0.5">
              <h2 className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-outline">
                Workspace
              </h2>
              <button
                onClick={() => navigate('chat')} aria-current={activeScreen === 'chat' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'chat'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chat</span>
                  <span className="text-[13px] truncate">Chat</span>
                </div>
              </button>

              <button
                onClick={() => navigate('agent')} aria-current={activeScreen === 'agent' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'agent'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">smart_toy</span>
                  <span className="text-[13px] truncate">Agent</span>
                </div>
              </button>

              <button
                onClick={() => navigate('models')} aria-current={activeScreen === 'models' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'models'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">inventory_2</span>
                  <span className="text-[13px] truncate">Models (Local Library)</span>
                </div>
              </button>

              <button
                onClick={() => navigate('model-hubs')} aria-current={activeScreen === 'model-hubs' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'model-hubs'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">hub</span>
                  <span className="text-[13px] truncate">Model Hub (Hugging Face)</span>
                </div>
              </button>

              <button
                onClick={() => navigate('knowledge')} aria-current={activeScreen === 'knowledge' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'knowledge'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">database</span>
                  <span className="text-[13px] truncate">Knowledge (RAG)</span>
                </div>
              </button>
            </div>

            {/* SYSTEM */}
            <div className="space-y-0.5">
              <h2 className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-outline">
                System
              </h2>

              <button
                onClick={() => navigate('hardware')} aria-current={activeScreen === 'hardware' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'hardware'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">developer_board</span>
                  <span className="text-[13px] truncate">Hardware (Multi-GPU)</span>
                </div>
              </button>

              <button
                onClick={() => navigate('load-model')} aria-current={activeScreen === 'load-model' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'load-model'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">memory</span>
                  <span className="text-[13px] truncate">Load Model (Placement)</span>
                </div>
              </button>

              <button
                onClick={() => navigate('providers-and-runtimes')} aria-current={activeScreen === 'providers-and-runtimes' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'providers-and-runtimes'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">settings_input_component</span>
                  <span className="text-[13px] truncate">Runtime Manager</span>
                </div>
              </button>

              <button
                onClick={() => navigate('downloads')} aria-current={activeScreen === 'downloads' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'downloads'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">download</span>
                  <span className="text-[13px] truncate">Downloads</span>
                </div>
              </button>
            </div>

            {/* DEVELOPER */}
            <div className="space-y-0.5">
              <h2 className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-outline">
                Developer
              </h2>

              <button
                onClick={() => navigate('local-api')} aria-current={activeScreen === 'local-api' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'local-api'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">terminal</span>
                  <span className="text-[13px] truncate">Local API Server</span>
                </div>
              </button>

              <button
                onClick={() => navigate('tools-and-permissions')} aria-current={activeScreen === 'tools-and-permissions' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'tools-and-permissions'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">shield</span>
                  <span className="text-[13px] truncate">Tools &amp; Permissions</span>
                </div>
              </button>

              <button
                onClick={() => navigate('logs-and-traces')} aria-current={activeScreen === 'logs-and-traces' ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'logs-and-traces'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">dvr</span>
                  <span className="text-[13px] truncate">Logs &amp; Traces</span>
                </div>
              </button>
            </div>
          </nav>
        </div>
      </div>

      {/* Settings lives outside the screen navigation groups. */}
      <div className="p-3 bg-surface-container-low/90 border-t border-outline-variant/30">
        <div className="flex items-center pt-1">
          <button
            onClick={() => navigate('settings')} aria-current={activeScreen === 'settings' ? 'page' : undefined}
            className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors ${
              activeScreen === 'settings'
                ? 'text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">settings</span>
            <span>Settings</span>
          </button>
        </div>
      </div>
    </aside>
    </>
  );
};
