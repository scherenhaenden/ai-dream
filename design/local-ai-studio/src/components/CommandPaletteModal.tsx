import React, { useState, useEffect } from 'react';
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

  if (!isOpen) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-[#0e131d] border border-[#282f3d] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#282f3d] bg-[#111722] gap-3">
          <span className="material-symbols-outlined text-[#a0caff]">search</span>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or jump to screen... (e.g. Chat, Hardware, API)"
            className="flex-1 bg-transparent text-sm text-white placeholder-[#8991a2] focus:outline-none font-sans"
            autoFocus
          />
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#171c26] text-[#8991a2] border border-[#282f3d]">
            ESC to close
          </span>
        </div>

        {/* Command List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-[#8991a2]">
              No commands matching "{query}"
            </div>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left text-xs font-mono transition-colors ${
                  selectedIndex === index
                    ? 'bg-blue-600/20 text-[#a0caff] border border-blue-500/30'
                    : 'text-[#c3c6cf] hover:bg-[#141b27] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-base text-[#a0caff]">
                    {item.icon}
                  </span>
                  <div>
                    <div className="text-white font-medium">{item.title}</div>
                    <div className="text-[10px] text-[#8991a2]">{item.category}</div>
                  </div>
                </div>

                {item.shortcut && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#171c26] text-[#8991a2] border border-[#282f3d]">
                    {item.shortcut}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#090e18] border-t border-[#282f3d] flex items-center justify-between text-[11px] font-mono text-[#8991a2]">
          <div className="flex items-center gap-4">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
          </div>
          <span className="text-[#a0caff]">Local AI Studio Orchestrator</span>
        </div>
      </div>
    </div>
  );
};
