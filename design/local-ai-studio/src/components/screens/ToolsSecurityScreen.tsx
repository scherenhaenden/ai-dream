import React, { useState } from 'react';

interface ToolItem {
  id: string;
  name: string;
  category: 'system' | 'knowledge' | 'browser' | 'execution';
  description: string;
  ring: 'Ring 3 (Safe)' | 'Ring 2 (Restricted)' | 'Ring 1 (Elevated)' | 'Ring 0 (Root/Blocked)';
  enabled: boolean;
  callsCount: number;
  lastCalled: string;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  tool: string;
  action: string;
  target: string;
  status: 'ALLOWED' | 'BLOCKED_BY_POLICY' | 'SANDBOXED_OK' | 'INTERCEPTED';
  durationMs: number;
}

export const ToolsSecurityScreen: React.FC = () => {
  const [activeProfile, setActiveProfile] = useState<'strict' | 'dev' | 'autonomous' | 'custom'>('strict');
  const [networkEgress, setNetworkEgress] = useState(false);
  const [bpfIsolation, setBpfIsolation] = useState(true);
  const [landlockFs, setLandlockFs] = useState(true);
  const [ephemeralMounts, setEphemeralMounts] = useState(true);

  const [tools, setTools] = useState<ToolItem[]>([
    {
      id: 'tool-rocm',
      name: 'hardware_telemetry_probe',
      category: 'system',
      description: 'Query rocm-smi & sysfs for VRAM clock, thermals, and power draw metrics.',
      ring: 'Ring 3 (Safe)',
      enabled: true,
      callsCount: 1420,
      lastCalled: '1.2s ago',
    },
    {
      id: 'tool-proc',
      name: 'process_tree_inspector',
      category: 'system',
      description: 'Enumerate subprocess PIDs running under llama.cpp runtime cgroups.',
      ring: 'Ring 2 (Restricted)',
      enabled: true,
      callsCount: 88,
      lastCalled: '4m ago',
    },
    {
      id: 'tool-rag',
      name: 'vector_store_query',
      category: 'knowledge',
      description: 'Cosine distance ANN search across local Qdrant/Chroma embedded collections.',
      ring: 'Ring 3 (Safe)',
      enabled: true,
      callsCount: 382,
      lastCalled: '12s ago',
    },
    {
      id: 'tool-doc-extract',
      name: 'pdf_markdown_parser',
      category: 'knowledge',
      description: 'In-memory text extraction from uncompressed PDF & Markdown buffer without disk write.',
      ring: 'Ring 3 (Safe)',
      enabled: true,
      callsCount: 94,
      lastCalled: '18m ago',
    },
    {
      id: 'tool-browser-headless',
      name: 'headless_playwright_render',
      category: 'browser',
      description: 'Isolated Chromium renderer with strict localhost & RFC1918 egress blacklisting.',
      ring: 'Ring 2 (Restricted)',
      enabled: false,
      callsCount: 0,
      lastCalled: 'Never',
    },
    {
      id: 'tool-curl',
      name: 'restricted_http_get',
      category: 'browser',
      description: 'HTTP GET request executor with domain whitelist and TLS 1.3 certificate pinning.',
      ring: 'Ring 2 (Restricted)',
      enabled: false,
      callsCount: 14,
      lastCalled: '2h ago',
    },
    {
      id: 'tool-py-sandbox',
      name: 'wasm_python_eval',
      category: 'execution',
      description: 'WebAssembly Pyodide execution sandbox with zero POSIX syscall access.',
      ring: 'Ring 3 (Safe)',
      enabled: true,
      callsCount: 204,
      lastCalled: '42s ago',
    },
    {
      id: 'tool-bash-cgroup',
      name: 'isolated_bash_runner',
      category: 'execution',
      description: 'Namespace-isolated cgroup v2 shell with read-only rootfs and 512MB RAM ceiling.',
      ring: 'Ring 1 (Elevated)',
      enabled: false,
      callsCount: 0,
      lastCalled: 'Disabled',
    },
    {
      id: 'tool-fs-write',
      name: 'workspace_file_mutator',
      category: 'execution',
      description: 'Direct arbitrary write to host filesystem path outside workspace directory.',
      ring: 'Ring 0 (Root/Blocked)',
      enabled: false,
      callsCount: 0,
      lastCalled: 'Perm. Blocked',
    },
  ]);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([
    {
      id: 'aud-109',
      timestamp: '14:42:01.082',
      tool: 'vector_store_query',
      action: 'QUERY_COSINE_SIMILARITY',
      target: 'collection://vulkan-compute-specs (k=4)',
      status: 'SANDBOXED_OK',
      durationMs: 4.8,
    },
    {
      id: 'aud-108',
      timestamp: '14:41:59.712',
      tool: 'wasm_python_eval',
      action: 'EXECUTE_WASM_PYODIDE',
      target: 'def calculate_tflops(vram_gb, bandwidth)...',
      status: 'ALLOWED',
      durationMs: 12.4,
    },
    {
      id: 'aud-107',
      timestamp: '14:40:12.339',
      tool: 'restricted_http_get',
      action: 'HTTP_REQUEST_EXTERNAL',
      target: 'https://raw.githubusercontent.com/KhronosGroup/...',
      status: 'BLOCKED_BY_POLICY',
      durationMs: 0.2,
    },
    {
      id: 'aud-106',
      timestamp: '14:38:20.910',
      tool: 'workspace_file_mutator',
      action: 'SYSCALL_OPEN_O_CREAT',
      target: '/etc/systemd/system/local-ai.service',
      status: 'INTERCEPTED',
      durationMs: 0.1,
    },
    {
      id: 'aud-105',
      timestamp: '14:35:44.204',
      tool: 'hardware_telemetry_probe',
      action: 'READ_SYSFS_POWER_DRAIN',
      target: '/sys/class/drm/card0/device/hwmon/hwmon1/power1_average',
      status: 'ALLOWED',
      durationMs: 0.9,
    },
  ]);

  const toggleTool = (id: string) => {
    setTools((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          if (t.ring.includes('Ring 0')) return t; // cannot enable Ring 0
          return { ...t, enabled: !t.enabled };
        }
        return t;
      }),
    );
  };

  const handleApplyPreset = (preset: 'strict' | 'dev' | 'autonomous') => {
    setActiveProfile(preset);
    if (preset === 'strict') {
      setTools((prev) =>
        prev.map((t) => ({
          ...t,
          enabled: t.category === 'system' || t.id === 'tool-rag' || t.id === 'tool-py-sandbox',
        })),
      );
      setNetworkEgress(false);
      setBpfIsolation(true);
    } else if (preset === 'dev') {
      setTools((prev) =>
        prev.map((t) => ({
          ...t,
          enabled: !t.ring.includes('Ring 0') && t.id !== 'tool-bash-cgroup',
        })),
      );
      setNetworkEgress(true);
      setBpfIsolation(true);
    } else if (preset === 'autonomous') {
      setTools((prev) =>
        prev.map((t) => ({
          ...t,
          enabled: !t.ring.includes('Ring 0'),
        })),
      );
      setNetworkEgress(true);
      setBpfIsolation(true);
    }
  };

  const clearAuditLogs = () => {
    setAuditLogs([]);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--ds-surface-container-lowest)] overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--ds-outline-variant)]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-[var(--ds-on-surface)] flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--ds-primary)]">verified_user</span>
              Tools, Execution Profiles & Sandbox Isolation
            </h1>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              SECCOMP-BPF ACTIVE
            </span>
          </div>
          <p className="text-xs text-[var(--ds-on-surface-variant)] mt-1 font-mono">
            Deterministic Landlock syscall containment for model function calling, agent tool execution, and workspace boundaries.
          </p>
        </div>

        {/* Security level badge */}
        <div className="flex items-center gap-3 bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] px-4 py-2 rounded-lg">
          <div className="text-right">
            <div className="text-[10px] text-[var(--ds-on-surface-variant)] font-mono uppercase">Enforcement Level</div>
            <div className="text-xs font-bold text-[var(--ds-primary)] font-mono">RING 3 (STRICT HERMETIC)</div>
          </div>
          <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <span className="material-symbols-outlined text-lg">lock</span>
          </div>
        </div>
      </div>

      {/* Preset Selector */}
      <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] rounded-xl p-5">
        <div className="text-xs font-bold text-[var(--ds-on-surface)] uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
          <span className="material-symbols-outlined text-sm text-[var(--ds-primary)]">tune</span>
          Execution Profile Presets
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => handleApplyPreset('strict')}
            className={`text-left p-4 rounded-lg border transition-all ${
              activeProfile === 'strict'
                ? 'bg-blue-600/15 border-[var(--ds-primary)] text-on-surface shadow-lg shadow-blue-500/10'
                : 'bg-[var(--ds-surface-container-low)] border-[var(--ds-outline-variant)] hover:border-[var(--ds-outline-variant)] text-[var(--ds-on-surface-variant)]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm text-on-surface">Strict Read-Only & WASM</span>
              {activeProfile === 'strict' && (
                <span className="text-[10px] font-mono bg-blue-500 text-on-surface px-2 py-0.5 rounded-full font-bold">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--ds-on-surface-variant)] leading-relaxed">
              Zero network egress, read-only hardware probes, in-memory WASM execution only. Recommended for untrusted prompt evaluation.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-emerald-400">Egress: Denied</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-[var(--ds-primary)]">FS: Ephemeral</span>
            </div>
          </button>

          <button
            onClick={() => handleApplyPreset('dev')}
            className={`text-left p-4 rounded-lg border transition-all ${
              activeProfile === 'dev'
                ? 'bg-blue-600/15 border-[var(--ds-primary)] text-on-surface shadow-lg shadow-blue-500/10'
                : 'bg-[var(--ds-surface-container-low)] border-[var(--ds-outline-variant)] hover:border-[var(--ds-outline-variant)] text-[var(--ds-on-surface-variant)]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm text-on-surface">Developer Assistant</span>
              {activeProfile === 'dev' && (
                <span className="text-[10px] font-mono bg-blue-500 text-on-surface px-2 py-0.5 rounded-full font-bold">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--ds-on-surface-variant)] leading-relaxed">
              Allows workspace directory mutations, Python script runner, and localhost dev server queries. System paths stay strictly sealed.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-amber-400">Egress: Filtered</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-[var(--ds-primary)]">Workspace: RW</span>
            </div>
          </button>

          <button
            onClick={() => handleApplyPreset('autonomous')}
            className={`text-left p-4 rounded-lg border transition-all ${
              activeProfile === 'autonomous'
                ? 'bg-blue-600/15 border-[var(--ds-primary)] text-on-surface shadow-lg shadow-blue-500/10'
                : 'bg-[var(--ds-surface-container-low)] border-[var(--ds-outline-variant)] hover:border-[var(--ds-outline-variant)] text-[var(--ds-on-surface-variant)]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm text-on-surface">Autonomous Research Agent</span>
              {activeProfile === 'autonomous' && (
                <span className="text-[10px] font-mono bg-blue-500 text-on-surface px-2 py-0.5 rounded-full font-bold">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--ds-on-surface-variant)] leading-relaxed">
              Enables headless browser interaction, external documentation searches, and temporary namespace sandboxed subshells.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-emerald-400">Web Search: On</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-purple-400">Playwright: Sandbox</span>
            </div>
          </button>
        </div>
      </div>

      {/* Isolation Controls Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-3.5 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono text-[var(--ds-on-surface-variant)]">Network Egress</div>
            <div className="text-xs font-bold text-on-surface mt-0.5">
              {networkEgress ? 'Whitelisted Domains' : '100% Hermetic / Offline'}
            </div>
          </div>
          <button
            onClick={() => setNetworkEgress(!networkEgress)}
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
              networkEgress ? 'bg-blue-600 justify-end' : 'bg-[var(--ds-outline-variant)] justify-start'
            }`}
          >
            <div className="bg-white w-4 h-4 rounded-full shadow-md"></div>
          </button>
        </div>

        <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-3.5 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono text-[var(--ds-on-surface-variant)]">Landlock Linux FS</div>
            <div className="text-xs font-bold text-on-surface mt-0.5">
              {landlockFs ? 'Rootfs Read-Only' : 'Permissive Workspace'}
            </div>
          </div>
          <button
            onClick={() => setLandlockFs(!landlockFs)}
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
              landlockFs ? 'bg-blue-600 justify-end' : 'bg-[var(--ds-outline-variant)] justify-start'
            }`}
          >
            <div className="bg-white w-4 h-4 rounded-full shadow-md"></div>
          </button>
        </div>

        <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-3.5 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono text-[var(--ds-on-surface-variant)]">Seccomp Syscall BPF</div>
            <div className="text-xs font-bold text-on-surface mt-0.5">
              {bpfIsolation ? 'Filter 38 Syscalls' : 'Disabled'}
            </div>
          </div>
          <button
            onClick={() => setBpfIsolation(!bpfIsolation)}
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
              bpfIsolation ? 'bg-blue-600 justify-end' : 'bg-[var(--ds-outline-variant)] justify-start'
            }`}
          >
            <div className="bg-white w-4 h-4 rounded-full shadow-md"></div>
          </button>
        </div>

        <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] p-3.5 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono text-[var(--ds-on-surface-variant)]">RAM Namespace Overlay</div>
            <div className="text-xs font-bold text-on-surface mt-0.5">
              {ephemeralMounts ? '512MB RAM disk ceiling' : 'Direct disk'}
            </div>
          </div>
          <button
            onClick={() => setEphemeralMounts(!ephemeralMounts)}
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
              ephemeralMounts ? 'bg-blue-600 justify-end' : 'bg-[var(--ds-outline-variant)] justify-start'
            }`}
          >
            <div className="bg-white w-4 h-4 rounded-full shadow-md"></div>
          </button>
        </div>
      </div>

      {/* Tool Matrix by Categories */}
      <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--ds-outline-variant)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-on-surface font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--ds-primary)] text-base">handyman</span>
              Configured Tool Registry & Execution Enclave
            </h2>
            <p className="text-xs text-[var(--ds-on-surface-variant)] mt-0.5">
              Individual function call bindings exposed to loaded models via JSON schema declarations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-[var(--ds-on-surface-variant)]">
              {tools.filter((t) => t.enabled).length}/{tools.length} Tools Enabled
            </span>
          </div>
        </div>

        <div className="divide-y divide-[var(--ds-surface-container-high)]">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                tool.enabled ? 'bg-[var(--ds-surface-container-low)]' : 'bg-[var(--ds-surface-container-lowest)] opacity-75'
              }`}
            >
              <div className="space-y-1 max-w-2xl">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-sm font-bold text-on-surface">{tool.name}</span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold ${
                      tool.ring.includes('Ring 3')
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : tool.ring.includes('Ring 2')
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : tool.ring.includes('Ring 1')
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}
                  >
                    {tool.ring}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--ds-on-surface-variant)] px-1.5 py-0.5 bg-black/30 rounded">
                    Category: {tool.category}
                  </span>
                </div>
                <p className="text-xs text-[var(--ds-on-surface-variant)] font-mono leading-relaxed">{tool.description}</p>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right font-mono text-xs hidden sm:block">
                  <div className="text-on-surface font-bold">{tool.callsCount.toLocaleString()} calls</div>
                  <div className="text-[10px] text-[var(--ds-on-surface-variant)]">Last: {tool.lastCalled}</div>
                </div>

                <button
                  disabled={tool.ring.includes('Ring 0')}
                  onClick={() => toggleTool(tool.id)}
                  className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors ${
                    tool.ring.includes('Ring 0')
                      ? 'bg-red-950/40 cursor-not-allowed justify-start border border-red-800/40'
                      : tool.enabled
                      ? 'bg-blue-600 justify-end'
                      : 'bg-[var(--ds-outline-variant)] justify-start'
                  }`}
                  title={tool.ring.includes('Ring 0') ? 'System Ring 0 tools cannot be enabled' : 'Toggle tool permission'}
                >
                  <div
                    className={`w-4 h-4 rounded-full shadow-md ${
                      tool.ring.includes('Ring 0') ? 'bg-red-500' : 'bg-white'
                    }`}
                  ></div>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Real-time Audit & Telemetry Log */}
      <div className="bg-[var(--ds-surface-container-low)] border border-[var(--ds-outline-variant)] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--ds-outline-variant)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[var(--ds-primary)] text-base">receipt_long</span>
            <h2 className="text-sm font-bold text-on-surface font-mono">Real-Time Tool Invocation Audit Ledger</h2>
          </div>
          <button
            onClick={clearAuditLogs}
            className="text-xs font-mono text-[var(--ds-on-surface-variant)] hover:text-on-surface px-2 py-1 bg-[var(--ds-surface-container)] rounded border border-[var(--ds-outline-variant)]"
          >
            Clear Ledger
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[var(--ds-surface-container-lowest)] text-[var(--ds-on-surface-variant)] border-b border-[var(--ds-outline-variant)]">
              <tr>
                <th className="px-4 py-2.5">TIMESTAMP</th>
                <th className="px-4 py-2.5">TOOL IDENTIFIER</th>
                <th className="px-4 py-2.5">ACTION</th>
                <th className="px-4 py-2.5">PAYLOAD TARGET</th>
                <th className="px-4 py-2.5">STATUS</th>
                <th className="px-4 py-2.5 text-right">LATENCY</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ds-outline-variant)] text-[var(--ds-on-surface-variant)]">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-[var(--ds-surface-container-low)]">
                  <td className="px-4 py-2.5 text-[var(--ds-on-surface-variant)]">{log.timestamp}</td>
                  <td className="px-4 py-2.5 text-on-surface font-semibold">{log.tool}</td>
                  <td className="px-4 py-2.5 text-[var(--ds-primary)]">{log.action}</td>
                  <td className="px-4 py-2.5 truncate max-w-xs text-[var(--ds-on-surface-variant)]">{log.target}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.status === 'ALLOWED' || log.status === 'SANDBOXED_OK'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : log.status === 'INTERCEPTED'
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--ds-primary)]">{log.durationMs.toFixed(1)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
