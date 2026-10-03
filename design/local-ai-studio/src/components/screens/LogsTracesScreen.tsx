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
    <div className="flex-1 flex flex-col h-full bg-surface-container-lowest overflow-hidden p-6 space-y-4 font-mono">
      <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-sans text-warning">
        Static reference · all log entries, timestamps, metrics and security events are fictional examples. The current local API exposes no logs or traces endpoint.
      </div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-outline-variant">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary" aria-hidden="true">terminal</span>
            Logs & Traces · sample data
          </h1>
          <p className="text-xs text-on-surface-variant mt-1 font-sans">
            Illustrative log rows only. Production currently has no logs or traces API endpoint.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button disabled title="Preview only · this reference has no live stream"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              autoScroll
                ? 'bg-primary-container/20 text-primary border-primary/40'
                : 'bg-surface-container-low text-on-surface-variant border-outline-variant'
            }`}
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">vertical_align_bottom</span>
            Sample stream · unavailable
          </button>
          <button disabled title="Export is unavailable because these sample rows are not real logs"
            className="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high border border-outline-variant rounded-lg text-xs text-on-surface flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">download</span>
            Export .log
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-surface-container-low border border-outline-variant p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-on-surface-variant text-[11px]">Level:</span>
          {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              aria-pressed={levelFilter === lvl}
              className={`px-2.5 py-1 rounded font-bold text-[11px] ${
                levelFilter === lvl
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {lvl}
            </button>
          ))}

          <span className="text-on-surface-variant text-[11px] ml-2">Subsystem:</span>
          <select
            value={subsystemFilter}
            onChange={(e) => setSubsystemFilter(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded px-2.5 py-1 text-on-surface text-[11px] focus:outline-none"
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
            className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-1.5 text-xs text-on-surface placeholder-on-surface-variant w-56 focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Terminal View */}
      <div className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-xl p-4 overflow-y-auto space-y-2 text-xs">
        {filteredLogs.map((log) => (
          <div
            key={log.id}
            className="flex items-start gap-3 p-2 rounded hover:bg-surface-container-low border border-transparent hover:border-outline-variant transition-colors"
          >
            <span className="text-on-surface-variant">{log.timestamp}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                log.level === 'INFO'
                  ? 'text-primary bg-primary-container/10'
                  : log.level === 'WARN'
                  ? 'text-warning bg-warning/10'
                  : log.level === 'ERROR'
                  ? 'text-error bg-error/10'
                  : 'text-secondary bg-secondary/10'
              }`}
            >
              {log.level}
            </span>
            <span className="text-primary text-[11px] font-bold">[{log.subsystem}]</span>
            <span className="text-on-surface flex-1 leading-relaxed">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
