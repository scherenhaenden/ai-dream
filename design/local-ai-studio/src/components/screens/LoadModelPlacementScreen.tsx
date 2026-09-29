import React, { useState } from 'react';

interface LoadModelPlacementScreenProps {
  onDeploySuccess: () => void;
  onBack: () => void;
}

export const LoadModelPlacementScreen: React.FC<LoadModelPlacementScreenProps> = ({
  onDeploySuccess,
  onBack,
}) => {
  const [allocationMode, setAllocationMode] = useState<'auto' | 'manual'>('manual');
  const [splitStrategy, setSplitStrategy] = useState<'layer' | 'tensor'>('layer');

  // Sliders for 48 layers total
  const TOTAL_LAYERS = 48;
  const [gpu0Layers, setGpu0Layers] = useState<number>(29);
  const [gpu1Layers, setGpu1Layers] = useState<number>(19);

  // Flags
  const [flashAttnV2, setFlashAttnV2] = useState<boolean>(true);
  const [mlock, setMlock] = useState<boolean>(true);
  const [contextShift, setContextShift] = useState<boolean>(true);
  const [numaPin, setNumaPin] = useState<boolean>(false);

  // Launch state
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [isLaunched, setIsLaunched] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const updateGpu0 = (val: number) => {
    setGpu0Layers(val);
    setGpu1Layers(Math.max(0, TOTAL_LAYERS - val));
  };

  const updateGpu1 = (val: number) => {
    setGpu1Layers(val);
    setGpu0Layers(Math.max(0, TOTAL_LAYERS - val));
  };

  const applyAutoPreset = () => {
    setGpu0Layers(29);
    setGpu1Layers(19);
    showToast('Applied llama.cpp Vulkan 60/40 auto-tuned split');
  };

  // Calculations
  const LAYER_WEIGHT_GB = 0.462;
  const gpu0ModelGb = (gpu0Layers * LAYER_WEIGHT_GB).toFixed(1);
  const gpu0TotalGb = (1.2 + parseFloat(gpu0ModelGb)).toFixed(1);
  const gpu0FreeGb = Math.max(0, 16.0 - parseFloat(gpu0TotalGb)).toFixed(1);

  const gpu1ModelGb = (gpu1Layers * LAYER_WEIGHT_GB).toFixed(1);
  const gpu1TotalGb = (0.3 + parseFloat(gpu1ModelGb)).toFixed(1);
  const gpu1FreeGb = Math.max(0, 16.0 - parseFloat(gpu1TotalGb)).toFixed(1);

  const handleLaunch = () => {
    setIsLaunching(true);
    showToast('Allocating physical device memory via ROCm/Vulkan...');
    setTimeout(() => {
      setIsLaunching(false);
      setIsLaunched(true);
      showToast('Model Allocated & Initialized in VRAM!');
      setTimeout(() => {
        onDeploySuccess();
      }, 1000);
    }, 1500);
  };

  return (
    <div className="flex flex-col w-full text-on-surface select-none pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-12 right-6 z-50 px-3 py-2 rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl flex items-center gap-2 text-[12px] font-mono animate-bounce">
          <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Ambient Glow Field */}
      <div className="relative w-full overflow-hidden">
        <div className="absolute -top-24 left-1/3 w-96 h-96 bg-primary-container/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -top-24 right-1/4 w-80 h-80 bg-tertiary-container/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Wizard Header Block */}
        <div className="px-6 pt-5 pb-3 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-outline uppercase tracking-wider mb-1">
                <span>Execution Target</span>
                <span>/</span>
                <span className="text-tertiary font-semibold">Topology Matrix v2</span>
              </div>
              <h1 className="text-[22px] font-semibold text-on-surface tracking-tight">
                Load Model into Memory — Hardware Orchestration
              </h1>
              <p className="text-[13px] text-on-surface-variant mt-0.5">
                Partition weights, KV caches, and attention heads across heterogeneous PCIe clusters.
              </p>
            </div>
            <div className="flex items-center gap-2 bg-surface-container-low border border-outline-variant/30 px-3.5 py-1.5 rounded-lg shadow-sm">
              <div className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></div>
              <span className="font-mono text-[11px] text-on-surface-variant font-medium">
                ROCm / Vulkan Pipeline:
              </span>
              <span className="font-mono text-[11px] text-tertiary font-semibold">Ready for Allocation</span>
            </div>
          </div>

          {/* Step Flow Pipeline Indicator */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 pt-1 font-mono">
            {/* Step 1 */}
            <div className="bg-surface-container-low border border-outline-variant/20 px-3.5 py-2 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-tertiary/20 text-tertiary text-[11px] font-semibold">
                  ✓
                </span>
                <div className="truncate">
                  <div className="text-[10px] text-outline truncate">Step 1 • Model</div>
                  <div className="text-[12px] text-on-surface font-medium truncate">Qwen3.8-27B</div>
                </div>
              </div>
              <span className="text-[11px] text-tertiary">Q4_K_M</span>
            </div>

            {/* Step 2 */}
            <div className="bg-surface-container-low border border-outline-variant/20 px-3.5 py-2 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-tertiary/20 text-tertiary text-[11px] font-semibold">
                  ✓
                </span>
                <div className="truncate">
                  <div className="text-[10px] text-outline truncate">Step 2 • Backend</div>
                  <div className="text-[12px] text-on-surface font-medium truncate">llama.cpp Vulkan</div>
                </div>
              </div>
              <span className="text-[11px] text-outline">b6821</span>
            </div>

            {/* Step 3 (Active) */}
            <div className="bg-surface-container-high border border-primary/40 px-3.5 py-2 rounded-lg flex items-center justify-between shadow-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>
              <div className="flex items-center gap-2 min-w-0 pl-1">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-on-primary text-[11px] font-semibold">
                  3
                </span>
                <div className="truncate">
                  <div className="text-[10px] text-primary font-semibold truncate">Step 3 • Active</div>
                  <div className="text-[12px] text-on-surface font-semibold truncate">Device Placement</div>
                </div>
              </div>
              <span className="material-symbols-outlined text-primary text-[16px]">tune</span>
            </div>

            {/* Step 4 */}
            <div className="bg-surface-container-lowest border border-outline-variant/10 px-3.5 py-2 rounded-lg flex items-center justify-between opacity-60">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-surface-variant text-outline text-[11px] font-semibold">
                  4
                </span>
                <div className="truncate">
                  <div className="text-[10px] text-outline truncate">Step 4 • Flags</div>
                  <div className="text-[12px] text-on-surface-variant truncate">FlashAttn / mlock</div>
                </div>
              </div>
              <span className="material-symbols-outlined text-outline text-[14px]">arrow_forward</span>
            </div>

            {/* Step 5 */}
            <div className="bg-surface-container-lowest border border-outline-variant/10 px-3.5 py-2 rounded-lg flex items-center justify-between opacity-60">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-surface-variant text-outline text-[11px] font-semibold">
                  5
                </span>
                <div className="truncate">
                  <div className="text-[10px] text-outline truncate">Step 5 • Launch</div>
                  <div className="text-[12px] text-on-surface-variant truncate">Deploy Process</div>
                </div>
              </div>
              <span className="material-symbols-outlined text-outline text-[14px]">rocket_launch</span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Workspace Canvas */}
      <div className="px-6 pb-6 flex flex-col gap-4">
        {/* Mode Toggle and Autoplacement Banner */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl shadow-sm">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="font-mono text-[11px] text-outline uppercase font-semibold">
              Allocation Engine:
            </div>
            <div className="inline-flex p-0.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30">
              <button
                onClick={() => {
                  setAllocationMode('auto');
                  applyAutoPreset();
                }}
                className={`px-3 py-1 rounded text-[12px] transition-colors flex items-center gap-1.5 ${
                  allocationMode === 'auto'
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-outline hover:text-on-surface'
                }`}
                type="button"
              >
                <span className="material-symbols-outlined text-[15px]">auto_mode</span>
                <span>Automatic Placement</span>
              </button>
              <button
                onClick={() => setAllocationMode('manual')}
                className={`px-3 py-1 rounded text-[12px] transition-colors flex items-center gap-1.5 ${
                  allocationMode === 'manual'
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-outline hover:text-on-surface'
                }`}
                type="button"
              >
                <span className="material-symbols-outlined text-[15px] text-primary">linear_scale</span>
                <span>Manual Custom Distribution</span>
              </button>
            </div>
          </div>

          {/* Live VRAM Guard Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-tertiary-container/10 border border-tertiary/30 rounded-lg">
            <span className="material-symbols-outlined text-tertiary text-[18px]">verified_user</span>
            <div className="font-mono text-[11px] text-tertiary font-medium">
              Safety Check: <strong className="font-bold">PASSED</strong> • 0 VRAM Overflow • 1.4 GB Headroom Buffer
            </div>
          </div>
        </div>

        {/* Automatic Reference Profile Card */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-3 font-mono text-[11px]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[18px]">lightbulb</span>
            <span className="text-on-surface-variant font-medium">Auto-Tuning Reference Profile:</span>
            <span className="text-on-surface">Calculated by llama.cpp Vulkan • Split GPU 0 (60%) / GPU 1 (40%)</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-on-surface-variant">
              Estimated Alloc: <span className="text-primary font-semibold">14.6 GB + 10.1 GB</span>
            </span>
            <span className="text-tertiary font-semibold flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">speed</span>42.4+ tok/s
            </span>
            <button
              onClick={applyAutoPreset}
              className="text-primary hover:underline font-semibold cursor-pointer"
              type="button"
            >
              Apply Preset
            </button>
          </div>
        </div>

        {/* Main Grid: Device Allocation Sliders (7 cols) vs Pipeline Diagram + Flags (5 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Device Allocation Sliders (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-mono text-[12px] text-on-surface font-semibold uppercase tracking-wider">
                <span className="material-symbols-outlined text-primary text-[18px]">developer_board</span>
                <span>Hardware Devices &amp; Split Allocator</span>
              </div>
              <div className="font-mono text-[11px] text-outline">
                Total Layers:{' '}
                <span className="text-primary font-semibold">
                  {gpu0Layers + gpu1Layers} / {TOTAL_LAYERS}
                </span>{' '}
                offloaded
              </div>
            </div>

            {/* Card 1: GPU 0 */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl flex flex-col gap-2 relative overflow-hidden shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-tertiary"></span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-on-surface">
                        GPU 0 — AMD Radeon RX 9070
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-surface-container-highest font-mono text-[10px] text-on-surface-variant">
                        PCIe 4.0 x16
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-outline mt-0.5">
                      VRAM Total: 16,384 MB (16.0 GB) • Base Usage: 1.2 GB • Available: 14.8 GB
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer bg-surface-container px-2 py-1 rounded border border-outline-variant/30">
                  <input checked disabled className="accent-primary w-3.5 h-3.5 rounded" type="checkbox" />
                  <span className="font-mono text-[10px] text-primary font-semibold">Primary Compute</span>
                </label>
              </div>

              {/* Slider & Capacity Segment */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-2 mt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-on-surface-variant font-medium">
                    Assigned Transformer Layers
                  </span>
                  <div className="flex items-baseline gap-1 font-mono text-[12px]">
                    <span className="text-primary font-bold text-[15px]">{gpu0Layers}</span>
                    <span className="text-outline">/ 48 Layers</span>
                    <span className="text-primary font-semibold ml-1">
                      ({Math.round((gpu0Layers / TOTAL_LAYERS) * 100)}%)
                    </span>
                  </div>
                </div>

                <input
                  className="w-full accent-primary bg-surface-variant h-2 rounded cursor-pointer"
                  max={TOTAL_LAYERS}
                  min={0}
                  type="range"
                  value={gpu0Layers}
                  onChange={(e) => updateGpu0(parseInt(e.target.value, 10))}
                />

                <div className="flex flex-col gap-1 pt-1 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-outline">
                      Post-Load VRAM: <span className="text-on-surface font-semibold">{gpu0TotalGb}</span> / 16.0 GB
                    </span>
                    <span className={parseFloat(gpu0TotalGb) > 15.5 ? 'text-error font-semibold' : 'text-tertiary font-semibold'}>
                      {parseFloat(gpu0TotalGb) > 15.5 ? 'High Load Warning' : `${Math.round((parseFloat(gpu0TotalGb) / 16.0) * 100)}% Optimal Capacity`}
                    </span>
                  </div>

                  <div className="w-full h-3 bg-surface-container-highest rounded-full overflow-hidden flex p-0.5 gap-0.5">
                    <div className="h-full bg-outline-variant rounded-l-full" style={{ width: '7.5%' }} title="OS: 1.2 GB"></div>
                    <div
                      className="h-full bg-primary transition-all duration-150"
                      style={{ width: `${Math.min(92.5, (parseFloat(gpu0ModelGb) / 16.0) * 100)}%` }}
                      title={`Model: ${gpu0ModelGb} GB`}
                    ></div>
                    <div className="h-full bg-surface-container-low rounded-r-full flex-1" title={`Headroom: ${gpu0FreeGb} GB`}></div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-outline pt-0.5">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-outline-variant"></span>OS Baseline: 1.2 GB
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-primary"></span>Model Weights:{' '}
                      <span className="text-on-surface font-medium">{gpu0ModelGb} GB</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-surface-container-high"></span>Headroom:{' '}
                      <span className="text-tertiary font-medium">{gpu0FreeGb} GB</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: GPU 1 */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl flex flex-col gap-2 relative overflow-hidden shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-tertiary"></span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-on-surface">
                        GPU 1 — AMD Radeon RX 9070
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-surface-container-highest font-mono text-[10px] text-on-surface-variant">
                        PCIe 4.0 x8
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-outline mt-0.5">
                      VRAM Total: 16,384 MB (16.0 GB) • Base Usage: 0.3 GB • Available: 15.7 GB
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[10px] text-on-surface-variant bg-surface-container px-2 py-1 rounded border border-outline-variant/20">
                  Secondary Worker
                </span>
              </div>

              {/* Slider & Capacity Segment */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-2 mt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-on-surface-variant font-medium">
                    Assigned Transformer Layers
                  </span>
                  <div className="flex items-baseline gap-1 font-mono text-[12px]">
                    <span className="text-secondary font-bold text-[15px]">{gpu1Layers}</span>
                    <span className="text-outline">/ 48 Layers</span>
                    <span className="text-secondary-fixed font-semibold ml-1">
                      ({Math.round((gpu1Layers / TOTAL_LAYERS) * 100)}%)
                    </span>
                  </div>
                </div>

                <input
                  className="w-full accent-secondary bg-surface-variant h-2 rounded cursor-pointer"
                  max={TOTAL_LAYERS}
                  min={0}
                  type="range"
                  value={gpu1Layers}
                  onChange={(e) => updateGpu1(parseInt(e.target.value, 10))}
                />

                <div className="flex flex-col gap-1 pt-1 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-outline">
                      Post-Load VRAM: <span className="text-on-surface font-semibold">{gpu1TotalGb}</span> / 16.0 GB
                    </span>
                    <span className={parseFloat(gpu1TotalGb) > 15.5 ? 'text-error font-semibold' : 'text-tertiary font-semibold'}>
                      {parseFloat(gpu1TotalGb) > 15.5 ? 'High Load Warning' : `${Math.round((parseFloat(gpu1TotalGb) / 16.0) * 100)}% Safe Load`}
                    </span>
                  </div>

                  <div className="w-full h-3 bg-surface-container-highest rounded-full overflow-hidden flex p-0.5 gap-0.5">
                    <div className="h-full bg-outline-variant rounded-l-full" style={{ width: '2%' }} title="OS: 0.3 GB"></div>
                    <div
                      className="h-full bg-secondary transition-all duration-150"
                      style={{ width: `${Math.min(98.0, (parseFloat(gpu1ModelGb) / 16.0) * 100)}%` }}
                      title={`Model: ${gpu1ModelGb} GB`}
                    ></div>
                    <div className="h-full bg-surface-container-low rounded-r-full flex-1" title={`Headroom: ${gpu1FreeGb} GB`}></div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-outline pt-0.5">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-outline-variant"></span>OS Baseline: 0.3 GB
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-secondary"></span>Model Weights:{' '}
                      <span className="text-on-surface font-medium">{gpu1ModelGb} GB</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-surface-container-high"></span>Headroom:{' '}
                      <span className="text-tertiary font-medium">{gpu1FreeGb} GB</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Dual Grid: Excluded GPU + Host CPU */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Excluded GPU */}
              <div className="bg-surface-container-low border border-outline-variant/30 p-3.5 rounded-xl flex flex-col justify-between opacity-70">
                <div>
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <div className="flex items-center gap-1 text-outline font-semibold">
                      <span className="w-2 h-2 rounded-full bg-outline"></span>
                      <span>GPU 2 — AMD RX 460</span>
                    </div>
                    <span className="text-outline">PCIe 3.0 x8</span>
                  </div>
                  <p className="text-[12px] text-outline mt-1 font-mono">4,096 MB (4.0 GB VRAM)</p>
                </div>
                <div className="mt-3 bg-surface-container-lowest border border-outline-variant/20 p-2 rounded font-mono text-[10px] text-outline flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">block</span>
                  <span className="truncate">Excluded: Insufficient VRAM bandwidth</span>
                </div>
              </div>

              {/* Host CPU */}
              <div className="bg-surface-container-low border border-outline-variant/30 p-3.5 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <div className="flex items-center gap-1.5 text-on-surface font-semibold">
                      <span className="material-symbols-outlined text-tertiary text-[15px]">memory</span>
                      <span>AMD Ryzen 9 7950X</span>
                    </div>
                    <span className="text-tertiary font-semibold">0 Offload Layers</span>
                  </div>
                  <p className="text-[12px] text-on-surface-variant mt-0.5 font-mono">
                    16C/32T • 64 GB DDR5-6000
                  </p>
                </div>
                <div className="mt-3 bg-surface-container-lowest border border-outline-variant/20 p-2 rounded flex items-center justify-between font-mono text-[10px]">
                  <span className="text-outline">Host Orchestration &amp; KV:</span>
                  <span className="text-on-surface font-medium">2.1 GB RAM</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Partition Diagram + Topology Map + Flags (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Partition Topology Map */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl flex flex-col gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-on-surface font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-[17px]">hub</span>
                  <span>Layer Partition Topology</span>
                </span>
                <span className="font-mono text-[10px] text-tertiary font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>PCIe P2P Direct
                </span>
              </div>
              <div className="text-[12px] text-on-surface-variant leading-relaxed">
                Cross-GPU pipeline distribution over bidirectional 28 GB/s interconnect.
              </div>

              {/* Pipeline Visual Flow Diagram */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-3">
                {/* GPU 0 Domain */}
                <div className="p-2 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-primary font-bold">GPU 0 (Primary)</span>
                    <span className="text-on-surface font-medium">
                      {gpu0Layers > 0 ? `Embedding + Layers 00 – ${gpu0Layers - 1}` : '0 Layers'}
                    </span>
                  </div>
                  {/* Visual Mini Blocks */}
                  <div className="grid grid-cols-8 gap-1 pt-1">
                    {Array.from({ length: 8 }, (_, i) => (
                      <div
                        key={i}
                        className={`h-3 rounded-sm ${
                          i < Math.ceil((gpu0Layers / TOTAL_LAYERS) * 8)
                            ? 'bg-primary/90'
                            : 'bg-surface-variant/40'
                        }`}
                        title={`Block range`}
                      ></div>
                    ))}
                  </div>
                </div>

                {/* Interconnect Bridge */}
                <div className="flex items-center justify-between px-3 py-1 bg-surface-container-high rounded text-[11px] font-mono border border-outline-variant/20">
                  <div className="flex items-center gap-1.5 text-outline">
                    <span className="material-symbols-outlined text-primary text-[15px]">swap_vert</span>
                    <span>PCIe Gen4 x16 Direct P2P Bridge</span>
                  </div>
                  <span className="text-tertiary font-semibold">28.0 GB/s</span>
                </div>

                {/* GPU 1 Domain */}
                <div className="p-2 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-secondary font-bold">GPU 1 (Worker)</span>
                    <span className="text-on-surface font-medium">
                      {gpu1Layers > 0 ? `Layers ${gpu0Layers} – ${TOTAL_LAYERS - 1} + Head` : '0 Layers'}
                    </span>
                  </div>
                  <div className="grid grid-cols-8 gap-1 pt-1">
                    {Array.from({ length: 8 }, (_, i) => (
                      <div
                        key={i}
                        className={`h-3 rounded-sm ${
                          i < Math.ceil((gpu1Layers / TOTAL_LAYERS) * 8)
                            ? 'bg-secondary/90'
                            : 'bg-surface-variant/40'
                        }`}
                        title={`Worker Block range`}
                      ></div>
                    ))}
                  </div>
                </div>

                {/* Model Specs */}
                <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                  <div className="bg-surface-container p-2 rounded border border-outline-variant/20">
                    <div className="text-outline text-[9px]">Hidden Dim</div>
                    <div className="text-on-surface font-semibold">5120</div>
                  </div>
                  <div className="bg-surface-container p-2 rounded border border-outline-variant/20">
                    <div className="text-outline text-[9px]">Attn Heads</div>
                    <div className="text-on-surface font-semibold">40 (GQA 8)</div>
                  </div>
                  <div className="bg-surface-container p-2 rounded border border-outline-variant/20">
                    <div className="text-outline text-[9px]">Context Size</div>
                    <div className="text-on-surface font-semibold">32,768</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced Split Flags */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl flex flex-col gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-on-surface font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-outline text-[16px]">
                    settings_input_component
                  </span>
                  <span>Advanced Split Flags</span>
                </span>
                <span className="font-mono text-[10px] text-outline">Optimized Defaults</span>
              </div>

              {/* Split Strategy */}
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-on-surface-variant font-medium">Split Strategy</label>
                <div className="grid grid-cols-2 gap-1 bg-surface-container-lowest p-1 rounded-lg border border-outline-variant/30 font-mono text-[11px]">
                  <button
                    onClick={() => setSplitStrategy('layer')}
                    className={`py-1 px-2 rounded transition-colors ${
                      splitStrategy === 'layer'
                        ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                        : 'text-outline hover:text-on-surface'
                    }`}
                    type="button"
                  >
                    Layer-wise Split (Pipeline)
                  </button>
                  <button
                    onClick={() => setSplitStrategy('tensor')}
                    className={`py-1 px-2 rounded transition-colors ${
                      splitStrategy === 'tensor'
                        ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                        : 'text-outline hover:text-on-surface'
                    }`}
                    type="button"
                  >
                    Tensor Split (Row/Col)
                  </button>
                </div>
              </div>

              {/* Toggles Matrix */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <label className="flex items-center justify-between p-2 bg-surface-container-lowest border border-outline-variant/20 rounded cursor-pointer hover:bg-surface-container transition-colors">
                  <div className="flex flex-col">
                    <span className="text-on-surface font-medium">Flash Attention V2</span>
                    <span className="text-[9px] text-outline">Saves ~1.8 GB VRAM</span>
                  </div>
                  <input
                    checked={flashAttnV2}
                    onChange={(e) => setFlashAttnV2(e.target.checked)}
                    className="accent-primary w-4 h-4 rounded"
                    type="checkbox"
                  />
                </label>
                <label className="flex items-center justify-between p-2 bg-surface-container-lowest border border-outline-variant/20 rounded cursor-pointer hover:bg-surface-container transition-colors">
                  <div className="flex flex-col">
                    <span className="text-on-surface font-medium">mlock (Lock Pages)</span>
                    <span className="text-[9px] text-outline">Prevents Host Swap</span>
                  </div>
                  <input
                    checked={mlock}
                    onChange={(e) => setMlock(e.target.checked)}
                    className="accent-primary w-4 h-4 rounded"
                    type="checkbox"
                  />
                </label>
                <label className="flex items-center justify-between p-2 bg-surface-container-lowest border border-outline-variant/20 rounded cursor-pointer hover:bg-surface-container transition-colors">
                  <div className="flex flex-col">
                    <span className="text-on-surface font-medium">Context Shift</span>
                    <span className="text-[9px] text-outline">Infinite stream ring</span>
                  </div>
                  <input
                    checked={contextShift}
                    onChange={(e) => setContextShift(e.target.checked)}
                    className="accent-primary w-4 h-4 rounded"
                    type="checkbox"
                  />
                </label>
                <label className="flex items-center justify-between p-2 bg-surface-container-lowest border border-outline-variant/20 rounded cursor-pointer hover:bg-surface-container transition-colors">
                  <div className="flex flex-col">
                    <span className="text-on-surface font-medium">NUMA Node Pin</span>
                    <span className="text-[9px] text-outline">Socket affinity</span>
                  </div>
                  <input
                    checked={numaPin}
                    onChange={(e) => setNumaPin(e.target.checked)}
                    className="accent-primary w-4 h-4 rounded"
                    type="checkbox"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Wizard Bottom Actions Bar */}
        <div className="bg-surface-container-low border border-outline-variant/30 px-6 py-3.5 rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="px-3 py-1.5 rounded-lg text-outline hover:text-on-surface text-[12px] transition-colors flex items-center gap-1 cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
              <span>Cancel</span>
            </button>
            <span className="text-outline-variant">|</span>
            <button
              onClick={onBack}
              className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-[12px] transition-colors flex items-center gap-1.5 border border-outline-variant/30 cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Back: Runtime</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => showToast('Saved topology split to hardware profile: "Dual_9070_Optimal"')}
              className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] transition-colors flex items-center gap-1.5 border border-outline-variant/30 cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">bookmark</span>
              <span>Save as Hardware Profile...</span>
            </button>
            <button
              onClick={handleLaunch}
              className={`px-5 py-2 rounded-lg font-semibold text-[13px] transition-all flex items-center gap-2 shadow-md cursor-pointer ${
                isLaunched
                  ? 'bg-tertiary text-on-tertiary'
                  : isLaunching
                  ? 'bg-primary/80 text-on-primary'
                  : 'bg-primary hover:bg-primary-fixed-dim text-on-primary'
              }`}
              type="button"
            >
              {isLaunching ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-on-primary border-t-transparent animate-spin"></div>
                  <span>Allocating Device Memory...</span>
                </>
              ) : isLaunched ? (
                <>
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>Allocated &amp; Initialized</span>
                </>
              ) : (
                <>
                  <span>Load Model &amp; Start Engine</span>
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
