import React from 'react';

interface FooterProps {
  onToggleInspector?: () => void;
  onToggleConsole?: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  onToggleInspector,
  onToggleConsole,
}) => {
  return (
    <footer className="studio-footer fixed bottom-0 left-0 right-0 h-6 bg-surface-container-lowest border-t border-outline-variant/30 z-50 flex items-center justify-between px-3 font-mono text-[11px] text-outline shadow-[0_-1px_6px_rgba(0,0,0,0.06)] select-none">
      {/* Left items */}
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex items-center gap-1.5 text-on-surface-variant truncate">
          <span className="material-symbols-outlined text-tertiary text-[13px]">terminal</span>
          <span className="truncate">llama.cpp (Vulkan b6821)</span>
        </div>
        <span className="text-outline-variant">|</span>
        <div className="flex items-center gap-1 text-primary truncate">
          <span className="material-symbols-outlined text-[13px]">smart_toy</span>
          <span className="font-semibold truncate">Qwen3.8-27B-Instruct (Q4_K_M)</span>
        </div>
        <span className="text-outline-variant hidden md:inline">|</span>
        <div className="text-tertiary font-medium hidden md:inline truncate">
          42.4 tok/s • 32K ctx
        </div>
        <span className="text-outline-variant hidden lg:inline">|</span>
        <div className="text-on-surface-variant hidden lg:inline truncate">
          GPU0: 54°C 18% • GPU1: 49°C 12% • Gen4 x16
        </div>
      </div>

      {/* Right items */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-on-surface-variant hidden sm:inline">
          VRAM: <span className="text-on-surface font-semibold">22.0/32.0 GB</span> • RAM:{' '}
          <span className="text-on-surface font-semibold">28.4/64.0 GB</span>
        </div>
        <span className="text-outline-variant hidden sm:inline">|</span>
        <div className="flex items-center gap-1.5 text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
          <span>HF Hub Connected</span>
        </div>
        <span className="text-outline-variant">|</span>
        <button type="button" aria-label="Open runtime inspector"
          onClick={onToggleInspector}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[13px]">vertical_split</span>
          <span>Inspector</span>
        </button>
        <button type="button" aria-label="Open console logs"
          onClick={onToggleConsole}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[13px]">terminal</span>
          <span>Console</span>
        </button>
      </div>
    </footer>
  );
};
