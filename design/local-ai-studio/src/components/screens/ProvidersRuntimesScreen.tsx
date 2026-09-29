import React, { useState } from 'react';

export const ProvidersRuntimesScreen: React.FC = () => {
  const [cloudFallback, setCloudFallback] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals
  const [addServerModalOpen, setAddServerModalOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [activeProviderKey, setActiveProviderKey] = useState<{ name: string; key: string }>({
    name: '',
    key: '',
  });
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [configLlamaModalOpen, setConfigLlamaModalOpen] = useState(false);

  // Forms
  const [serverName, setServerName] = useState('');
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:8000/v1');
  const [healthStatus, setHealthStatus] = useState('Untested');
  const [inputKey, setInputKey] = useState('');

  // Llama config state
  const [gpuLayers, setGpuLayers] = useState(64);
  const [ctxTokens, setCtxTokens] = useState(32768);
  const [splitRatio, setSplitRatio] = useState('0.55, 0.45');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleRescan = () => {
    setIsRescanning(true);
    showToast('Scanning host daemons & loopback sockets...');
    setTimeout(() => {
      setIsRescanning(false);
      showToast('Subsystem scan complete. 2 GPUs healthy, 2 daemons online.');
    }, 900);
  };

  const openKeyDialog = (name: string, existingKey: string) => {
    setActiveProviderKey({ name, key: existingKey });
    setInputKey(existingKey);
    setKeyModalOpen(true);
  };

  const saveKey = () => {
    setKeyModalOpen(false);
    showToast(`${activeProviderKey.name} credential committed to local OS keyring.`);
  };

  return (
    <div className="flex flex-col w-full text-on-surface select-none pb-12 p-6 max-w-7xl mx-auto space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-12 right-6 z-50 px-3 py-2 rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl flex items-center gap-2 text-[12px] font-mono animate-bounce">
          <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 font-mono text-[11px] text-primary uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
            <span>Engine Subsystem · Compute Bus</span>
          </div>
          <h1 className="text-[22px] font-semibold text-on-surface tracking-tight">
            AI Providers &amp; Runtimes
          </h1>
          <p className="text-[13px] text-on-surface-variant max-w-3xl leading-relaxed">
            Manage local compute backends, OpenAI-compatible local servers, and optional remote cloud
            connections. Strict local privacy enforcement.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRescan}
            className="flex items-center gap-1.5 px-3 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] font-semibold rounded-lg border border-outline-variant/30 transition-colors shadow-sm cursor-pointer"
          >
            <span className={`material-symbols-outlined text-[16px] text-tertiary ${isRescanning ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Rescan Daemons</span>
          </button>
          <button
            onClick={() => setAddServerModalOpen(true)}
            className="flex items-center gap-1.5 px-3 h-8 bg-primary hover:bg-primary-container text-on-primary text-[12px] font-semibold rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">add_link</span>
            <span>Register Endpoint</span>
          </button>
        </div>
      </div>

      {/* Strict Local Privacy Banner */}
      <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1 bg-tertiary"></div>
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-tertiary/10 text-tertiary flex items-center justify-center shrink-0 border border-tertiary/20">
            <span className="material-symbols-outlined text-[18px]">verified_user</span>
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[11px] font-bold text-tertiary uppercase tracking-wider">
                PRIVACY MODE: STRICT LOCAL FIRST
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-surface-container-high text-on-surface-variant">
                HARDWARE ENFORCED
              </span>
            </div>
            <p className="text-[12px] text-on-surface-variant truncate">
              Cloud providers are disabled from auto-fallback unless explicitly enabled per session.
              Outbound network traffic is firewalled by node daemon.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center font-mono text-[11px] text-tertiary bg-surface-container border border-outline-variant/20 px-2.5 py-1 rounded-md">
          <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
          <span>0 Byte Exfiltration</span>
        </div>
      </div>

      {/* 3 Top Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card 1 */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline">
              Compute Backend
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-[16px] text-on-surface">llama.cpp b6821</span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 bg-tertiary/15 text-tertiary rounded font-semibold border border-tertiary/30">
                ACTIVE
              </span>
            </div>
            <span className="font-mono text-[11px] text-on-surface-variant">ROCm 6.2 + Vulkan Direct</span>
          </div>
          <div className="w-11 h-11 rounded-lg bg-surface-container-highest border border-outline-variant/20 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-[24px]">terminal</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline">
              Loaded Context Engine
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-[16px] text-tertiary">42.4 tok/s</span>
              <span className="font-mono text-[11px] text-outline">Qwen3.8-27B</span>
            </div>
            <span className="font-mono text-[11px] text-on-surface-variant">22.0 / 32 GB VRAM Alloc</span>
          </div>
          <div className="w-11 h-11 rounded-lg bg-surface-container-highest border border-outline-variant/20 flex items-center justify-center text-tertiary">
            <span className="material-symbols-outlined text-[24px]">speed</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline">
              Keyring State
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-[16px] text-on-surface">libsecret: GnuPG</span>
            </div>
            <span className="font-mono text-[11px] text-on-surface-variant">
              2 Keys Locked · Zero Cloud Sync
            </span>
          </div>
          <div className="w-11 h-11 rounded-lg bg-surface-container-highest border border-outline-variant/20 flex items-center justify-center text-secondary">
            <span className="material-symbols-outlined text-[24px]">key</span>
          </div>
        </div>
      </div>

      {/* SECTION 1: Local Runtimes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-primary font-bold">01/</span>
            <h2 className="text-[16px] font-semibold text-on-surface">Local Runtimes</h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 bg-surface-container-high text-on-surface-variant rounded">
              Core Engine
            </span>
          </div>
          <span className="font-mono text-[11px] text-outline">
            Low-latency C++ &amp; Python daemons directly on host hardware
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Runtime 1: llama.cpp */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-md space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">neurology</span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">llama.cpp</h3>
                    <span className="font-mono text-[10px] text-outline">v6821 · Native C/C++</span>
                  </div>
                </div>
                <span className="flex items-center gap-1 px-2 py-0.5 bg-tertiary/15 text-tertiary rounded font-mono text-[10px] font-semibold border border-tertiary/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                  RUNNING
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1 text-on-surface-variant">
                <div className="flex justify-between">
                  <span className="text-outline">Process ID:</span>
                  <span className="text-on-surface font-semibold">PID 48201</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Backend:</span>
                  <span className="text-primary font-medium">Vulkan &amp; ROCm dual GPU</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Active Model:</span>
                  <span className="text-tertiary font-medium truncate max-w-[140px]">Qwen3.8-27B</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Inter-Process:</span>
                  <span className="text-on-surface font-mono">IPC Direct / Unix Socket</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[10px]">
                  <span className="text-outline">GPU Utilization Aggregated</span>
                  <span className="text-primary font-mono">68.7%</span>
                </div>
                <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: '68.7%' }}></div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setConfigLlamaModalOpen(true)}
                className="flex-1 py-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface text-center rounded-lg font-mono text-[11px] font-semibold border border-outline-variant/30 transition-colors"
              >
                Configure
              </button>
              <button
                onClick={() => showToast('Restarting llama.cpp daemon (PID 48201)...')}
                className="py-1.5 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg font-mono text-[11px] border border-outline-variant/30 transition-colors"
              >
                Restart
              </button>
              <button
                onClick={() => setLogsModalOpen(true)}
                className="py-1.5 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg font-mono text-[11px] border border-outline-variant/30 transition-colors"
              >
                Logs
              </button>
            </div>
          </div>

          {/* Runtime 2: vLLM */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-md space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-surface-container-highest border border-outline-variant/20 text-on-surface flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">bolt</span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">vLLM</h3>
                    <span className="font-mono text-[10px] text-outline">v0.6.2 · PagedAttention</span>
                  </div>
                </div>
                <span className="flex items-center gap-1 px-2 py-0.5 bg-surface-container-highest text-on-surface-variant rounded font-mono text-[10px] border border-outline-variant/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                  STANDBY
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1 text-on-surface-variant">
                <div className="flex justify-between">
                  <span className="text-outline">Environment:</span>
                  <span className="text-on-surface">Python 3.11 (venv)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">KV Cache Optim:</span>
                  <span className="text-primary font-medium">FlashAttention-2 ROCm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Max Context Slot:</span>
                  <span className="text-on-surface">65,536 Tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Instance Status:</span>
                  <span className="text-outline">Idle (No Process Bound)</span>
                </div>
              </div>

              <p className="text-[12px] text-on-surface-variant leading-relaxed">
                High-throughput continuous batching server optimized for multiple concurrent agent tool calls.
              </p>
            </div>

            <div className="pt-2">
              <button
                onClick={() => showToast('Spinning up vLLM ROCm container runtime...')}
                className="w-full py-1.5 px-3 bg-primary hover:bg-primary-fixed-dim text-on-primary text-center rounded-lg font-mono text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                <span>Launch Instance</span>
              </button>
            </div>
          </div>

          {/* Runtime 3: MLX Framework */}
          <div className="p-4 rounded-xl bg-surface-container-low/60 border border-outline-variant/20 space-y-4 flex flex-col justify-between opacity-60">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-surface-container-highest text-outline flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">file_download</span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">MLX Framework</h3>
                    <span className="font-mono text-[10px] text-outline">Apple Silicon Unified</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-surface-container-highest text-outline rounded font-mono text-[10px]">
                  UNAVAILABLE
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1 text-outline">
                <div className="flex justify-between">
                  <span>Detected OS:</span>
                  <span className="text-on-surface-variant">Linux 6.10-arch1</span>
                </div>
                <div className="flex justify-between">
                  <span>Architecture:</span>
                  <span className="text-on-surface-variant">x86_64</span>
                </div>
                <div className="flex justify-between">
                  <span>Required HW:</span>
                  <span>M1/M2/M3/M4 SoC</span>
                </div>
              </div>

              <p className="text-[12px] text-outline leading-relaxed">
                MLX requires macOS Darwin kernel running on Apple Silicon unified memory hardware. Disabled
                automatically on x86 hosts.
              </p>
            </div>

            <div className="pt-2">
              <button
                disabled
                className="w-full py-1.5 px-3 bg-surface-container-highest text-outline text-center rounded-lg font-mono text-[11px] cursor-not-allowed border border-outline-variant/10"
              >
                Platform Incompatible
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Local Servers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-primary font-bold">02/</span>
            <h2 className="text-[16px] font-semibold text-on-surface">Local Servers</h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 bg-surface-container-high text-on-surface-variant rounded">
              Network &amp; Containers
            </span>
          </div>
          <span className="font-mono text-[11px] text-outline">
            Standardized loopback endpoints · zero external telemetry
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Ollama */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-md space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-surface-container-highest text-on-surface flex items-center justify-center font-mono font-bold text-[14px]">
                    <span className="material-symbols-outlined text-[20px]">dns</span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">Ollama</h3>
                    <span className="font-mono text-[10px] text-outline">v0.5.4 · Go Daemon</span>
                  </div>
                </div>
                <span className="flex items-center gap-1 px-2 py-0.5 bg-tertiary/15 text-tertiary rounded font-mono text-[10px] font-semibold border border-tertiary/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                  CONNECTED
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-outline">Endpoint:</span>
                  <span className="text-primary font-mono truncate">http://localhost:11434</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-outline">Discovered:</span>
                  <span className="text-on-surface font-semibold">12 Models Found</span>
                </div>
                <div className="flex items-center gap-1 pt-1 flex-wrap text-[10px]">
                  <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded border border-outline-variant/20">
                    qwen3:14b
                  </span>
                  <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded border border-outline-variant/20">
                    deepseek-r1:8b
                  </span>
                  <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded border border-outline-variant/20">
                    nomic-embed:v1.5
                  </span>
                </div>
              </div>

              <p className="text-[12px] text-on-surface-variant leading-relaxed">
                Automatic sync enabled. Models downloaded through Ollama CLI are indexed automatically into local Studio catalogs.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => showToast('Synced 12 Ollama models into local studio catalog')}
                className="flex-1 py-1.5 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface text-center rounded-lg font-mono text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[14px]">sync</span>
                <span>Sync Catalog</span>
              </button>
              <button
                onClick={() => showToast('Disconnected Ollama socket')}
                className="py-1.5 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-error rounded-lg font-mono text-[11px] transition-colors border border-outline-variant/30"
              >
                Disconnect
              </button>
            </div>
          </div>

          {/* LM Studio */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-md space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-surface-container-highest text-on-surface flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">science</span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">LM Studio</h3>
                    <span className="font-mono text-[10px] text-outline">OpenAI Compatible</span>
                  </div>
                </div>
                <span className="flex items-center gap-1 px-2 py-0.5 bg-surface-container-highest text-outline rounded font-mono text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                  OFFLINE
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-outline">Endpoint:</span>
                  <span className="text-on-surface-variant font-mono">http://localhost:1234/v1</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-outline">Diagnostic:</span>
                  <span className="text-error font-medium">Connection Refused</span>
                </div>
                <div className="text-outline text-[10px]">Server not started in LM Studio Developer tab.</div>
              </div>

              <p className="text-[12px] text-on-surface-variant leading-relaxed">
                Launch LM Studio on host and turn on "Start Local Inference Server" on port 1234 to bridge weights.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => showToast('Testing connection: ECONNREFUSED on port 1234')}
                className="flex-1 py-1.5 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface text-center rounded-lg font-mono text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[14px]">cell_tower</span>
                <span>Test Connection</span>
              </button>
              <button
                onClick={() => setAddServerModalOpen(true)}
                className="py-1.5 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg font-mono text-[11px] transition-colors border border-outline-variant/30"
              >
                Edit Endpoint
              </button>
            </div>
          </div>

          {/* Add Server Placeholder */}
          <div
            onClick={() => setAddServerModalOpen(true)}
            className="p-5 rounded-xl bg-surface-container-lowest hover:bg-surface-container-low border border-dashed border-outline-variant/40 transition-colors shadow-sm flex flex-col items-center justify-center text-center gap-3 cursor-pointer group"
          >
            <div className="w-11 h-11 rounded-full bg-surface-container-high group-hover:bg-primary/20 group-hover:text-primary text-on-surface-variant flex items-center justify-center transition-colors">
              <span className="material-symbols-outlined text-[24px]">add</span>
            </div>
            <div className="space-y-1">
              <h3 className="text-[14px] font-semibold text-on-surface">Add OpenAI-Compatible Server</h3>
              <p className="text-[11px] text-on-surface-variant max-w-xs">
                Connect Aphrodite Engine, TabbyAPI, LocalAI, vLLM remote node, or custom Docker container ports.
              </p>
            </div>
            <span className="font-mono text-[11px] text-primary flex items-center gap-1 font-semibold">
              <span>Configure Endpoint</span>
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </span>
          </div>
        </div>
      </section>

      {/* SECTION 3: Cloud Providers */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-primary font-bold">03/</span>
            <h2 className="text-[16px] font-semibold text-on-surface">Cloud Providers</h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 bg-surface-container-high text-on-surface-variant rounded">
              Optional Remote
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[15px] text-tertiary">lock</span>
            <span>Credentials stored securely in local OS keyring (libsecret/keychain). Never sent to analytics.</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* OpenRouter */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-surface-container-highest text-primary font-mono font-bold flex items-center justify-center text-[12px]">
                    OR
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">OpenRouter</h3>
                    <span className="font-mono text-[10px] text-tertiary">Multi-vendor Gateway</span>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 bg-tertiary/15 text-tertiary rounded font-mono text-[10px] font-semibold border border-tertiary/20">
                  CONFIGURED
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-outline">API Key:</span>
                  <span className="text-on-surface font-mono">••••••••••••8f3a</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-outline">Key Credit Balance:</span>
                  <span className="text-tertiary font-bold font-mono">$14.20 USD</span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Vision</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Tools</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Reasoning</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">400+ Models</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 font-mono text-[11px]">
              <button
                onClick={() => showToast('OpenRouter API test successful (latency 118ms)')}
                className="flex-1 py-1 px-2.5 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg transition-colors border border-outline-variant/30"
              >
                Test Connection
              </button>
              <button
                onClick={() => openKeyDialog('OpenRouter', 'sk-or-v1-••••••••••••8f3a')}
                className="py-1 px-2.5 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg transition-colors border border-outline-variant/30"
              >
                Update Key
              </button>
            </div>
          </div>

          {/* OpenAI */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-surface-container-highest text-on-surface font-mono font-bold flex items-center justify-center text-[12px]">
                    OA
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">OpenAI</h3>
                    <span className="font-mono text-[10px] text-outline">Direct Cloud API</span>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 bg-surface-container-highest text-outline rounded font-mono text-[10px]">
                  NOT CONFIGURED
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-outline">API Key:</span>
                  <span className="text-outline italic">No key registered</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-outline">Keyring:</span>
                  <span className="text-outline font-mono">Empty slot</span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Vision</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Tools</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Reasoning (o3)</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Audio</span>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={() => openKeyDialog('OpenAI', '')}
                className="w-full py-1 px-3 bg-primary hover:bg-primary-container text-on-primary font-mono text-[11px] font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 shadow-sm"
              >
                <span className="material-symbols-outlined text-[14px]">key</span>
                <span>Set API Key</span>
              </button>
            </div>
          </div>

          {/* Anthropic */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-surface-container-highest text-secondary font-mono font-bold flex items-center justify-center text-[12px]">
                    AN
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">Anthropic</h3>
                    <span className="font-mono text-[10px] text-tertiary">Claude 3.5 &amp; 3.7</span>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 bg-tertiary/15 text-tertiary rounded font-mono text-[10px] font-semibold border border-tertiary/20">
                  CONFIGURED
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-outline">API Key:</span>
                  <span className="text-on-surface font-mono">••••••••••••2b91</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-outline">Keyring Status:</span>
                  <span className="text-tertiary font-medium">Valid / Secret Locked</span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Vision</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Computer Use</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Tools</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 font-mono text-[11px]">
              <button
                onClick={() => showToast('Anthropic key authenticated successfully')}
                className="flex-1 py-1 px-2.5 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg transition-colors border border-outline-variant/30"
              >
                Test
              </button>
              <button
                onClick={() => openKeyDialog('Anthropic', 'sk-ant-••••••••••••2b91')}
                className="py-1 px-2.5 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg transition-colors border border-outline-variant/30"
              >
                Manage
              </button>
            </div>
          </div>

          {/* DeepSeek */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-surface-container-highest text-primary font-mono font-bold flex items-center justify-center text-[12px]">
                    DS
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">DeepSeek Cloud</h3>
                    <span className="font-mono text-[10px] text-outline">V3 &amp; R1 Reasoning</span>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 bg-surface-container-highest text-outline rounded font-mono text-[10px]">
                  STANDBY
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-outline">Mode:</span>
                  <span className="text-on-surface-variant">Prefer Local R1 (8B)</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-outline">Keyring:</span>
                  <span className="text-outline">Unconfigured</span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Reasoning</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Code</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">FIM</span>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={() => openKeyDialog('DeepSeek', '')}
                className="w-full py-1 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface font-mono text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                <span>Register Key</span>
              </button>
            </div>
          </div>

          {/* Google Gemini */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-surface-container-highest text-primary font-mono font-bold flex items-center justify-center text-[12px]">
                    GO
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">Google Gemini</h3>
                    <span className="font-mono text-[10px] text-outline">Gemini 1.5 &amp; 2.0 Flash</span>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 bg-surface-container-highest text-outline rounded font-mono text-[10px]">
                  STANDBY
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-outline">Context Limit:</span>
                  <span className="text-on-surface">2,000,000 Tok</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-outline">Keyring:</span>
                  <span className="text-outline">Unconfigured</span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Vision</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Audio</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Video</span>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={() => openKeyDialog('Google Gemini', '')}
                className="w-full py-1 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface font-mono text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                <span>Register Key</span>
              </button>
            </div>
          </div>

          {/* Mistral / Grok */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-surface-container-highest text-on-surface font-mono font-bold flex items-center justify-center text-[12px]">
                    MI
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-on-surface">Mistral / Grok</h3>
                    <span className="font-mono text-[10px] text-outline">Le Chat &amp; xAI API</span>
                  </div>
                </div>
                <span className="px-1.5 py-0.5 bg-surface-container-highest text-outline rounded font-mono text-[10px]">
                  INACTIVE
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-outline">Mistral Large:</span>
                  <span className="text-outline">Disabled</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-outline">Grok 2 / Vision:</span>
                  <span className="text-outline">Disabled</span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Vision</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Tools</span>
                <span className="px-1.5 py-0.5 bg-surface-container text-on-surface-variant rounded">Reasoning</span>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={() => openKeyDialog('Mistral & Grok', '')}
                className="w-full py-1 px-3 bg-surface-container-high hover:bg-surface-bright text-on-surface font-mono text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[14px]">tune</span>
                <span>Configure Providers</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: Model Routing & Fallback Policy */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-primary font-bold">04/</span>
            <h2 className="text-[16px] font-semibold text-on-surface">Model Routing &amp; Fallback Policy</h2>
          </div>
          <span className="font-mono text-[11px] text-tertiary flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
            <span>Zero-Leakage Guarantee Active</span>
          </span>
        </div>

        <div className="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-md space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-surface-container-lowest border border-outline-variant/20">
            <div className="space-y-1 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-on-surface">Allow Cloud Fallback</span>
                <span className="px-1.5 py-0.5 rounded bg-error-container text-error font-mono text-[10px] uppercase font-bold">
                  Privacy Guard
                </span>
              </div>
              <p className="text-[12px] text-on-surface-variant leading-relaxed">
                Disabled by default. Prevents accidental data leakage and unexpected cloud billing. When off,
                local Out-Of-Memory (OOM) errors halt inference instead of sending prompts over WAN.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  checked={cloudFallback}
                  onChange={(e) => {
                    setCloudFallback(e.target.checked);
                    showToast(
                      e.target.checked
                        ? 'Warning: Cloud fallback active. Prompts may egress on OOM.'
                        : 'Strict Local First re-engaged. WAN egress blocked.'
                    );
                  }}
                  className="sr-only peer"
                  type="checkbox"
                />
                <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  cloudFallback ? 'text-error' : 'text-outline'
                }`}
              >
                {cloudFallback ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline">
              Active Workstation Routing Rules
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-[11px]">
              <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 space-y-1">
                <div className="flex items-center justify-between text-outline text-[10px]">
                  <span>PRIMARY CHAT &amp; AGENT</span>
                  <span className="text-tertiary">STRICT LOCAL</span>
                </div>
                <div className="text-on-surface font-semibold text-[13px]">Dual RX 9070 Local</div>
                <div className="text-on-surface-variant text-[11px]">Engine: llama.cpp IPC · Qwen3.8-27B</div>
                <div className="pt-1 flex items-center gap-1 text-outline text-[10px]">
                  <span className="material-symbols-outlined text-[14px]">router</span>
                  <span>Direct GPU 0 · GPU 1 Split</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 space-y-1">
                <div className="flex items-center justify-between text-outline text-[10px]">
                  <span>CODE &amp; REASONING TASK</span>
                  <span className="text-tertiary">STRICT LOCAL</span>
                </div>
                <div className="text-on-surface font-semibold text-[13px]">DeepSeek-Coder-32B Local</div>
                <div className="text-on-surface-variant text-[11px]">Engine: Ollama Container · Context 32K</div>
                <div className="pt-1 flex items-center gap-1 text-outline text-[10px]">
                  <span className="material-symbols-outlined text-[14px]">code</span>
                  <span>Target Port :11434</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 space-y-1">
                <div className="flex items-center justify-between text-outline text-[10px]">
                  <span>FAILOVER ESCALATION</span>
                  <span className={cloudFallback ? 'text-error font-medium' : 'text-primary font-medium'}>
                    {cloudFallback ? 'AUTO (OOM FAILOVER)' : 'INTERACTIVE ONLY'}
                  </span>
                </div>
                <div className="text-on-surface font-semibold text-[13px]">OpenRouter Gateway</div>
                <div className="text-on-surface-variant text-[11px]">Requires User Prompt Confirmation modal</div>
                <div className="pt-1 flex items-center gap-1 text-outline text-[10px]">
                  <span className="material-symbols-outlined text-[14px]">security</span>
                  <span>Zero Silent Rerouting</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-1 gap-2 font-mono text-[11px] text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-tertiary">memory</span>
              <span>
                Daemon Policy Engine: Hash SHA-256 <code className="text-primary font-mono">c9820f1a...43de</code> verified
              </span>
            </div>
            <button
              onClick={() => showToast('Routing table exported to ~/.local/share/local-ai-studio/routing.json')}
              className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">download</span>
              <span>Export Routing Policy (JSON)</span>
            </button>
          </div>
        </div>
      </section>

      {/* MODAL 1: Add Server Modal */}
      {addServerModalOpen && (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-surface-container p-6 shadow-2xl border border-outline-variant/40 space-y-4 relative">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">dns</span>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-on-surface">
                    Add OpenAI-Compatible Local Server
                  </h3>
                  <p className="font-mono text-[10px] text-outline">
                    Register custom Docker container or host daemon
                  </p>
                </div>
              </div>
              <button onClick={() => setAddServerModalOpen(false)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                showToast(`Registered server "${serverName || 'Custom Node'}" successfully`);
                setAddServerModalOpen(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className="font-mono text-[10px] text-on-surface uppercase">Server Display Name</label>
                <input
                  className="w-full h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface font-mono text-[12px] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  placeholder="e.g., Aphrodite Engine ROCm"
                  required
                  type="text"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[10px] text-on-surface uppercase">Base URL Endpoint</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface font-mono text-[12px] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    required
                    type="text"
                  />
                  <button
                    type="button"
                    onClick={() => setHealthStatus('Ping: 200 OK (2.4ms) - llama / v1 ready')}
                    className="px-3 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface font-mono text-[11px] rounded-lg border border-outline-variant/30 transition-colors"
                  >
                    Health Check
                  </button>
                </div>
                <p className="font-mono text-[10px] text-outline">
                  Must expose <code className="text-on-surface-variant">/models</code> and{' '}
                  <code className="text-on-surface-variant">/chat/completions</code> endpoints.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 flex items-center justify-between font-mono text-[11px]">
                <span className="text-outline">Health Check Status:</span>
                <span className="text-tertiary">{healthStatus}</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddServerModalOpen(false)}
                  className="px-3.5 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] rounded-lg border border-outline-variant/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 h-8 bg-primary hover:bg-primary-container text-on-primary text-[12px] font-semibold rounded-lg transition-colors"
                >
                  Register &amp; Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Key Modal */}
      {keyModalOpen && (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-container p-6 shadow-2xl border border-outline-variant/40 space-y-4 relative">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">vpn_key</span>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-on-surface">
                    Configure {activeProviderKey.name} Key
                  </h3>
                  <p className="font-mono text-[10px] text-outline">Stored in secure host keyring</p>
                </div>
              </div>
              <button onClick={() => setKeyModalOpen(false)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="font-mono text-[10px] text-on-surface uppercase">API Key Token</label>
                <input
                  className="w-full h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface font-mono text-[12px] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="sk-..."
                  type="password"
                />
                <p className="font-mono text-[10px] text-outline">
                  Key will be passed strictly over TLS 1.3 when explicitly invoked.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setKeyModalOpen(false)}
                  className="px-3.5 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] rounded-lg border border-outline-variant/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveKey}
                  className="px-3.5 h-8 bg-primary hover:bg-primary-container text-on-primary text-[12px] font-semibold rounded-lg transition-colors"
                >
                  Save into Keyring
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: llama.cpp Runtime Journal */}
      {logsModalOpen && (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-surface-container p-6 shadow-2xl border border-outline-variant/40 space-y-4 relative">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-tertiary">terminal</span>
                <h3 className="text-[15px] font-semibold text-on-surface font-mono">
                  llama.cpp Runtime Journal (PID 48201)
                </h3>
              </div>
              <button onClick={() => setLogsModalOpen(false)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="h-64 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] text-on-surface-variant overflow-y-auto space-y-1 select-text">
              <div className="text-outline">[2026-09-25 10:14:02.102] main: build = 6821 with HIP ROCm 6.2 for Linux x86_64</div>
              <div className="text-outline">[2026-09-25 10:14:02.110] hip_init: found 2 ROCm devices: Radeon RX 9070, Radeon RX 9070</div>
              <div className="text-on-surface">[2026-09-25 10:14:03.441] llama_model_loader: loaded meta data with 38 key-value pairs</div>
              <div className="text-on-surface">[2026-09-25 10:14:03.442] llama_model_loader: - type f32: 65 tensors, type q4_K: 299 tensors</div>
              <div className="text-tertiary">[2026-09-25 10:14:05.109] llama_kv_cache_init: VRAM kv buffer size = 2048.00 MiB (ROCm device 0)</div>
              <div className="text-tertiary">[2026-09-25 10:14:05.110] llama_kv_cache_init: VRAM kv buffer size = 2048.00 MiB (ROCm device 1)</div>
              <div className="text-primary">[2026-09-25 10:14:05.890] server: IPC direct pipe listening at /run/user/1000/local-ai-studio-llama.sock</div>
              <div className="text-tertiary font-bold">[2026-09-25 10:14:05.892] server: WORKSTATION SERVER READY FOR PROMPTS</div>
            </div>

            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="text-outline">Socket: /run/user/1000/local-ai-studio-llama.sock</span>
              <button
                onClick={() => setLogsModalOpen(false)}
                className="px-3.5 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg transition-colors border border-outline-variant/30"
              >
                Close Journal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Configure llama.cpp Parameters */}
      {configLlamaModalOpen && (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-surface-container p-6 shadow-2xl border border-outline-variant/40 space-y-4 relative">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">tune</span>
                <h3 className="text-[15px] font-semibold text-on-surface">llama.cpp Daemon Parameters</h3>
              </div>
              <button onClick={() => setConfigLlamaModalOpen(false)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-[11px]">
              <div className="space-y-1">
                <label className="text-on-surface uppercase">GPU Layers Offload (-ngl)</label>
                <input
                  className="w-full h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  type="number"
                  value={gpuLayers}
                  onChange={(e) => setGpuLayers(parseInt(e.target.value, 10))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-on-surface uppercase">Context Window Tokens (-c)</label>
                <input
                  className="w-full h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  type="number"
                  value={ctxTokens}
                  onChange={(e) => setCtxTokens(parseInt(e.target.value, 10))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-on-surface uppercase">ROCm Split Tensor Ratio</label>
                <input
                  className="w-full h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  type="text"
                  value={splitRatio}
                  onChange={(e) => setSplitRatio(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfigLlamaModalOpen(false)}
                className="px-3.5 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] rounded-lg border border-outline-variant/30 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  showToast('llama.cpp parameters saved. Daemon hot-reloaded.');
                  setConfigLlamaModalOpen(false);
                }}
                className="px-3.5 h-8 bg-primary hover:bg-primary-container text-on-primary text-[12px] font-semibold rounded-lg transition-colors"
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
