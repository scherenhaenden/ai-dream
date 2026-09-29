import React, { useState } from 'react';
import { ActiveScreen } from '../types';

interface HeaderProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  onOpenCommandPalette: () => void;
  onToggleInspector?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeScreen,
  onNavigate,
  onOpenCommandPalette,
  onToggleInspector,
}) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [activeModel, setActiveModel] = useState('Qwen3.8-27B-Instruct');

  const getScreenTitle = () => {
    switch (activeScreen) {
      case 'chat':
        return 'Chat (Loaded Model)';
      case 'models':
        return 'Models (Local Library)';
      case 'model-hubs':
        return 'Model Hubs (HF / Scope)';
      case 'hardware':
        return 'Hardware (Multi-GPU)';
      case 'load-model':
        return 'Load Model (Placement)';
      case 'providers-and-runtimes':
        return 'Providers & Runtimes';
      case 'local-api':
        return 'Local API Server';
      case 'knowledge':
        return 'Knowledge Base (Local RAG)';
      case 'tools-and-permissions':
        return 'Tools & Permissions';
      case 'downloads':
        return 'Downloads';
      case 'logs-and-traces':
        return 'Logs & Traces';
      case 'settings':
        return 'Settings';
      case 'profiles':
        return 'Hardware Profiles';
      default:
        return 'Runtime Workspace';
    }
  };

  return (
    <header className="fixed top-0 left-72 right-0 h-14 bg-surface-container-lowest/90 backdrop-blur-xl z-40 px-4 flex items-center justify-between border-b border-outline-variant/30 select-none shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      {/* Left: Breadcrumbs & Search */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-[12px] text-outline">
          <span className="text-on-surface-variant font-medium">Studio</span>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-primary font-semibold truncate">{getScreenTitle()}</span>
        </div>

        {/* Global Command Search Box */}
        <div className="relative hidden md:flex items-center">
          <span className="material-symbols-outlined absolute left-2.5 text-outline text-[16px] pointer-events-none">
            search
          </span>
          <input
            onClick={onOpenCommandPalette}
            readOnly
            className="w-72 h-8 pl-8 pr-12 bg-surface-container-low hover:bg-surface-container text-on-surface placeholder:text-outline font-sans text-[12px] rounded-lg border border-outline-variant/30 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer transition-colors"
            placeholder="Search models, runtimes, commands..."
            type="text"
          />
          <kbd className="absolute right-2 px-1.5 py-0.5 rounded bg-surface-container-high text-outline text-[10px] font-mono">
            Ctrl+K
          </kbd>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Model dropdown indicator */}
        <div className="relative">
          <button
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            className="flex items-center gap-2 px-3 h-8 rounded-lg bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 transition-colors cursor-pointer text-left"
          >
            <span className="material-symbols-outlined text-primary text-[16px]">smart_toy</span>
            <span className="font-mono text-[12px] font-semibold text-on-surface truncate max-w-[150px]">
              {activeModel}
            </span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-surface-container-highest text-tertiary font-mono hidden xl:inline">
              [LOCAL]
            </span>
            <span className="material-symbols-outlined text-outline text-[14px]">expand_more</span>
          </button>

          {/* Dropdown Menu */}
          {modelDropdownOpen && (
            <div className="absolute right-0 top-10 w-80 bg-surface-container-high rounded-xl border border-outline-variant/40 shadow-2xl p-2 space-y-2 z-50">
              <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-outline">
                Loaded In Memory
              </div>
              <div
                onClick={() => {
                  setActiveModel('Qwen3.8-27B-Instruct');
                  setModelDropdownOpen(false);
                }}
                className="p-2 rounded-lg bg-surface-container hover:bg-surface-container-highest cursor-pointer flex items-center justify-between"
              >
                <div>
                  <div className="font-mono text-[12px] font-semibold text-primary">
                    Qwen3.8-27B-Instruct (Q4_K_M)
                  </div>
                  <div className="text-[11px] text-outline">llama.cpp Vulkan • 17.4 GB VRAM</div>
                </div>
                <span className="material-symbols-outlined text-tertiary text-[18px]">check_circle</span>
              </div>

              <div
                onClick={() => {
                  setActiveModel('DeepSeek-R1-Distill-14B');
                  setModelDropdownOpen(false);
                }}
                className="p-2 rounded-lg hover:bg-surface-container cursor-pointer flex items-center justify-between"
              >
                <div>
                  <div className="font-mono text-[12px] font-semibold text-on-surface">
                    DeepSeek-R1-Distill-14B (Q8_0)
                  </div>
                  <div className="text-[11px] text-outline">15.6 GB • GPU 0 Direct</div>
                </div>
              </div>

              <div className="px-2 pt-1 text-[10px] font-mono uppercase tracking-wider text-outline">
                Quick Actions
              </div>
              <button
                onClick={() => {
                  setModelDropdownOpen(false);
                  onNavigate('load-model');
                }}
                className="w-full flex items-center gap-2 p-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-mono text-[11px] font-medium"
              >
                <span className="material-symbols-outlined text-[16px]">tune</span>
                <span>Open Layer Placement Matrix...</span>
              </button>
            </div>
          )}
        </div>

        {/* Runtime info pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-surface-container-low border border-outline-variant/30 font-mono text-[11px] text-on-surface">
          <span className="material-symbols-outlined text-primary text-[15px]">bolt</span>
          <span>llama.cpp v6821 / Vulkan</span>
        </div>

        {/* System Ready Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-tertiary-container/20 border border-tertiary/30 font-mono text-[11px] text-tertiary">
          <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
          <span>System Ready • 2 GPUs Active</span>
        </div>

        {/* Load Model Button */}
        <button
          onClick={() => onNavigate('load-model')}
          className="flex items-center gap-1.5 px-3 h-8 bg-primary hover:bg-primary-fixed-dim text-on-primary font-semibold text-[12px] rounded-lg transition-colors shadow-sm"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>Load Model</span>
        </button>

        {/* Quick Inspector toggle */}
        {onToggleInspector && (
          <button
            onClick={onToggleInspector}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-outline-variant/30 transition-colors"
            title="Toggle Runtime Inspector"
          >
            <span className="material-symbols-outlined text-[17px]">dock_to_left</span>
          </button>
        )}

        {/* User profile avatar */}
        <div
          onClick={() => onNavigate('profiles')}
          className="w-8 h-8 rounded-full bg-primary flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all shrink-0"
          title="Hardware Profile (Operator)"
        >
          <span className="material-symbols-outlined text-on-primary text-[17px]">person</span>
        </div>
      </div>
    </header>
  );
};
