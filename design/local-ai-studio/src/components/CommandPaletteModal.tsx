import React, { useState, useEffect, useRef } from 'react';
import { ActiveScreen } from '../types';

interface CommandItem {
  id: string;
  title: string;
  category: string;
  icon: string;
  action: () => void;
  shortcut?: string;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: ActiveScreen) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const filteredRef = useRef<CommandItem[]>([]);
  const selectedIndexRef = useRef(selectedIndex);
  closeRef.current = onClose;
  selectedIndexRef.current = selectedIndex;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.getElementById('app-background');
    background?.setAttribute('inert', '');
    background?.setAttribute('aria-hidden', 'true');
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!dialogRef.current?.contains(active)) {
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

      const commands = filteredRef.current;
      if (event.target === searchRef.current && event.key === 'ArrowDown' && commands.length) {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % commands.length);
      } else if (event.target === searchRef.current && event.key === 'ArrowUp' && commands.length) {
        event.preventDefault();
        setSelectedIndex((index) => (index - 1 + commands.length) % commands.length);
      } else if (event.target === searchRef.current && event.key === 'Enter' && commands.length) {
        event.preventDefault();
        commands[selectedIndexRef.current]?.action();
      }
    };
    document.addEventListener('keydown', handleModalKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleModalKeyDown, true);
      background?.removeAttribute('inert');
      background?.removeAttribute('aria-hidden');
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const commands: CommandItem[] = [
    {
      id: 'cmd-chat',
      title: 'Open Chat',
      category: 'Navigation',
      icon: 'chat',
      shortcut: 'G C',
      action: () => {
        onNavigate('chat');
        onClose();
      },
    },
    {
      id: 'cmd-agent',
      title: 'Open Read-only Agent',
      category: 'Navigation',
      icon: 'smart_toy',
      action: () => {
        onNavigate('agent');
        onClose();
      },
    },
    {
      id: 'cmd-models',
      title: 'Models (Local Library)',
      category: 'Navigation',
      icon: 'database',
      shortcut: 'G M',
      action: () => {
        onNavigate('models');
        onClose();
      },
    },
    {
      id: 'cmd-model-hubs',
      title: 'Browse Hugging Face GGUF models',
      category: 'Navigation',
      icon: 'hub',
      shortcut: 'G H',
      action: () => {
        onNavigate('model-hubs');
        onClose();
      },
    },
    {
      id: 'cmd-hardware',
      title: 'Hardware (Multi-GPU)',
      category: 'Navigation',
      icon: 'memory',
      shortcut: 'G T',
      action: () => {
        onNavigate('hardware');
        onClose();
      },
    },
    {
      id: 'cmd-placement',
      title: 'Load Model (Placement)',
      category: 'Navigation',
      icon: 'view_in_ar',
      shortcut: 'G P',
      action: () => {
        onNavigate('load-model');
        onClose();
      },
    },
    {
      id: 'cmd-providers',
      title: 'Open Runtime Manager',
      category: 'Navigation',
      icon: 'dns',
      action: () => {
        onNavigate('providers-and-runtimes');
        onClose();
      },
    },
    {
      id: 'cmd-local-api',
      title: 'Local API Server',
      category: 'Navigation',
      icon: 'terminal',
      shortcut: 'G A',
      action: () => {
        onNavigate('local-api');
        onClose();
      },
    },
    {
      id: 'cmd-knowledge',
      title: 'Knowledge (Local Search)',
      category: 'Navigation',
      icon: 'library_books',
      shortcut: 'G K',
      action: () => {
        onNavigate('knowledge');
        onClose();
      },
    },
    {
      id: 'cmd-tools',
      title: 'Tools & Permissions',
      category: 'Navigation',
      icon: 'verified_user',
      shortcut: 'G S',
      action: () => {
        onNavigate('tools-and-permissions');
        onClose();
      },
    },
    {
      id: 'cmd-downloads',
      title: 'Downloads',
      category: 'Navigation',
      icon: 'download',
      action: () => {
        onNavigate('downloads');
        onClose();
      },
    },
    {
      id: 'cmd-logs',
      title: 'Logs & Traces',
      category: 'Navigation',
      icon: 'receipt_long',
      action: () => {
        onNavigate('logs-and-traces');
        onClose();
      },
    },
    {
      id: 'cmd-settings',
      title: 'Settings',
      category: 'Navigation',
      icon: 'settings',
      shortcut: 'G ,',
      action: () => {
        onNavigate('settings');
        onClose();
      },
    },
  ];

  const filtered = commands.filter((cmd) => {
    return (
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.category.toLowerCase().includes(query.toLowerCase())
    );
  });
  filteredRef.current = filtered;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-3 sm:px-4 bg-scrim/75 backdrop-blur-sm animate-in fade-in duration-150" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog" aria-modal="true" aria-label="Command palette" aria-describedby="command-palette-help"
        tabIndex={-1}
        className="w-full max-w-2xl max-h-[80dvh] bg-surface border border-outline-variant rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-outline-variant bg-surface-container-low gap-3">
          <span className="material-symbols-outlined text-primary" aria-hidden="true">search</span>
          <input
            ref={searchRef}
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls="command-list"
            aria-activedescendant={filtered.length ? `command-${filtered[selectedIndex]?.id}` : undefined}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or jump to screen... (e.g. Chat, Hardware, API)"
            className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-outline font-sans"
          />
          <span id="command-palette-help" className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-container-low text-outline border border-outline-variant">
            ESC to close
          </span>
        </div>

        {/* Command List */}
        <div id="command-list" role="listbox" aria-label="Available commands" className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-outline">
              No commands matching "{query}"
            </div>
          ) : (
            filtered.map((item, index) => (
              <div
                key={item.id}
                id={`command-${item.id}`}
                role="option"
                aria-selected={selectedIndex === index}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left text-xs font-mono transition-colors ${
                  selectedIndex === index
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'text-on-surface-variant hover:bg-surface-container-low border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-base text-primary">
                    {item.icon}
                  </span>
                  <div>
                    <div className="text-on-surface font-medium">{item.title}</div>
                    <div className="text-[10px] text-outline">{item.category}</div>
                  </div>
                </div>

                {item.shortcut && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-low text-outline border border-outline-variant">
                    {item.shortcut}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-between text-[11px] font-mono text-outline">
          <div className="flex items-center gap-4">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
          </div>
          <span className="text-primary">Command palette</span>
        </div>
      </div>
    </div>
  );
};
