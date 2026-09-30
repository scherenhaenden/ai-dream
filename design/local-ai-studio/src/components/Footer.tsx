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
    <footer aria-label="Runtime status and shortcuts" className="fixed bottom-0 left-0 lg:left-72 right-0 h-6 bg-surface-container-lowest border-t border-outline-variant/30 z-50 flex items-center justify-between px-2 sm:px-3 font-mono text-[11px] text-outline shadow-[0_-1px_6px_rgba(0,0,0,0.06)]">
      <div className="flex min-w-0 items-center gap-1.5 text-on-surface-variant">
        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">info</span>
        <span className="truncate">Sample data · disconnected</span>
      </div>

      {/* Right items */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          type="button" aria-label="Toggle runtime inspector"
          onClick={onToggleInspector}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[13px]">vertical_split</span>
          <span className="hidden sm:inline">Inspector</span>
        </button>
        <button
          type="button" aria-label="Open logs and traces console"
          onClick={onToggleConsole}
          className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[13px]">terminal</span>
          <span className="hidden sm:inline">Logs</span>
        </button>
      </div>
    </footer>
  );
};
