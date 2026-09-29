import React, { useState } from 'react';

export const SettingsScreen: React.FC = () => {
  const [defaultBackend, setDefaultBackend] = useState('vulkan');
  const [flashAttn, setFlashAttn] = useState(true);
  const [mlock, setMlock] = useState(true);
  const [mmq, setMmq] = useState(true);
  const [defaultPort, setDefaultPort] = useState('5200');
  const [defaultHost, setDefaultHost] = useState('127.0.0.1');
  const [defaultCtx, setDefaultCtx] = useState('32768');
  const [threads, setThreads] = useState('16');
  const [savedToast, setSavedToast] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090e18] overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#282f3d]">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#e0e2ec] flex items-center gap-2">
            <span className="material-symbols-outlined text-[#a0caff]">settings</span>
            Workstation Engine & Hardware Preferences
          </h1>
          <p className="text-xs text-[#8991a2] mt-1 font-mono">
            Low-level compilation flags, llama.cpp execution parameters, and local network bindings.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {savedToast && (
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1 animate-pulse">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Settings Persisted to NVRAM
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-500/20"
          >
            Save Changes
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Hardware Acceleration */}
        <div className="bg-[#111722] border border-[#282f3d] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white font-mono">
            <span className="material-symbols-outlined text-[#a0caff]">memory</span>
            Compute Engine & Offload Flags
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[#8991a2] font-mono block mb-1">Primary Accelerator Engine</label>
              <select
                value={defaultBackend}
                onChange={(e) => setDefaultBackend(e.target.value)}
                className="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]"
              >
                <option value="vulkan">Vulkan 1.3 (Multi-Vendor Unified Backend - Recommended)</option>
                <option value="rocm">AMD ROCm / HIP 6.2 (Native CDNA/RDNA3)</option>
                <option value="cuda">NVIDIA CUDA 12.6 (cuBLAS)</option>
                <option value="cpu">CPU AVX-512 / AMX (Host Fallback)</option>
              </select>
            </div>

            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between p-3 bg-[#171c26] rounded-lg border border-[#282f3d]">
                <div>
                  <div className="font-mono text-white font-bold">FlashAttention-2 Kernel</div>
                  <div className="text-[11px] text-[#8991a2]">Reduces attention memory footprint from O(N²) to O(N).</div>
                </div>
                <input
                  type="checkbox"
                  checked={flashAttn}
                  onChange={(e) => setFlashAttn(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-[#171c26] rounded-lg border border-[#282f3d]">
                <div>
                  <div className="font-mono text-white font-bold">mlock (Lock Pages in RAM)</div>
                  <div className="text-[11px] text-[#8991a2]">Prevents OS paging/swapping model weights to NVMe during load.</div>
                </div>
                <input
                  type="checkbox"
                  checked={mlock}
                  onChange={(e) => setMlock(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-[#171c26] rounded-lg border border-[#282f3d]">
                <div>
                  <div className="font-mono text-white font-bold">Matrix Quantization (MMQ)</div>
                  <div className="text-[11px] text-[#8991a2]">Accelerates prompt processing for 4-bit and 8-bit quantized weights.</div>
                </div>
                <input
                  type="checkbox"
                  checked={mmq}
                  onChange={(e) => setMmq(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </div>
            </div>
          </div>
        </div>

        {/* API Server & Network */}
        <div className="bg-[#111722] border border-[#282f3d] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white font-mono">
            <span className="material-symbols-outlined text-[#a0caff]">lan</span>
            API Server & Context Sizing
          </div>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#8991a2] font-mono block mb-1">Bind Host</label>
                <input
                  type="text"
                  value={defaultHost}
                  onChange={(e) => setDefaultHost(e.target.value)}
                  className="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]"
                />
              </div>
              <div>
                <label className="text-[#8991a2] font-mono block mb-1">Bind Port</label>
                <input
                  type="text"
                  value={defaultPort}
                  onChange={(e) => setDefaultPort(e.target.value)}
                  className="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#8991a2] font-mono block mb-1">Default Context Tokens</label>
                <input
                  type="text"
                  value={defaultCtx}
                  onChange={(e) => setDefaultCtx(e.target.value)}
                  className="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]"
                />
              </div>
              <div>
                <label className="text-[#8991a2] font-mono block mb-1">CPU Compute Threads</label>
                <input
                  type="text"
                  value={threads}
                  onChange={(e) => setThreads(e.target.value)}
                  className="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]"
                />
              </div>
            </div>

            {/* Privacy Guarantee Card */}
            <div className="p-4 bg-emerald-950/20 border border-emerald-500/30 rounded-lg space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-400 font-bold font-mono">
                <span className="material-symbols-outlined text-base">security</span>
                Zero Remote Telemetry Active
              </div>
              <p className="text-[11px] text-[#8991a2] leading-relaxed">
                All weights, prompts, embeddings, and chat histories remain strictly on your physical NVMe drive. No diagnostic metrics or tokens leave localhost.
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
