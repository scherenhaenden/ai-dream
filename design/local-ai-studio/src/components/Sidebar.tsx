import React from 'react';
import { ActiveScreen } from '../types';

interface SidebarProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  gpu0Usage: number;
  gpu1Usage: number;
  hostRamUsage: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeScreen,
  onNavigate,
  gpu0Usage,
  gpu1Usage,
  hostRamUsage,
}) => {
  return (
    <aside className="fixed left-0 top-0 h-full w-72 bg-surface-container-lowest z-50 flex flex-col justify-between overflow-hidden border-r border-outline-variant/30 select-none shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      {/* Header and Nav Links */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between bg-surface-container-low border-b border-outline-variant/20">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Logo Icon SVG */}
            <div className="w-8 h-8 rounded-lg bg-surface-container-high border border-outline-variant/40 flex items-center justify-center p-1 relative shrink-0 shadow-sm">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {/* Outer frame */}
                <rect x="6" y="6" width="88" height="88" rx="22" fill="#131722" />
                {/* Connecting nodes */}
                <path d="M50 24 L50 35 M50 65 L50 76 M24 50 L35 50 M65 50 L76 50" stroke="#717a8e" strokeWidth="6" strokeLinecap="round" />
                {/* Eye Diamond */}
                <polygon points="50,32 74,50 50,68 26,50" fill="none" stroke="#3b82f6" strokeWidth="8" strokeLinejoin="round" />
                {/* Center pupil */}
                <circle cx="50" cy="50" r="13" fill="#60a5fa" />
                {/* Outer dots */}
                <circle cx="50" cy="24" r="6" fill="#10b981" />
                <circle cx="76" cy="50" r="6" fill="#3b82f6" />
                <circle cx="50" cy="76" r="6" fill="#a855f7" />
                <circle cx="24" cy="50" r="6" fill="#f59e0b" />
              </svg>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[14px] text-on-surface tracking-tight truncate">
                  Local AI Studio
                </span>
                <span className="text-[10px] px-1 py-0.2 rounded bg-surface-container-high text-primary font-mono font-medium">
                  v1.6.0
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
                <span className="text-[11px] text-on-surface-variant truncate">
                  Workstation Local Node
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Categories */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          <nav className="space-y-4">
            {/* WORKSPACE */}
            <div className="space-y-0.5">
              <div className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-outline">
                Workspace
              </div>
              <button
                onClick={() => onNavigate('chat')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'chat'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">chat</span>
                  <span className="text-[13px] truncate">Chat</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-tertiary/10 text-tertiary rounded">
                  Active Qwen3.8
                </span>
              </button>

              <button
                onClick={() => onNavigate('models')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'models'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                  <span className="text-[13px] truncate">Models (Local Library)</span>
                </div>
                <span className="text-[11px] font-mono text-outline">43 files</span>
              </button>

              <button
                onClick={() => onNavigate('model-hubs')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'model-hubs'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">hub</span>
                  <span className="text-[13px] truncate">Model Hubs (HF / Scope)</span>
                </div>
                <span className="text-[11px] font-mono text-outline">Sync OK</span>
              </button>

              <button
                onClick={() => onNavigate('knowledge')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'knowledge'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">database</span>
                  <span className="text-[13px] truncate">Knowledge (RAG)</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-surface-container-high text-outline rounded">
                  HNSW
                </span>
              </button>
            </div>

            {/* SYSTEM */}
            <div className="space-y-0.5">
              <div className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-outline">
                System
              </div>

              <button
                onClick={() => onNavigate('hardware')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'hardware'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">developer_board</span>
                  <span className="text-[13px] truncate">Hardware (Multi-GPU)</span>
                </div>
                <span className="text-[11px] font-mono text-tertiary">2 GPU P2P</span>
              </button>

              <button
                onClick={() => onNavigate('load-model')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'load-model'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">memory</span>
                  <span className="text-[13px] truncate">Load Model (Placement)</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-primary/15 text-primary rounded">
                  Matrix v2
                </span>
              </button>

              <button
                onClick={() => onNavigate('providers-and-runtimes')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'providers-and-runtimes'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">settings_input_component</span>
                  <span className="text-[13px] truncate">Providers &amp; Runtimes</span>
                </div>
                <span className="text-[11px] font-mono text-tertiary">3 Daemons</span>
              </button>

              <button
                onClick={() => onNavigate('downloads')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'downloads'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  <span className="text-[13px] truncate">Downloads</span>
                </div>
                <span className="text-[10px] font-mono text-outline">1 active</span>
              </button>
            </div>

            {/* DEVELOPER */}
            <div className="space-y-0.5">
              <div className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-outline">
                Developer
              </div>

              <button
                onClick={() => onNavigate('local-api')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'local-api'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">terminal</span>
                  <span className="text-[13px] truncate">Local API Server</span>
                </div>
                <span className="text-[11px] font-mono text-primary font-semibold">:5200</span>
              </button>

              <button
                onClick={() => onNavigate('tools-and-permissions')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'tools-and-permissions'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">shield</span>
                  <span className="text-[13px] truncate">Tools &amp; Permissions</span>
                </div>
                <span className="text-[10px] font-mono text-tertiary">Sandbox</span>
              </button>

              <button
                onClick={() => onNavigate('logs-and-traces')}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md transition-colors text-left group ${
                  activeScreen === 'logs-and-traces'
                    ? 'bg-surface-container-high text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-[18px]">dvr</span>
                  <span className="text-[13px] truncate">Logs &amp; Traces</span>
                </div>
              </button>
            </div>
          </nav>
        </div>
      </div>

      {/* Hardware Telemetry Bottom Block */}
      <div className="p-3 bg-surface-container-low/90 border-t border-outline-variant/30 space-y-2">
        <div className="p-2 rounded bg-surface-container-lowest border border-outline-variant/20 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-outline uppercase font-semibold">
              DAEMON STACK
            </span>
            <span className="text-[10px] font-mono text-tertiary font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
              ONLINE
            </span>
          </div>
          <p className="text-[10px] font-mono text-on-surface-variant truncate">
            llama-server • API Server • Vector DB
          </p>
        </div>

        {/* Telemetry Meters */}
        <div className="p-2 rounded bg-surface-container-lowest border border-outline-variant/20 space-y-1.5">
          {/* GPU 0 */}
          <div className="space-y-0.5">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-on-surface font-medium">GPU 0: RX 9070</span>
              <span className="text-error font-semibold">
                {(gpu0Usage * 0.16).toFixed(1)} / 16G ({gpu0Usage.toFixed(0)}%)
              </span>
            </div>
            <div className="h-1.5 w-full bg-surface-variant rounded-full overflow-hidden">
              <div
                className="h-full bg-error rounded-full transition-all duration-300"
                style={{ width: `${gpu0Usage}%` }}
              ></div>
            </div>
          </div>

          {/* GPU 1 */}
          <div className="space-y-0.5">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-on-surface font-medium">GPU 1: RX 9070</span>
              <span className="text-tertiary font-semibold">
                {(gpu1Usage * 0.16).toFixed(1)} / 16G ({gpu1Usage.toFixed(0)}%)
              </span>
            </div>
            <div className="h-1.5 w-full bg-surface-variant rounded-full overflow-hidden">
              <div
                className="h-full bg-tertiary rounded-full transition-all duration-300"
                style={{ width: `${gpu1Usage}%` }}
              ></div>
            </div>
          </div>

          {/* Host RAM */}
          <div className="space-y-0.5">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-on-surface-variant">Host RAM</span>
              <span className="text-on-surface-variant font-medium">
                {(hostRamUsage * 0.64).toFixed(1)} / 64G ({hostRamUsage.toFixed(0)}%)
              </span>
            </div>
            <div className="h-1 w-full bg-surface-variant rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-container rounded-full transition-all duration-300"
                style={{ width: `${hostRamUsage}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Runtime / Settings footer buttons */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => onNavigate('settings')}
            className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors ${
              activeScreen === 'settings'
                ? 'text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
            <span>Settings</span>
          </button>
          <button
            onClick={() => onNavigate('profiles')}
            className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors ${
              activeScreen === 'profiles'
                ? 'text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">manage_accounts</span>
            <span>Profiles</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
