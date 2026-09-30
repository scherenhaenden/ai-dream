import React from 'react';

export const HardwareTopologyScreen: React.FC = () => {
  const traceLogs = [
    '[14:42:01] ROCm P2P Direct: DMA map validated.',
    '[14:42:02] GPU0 BAR1 mapped to GPU1 (16 GB aperture).',
    '[14:42:04] Benchmark: 28.02 GB/s verified.',
  ];

  return (
    <div className="flex flex-col w-full min-w-0 text-on-surface pb-8 sm:pb-12 p-3 sm:p-4 2xl:p-6 gap-4 sm:gap-6">
      {/* Header Area */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4 bg-surface-container-low border border-outline-variant/30 p-4 sm:p-5 rounded-xl shadow-sm min-w-0">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-start gap-2 min-w-0">
            <span className="material-symbols-outlined text-primary text-[20px]">hub</span>
            <h1 className="text-[18px] sm:text-[20px] font-semibold text-on-surface tracking-tight min-w-0">
              Hardware Orchestration &amp; PCIe Topology
            </h1>
          </div>
          <p className="text-[13px] text-on-surface-variant max-w-3xl leading-relaxed">
            Physical compute layout, NUMA node affinities, interconnect bandwidth, and heterogeneous GPU accelerators.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] min-w-0">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-container-high rounded-lg border border-outline-variant/20 text-tertiary">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
            <span>System Ready • 2 Compute GPUs Active • 1 Display GPU Excluded</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-container-high rounded-lg border border-outline-variant/20 text-primary">
            <span className="material-symbols-outlined text-[13px]">verified</span>
            <span>ROCm 6.2 &amp; Vulkan b6821 Drivers Initialized</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-secondary-container/30 rounded-lg border border-secondary/30 text-secondary">
            <span className="material-symbols-outlined text-[13px]">swap_horiz</span>
            <span>P2P PCIe Gen4 x16 Direct Bridge: 28.0 GB/s</span>
          </div>
        </div>
      </div>

      {/* Main Grid: 2-Column Workstation Layout */}
      <div className="grid grid-cols-1 2xl:grid-cols-12 gap-4 sm:gap-6 min-w-0">
        {/* Left 9 Columns: Graph & Detailed Spec Cards */}
        <div className="2xl:col-span-9 flex flex-col gap-4 sm:gap-6 min-w-0">
          {/* Interactive Node-Based Workstation Topology Diagram */}
          <div className="relative bg-surface-container-lowest border border-outline-variant/30 p-3 sm:p-5 rounded-xl shadow-sm flex flex-col min-w-0">
            {/* Canvas Legend */}
            <div className="flex flex-col items-start pb-4 gap-3 border-b border-outline-variant/20">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-outline text-[16px]">account_tree</span>
                <span className="text-[14px] font-semibold text-on-surface">Physical Interconnect Fabric</span>
                <span className="font-mono text-[10px] text-outline bg-surface-container-high px-2 py-0.5 rounded border border-outline-variant/20">
                  Topology: Tree-Direct P2P
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px]">
                <span className="flex items-center gap-1.5 text-tertiary">
                  <span className="w-3 h-0.5 bg-tertiary inline-block rounded"></span>
                  PCIe Gen4 x16 (64 GB/s)
                </span>
                <span className="flex items-center gap-1.5 text-primary">
                  <span className="w-3 h-0.5 bg-primary inline-block rounded"></span>
                  PCIe Gen4 x8 (32 GB/s)
                </span>
                <span className="flex items-center gap-1.5 text-secondary">
                  <span className="w-3 h-0.5 bg-secondary inline-block rounded"></span>
                  P2P Direct Bridge (28 GB/s)
                </span>
                <span className="flex items-center gap-1.5 text-outline">
                  <span className="w-3 h-0.5 bg-outline inline-block rounded opacity-60"></span>
                  PCIe Gen3 x8 (Excluded)
                </span>
              </div>
            </div>

            {/* Topology Diagram Canvas with SVG */}
            <div className="relative w-full min-h-[420px] 2xl:min-h-[500px] bg-surface-container-low/50 rounded-lg p-3 sm:p-4 2xl:p-6 flex flex-col justify-start 2xl:justify-between gap-4 overflow-x-auto mt-4 border border-outline-variant/20">
              {/* SVG Background Grid and Interconnect Traces */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none hidden 2xl:block" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="grid-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="0.75" fill="var(--color-outline-variant)" fillOpacity="0.4"></circle>
                  </pattern>
                  <linearGradient id="p2p-glow" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="var(--color-tertiary)" stopOpacity="0.9"></stop>
                    <stop offset="50%" stopColor="var(--color-secondary)" stopOpacity="1"></stop>
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.9"></stop>
                  </linearGradient>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid-dots)"></rect>

                {/* SVG bus lines */}
                {/* CPU to GPU 0 */}
                <path d="M 320 130 V 220 H 160 V 275" fill="none" stroke="var(--color-tertiary)" strokeWidth="2.5" strokeDasharray="4 2" className="opacity-80" />
                {/* CPU to GPU 1 */}
                <path d="M 400 130 V 220 H 460 V 275" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeDasharray="4 2" className="opacity-80" />
                {/* CPU to GPU 2 */}
                <path d="M 480 130 V 220 H 760 V 275" fill="none" stroke="var(--color-outline-variant)" strokeWidth="1.5" strokeDasharray="6 4" className="opacity-50" />
                {/* Peer-to-Peer Interconnect Bus GPU 0 <-> GPU 1 */}
                <path d="M 270 365 H 350" fill="none" stroke="url(#p2p-glow)" strokeWidth="4" className="animate-pulse" />
              </svg>

              {/* Level 1: Host Subsystems (CPU, RAM, NVMe) */}
              <div className="relative z-10 grid grid-cols-1 2xl:grid-cols-12 gap-3 sm:gap-4 items-stretch 2xl:items-center">
                {/* Host CPU & Memory */}
                <div className="2xl:col-span-8 bg-surface-container border border-outline-variant/30 p-3 sm:p-4 rounded-lg shadow-sm flex flex-col 2xl:flex-row gap-4 justify-between min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary-container/20 border border-primary/30 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-primary text-[22px]">memory</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 font-mono text-[10px] text-tertiary">
                        <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                        <span>ROOT COMPLEX • NUMA NODE 0</span>
                      </div>
                      <div className="text-[15px] font-semibold text-on-surface">AMD Ryzen 9 7950X</div>
                      <div className="font-mono text-[11px] text-on-surface-variant">
                        16 Cores / 32 Threads • 4.5 GHz Base (5.7 GHz Boost) • 28 PCIe 5.0 Lanes
                      </div>
                    </div>
                  </div>

                  {/* Host RAM Meter */}
                  <div className="flex flex-col justify-center bg-surface-container-low border border-outline-variant/20 px-3 py-2 rounded-lg min-w-0 2xl:min-w-[200px]">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-on-surface-variant font-medium">Host DDR5-6000</span>
                      <span className="text-primary font-semibold">78.4 GB/s</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[13px] text-on-surface mt-1 font-bold">
                      <span>
                        28.4 <span className="font-normal text-[10px] text-outline">/ 64.0 GB</span>
                      </span>
                      <span className="text-[11px] font-medium text-tertiary">35.6 GB Free</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-variant rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full bg-primary-container rounded-full" style={{ width: '44.3%' }}></div>
                    </div>
                  </div>
                </div>

                {/* Storage NVMe */}
                <div className="2xl:col-span-4 bg-surface-container border border-outline-variant/30 p-3 sm:p-4 rounded-lg shadow-sm flex items-center justify-between min-w-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0 border border-outline-variant/20">
                      <span className="material-symbols-outlined text-primary text-[20px]">hard_drive</span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] text-outline uppercase truncate">
                        DirectStorage / mmap
                      </div>
                      <div className="text-[13px] text-on-surface font-semibold truncate">Samsung 990 Pro 2TB</div>
                      <div className="font-mono text-[11px] text-tertiary">Read: 7,450 MB/s</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono">
                    <div className="text-[10px] text-on-surface-variant">Free Space</div>
                    <div className="text-[14px] font-bold text-on-surface">
                      348.4 <span className="text-[10px] font-normal text-outline">GB</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interconnect Bus Strip */}
              <div className="relative z-10 py-1 2xl:py-4 flex flex-wrap items-center justify-start 2xl:justify-between px-0 sm:px-2 gap-2">
                <div className="bg-surface-container-lowest/90 px-3 py-1 rounded-md font-mono text-[11px] text-tertiary flex items-center gap-1 border border-outline-variant/20 shadow-sm">
                  <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                  <span>PCIe 4.0 x16 Link (Direct Root)</span>
                </div>

                {/* Center P2P Direct Bridge Badge */}
                <div className="bg-secondary-container px-3 sm:px-4 py-1.5 rounded-full flex items-center gap-2 shadow-md border border-secondary/40 max-w-full">
                  <span className="material-symbols-outlined text-on-secondary-container text-[16px] animate-pulse">
                    compare_arrows
                  </span>
                  <span className="font-mono text-[11px] text-on-secondary-container font-semibold">
                    P2P Direct Memory Copy: 28.0 GB/s Active
                  </span>
                </div>

                <div className="bg-surface-container-lowest/90 px-3 py-1 rounded-md font-mono text-[11px] text-outline flex items-center gap-1 border border-outline-variant/20 shadow-sm">
                  <span className="material-symbols-outlined text-[13px]">block</span>
                  <span>PCIe 3.0 x8 (Legacy)</span>
                </div>
              </div>

              {/* Level 2: Discrete Accelerators (GPU 0, GPU 1, GPU 2) */}
              <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4 items-stretch">
                {/* GPU 0: Primary Compute */}
                <div className="bg-surface-container border border-outline-variant/30 p-4 rounded-lg shadow-sm flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-tertiary flex items-center gap-1 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                        PRIMARY COMPUTE
                      </span>
                      <span className="font-mono text-[10px] text-outline">PCIe 4.0 x16</span>
                    </div>
                    <div className="text-[14px] font-semibold text-on-surface mt-1">GPU 0: Radeon RX 9070</div>
                    <div className="font-mono text-[11px] text-on-surface-variant">16GB GDDR6 • RDNA 4 • gfx1200</div>
                  </div>

                  <div className="bg-surface-container-low p-2.5 rounded-lg border border-outline-variant/20 space-y-1">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-on-surface-variant">VRAM Allocation</span>
                      <span className="text-error font-semibold">14.2 / 16.0 GB (88%)</span>
                    </div>
                    <div className="w-full h-2 bg-surface-variant rounded-full overflow-hidden">
                      <div className="h-full bg-error rounded-full" style={{ width: '88%' }}></div>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-outline pt-0.5">
                      <span>Temp: <strong className="text-on-surface">54°C</strong></span>
                      <span>TGP: <strong className="text-on-surface">240W</strong></span>
                      <span>Fan: <strong className="text-on-surface">42%</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 font-mono text-[11px]">
                    <span className="text-tertiary flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">check_circle</span>
                      Host P2P Validated
                    </span>
                    <span className="text-on-surface font-mono font-semibold">2,450 MHz</span>
                  </div>
                </div>

                {/* GPU 1: Worker Compute */}
                <div className="bg-surface-container border border-outline-variant/30 p-4 rounded-lg shadow-sm flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-primary flex items-center gap-1 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                        WORKER COMPUTE
                      </span>
                      <span className="font-mono text-[10px] text-outline">PCIe 4.0 x8 (P2P)</span>
                    </div>
                    <div className="text-[14px] font-semibold text-on-surface mt-1">GPU 1: Radeon RX 9070</div>
                    <div className="font-mono text-[11px] text-on-surface-variant">16GB GDDR6 • RDNA 4 • gfx1200</div>
                  </div>

                  <div className="bg-surface-container-low p-2.5 rounded-lg border border-outline-variant/20 space-y-1">
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-on-surface-variant">VRAM Allocation</span>
                      <span className="text-tertiary font-semibold">7.8 / 16.0 GB (48%)</span>
                    </div>
                    <div className="w-full h-2 bg-surface-variant rounded-full overflow-hidden">
                      <div className="h-full bg-tertiary rounded-full" style={{ width: '48%' }}></div>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-outline pt-0.5">
                      <span>Temp: <strong className="text-on-surface">49°C</strong></span>
                      <span>TGP: <strong className="text-on-surface">185W</strong></span>
                      <span>Fan: <strong className="text-on-surface">36%</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 font-mono text-[11px]">
                    <span className="text-tertiary flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">swap_horizontal_circle</span>
                      Dual-GPU Ring Mesh
                    </span>
                    <span className="text-on-surface font-mono font-semibold">2,210 MHz</span>
                  </div>
                </div>

                {/* GPU 2: Legacy Display-Only */}
                <div className="bg-surface-container/60 border border-outline-variant/30 p-4 rounded-lg shadow-sm flex flex-col justify-between gap-3 opacity-80">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-outline flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                        DISPLAY OUTPUT ONLY
                      </span>
                      <span className="font-mono text-[10px] text-outline">PCIe 3.0 x8</span>
                    </div>
                    <div className="text-[14px] font-semibold text-on-surface mt-1">GPU 2: Radeon RX 460</div>
                    <div className="font-mono text-[11px] text-outline">4GB GDDR5 • Polaris 11 • gfx804</div>
                  </div>

                  <div className="bg-surface-container-low/70 p-2.5 rounded-lg border border-outline-variant/20 space-y-1">
                    <div className="flex items-center justify-between font-mono text-[11px] text-outline">
                      <span>VRAM (GUI Buffers)</span>
                      <span>0.9 / 4.0 GB (22%)</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-variant/50 rounded-full overflow-hidden">
                      <div className="h-full bg-outline/40 rounded-full" style={{ width: '22%' }}></div>
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-outline pt-0.5">
                      <span>Temp: 41°C</span>
                      <span>TGP: 38W</span>
                      <span>Fan: 0% (Quiet)</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 font-mono text-[11px] text-outline">
                    <span className="flex items-center gap-1 text-on-surface-variant">
                      <span className="material-symbols-outlined text-[13px]">do_not_disturb_on</span>
                      Excluded (VRAM &lt; 8GB)
                    </span>
                    <span className="font-mono">1,090 MHz</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Technical Specs 4-Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 sm:gap-4">
            {/* GPU 0 Detail */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl shadow-sm flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-tertiary font-semibold">DEVICE 0</span>
                  <span className="bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface">NUMA #0</span>
                </div>
                <div className="text-[14px] font-semibold text-on-surface truncate">RX 9070 (Primary)</div>
                <div className="font-mono text-[10px] text-outline">16,384 MB VRAM GDDR6</div>
              </div>
              <div className="my-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Vulkan 1.3</span>
                  <span className="text-tertiary font-semibold">Supported ✓</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>ROCm / HIP 6.2</span>
                  <span className="text-tertiary font-semibold">Active ✓</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Wavefront</span>
                  <span className="text-on-surface">Size 64</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Bus Width</span>
                  <span className="text-on-surface">256-bit @ 576 GB/s</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 font-mono text-[11px] bg-surface-container px-2.5 py-1 rounded-md border border-outline-variant/20">
                <span className="text-on-surface-variant">Core Clock</span>
                <span className="text-primary font-bold">2,450 MHz</span>
              </div>
            </div>

            {/* GPU 1 Detail */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl shadow-sm flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-primary font-semibold">DEVICE 1</span>
                  <span className="bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface">NUMA #0</span>
                </div>
                <div className="text-[14px] font-semibold text-on-surface truncate">RX 9070 (Worker)</div>
                <div className="font-mono text-[10px] text-outline">16,384 MB VRAM GDDR6</div>
              </div>
              <div className="my-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Vulkan 1.3</span>
                  <span className="text-tertiary font-semibold">Supported ✓</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>ROCm / HIP 6.2</span>
                  <span className="text-tertiary font-semibold">Active ✓</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Wavefront</span>
                  <span className="text-on-surface">Size 64</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Peer Access</span>
                  <span className="text-secondary font-semibold">Direct IPC</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 font-mono text-[11px] bg-surface-container px-2.5 py-1 rounded-md border border-outline-variant/20">
                <span className="text-on-surface-variant">Core Clock</span>
                <span className="text-primary font-bold">2,210 MHz</span>
              </div>
            </div>

            {/* GPU 2 Detail */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl shadow-sm flex flex-col justify-between opacity-80">
              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-outline font-semibold">DEVICE 2 (AUX)</span>
                  <span className="bg-surface-container-high px-1.5 py-0.5 rounded text-outline">Desktop Only</span>
                </div>
                <div className="text-[14px] font-semibold text-on-surface truncate">Radeon RX 460</div>
                <div className="font-mono text-[10px] text-outline">4,096 MB VRAM GDDR5</div>
              </div>
              <div className="my-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Compute Pipeline</span>
                  <span className="text-outline font-semibold">Offload Disabled</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>ROCm Support</span>
                  <span className="text-outline">Deprecated (gfx8)</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Displays Attached</span>
                  <span className="text-on-surface">2x 4K @ 60Hz</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Bus Link</span>
                  <span className="text-outline">PCIe 3.0 x8</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 font-mono text-[11px] bg-surface-container px-2.5 py-1 rounded-md border border-outline-variant/20">
                <span className="text-on-surface-variant">Status</span>
                <span className="text-tertiary font-semibold">X11/Wayland Sink</span>
              </div>
            </div>

            {/* Host CPU Detail */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl shadow-sm flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-secondary font-semibold">HOST PROCESSOR</span>
                  <span className="bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface">x86_64</span>
                </div>
                <div className="text-[14px] font-semibold text-on-surface truncate">Ryzen 9 7950X</div>
                <div className="font-mono text-[10px] text-outline">64GB Dual-Channel DDR5</div>
              </div>
              <div className="my-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Vector SIMD</span>
                  <span className="text-tertiary font-semibold">AVX-512 ✓ / AVX2 ✓</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Thread Pool</span>
                  <span className="text-primary font-semibold">16 Worker Threads</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Memory Bandwidth</span>
                  <span className="text-on-surface">78.4 GB/s</span>
                </div>
                <div className="flex justify-between items-center text-on-surface-variant">
                  <span>Backend</span>
                  <span className="text-on-surface">llama.cpp b6821</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 font-mono text-[11px] bg-surface-container px-2.5 py-1 rounded-md border border-outline-variant/20">
                <span className="text-on-surface-variant">Governor</span>
                <span className="text-tertiary font-semibold">Performance Mode</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right 3 Columns: Action Suite & Real-Time Performance Drawer */}
        <div className="2xl:col-span-3 flex flex-col gap-4 sm:gap-6 min-w-0">
          {/* Action Drawer: Hardware Diagnostic Suite */}
          <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">build</span>
                <span className="font-semibold text-on-surface text-[14px]">Diagnostic Suite</span>
              </div>
              <span className="material-symbols-outlined text-outline text-[16px]">info</span>
            </div>

            <div className="flex flex-col gap-2">
              <button
                disabled
                title="Sample action only; hardware diagnostics are not connected in this reference."
                className="w-full flex items-center justify-between p-3 bg-surface-container rounded-lg text-left border border-outline-variant/20 cursor-not-allowed opacity-60"
                type="button"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-secondary text-[18px]">
                    speed
                  </span>
                  <div>
                    <div className="text-[13px] text-on-surface font-semibold">PCIe P2P Benchmark</div>
                    <div className="font-mono text-[10px] text-outline">Stress GPU0 ↔ GPU1 Ring Bus</div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline text-[16px]">chevron_right</span>
              </button>

              <button
                disabled
                title="Sample action only; hardware diagnostics are not connected in this reference."
                className="w-full flex items-center justify-between p-3 bg-surface-container rounded-lg text-left border border-outline-variant/20 cursor-not-allowed opacity-60"
                type="button"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-tertiary text-[18px]">
                    memory_alt
                  </span>
                  <div>
                    <div className="text-[13px] text-on-surface font-semibold">VRAM Integrity Test</div>
                    <div className="font-mono text-[10px] text-outline">Check ECC / Bitflip parity</div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline text-[16px]">chevron_right</span>
              </button>

              <button
                disabled
                title="Driver controls are not part of AI Dream's current hardware page."
                className="w-full flex items-center justify-between p-3 bg-surface-container rounded-lg text-left border border-outline-variant/20 cursor-not-allowed opacity-60"
                type="button"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-error text-[18px]">
                    restart_alt
                  </span>
                  <div>
                    <div className="text-[13px] text-on-surface font-semibold">Reset GPU Drivers</div>
                    <div className="font-mono text-[10px] text-outline">Rebind amdgpu kernel module</div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline text-[16px]">chevron_right</span>
              </button>

              <button
                disabled
                title="The topology is sample data and cannot be exported as a real hardware profile."
                className="w-full flex items-center justify-between p-3 bg-surface-container rounded-lg text-left border border-outline-variant/20 cursor-not-allowed opacity-60"
                type="button"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-primary text-[18px]">
                    download_for_offline
                  </span>
                  <div>
                    <div className="text-[13px] text-on-surface font-semibold">Export Profile (.json)</div>
                    <div className="font-mono text-[10px] text-outline">Hardware allocation manifest</div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline text-[16px]">chevron_right</span>
              </button>
            </div>

            {/* Quick Test Console Output / Log Terminal */}
            <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg font-mono text-[11px] flex flex-col gap-1 max-h-40 overflow-y-auto">
              <div className="flex items-center justify-between text-outline text-[10px] pb-1 border-b border-outline-variant/10">
                <span>SYSTEM TRACE</span>
                <span className="text-tertiary">SYNC</span>
              </div>
              <div className="space-y-1 text-on-surface-variant text-[10px] leading-tight">
                {traceLogs.map((log, i) => (
                  <div key={i} className={log.includes('verified') || log.includes('Clean') ? 'text-tertiary' : ''}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Real-Time Hardware Sparkline Drawer */}
          <div className="bg-surface-container-low border border-outline-variant/30 p-4 rounded-xl shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-on-surface">Compute Pressure</span>
              <span className="font-mono text-[10px] text-tertiary flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
                POLLING 500ms
              </span>
            </div>

            {/* Sparkline 1: GPU 0 */}
            <div className="bg-surface-container border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-on-surface-variant font-medium">GPU 0 Compute Load</span>
                <span className="text-error font-bold text-[14px]">89%</span>
              </div>
              <div className="w-full h-10 overflow-hidden">
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 200 40">
                  <path d="M0,35 Q 25,32 50,22 T 100,10 T 150,15 T 180,6 L 200,4" fill="none" stroke="var(--color-error)" strokeWidth="2"></path>
                  <path d="M0,35 Q 25,32 50,22 T 100,10 T 150,15 T 180,6 L 200,4 L 200,40 L 0,40 Z" fill="var(--color-error)" fillOpacity="0.15"></path>
                </svg>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                <span>RDNA4 Core: 2,450 MHz</span>
                <span>Temp: 54°C</span>
              </div>
            </div>

            {/* Sparkline 2: GPU 1 */}
            <div className="bg-surface-container border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-on-surface-variant font-medium">GPU 1 Compute Load</span>
                <span className="text-tertiary font-bold text-[14px]">78%</span>
              </div>
              <div className="w-full h-10 overflow-hidden">
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 200 40">
                  <path d="M0,30 Q 30,28 60,18 T 120,22 T 160,12 L 200,8" fill="none" stroke="var(--color-tertiary)" strokeWidth="2"></path>
                  <path d="M0,30 Q 30,28 60,18 T 120,22 T 160,12 L 200,8 L 200,40 L 0,40 Z" fill="var(--color-tertiary)" fillOpacity="0.15"></path>
                </svg>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                <span>RDNA4 Core: 2,210 MHz</span>
                <span>Temp: 49°C</span>
              </div>
            </div>

            {/* Sparkline 3: Host RAM */}
            <div className="bg-surface-container border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-on-surface-variant font-medium">Host RAM Allocation</span>
                <span className="text-primary font-bold text-[14px]">44.3%</span>
              </div>
              <div className="w-full h-10 overflow-hidden">
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 200 40">
                  <path d="M0,24 Q 40,24 80,23 T 140,22 T 180,21 L 200,21" fill="none" stroke="var(--color-primary)" strokeWidth="2"></path>
                  <path d="M0,24 Q 40,24 80,23 T 140,22 T 180,21 L 200,21 L 200,40 L 0,40 Z" fill="var(--color-primary)" fillOpacity="0.15"></path>
                </svg>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                <span>Commit: 28.4 / 64.0 GB</span>
                <span>Bandwidth: 78.4 GB/s</span>
              </div>
            </div>

            {/* NUMA Core Assignment Pills */}
            <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex flex-col gap-2">
              <span className="font-mono text-[10px] text-outline uppercase font-semibold">
                NUMA Core Assignment
              </span>
              <div className="grid grid-cols-8 gap-1">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((core) => (
                  <div
                    key={core}
                    className="h-5 bg-tertiary rounded flex items-center justify-center font-mono text-[10px] text-on-tertiary font-bold"
                    title={`Core ${core} - Compute Worker`}
                  >
                    {core}
                  </div>
                ))}
                {[8, 9, 10, 11].map((core) => (
                  <div
                    key={core}
                    className="h-5 bg-primary-container rounded flex items-center justify-center font-mono text-[10px] text-on-surface-container font-bold"
                    title={`Core ${core} - Memory Stream`}
                  >
                    {core}
                  </div>
                ))}
                {[12, 13, 14].map((core) => (
                  <div
                    key={core}
                    className="h-5 bg-surface-variant rounded flex items-center justify-center font-mono text-[10px] text-outline font-bold"
                    title={`Core ${core} - Idle`}
                  >
                    {core}
                  </div>
                ))}
                <div
                  className="h-5 bg-surface-variant rounded flex items-center justify-center font-mono text-[10px] text-outline font-bold"
                  title="Core 15 - System OS"
                >
                  15
                </div>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-outline pt-0.5">
                <span>8 Compute Threads</span>
                <span>4 I/O Stream Threads</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
