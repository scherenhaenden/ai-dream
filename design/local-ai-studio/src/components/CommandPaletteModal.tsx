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
  onLoadModel: (modelName: string) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onLoadModel,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => previouslyFocused.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const commands: CommandItem[] = [
    {
      id: 'cmd-chat',
      title: 'Open Chat & Loaded Model Session',
      category: 'Navigation',
      icon: 'chat',
      shortcut: 'G C',
      action: () => {
        onNavigate('chat');
        onClose();
      },
    },
    {
      id: 'cmd-models',
      title: 'Local Models Library & Quant Inspector',
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
      title: 'Hugging Face & Ollama Repositories Hub',
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
      title: 'Hardware Orchestration & PCIe Topology Graph',
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
      title: 'Execution Target & Model Placement Matrix',
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
      title: 'Providers & Local Runtimes (vLLM, llama.cpp)',
      category: 'Navigation',
      icon: 'dns',
      action: () => {
        onNavigate('providers-and-runtimes');
        onClose();
      },
    },
    {
      id: 'cmd-local-api',
      title: 'Local API Server (OpenAI Compatible Endpoint)',
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
      title: 'Knowledge Base & Ingestion Pipeline (Local RAG)',
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
      title: 'Tools, Sandboxing & Ring Isolation Security',
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
      title: 'Multi-Threaded Download Manager',
      category: 'Navigation',
      icon: 'download',
      action: () => {
        onNavigate('downloads');
        onClose();
      },
    },
    {
      id: 'cmd-logs',
      title: 'System Logs & Real-Time Distributed Traces',
      category: 'Navigation',
      icon: 'receipt_long',
      action: () => {
        onNavigate('logs-and-traces');
        onClose();
      },
    },
    {
      id: 'cmd-settings',
      title: 'Workstation Engine Preferences & Compilation Flags',
      category: 'Navigation',
      icon: 'settings',
      shortcut: 'G ,',
      action: () => {
        onNavigate('settings');
        onClose();
      },
    },
    {
      id: 'cmd-load-qwen',
      title: 'Quick Load: Qwen3.8-27B-Instruct (Q4_K_M)',
      category: 'Model Action',
      icon: 'play_circle',
      action: () => {
        onLoadModel('Qwen3.8-27B-Instruct');
        onNavigate('chat');
        onClose();
      },
    },
    {
      id: 'cmd-load-deepseek',
      title: 'Quick Load: DeepSeek-R1-Distill-Qwen-14B (Q8_0)',
      category: 'Model Action',
      icon: 'play_circle',
      action: () => {
        onLoadModel('DeepSeek-R1-Distill-Qwen-14B');
        onNavigate('chat');
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

  useEffect(() => {
    if (!isOpen) return;
    const onPaletteKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' && filtered.length) { event.preventDefault(); setSelectedIndex((i) => (i + 1) % filtered.length); }
      if (event.key === 'ArrowUp' && filtered.length) { event.preventDefault(); setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length); }
      if (event.key === 'Enter' && filtered.length) { event.preventDefault(); filtered[Math.min(selectedIndex, filtered.length - 1)]?.action(); }
    };
    window.addEventListener('keydown', onPaletteKeyDown);
    return () => window.removeEventListener('keydown', onPaletteKeyDown);
  }, [isOpen, filtered, selectedIndex]);

  if (!isOpen) return null;

  return (
    <div onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog" aria-modal="true" aria-labelledby="command-palette-title"
        className="w-full max-w-2xl bg-[var(--ds-surface)] border border-[var(--ds-outline-variant)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const items = event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])');
          const first = items[0]; const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-[var(--ds-outline-variant)] bg-[var(--ds-surface-container-low)] gap-3">
          <span className="material-symbols-outlined text-[var(--ds-primary)]">search</span>
          <span id="command-palette-title" className="sr-only">Command palette</span>
          <input
            ref={inputRef}
            type="text" aria-label="Search commands" aria-controls="command-list" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-activedescendant={filtered[selectedIndex] ? filtered[selectedIndex].id : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or jump to screen... (e.g. Chat, Hardware, API)"
            className="flex-1 bg-transparent text-sm text-on-surface placeholder-[var(--ds-on-surface-variant)] focus:outline-none font-sans"
            autoFocus
          />
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--ds-surface-container-low)] text-[var(--ds-on-surface-variant)] border border-[var(--ds-outline-variant)]">
            ESC to close
          </span>
        </div>

        {/* Command List */}
        <div id="command-list" role="listbox" aria-label="Available commands" className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-[var(--ds-on-surface-variant)]">
              No commands matching "{query}"
            </div>
          ) : (
            filtered.map((item, index) => (
              <button
                id={item.id} role="option" aria-selected={selectedIndex === index}
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left text-xs font-mono transition-colors ${
                  selectedIndex === index
                    ? 'bg-blue-600/20 text-[var(--ds-primary)] border border-blue-500/30'
                    : 'text-[var(--ds-on-surface-variant)] hover:bg-[var(--ds-surface-container-low)] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-base text-[var(--ds-primary)]">
                    {item.icon}
                  </span>
                  <div>
                    <div className="text-on-surface font-medium">{item.title}</div>
                    <div className="text-[10px] text-[var(--ds-on-surface-variant)]">{item.category}</div>
                  </div>
                </div>

                {item.shortcut && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ds-surface-container-low)] text-[var(--ds-on-surface-variant)] border border-[var(--ds-outline-variant)]">
                    {item.shortcut}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[var(--ds-surface-container-lowest)] border-t border-[var(--ds-outline-variant)] flex items-center justify-between text-[11px] font-mono text-[var(--ds-on-surface-variant)]">
          <div className="flex items-center gap-4">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
          </div>
          <span className="text-[var(--ds-primary)]">Local AI Studio Orchestrator</span>
        </div>
      </div>
    </div>
  );
};
