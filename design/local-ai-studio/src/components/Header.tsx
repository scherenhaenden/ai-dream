import React, { useEffect, useRef, useState } from 'react';
import { ActiveScreen } from '../types';

interface HeaderProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  onOpenCommandPalette: () => void;
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeScreen,
  onNavigate,
  onOpenCommandPalette,
  onToggleInspector,
  inspectorOpen = false,
  onToggleSidebar,
  sidebarOpen = false,
}) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [activeModel, setActiveModel] = useState('Qwen3.8-27B-Instruct');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectExampleModel = (modelName: string) => {
    setActiveModel(modelName);
    setModelDropdownOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) {
        setModelDropdownOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setModelDropdownOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [modelDropdownOpen]);

  const getScreenTitle = () => {
    switch (activeScreen) {
      case 'chat':
        return 'Chat';
      case 'agent':
        return 'Agent';
      case 'models':
        return 'Models (Local Library)';
      case 'model-hubs':
        return 'Model Hub (Hugging Face)';
      case 'hardware':
        return 'Hardware (Multi-GPU)';
      case 'load-model':
        return 'Load Model (Placement)';
      case 'providers-and-runtimes':
        return 'Runtime Manager';
      case 'local-api':
        return 'Local API Server';
      case 'knowledge':
        return 'Knowledge (Local Full-Text Search)';
      case 'tools-and-permissions':
        return 'Tools & Permissions';
      case 'downloads':
        return 'Downloads';
      case 'logs-and-traces':
        return 'Logs & Traces';
      case 'settings':
        return 'Settings';
      default:
        return 'Runtime Workspace';
    }
  };

  return (
    <header className="fixed top-0 left-0 lg:left-72 right-0 h-14 bg-surface-container-lowest/90 backdrop-blur-xl z-40 px-2 sm:px-4 flex items-center justify-between border-b border-outline-variant/30 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      {/* Left: Breadcrumbs & Search */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 2xl:gap-4">
        <button type="button" onClick={onToggleSidebar} aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={sidebarOpen} aria-controls="primary-navigation" className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-on-surface-variant hover:bg-surface-container">
          <span className="material-symbols-outlined" aria-hidden="true">menu</span>
        </button>
        <div className="flex min-w-0 shrink items-center gap-1.5 font-mono text-[12px] text-outline">
          <span className="text-on-surface-variant font-medium">Studio</span>
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">chevron_right</span>
          <span className="max-w-28 truncate text-primary font-semibold sm:max-w-40">{getScreenTitle()}</span>
        </div>

        {/* Global Command Search Box */}
        <button type="button" onClick={onOpenCommandPalette} aria-label="Search models, runtimes, and commands" className="relative hidden md:flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-outline text-[16px] pointer-events-none" aria-hidden="true">
            search
          </span>
          <span className="flex h-8 w-32 items-center overflow-hidden whitespace-nowrap text-ellipsis rounded-lg border border-outline-variant/30 bg-surface-container-low pl-8 pr-12 font-sans text-[12px] text-outline transition-colors hover:bg-surface-container md:w-40 lg:w-48 2xl:w-72">
            <span className="2xl:hidden">Search…</span>
            <span className="hidden 2xl:inline">Search models, runtimes, commands…</span>
          </span>
          <kbd className="absolute right-2 px-1.5 py-0.5 rounded bg-surface-container-high text-outline text-[10px] font-mono">
            Ctrl/⌘ K
          </kbd>
        </button>
      </div>

      {/* Right Controls */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 xl:gap-3">
        {/* Model dropdown indicator */}
        <div ref={dropdownRef} className="relative hidden max-w-48 sm:block xl:max-w-56 2xl:max-w-none">
          <button
            ref={triggerRef}
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            type="button" aria-expanded={modelDropdownOpen} aria-controls="loaded-model-menu" aria-label={`Example model selection: ${activeModel}`}
            className="flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low px-2 transition-colors hover:bg-surface-container cursor-pointer text-left sm:gap-2 sm:px-3"
          >
            <span className="material-symbols-outlined text-primary text-[16px]" aria-hidden="true">smart_toy</span>
            <span className="font-mono text-[12px] font-semibold text-on-surface truncate max-w-[150px]">
              {activeModel}
            </span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-surface-container-highest text-tertiary font-mono hidden 2xl:inline">
              [EXAMPLE]
            </span>
            <span className="material-symbols-outlined text-outline text-[14px]" aria-hidden="true">expand_more</span>
          </button>

          {/* Dropdown Menu */}
          {modelDropdownOpen && (
            <div id="loaded-model-menu" role="group" aria-label="Example model choices and actions" className="absolute right-0 top-10 w-[min(20rem,calc(100vw-1rem))] bg-surface-container-high rounded-xl border border-outline-variant/40 shadow-2xl p-2 space-y-2 z-50">
              <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-outline">
                Example Model Choices
              </div>
              <button type="button"
                onClick={() => selectExampleModel('Qwen3.8-27B-Instruct')}
                className="w-full p-2 rounded-lg bg-surface-container hover:bg-surface-container-highest cursor-pointer flex items-center justify-between text-left"
              >
                <div>
                  <div className="font-mono text-[12px] font-semibold text-primary">
                    Qwen3.8-27B-Instruct (Q4_K_M)
                  </div>
                  <div className="text-[11px] text-outline">Example runtime • 17.4 GB</div>
                </div>
                <span className="material-symbols-outlined text-tertiary text-[18px]" aria-hidden="true">check_circle</span>
              </button>

              <button type="button"
                onClick={() => selectExampleModel('DeepSeek-R1-Distill-14B')}
                className="w-full p-2 rounded-lg hover:bg-surface-container cursor-pointer flex items-center justify-between text-left"
              >
                <div>
                  <div className="font-mono text-[12px] font-semibold text-on-surface">
                    DeepSeek-R1-Distill-14B (Q8_0)
                  </div>
                  <div className="text-[11px] text-outline">Example allocation • 15.6 GB</div>
                </div>
              </button>

              <div className="px-2 pt-1 text-[10px] font-mono uppercase tracking-wider text-outline">
                Quick Actions
              </div>
              <button
                type="button"
                onClick={() => {
                  setModelDropdownOpen(false);
                  onNavigate('load-model');
                }}
                className="w-full flex items-center gap-2 p-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-mono text-[11px] font-medium"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">tune</span>
                <span>Open Layer Placement Matrix...</span>
              </button>
            </div>
          )}
        </div>

        {/* Runtime info pill */}
        <div className="hidden 2xl:flex shrink-0 items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low px-2.5 h-8 font-mono text-[11px] text-on-surface">
          <span className="material-symbols-outlined text-primary text-[15px]" aria-hidden="true">bolt</span>
          <span>Example runtime • llama.cpp / Vulkan</span>
        </div>

        {/* System Ready Badge */}
        <div className="hidden 2xl:flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary/30 bg-tertiary-container/20 px-2.5 h-8 font-mono text-[11px] text-tertiary">
          <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
          <span>Example system state • 2 GPUs</span>
        </div>

        {/* Load Model Button */}
        <button
          type="button"
          onClick={() => onNavigate('load-model')}
          className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-2.5 font-semibold text-[12px] text-on-primary shadow-sm transition-colors hover:bg-primary-fixed-dim sm:px-3"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
          <span className="hidden sm:inline">Load Model</span>
          <span className="sm:hidden">Load</span>
        </button>

        {/* Quick Inspector toggle */}
        {onToggleInspector && (
          <button
            type="button"
            onClick={onToggleInspector}
            aria-pressed={inspectorOpen}
            aria-label="Toggle runtime inspector"
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-outline-variant/30 transition-colors"
            title="Toggle Runtime Inspector"
          >
            <span className="material-symbols-outlined text-[17px]" aria-hidden="true">dock_to_left</span>
          </button>
        )}

      </div>
    </header>
  );
};
