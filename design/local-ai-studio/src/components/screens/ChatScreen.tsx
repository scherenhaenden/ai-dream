import React, { useState, useRef, useEffect } from 'react';

interface ChatScreenProps {
  onNavigateToPlacement?: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  inspectorOpen,
  onToggleInspector,
}) => {
  // Mode switcher: 'chat' | 'split-canvas'
  const [viewMode, setViewMode] = useState<'standard' | 'split-canvas'>('standard');
  const [inspectorTab, setInspectorTab] = useState<'advanced' | 'simple'>('advanced');
  const [canvasSubTab, setCanvasSubTab] = useState<'editor' | 'diagnostics' | 'assembly'>('editor');

  // Inspector Parameter States
  const [temperature, setTemperature] = useState<number>(0.2);
  const [topP, setTopP] = useState<number>(0.9);
  const [topK, setTopK] = useState<number>(40);
  const [minP, setMinP] = useState<number>(0.05);
  const [repPenalty, setRepPenalty] = useState<number>(1.1);
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [contextLimit, setContextLimit] = useState<number>(32768);
  const [kvPrecision, setKvPrecision] = useState<'FP16' | 'Q8_0' | 'Q4_0'>('Q8_0');
  const [flags, setFlags] = useState({
    mmap: true,
    mlock: true,
    flashAttn: true,
    noMmap: false,
  });

  // Prompt Composer & Streaming States
  const [promptText, setPromptText] = useState(
    'Write an optimized Vulkan compute shader to benchmark matrix multiplication across heterogeneous AMD GPUs with workgroup synchronization.'
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamSpeed, setStreamSpeed] = useState<number>(42.8);
  const [tokenCount, setTokenCount] = useState<number>(482);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // GLSL Code for editor and canvas
  const [glslCode, setGlslCode] = useState(`#version 450 core
#extension GL_KHR_shader_subgroup_arithmetic : enable
#extension GL_EXT_shader_explicit_arithmetic_types_float16 : enable

// Heterogeneous Vulkan Compute GEMM Kernel for Workstation Dual RX 9070
layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

layout(push_constant) uniform PushConstants {
    uint M; // Matrix Rows
    uint N; // Matrix Columns
    uint K; // Inner Dimension
    float alpha;
} dims;

layout(std430, set = 0, binding = 0) readonly buffer MatrixA { float dataA[]; };
layout(std430, set = 0, binding = 1) readonly buffer MatrixB { float dataB[]; };
layout(std430, set = 0, binding = 2) writeonly buffer MatrixC { float dataC[]; };

// Shared Local Memory cache tiles (16x16)
shared float tileA[16][16];
shared float tileB[16][16];

void main() {
    uint row = gl_GlobalInvocationID.y;
    uint col = gl_GlobalInvocationID.x;
    float acc = 0.0;

    uint numTiles = (dims.K + 15) / 16;

    for (uint t = 0; t < numTiles; ++t) {
        if (row < dims.M && (t * 16 + gl_LocalInvocationID.x) < dims.K)
            tileA[gl_LocalInvocationID.y][gl_LocalInvocationID.x] = dataA[row * dims.K + t * 16 + gl_LocalInvocationID.x];
        else
            tileA[gl_LocalInvocationID.y][gl_LocalInvocationID.x] = 0.0;

        if (col < dims.N && (t * 16 + gl_LocalInvocationID.y) < dims.K)
            tileB[gl_LocalInvocationID.y][gl_LocalInvocationID.x] = dataB[(t * 16 + gl_LocalInvocationID.y) * dims.N + col];
        else
            tileB[gl_LocalInvocationID.y][gl_LocalInvocationID.x] = 0.0;

        // Explicit subgroup synchronization barrier
        barrier();

        for (uint k = 0; k < 16; ++k) {
            acc += tileA[gl_LocalInvocationID.y][k] * tileB[k][gl_LocalInvocationID.x];
        }

        barrier();
    }

    if (row < dims.M && col < dims.N) {
        dataC[row * dims.N + col] = acc;
    }
}`);

  // Streaming effect simulation
  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      interval = setInterval(() => {
        setTokenCount((prev) => prev + 4);
        setStreamSpeed(+(42 + Math.random() * 2).toFixed(1));
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleGenerate = () => {
    if (isGenerating) {
      setIsGenerating(false);
      showToast('Generation halted by operator');
    } else {
      setIsGenerating(true);
      showToast('Initiating Vulkan compute streaming...');
      setTimeout(() => {
        setIsGenerating(false);
        showToast('Generation complete: 482 tokens generated');
      }, 4000);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(glslCode);
    showToast('GLSL Compute shader copied to clipboard');
  };

  return (
    <div className="flex flex-col w-full text-on-surface select-none pb-8">
      {/* Toast popup */}
      {toastMessage && (
        <div className="fixed bottom-12 right-6 z-50 px-3 py-2 rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl flex items-center gap-2 text-[12px] font-mono animate-bounce">
          <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP MODEL TELEMETRY HEADER BANNER */}
      <div className="w-full bg-surface-container-low px-4 py-2.5 flex flex-col gap-2 border-b border-outline-variant/30 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Title & Main Identifiers */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary shrink-0 shadow-sm border border-outline-variant/30">
              <span className="material-symbols-outlined text-[20px]">smart_toy</span>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[15px] text-on-surface tracking-tight truncate">
                  Qwen3.8-27B-Instruct-Q4_K_M
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-container/20 border border-tertiary/30 text-tertiary font-mono text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
                  Status: Loaded &amp; Hot
                </span>
              </div>
              <span className="font-mono text-[11px] text-outline truncate">
                /mnt/models/qwen/Qwen3.8-27B-Q4_K_M.gguf
              </span>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* View Mode Switcher: Standard Inspector vs Split Canvas */}
            <div className="flex items-center bg-surface-container-lowest p-0.5 rounded-lg border border-outline-variant/30 text-[11px] font-mono">
              <button
                onClick={() => setViewMode('standard')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  viewMode === 'standard'
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-outline hover:text-on-surface'
                }`}
              >
                Standard View
              </button>
              <button
                onClick={() => setViewMode('split-canvas')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  viewMode === 'split-canvas'
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-outline hover:text-on-surface'
                }`}
              >
                Split Canvas / Code
              </button>
            </div>

            <button
              onClick={() => showToast('Opening Model Settings...')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] transition-colors border border-outline-variant/30"
              type="button"
            >
              <span className="material-symbols-outlined text-[15px]">tune</span>
              <span>Model Settings</span>
            </button>
            <button
              onClick={() => showToast('Model unallocated from dual RX 9070')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error-container/30 hover:bg-error-container/50 text-error text-[12px] transition-colors border border-error/30"
              type="button"
            >
              <span className="material-symbols-outlined text-[15px]">eject</span>
              <span>Unload Model</span>
            </button>
            <button
              onClick={onToggleInspector}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition-colors ${
                inspectorOpen
                  ? 'bg-surface-container-high text-primary border-primary/40'
                  : 'bg-surface-container text-outline border-outline-variant/30'
              }`}
              title="Toggle Inspector Panel"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">dock_to_left</span>
            </button>
          </div>
        </div>

        {/* Metagroup Badges & Dynamic Hardware Chips */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-2 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-medium">
              GGUF v3
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-medium">
              27B Parameters
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-container-highest text-primary font-medium">
              Q4_K_M
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-container-highest text-tertiary font-medium">
              Vulkan Backend
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-container-highest text-secondary font-medium">
              Dual GPU Split (60/40)
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-container-highest text-on-surface font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-tertiary text-[13px]">check</span> Flash
              Attention
            </span>
          </div>

          {/* Realtime Metric Readouts */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container border border-outline-variant/20">
              <span className="text-outline">CTX:</span>
              <span className="text-on-surface font-medium">14,280 / 32,768</span>
              <span className="text-primary font-bold">(43%)</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container border border-outline-variant/20">
              <span className="text-outline">RAM:</span>
              <span className="text-on-surface font-medium">4.5 GB</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container border border-outline-variant/20">
              <span className="text-outline">VRAM:</span>
              <span className="text-tertiary font-medium">24.2 / 32.0 GB</span>
              <span className="text-outline text-[10px]">[GPU0: 14.4G • GPU1: 9.8G]</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-tertiary/10 border border-tertiary/20 text-tertiary font-bold">
              <span className="material-symbols-outlined text-[13px]">speed</span>
              <span>{streamSpeed} tok/s</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN WORKSPACE BODY */}
      <div className="flex w-full min-h-[calc(100vh-190px)] relative">
        {/* CENTER COLUMN: CHAT CANVAS AREA */}
        <div className="flex flex-col flex-1 min-w-0 bg-surface">
          {/* IN-FLIGHT COMPUTE TELEMETRY STRIP (LIVE) */}
          <div className="px-4 py-1.5 bg-surface-container-lowest flex items-center justify-between font-mono text-[11px] text-outline-variant border-b border-outline-variant/20 shadow-inner">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-tertiary">
                <span className="w-2 h-2 rounded-full bg-tertiary animate-ping"></span>
                <span className="text-on-surface font-semibold font-mono">Stream Active</span>
              </div>
              <span className="text-outline">|</span>
              <span className="text-on-surface-variant font-mono">
                GPU0 Load: <strong className="text-on-surface">89%</strong> (56°C)
              </span>
              <span className="text-on-surface-variant font-mono">
                GPU1 Load: <strong className="text-on-surface">78%</strong> (51°C)
              </span>
              <span className="text-outline">|</span>
              <span className="text-on-surface-variant font-mono">PCIe Bus: Gen4 x16 P2P Enabled</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-primary font-mono">Tokens/sec: {streamSpeed}</span>
              <span className="text-tertiary font-mono">TTFT: 142ms</span>
            </div>
          </div>

          {/* CHAT MESSAGE SCROLL CONTAINER */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 max-w-5xl mx-auto w-full">
            {/* USER MESSAGE ITEM */}
            <div className="flex gap-3 items-start group">
              <div className="w-8 h-8 rounded-lg bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-primary shrink-0 shadow-sm">
                <span className="material-symbols-outlined text-[18px]">person</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-on-surface text-[13px]">Operator</span>
                  <span className="font-mono text-[11px] text-outline">10:42:19</span>
                  <span className="px-1.5 py-0.2 rounded bg-surface-container-high text-outline text-[10px] font-mono">
                    User Prompt
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-surface-container text-on-surface text-[13px] leading-relaxed shadow-sm max-w-3xl border border-outline-variant/20">
                  Write an optimized Vulkan compute shader to benchmark matrix multiplication across
                  heterogeneous AMD GPUs with workgroup synchronization.
                </div>
                <div className="mt-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => showToast('Editing prompt...')}
                    className="text-outline hover:text-on-surface font-mono text-[11px] inline-flex items-center gap-1"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[13px]">edit</span> Edit
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(promptText);
                      showToast('Prompt copied to clipboard');
                    }}
                    className="text-outline hover:text-on-surface font-mono text-[11px] inline-flex items-center gap-1"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[13px]">content_copy</span> Copy
                  </button>
                </div>
              </div>
            </div>

            {/* ASSISTANT MESSAGE ITEM */}
            <div className="flex gap-3 items-start">
              <div className="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0 shadow-md">
                <span className="material-symbols-outlined text-[18px]">terminal</span>
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-primary text-[14px]">Qwen3.8-27B-Instruct</span>
                  <span className="font-mono text-[11px] text-outline">10:42:30</span>
                  <span className="px-1.5 py-0.5 rounded bg-tertiary-container/30 text-tertiary font-mono text-[11px] font-medium border border-tertiary/20">
                    Full Precision Response
                  </span>
                </div>

                {/* COLLAPSIBLE REASONING ACCORDION */}
                <details className="group bg-surface-container-low rounded-lg p-2.5 transition-all border border-outline-variant/30 open:bg-surface-container" open>
                  <summary className="flex items-center justify-between cursor-pointer list-none select-none">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-primary">
                      <span className="material-symbols-outlined text-[16px] transition-transform group-open:rotate-90">
                        arrow_right
                      </span>
                      <span className="font-semibold">Thinking Process</span>
                      <span className="px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-mono">
                        1,420 ms • 128 tokens reasoned
                      </span>
                    </div>
                    <span className="text-outline font-mono text-[10px] group-open:hidden">
                      Click to expand
                    </span>
                  </summary>
                  <div className="mt-2.5 pt-2 font-mono text-[11px] text-on-surface-variant space-y-1.5 pl-6 leading-relaxed bg-surface-container-lowest/50 p-2.5 rounded border border-outline-variant/20">
                    <p>1. Analyzing memory latency and dispatch overhead on dual AMD RDNA4 (RX 9070) Vulkan physical devices.</p>
                    <p>2. Formulating tiled matrix multiplication (GEMM) using Shared Local Memory (LDS) with local size 16x16.</p>
                    <p>
                      3. Incorporating{' '}
                      <code className="text-tertiary font-semibold">
                        controlBarrier(gl_ScopeWorkgroup, gl_ScopeWorkgroup, gl_StorageSemanticsShared, gl_SemanticsAcquireRelease)
                      </code>{' '}
                      for robust cross-thread sync.
                    </p>
                    <p>4. Setting up uniform strides and float buffers for non-coalesced memory avoidance.</p>
                  </div>
                </details>

                {/* ASSISTANT RESPONSE MARKDOWN BODY */}
                <div className="text-[13px] text-on-surface space-y-3 leading-relaxed">
                  <p>
                    Below is a high-performance SPIR-V compliant GLSL compute shader designed for Vulkan.
                    It implements a 16x16 tiled matrix multiplication with shared workgroup memory caches (
                    <code className="text-primary font-mono text-[12px]">shared float tileA/tileB</code>) to
                    maximize compute pipe saturation across heterogeneous devices.
                  </p>

                  {/* CODE CONTAINER */}
                  <div className="rounded-xl overflow-hidden bg-surface-container-lowest border border-outline-variant/30 shadow-md">
                    <div className="px-4 py-2 bg-surface-container-high flex items-center justify-between font-mono text-[11px] border-b border-outline-variant/30">
                      <div className="flex items-center gap-2 text-on-surface-variant font-mono">
                        <span className="material-symbols-outlined text-tertiary text-[14px]">code</span>
                        <span>gemm_heterogeneous_vulkan.comp</span>
                        <span className="text-outline">• GLSL Vulkan 1.3</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={copyCode}
                          className="hover:text-on-surface text-outline inline-flex items-center gap-1 transition-colors"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[14px]">content_copy</span> Copy Code
                        </button>
                        <button
                          onClick={() => {
                            const blob = new Blob([glslCode], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'gemm_heterogeneous_vulkan.comp';
                            a.click();
                            showToast('Downloaded gemm_heterogeneous_vulkan.comp');
                          }}
                          className="hover:text-on-surface text-outline inline-flex items-center gap-1 transition-colors"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[14px]">file_download</span> Download
                        </button>
                      </div>
                    </div>
                    <pre className="p-4 overflow-x-auto font-mono text-[11.5px] text-on-surface leading-relaxed">
                      <code>{glslCode}</code>
                    </pre>
                  </div>

                  {/* BENCHMARK TABLE */}
                  <p>Simulated throughput benchmarks across your configured dual RX 9070 arrangement:</p>
                  <div className="w-full overflow-x-auto rounded-xl bg-surface-container border border-outline-variant/30 shadow-sm">
                    <table className="w-full text-left font-mono text-[11px]">
                      <thead className="bg-surface-container-high text-on-surface-variant uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="px-3.5 py-2 font-semibold">Device</th>
                          <th className="px-3.5 py-2 font-semibold">Split Ratio</th>
                          <th className="px-3.5 py-2 font-semibold">Tile Size</th>
                          <th className="px-3.5 py-2 font-semibold">Memory Bandwidth</th>
                          <th className="px-3.5 py-2 font-semibold text-right">Effective TFLOPs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10 text-on-surface">
                        <tr className="bg-surface-container/60 hover:bg-surface-container-high/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-semibold text-primary flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-primary"></span> GPU 0 (PCIe 4.0 x16)
                          </td>
                          <td className="px-3.5 py-2.5 font-mono">60% (16,384 x 9,830)</td>
                          <td className="px-3.5 py-2.5 font-mono">16x16 (LDS)</td>
                          <td className="px-3.5 py-2.5 font-mono">576 GB/s</td>
                          <td className="px-3.5 py-2.5 font-mono text-tertiary font-bold text-right">
                            38.4 TFLOPs
                          </td>
                        </tr>
                        <tr className="hover:bg-surface-container-high/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-semibold text-secondary flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-secondary"></span> GPU 1 (PCIe 4.0 x8)
                          </td>
                          <td className="px-3.5 py-2.5 font-mono">40% (16,384 x 6,554)</td>
                          <td className="px-3.5 py-2.5 font-mono">16x16 (LDS)</td>
                          <td className="px-3.5 py-2.5 font-mono">512 GB/s</td>
                          <td className="px-3.5 py-2.5 font-mono text-tertiary font-bold text-right">
                            29.1 TFLOPs
                          </td>
                        </tr>
                        <tr className="bg-surface-container-lowest font-medium">
                          <td className="px-3.5 py-2.5 text-on-surface">Aggregate Cluster</td>
                          <td className="px-3.5 py-2.5">100% Workload</td>
                          <td className="px-3.5 py-2.5">Heterogeneous P2P</td>
                          <td className="px-3.5 py-2.5">Combined Sync</td>
                          <td className="px-3.5 py-2.5 font-bold text-tertiary text-right">67.5 TFLOPs</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* INFERENCE RUN METADATA FOOTER & ACTION TOOLBAR */}
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 flex flex-wrap items-center justify-between gap-3 text-outline">
                  <div className="flex items-center gap-3 font-mono text-[11px] flex-wrap">
                    <span className="text-tertiary font-medium">
                      Generated {tokenCount} tokens in 11.26s
                    </span>
                    <span>•</span>
                    <span className="text-on-surface font-semibold font-mono">{streamSpeed} tok/s</span>
                    <span>•</span>
                    <span className="font-mono">TTFT: 142ms</span>
                    <span>•</span>
                    <span className="font-mono">Context: 2,140 tokens</span>
                    <span>•</span>
                    <span className="font-mono text-secondary">VRAM Peak: 24.3 GB</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={copyCode}
                      className="p-1 hover:text-on-surface text-outline transition-colors"
                      title="Copy Code"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">code</span>
                    </button>
                    <button
                      onClick={() => showToast('Markdown copied')}
                      className="p-1 hover:text-on-surface text-outline transition-colors"
                      title="Copy Raw Markdown"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">content_copy</span>
                    </button>
                    <button
                      onClick={handleGenerate}
                      className="p-1 hover:text-on-surface text-outline transition-colors"
                      title="Regenerate with seed"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">refresh</span>
                    </button>
                    <button
                      onClick={() => showToast('Created conversation branch')}
                      className="p-1 hover:text-on-surface text-outline transition-colors"
                      title="Branch Conversation"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">fork_right</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* BOTTOM COMPOSER / INPUT WORKSPACE */}
          <div className="p-4 bg-surface-container-lowest/80 backdrop-blur-md border-t border-outline-variant/30 shadow-lg">
            <div className="max-w-5xl mx-auto w-full flex flex-col gap-2">
              {/* QUICK CONTEXT SELECTORS & PRESETS TOOLBAR */}
              <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-on-surface-variant font-mono text-[11px]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => showToast('Context file picker opened')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/30 transition-colors"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[14px]">attach_file</span>
                    <span>Attach Context</span>
                  </button>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container text-outline border border-outline-variant/20">
                    <span className="material-symbols-outlined text-[14px] text-tertiary">psychology</span>
                    <span className="text-on-surface font-medium truncate max-w-[200px]">
                      System: Linux Kernel &amp; GPU Specialist
                    </span>
                    <span
                      onClick={() => showToast('Removed context tag')}
                      className="material-symbols-outlined text-[12px] cursor-pointer hover:text-on-surface"
                    >
                      close
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container text-outline border border-outline-variant/20">
                    <span className="material-symbols-outlined text-[14px] text-primary">tune</span>
                    <span className="text-on-surface font-medium">Preset: Code / Precise (0.2)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-outline shrink-0">
                  <span className="text-[11px]">
                    Context Remaining: <strong className="text-on-surface font-mono">18,488</strong> tokens
                  </span>
                </div>
              </div>

              {/* MULTILINE INPUT BUFFER CONTAINER */}
              <div className="relative rounded-xl bg-surface-container-low border border-outline-variant/30 focus-within:bg-surface-container transition-colors shadow-inner flex flex-col">
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      handleGenerate();
                    }
                  }}
                  className="w-full bg-transparent px-3.5 py-3 text-[13px] text-on-surface placeholder:text-outline focus:outline-none resize-none font-sans"
                  placeholder="Send message to Qwen3.8-27B (Shift+Enter for newline, / for commands, @ for files)..."
                  rows={3}
                />
                <div className="flex items-center justify-between px-3 py-2 bg-surface-container-lowest/60 rounded-b-xl border-t border-outline-variant/20">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => showToast('Available slash commands: /benchmark, /rag, /vram, /reset')}
                      className="p-1.5 text-outline hover:text-on-surface rounded hover:bg-surface-container-high transition-colors"
                      title="Slash Commands"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">data_array</span>
                    </button>
                    <button
                      onClick={() => showToast('Opening prompt history...')}
                      className="p-1.5 text-outline hover:text-on-surface rounded hover:bg-surface-container-high transition-colors"
                      title="Prompt History"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">history</span>
                    </button>
                    <button
                      onClick={() => showToast('Formatted code')}
                      className="p-1.5 text-outline hover:text-on-surface rounded hover:bg-surface-container-high transition-colors"
                      title="Format JSON / Code"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">integration_instructions</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {isGenerating && (
                      <button
                        onClick={handleGenerate}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-error font-body-sm text-[12px] border border-error/30 transition-colors"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[16px]">stop_circle</span>
                        <span>Stop</span>
                      </button>
                    )}
                    <button
                      onClick={handleGenerate}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-on-primary font-semibold text-[13px] hover:bg-primary-fixed-dim transition-all shadow-md cursor-pointer"
                      type="button"
                    >
                      <span>{isGenerating ? 'Stop' : 'Generate'}</span>
                      <span className="material-symbols-outlined text-[16px]">
                        {isGenerating ? 'pause' : 'arrow_forward'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: INSPECTOR OR SPLIT CANVAS */}
        {viewMode === 'split-canvas' ? (
          /* Split Canvas / Code View (From Image 19 / HTML 9) */
          <aside className="w-[450px] lg:w-[500px] xl:w-[550px] bg-surface-container-lowest border-l border-outline-variant/30 flex flex-col shrink-0 overflow-hidden shadow-xl">
            {/* Split Pane Head */}
            <div className="h-10 px-4 bg-surface-container-low border-b border-outline-variant/30 flex items-center justify-between">
              <div className="flex items-center h-full gap-2">
                <button
                  onClick={() => setCanvasSubTab('editor')}
                  className={`h-full px-3 flex items-center gap-1.5 text-[12px] font-semibold border-b-2 transition-colors ${
                    canvasSubTab === 'editor'
                      ? 'border-primary text-primary bg-surface-container-lowest'
                      : 'border-transparent text-outline hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">code</span>
                  <span>Canvas / Code View</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary ml-1"></span>
                </button>
                <button
                  onClick={() => setViewMode('standard')}
                  className="h-full px-3 flex items-center gap-1.5 text-[12px] text-outline hover:text-on-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">analytics</span>
                  <span>Runtime Inspector</span>
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => showToast('Popped out code editor window')}
                  className="p-1 text-on-surface-variant hover:text-on-surface rounded"
                  title="Pop Out Window"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                </button>
              </div>
            </div>

            {/* File Meta Bar */}
            <div className="px-4 py-2 bg-surface-container border-b border-outline-variant/30 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-[16px] text-tertiary">memory</span>
                <span className="font-mono text-[12px] text-on-surface font-bold truncate">
                  vulkan_gemm.comp
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-surface-container-highest text-tertiary">
                  SPIR-V 1.3 Verified
                </span>
              </div>
              <div className="flex items-center gap-1 font-mono text-[11px]">
                <button className="px-2 py-0.5 bg-surface-container-high text-primary rounded font-semibold">
                  Editor
                </button>
                <button
                  onClick={() => showToast('Running Vulkan SPIR-V validator: 0 errors')}
                  className="px-2 py-0.5 text-outline hover:text-on-surface rounded"
                >
                  Diagnostics (0)
                </button>
              </div>
            </div>

            {/* Live Code Editor with Gutter */}
            <div className="flex-1 overflow-auto bg-surface-container-lowest font-mono text-[11.5px] flex">
              <div className="py-3 px-2 bg-surface-container-lowest text-outline select-none text-right font-mono flex flex-col gap-0.5 w-10 shrink-0 border-r border-outline-variant/20">
                {Array.from({ length: 32 }, (_, i) => (
                  <span key={i + 1}>{i + 1}</span>
                ))}
              </div>
              <textarea
                value={glslCode}
                onChange={(e) => setGlslCode(e.target.value)}
                className="py-3 px-3 text-on-surface bg-transparent focus:outline-none flex-1 font-mono leading-relaxed resize-none"
                rows={35}
                spellCheck={false}
              />
            </div>

            {/* Code Bottom Controls */}
            <div className="p-3 bg-surface-container-low border-t border-outline-variant/30 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={copyCode}
                  className="flex items-center gap-1 px-3 py-1.5 bg-surface-container-high hover:bg-surface-bright rounded text-on-surface font-mono text-[11px] font-semibold transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">save</span>
                  <span>Save</span>
                </button>
                <button
                  onClick={() => showToast('Benchmark started: 67.5 TFLOPs verified')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary text-on-primary rounded font-mono text-[11px] font-semibold hover:bg-primary-fixed-dim transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">speed</span>
                  <span>Benchmark Dual RX 9070</span>
                </button>
              </div>
              <span className="font-mono text-[10px] text-tertiary">Zero Validation Errors</span>
            </div>
          </aside>
        ) : inspectorOpen ? (
          /* RIGHT INSPECTOR PANEL (ADVANCED RUNTIME CONTROLS) */
          <div className="w-80 lg:w-96 bg-surface-container-low border-l border-outline-variant/30 flex flex-col shrink-0 overflow-y-auto">
            {/* INSPECTOR HEADER & MODE TOGGLE */}
            <div className="h-11 px-4 flex items-center justify-between bg-surface-container border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[17px]">tune</span>
                <span className="font-semibold text-on-surface text-[13px]">Runtime Inspector</span>
              </div>
              {/* Segmented Mode Switcher */}
              <div className="flex items-center p-0.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 font-mono text-[11px]">
                <button
                  onClick={() => setInspectorTab('simple')}
                  className={`px-2.5 py-0.5 rounded transition-colors ${
                    inspectorTab === 'simple'
                      ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                      : 'text-outline hover:text-on-surface'
                  }`}
                  type="button"
                >
                  Simple
                </button>
                <button
                  onClick={() => setInspectorTab('advanced')}
                  className={`px-2.5 py-0.5 rounded transition-colors ${
                    inspectorTab === 'advanced'
                      ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                      : 'text-outline hover:text-on-surface'
                  }`}
                  type="button"
                >
                  Advanced
                </button>
              </div>
            </div>

            <div className="p-4 space-y-5 text-[12px]">
              {/* SECTION 1: SAMPLING & GENERATION */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase font-bold tracking-wider">
                  <span>Sampling &amp; Generation</span>
                  <button
                    onClick={() => {
                      setTemperature(0.2);
                      setTopP(0.9);
                      setTopK(40);
                      setMinP(0.05);
                      setRepPenalty(1.1);
                      setMaxTokens(4096);
                      showToast('Reset sampling parameters to defaults');
                    }}
                    className="text-primary lowercase cursor-pointer hover:underline"
                  >
                    Reset default
                  </button>
                </div>

                {/* Temperature */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-on-surface-variant font-medium">Temperature</span>
                    <span className="font-mono text-primary font-semibold">{temperature.toFixed(2)}</span>
                  </div>
                  <input
                    className="w-full accent-primary h-1 bg-surface-variant rounded cursor-pointer"
                    max="2"
                    min="0"
                    step="0.05"
                    type="range"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  />
                  <div className="flex justify-between text-[10px] text-outline font-mono">
                    <span>0.0 (Deterministic)</span>
                    <span>2.0 (Creative)</span>
                  </div>
                </div>

                {/* Top P & Top K in Dual Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1 bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="text-on-surface-variant">Top-P</span>
                      <span className="font-mono text-on-surface font-semibold">{topP.toFixed(2)}</span>
                    </div>
                    <input
                      className="w-full accent-primary h-1 bg-surface-variant rounded cursor-pointer"
                      max="1"
                      min="0"
                      step="0.05"
                      type="range"
                      value={topP}
                      onChange={(e) => setTopP(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1 bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="text-on-surface-variant">Top-K</span>
                      <span className="font-mono text-on-surface font-semibold">{topK}</span>
                    </div>
                    <input
                      className="w-full accent-primary h-1 bg-surface-variant rounded cursor-pointer"
                      max="100"
                      min="0"
                      step="1"
                      type="range"
                      value={topK}
                      onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                    />
                  </div>
                </div>

                {/* Min P & Repeat Penalty */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1 bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="text-on-surface-variant">Min-P</span>
                      <span className="font-mono text-on-surface font-semibold">{minP.toFixed(2)}</span>
                    </div>
                    <input
                      className="w-full accent-primary h-1 bg-surface-variant rounded cursor-pointer"
                      max="0.5"
                      min="0"
                      step="0.01"
                      type="range"
                      value={minP}
                      onChange={(e) => setMinP(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1 bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="text-on-surface-variant">Rep Penalty</span>
                      <span className="font-mono text-on-surface font-semibold">{repPenalty.toFixed(2)}</span>
                    </div>
                    <input
                      className="w-full accent-primary h-1 bg-surface-variant rounded cursor-pointer"
                      max="2.0"
                      min="1.0"
                      step="0.05"
                      type="range"
                      value={repPenalty}
                      onChange={(e) => setRepPenalty(parseFloat(e.target.value))}
                    />
                  </div>
                </div>

                {/* Max Tokens */}
                <div className="flex items-center justify-between bg-surface-container px-3 py-2 rounded-lg border border-outline-variant/20 font-mono text-[11px]">
                  <span className="text-on-surface-variant">Max Output Tokens</span>
                  <input
                    className="w-20 bg-surface-container-lowest text-right font-mono text-on-surface px-2 py-0.5 rounded border border-outline-variant/30 focus:outline-none focus:ring-1 focus:ring-primary"
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 1024)}
                  />
                </div>
              </div>

              {/* SECTION 2: CONTEXT WINDOW & KV CACHE */}
              <div className="space-y-3 pt-2 border-t border-outline-variant/20">
                <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase font-bold tracking-wider">
                  <span>Context Window &amp; KV Cache</span>
                  <span className="text-tertiary">32K Ready</span>
                </div>
                <div className="space-y-1 bg-surface-container p-2.5 rounded-lg border border-outline-variant/20">
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-on-surface-variant">Context Limit</span>
                    <span className="font-mono text-primary font-semibold">{contextLimit.toLocaleString()} ctx</span>
                  </div>
                  <input
                    className="w-full accent-primary h-1 bg-surface-variant rounded cursor-pointer"
                    max="65536"
                    min="2048"
                    step="2048"
                    type="range"
                    value={contextLimit}
                    onChange={(e) => setContextLimit(parseInt(e.target.value, 10))}
                  />
                  <div className="w-full bg-surface-variant h-1.5 rounded-full overflow-hidden mt-1">
                    <div className="bg-primary h-full" style={{ width: '43%' }}></div>
                  </div>
                  <span className="text-[10px] text-outline font-mono block mt-1">
                    14,280 tokens populated (43% utilization)
                  </span>
                </div>

                {/* KV Cache Quantization Selector */}
                <div className="space-y-1.5">
                  <span className="text-on-surface-variant font-mono text-[11px]">KV Cache Precision</span>
                  <div className="grid grid-cols-3 gap-1 bg-surface-container-lowest p-1 rounded-lg border border-outline-variant/20 font-mono text-[11px]">
                    {(['FP16', 'Q8_0', 'Q4_0'] as const).map((prec) => (
                      <button
                        key={prec}
                        onClick={() => {
                          setKvPrecision(prec);
                          showToast(`Set KV cache precision to ${prec}`);
                        }}
                        className={`py-1 text-center rounded transition-colors ${
                          kvPrecision === prec
                            ? 'bg-surface-container-high text-tertiary font-bold shadow-sm'
                            : 'text-outline hover:text-on-surface'
                        }`}
                        type="button"
                      >
                        {prec} {prec === 'Q8_0' && '(Active)'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-tertiary font-mono">
                    Q8_0 saves 4.2 GB VRAM with &lt;0.1% perplexity delta.
                  </p>
                </div>
              </div>

              {/* SECTION 3: HARDWARE PLACEMENT & DISTRIBUTION */}
              <div className="space-y-3 pt-2 border-t border-outline-variant/20">
                <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase font-bold tracking-wider">
                  <span>Hardware Placement</span>
                  <span className="text-secondary font-mono">Vulkan Multi-GPU</span>
                </div>
                {/* Split Visualizer */}
                <div className="bg-surface-container p-2.5 rounded-lg border border-outline-variant/20 space-y-2">
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-primary font-semibold">GPU 0 (60% Layers)</span>
                    <span className="text-secondary font-semibold">GPU 1 (40% Layers)</span>
                  </div>
                  <div className="w-full h-3 rounded bg-surface-container-lowest flex overflow-hidden border border-outline-variant/30">
                    <div className="bg-primary h-full" style={{ width: '60%' }}></div>
                    <div className="bg-secondary h-full" style={{ width: '40%' }}></div>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-outline">
                    <span>29 of 48 Layers (14.4 GB)</span>
                    <span>19 of 48 Layers (9.8 GB)</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <span className="text-outline block text-[9px]">CPU THREADS</span>
                    <span className="text-on-surface font-semibold font-mono">16 (Ryzen 9)</span>
                  </div>
                  <div className="bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <span className="text-outline block text-[9px]">OFFLOAD RATIO</span>
                    <span className="text-tertiary font-semibold font-mono">48/48 (100% VRAM)</span>
                  </div>
                  <div className="bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <span className="text-outline block text-[9px]">BATCH SIZE (n_batch)</span>
                    <span className="text-on-surface font-semibold font-mono">512</span>
                  </div>
                  <div className="bg-surface-container p-2 rounded-lg border border-outline-variant/20">
                    <span className="text-outline block text-[9px]">uBATCH (n_ubatch)</span>
                    <span className="text-on-surface font-semibold font-mono">128</span>
                  </div>
                </div>
              </div>

              {/* SECTION 4: ENGINE & RUNTIME FLAGS */}
              <div className="space-y-3 pt-2 border-t border-outline-variant/20">
                <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase font-bold tracking-wider">
                  <span>Engine &amp; Runtime Flags</span>
                  <span className="text-outline font-mono">b6821</span>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <label className="flex items-center gap-2 bg-surface-container p-2 rounded-lg cursor-pointer hover:bg-surface-container-high transition-colors border border-outline-variant/20">
                    <input
                      checked={flags.mmap}
                      onChange={(e) => setFlags({ ...flags, mmap: e.target.checked })}
                      className="accent-primary rounded"
                      type="checkbox"
                    />
                    <span className="text-on-surface font-mono">mmap</span>
                  </label>
                  <label className="flex items-center gap-2 bg-surface-container p-2 rounded-lg cursor-pointer hover:bg-surface-container-high transition-colors border border-outline-variant/20">
                    <input
                      checked={flags.mlock}
                      onChange={(e) => setFlags({ ...flags, mlock: e.target.checked })}
                      className="accent-primary rounded"
                      type="checkbox"
                    />
                    <span className="text-on-surface font-mono">mlock</span>
                  </label>
                  <label className="flex items-center gap-2 bg-surface-container p-2 rounded-lg cursor-pointer hover:bg-surface-container-high transition-colors border border-outline-variant/20">
                    <input
                      checked={flags.flashAttn}
                      onChange={(e) => setFlags({ ...flags, flashAttn: e.target.checked })}
                      className="accent-primary rounded"
                      type="checkbox"
                    />
                    <span className="text-on-surface font-mono">Flash Attn</span>
                  </label>
                  <label className="flex items-center gap-2 bg-surface-container p-2 rounded-lg cursor-pointer hover:bg-surface-container-high transition-colors border border-outline-variant/20">
                    <input
                      checked={flags.noMmap}
                      onChange={(e) => setFlags({ ...flags, noMmap: e.target.checked })}
                      className="accent-primary rounded"
                      type="checkbox"
                    />
                    <span className="text-on-surface-variant font-mono">No-MMAP</span>
                  </label>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-container-lowest font-mono text-[11px] text-outline space-y-1 border border-outline-variant/20">
                  <div className="flex items-center justify-between">
                    <span>llama.cpp build:</span>
                    <span className="text-on-surface font-mono">vulkan-b6821</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Driver:</span>
                    <span className="text-tertiary font-mono">Mesa RADV 24.3.1</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
