import React, { useState } from 'react';

interface LogEntry {
  id: string;
  timestamp: string;
  subsystem: 'LLAMA_CPP' | 'VULKAN_ROCM' | 'HTTP_API' | 'RAG_EMBED' | 'SECCOMP_BPF';
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  details?: Record<string, any>;
}

export const LogsTracesScreen: React.FC = () => {
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [subsystemFilter, setSubsystemFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const logs: LogEntry[] = [
    {
      id: 'log-101',
      timestamp: '14:48:32.410',
      subsystem: 'LLAMA_CPP',
      level: 'INFO',
      message: 'llama_kv_cache_init: VRAM KV buffer allocated 2,048 MiB across GPU 0 + GPU 1.',
      details: { kv_size_mb: 2048, ctx_window: 32768, quant: 'f16' },
    },
    {
      id: 'log-102',
      timestamp: '14:48:32.618',
      subsystem: 'VULKAN_ROCM',
      level: 'INFO',
      message: 'vkAllocateMemory: [Device 0 AMD Radeon Pro W7900] bound 14,240 MiB weights successfully.',
      details: { device_id: 0, pci_bus: '0000:03:00.0', vram_type: 'GDDR6' },
    },
    {
      id: 'log-103',
      timestamp: '14:48:32.742',
      subsystem: 'VULKAN_ROCM',
      level: 'INFO',
      message: 'vkAllocateMemory: [Device 1 AMD Radeon Pro W7800] bound 7,760 MiB remaining weights.',
      details: { device_id: 1, pci_bus: '0000:07:00.0', vram_type: 'GDDR6' },
    },
    {
      id: 'log-104',
      timestamp: '14:48:33.109',
      subsystem: 'HTTP_API',
      level: 'INFO',
      message: 'POST /v1/chat/completions (stream=true, model=qwen3.8-27b) -> 200 OK [tok_speed=43.1 t/s]',
      details: { prompt_tokens: 382, completion_tokens: 124, elapsed_ms: 2876 },
    },
    {
      id: 'log-105',
      timestamp: '14:48:34.020',
      subsystem: 'RAG_EMBED',
      level: 'DEBUG',
      message: 'HNSW index probe in collection://vulkan-compute-specs finished in 3.4ms with 4 matches.',
      details: { collection: 'vulkan-compute-specs', distance_metric: 'cosine', top_score: 0.942 },
    },
    {
      id: 'log-106',
      timestamp: '14:48:35.512',
      subsystem: 'SECCOMP_BPF',
      level: 'WARN',
      message: 'Blocked syscall 257 (openat) on target /etc/shadow from unprivileged agent subshell.',
      details: { syscall: 'openat', path: '/etc/shadow', flags: 'O_RDONLY', ring: 'Ring 3' },
    },
    {
      id: 'log-107',
      timestamp: '14:48:36.104',
      subsystem: 'LLAMA_CPP',
      level: 'INFO',
      message: 'FlashAttention-2 kernel warm: dynamic dispatch selected gfx1100 native SIMD tile.',
      details: { kernel: 'fa2_f16_gfx1100', tile_m: 64, tile_n: 64 },
    },
  ];

  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== 'ALL' && log.level !== levelFilter) return false;
    if (subsystemFilter !== 'ALL' && log.subsystem !== subsystemFilter) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase()) && !log.subsystem.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--ds-surface-container-lowest)] overflow-hidden p-6 space-y-4 font-mono">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--ds-outline-variant)]">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--ds-on-surface)] flex items-center gap-2">
            <span className="material-symbols-outlined text-[var(--ds-primary)]">terminal</span>
            System Logs & Distributed Traces
          </h1>
          <p className="text-xs text-[var(--ds-on-surface-variant)] mt-1 font-sans">
            Real-time unified stdout/stderr stream from llama.cpp runtime, Vulkan driver, and OpenAI proxy.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              autoScroll
                ? 'bg-blue-600/20 text-[var(--ds-primary)] border-blue-500/40'
                : 'bg-[var(--ds-surface-container-low)] text-[var(--ds-on-surface-variant)] border-[var(--ds-outline-variant)]'
            }`}
          >
            <span className="material-symbols-outlined text-sm">vertical_align_bottom</span>
            Auto-Scroll: {autoScroll ? 'ON' : 'PAUSED'}
          </button>
          <button
            onClick={() => alert('Logs exported to local-ai-studio-session.log')}
            className="px-3 py-1.5 bg-[var(--ds-surface-container-low)] hover:bg-[var(--ds-surface-container-high)] border border-[var(--ds-outline-variant)] rounded-lg text-xs text-on-surface flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">download</span>
            Export .log
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--ds-on-surface-variant)] text-[11px]">Level:</span>
          {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`px-2.5 py-1 rounded font-bold text-[11px] ${
                levelFilter === lvl
                  ? 'bg-blue-600 text-on-surface'
                  : 'bg-[var(--ds-surface-container-low)] text-[var(--ds-on-surface-variant)] hover:text-on-surface'
              }`}
            >
              {lvl}
            </button>
          ))}

          <span className="text-[var(--ds-on-surface-variant)] text-[11px] ml-2">Subsystem:</span>
          <select
            value={subsystemFilter}
            onChange={(e) => setSubsystemFilter(e.target.value)}
            className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] rounded px-2.5 py-1 text-on-surface text-[11px] focus:outline-none"
          >
            <option value="ALL">All Subsystems</option>
            <option value="LLAMA_CPP">LLAMA_CPP</option>
            <option value="VULKAN_ROCM">VULKAN_ROCM</option>
            <option value="HTTP_API">HTTP_API</option>
            <option value="RAG_EMBED">RAG_EMBED</option>
            <option value="SECCOMP_BPF">SECCOMP_BPF</option>
          </select>
        </div>

        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter trace messages..."
            className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] rounded-lg px-3 py-1.5 text-xs text-on-surface placeholder-[var(--ds-on-surface-variant)] w-56 focus:outline-none focus:border-[var(--ds-primary)]"
          />
        </div>
      </div>

      {/* Terminal View */}
      <div className="flex-1 bg-[var(--ds-surface-container-lowest)] border border-[var(--ds-outline-variant)] rounded-xl p-4 overflow-y-auto space-y-2 text-xs">
        {filteredLogs.map((log) => (
          <div
            key={log.id}
            className="flex items-start gap-3 p-2 rounded hover:bg-[var(--ds-surface-container-low)] border border-transparent hover:border-[var(--ds-outline-variant)] transition-colors"
          >
            <span className="text-[var(--ds-on-surface-variant)] select-none">{log.timestamp}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold select-none ${
                log.level === 'INFO'
                  ? 'text-blue-400 bg-blue-500/10'
                  : log.level === 'WARN'
                  ? 'text-amber-400 bg-amber-500/10'
                  : log.level === 'ERROR'
                  ? 'text-red-400 bg-red-500/10'
                  : 'text-purple-400 bg-purple-500/10'
              }`}
            >
              {log.level}
            </span>
            <span className="text-[var(--ds-primary)] text-[11px] font-bold select-none">[{log.subsystem}]</span>
            <span className="text-[var(--ds-on-surface)] flex-1 leading-relaxed">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
