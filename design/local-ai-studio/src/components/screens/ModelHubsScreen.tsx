import React, { useState } from 'react';

interface ModelHubsScreenProps {
  onNavigateToModels: () => void;
  onNavigateToPlacement: () => void;
}

export const ModelHubsScreen: React.FC<ModelHubsScreenProps> = ({
  onNavigateToModels,
  onNavigateToPlacement,
}) => {
  const [hubTab, setHubTab] = useState<'hf' | 'modelscope' | 'ollama' | 'recent'>('hf');
  const [activeFilter, setActiveFilter] = useState<'text' | 'code' | 'vision' | 'embeddings'>('text');
  const [searchQuery, setSearchQuery] = useState('Qwen/Qwen3.8-27B-Instruct-GGUF');
  const [downloadProgress, setDownloadProgress] = useState(64);
  const [isPaused, setIsPaused] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
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

      {/* Top Banner Navigation & Mirrors */}
      <div className="px-6 py-3 bg-surface-container-low border-b border-outline-variant/30 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-on-surface tracking-tight">
              <span className="material-symbols-outlined text-primary text-[20px]">hub</span>
              <span>Model Hubs &amp; Repositories</span>
            </div>

            {/* Provider Tabs */}
            <div className="flex items-center gap-1 bg-surface-container-lowest p-0.5 rounded-lg border border-outline-variant/30">
              <button
                onClick={() => setHubTab('hf')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded font-mono text-[11px] font-semibold transition-colors ${
                  hubTab === 'hf'
                    ? 'bg-surface-container-high text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                type="button"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary shadow-[0_0_6px_rgba(78,222,163,0.6)]"></span>
                <span>Hugging Face</span>
                <span className="bg-surface-container-highest px-1 py-0.2 rounded text-outline font-normal">
                  Token OK
                </span>
              </button>
              <button
                onClick={() => setHubTab('modelscope')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded font-mono text-[11px] transition-colors ${
                  hubTab === 'modelscope'
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                type="button"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>
                <span>ModelScope</span>
                <span className="text-outline font-normal">Mirror</span>
              </button>
              <button
                onClick={() => setHubTab('ollama')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded font-mono text-[11px] transition-colors ${
                  hubTab === 'ollama'
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                type="button"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                <span>Ollama Bridge</span>
                <span className="text-tertiary font-normal">v0.5.8</span>
              </button>
              <button
                onClick={() => setHubTab('recent')}
                className={`flex items-center gap-1 px-3 py-1 rounded font-mono text-[11px] transition-colors ${
                  hubTab === 'recent'
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                type="button"
              >
                <span className="material-symbols-outlined text-[13px]">history</span>
                <span>Recent (14)</span>
              </button>
            </div>
          </div>

          {/* Mirror & Token Indicators */}
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-on-surface-variant">
              <span className="material-symbols-outlined text-tertiary text-[14px]">cloud_sync</span>
              <span>
                HF Mirror: <span className="text-on-surface font-semibold">cdn-lfs.huggingface.co</span> (1.2
                Gbps)
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-outline">
              <span className="material-symbols-outlined text-outline text-[14px]">vpn_key</span>
              <span className="text-on-surface font-mono">hf_•••••••9xWq</span>
              <button
                onClick={() => showToast('Editing Hugging Face Read Token...')}
                className="hover:text-primary transition-colors ml-1"
                type="button"
              >
                <span className="material-symbols-outlined text-[12px]">edit</span>
              </button>
            </div>
          </div>
        </div>

        {/* Search & Tag Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-1 items-center gap-3 min-w-[320px]">
            <div className="relative flex-1 flex items-center">
              <span className="material-symbols-outlined absolute left-2.5 text-outline text-[16px]">
                manage_search
              </span>
              <input
                className="w-full h-8 pl-8 pr-16 bg-surface-container-lowest border border-outline-variant/30 text-on-surface font-mono text-[12px] rounded-lg focus:outline-none focus:ring-1 focus:ring-primary shadow-inner"
                placeholder="Search Hugging Face GGUF models..."
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 px-1.5 py-0.5 bg-surface-container-high hover:bg-surface-variant text-outline hover:text-on-surface rounded font-mono text-[10px]"
                type="button"
              >
                Esc
              </button>
            </div>
            <div className="flex items-center bg-surface-container-lowest rounded-lg p-0.5 border border-outline-variant/30">
              <span className="material-symbols-outlined text-outline text-[15px] px-1.5">sort</span>
              <select className="bg-transparent text-on-surface-variant font-mono text-[11px] py-1 pr-3 focus:outline-none cursor-pointer">
                <option>Sort: Trending</option>
                <option>Sort: Most Downloads</option>
                <option>Sort: Recently Updated</option>
                <option>Sort: Quant Completeness</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 font-mono text-[11px]">
            <span className="text-outline uppercase tracking-wider mr-1">Filter:</span>
            <button
              onClick={() => setActiveFilter('text')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 shadow-sm transition-colors ${
                activeFilter === 'text'
                  ? 'bg-primary-container text-on-primary-container font-semibold'
                  : 'bg-surface-container-lowest hover:bg-surface-container-high text-on-surface-variant'
              }`}
              type="button"
            >
              <span>Text Generation</span>
              <span className="text-[10px] bg-primary text-on-primary rounded-full px-1 font-mono">1.8k</span>
            </button>
            <button
              onClick={() => setActiveFilter('code')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                activeFilter === 'code'
                  ? 'bg-primary-container text-on-primary-container font-semibold'
                  : 'bg-surface-container-lowest hover:bg-surface-container-high text-on-surface-variant'
              }`}
              type="button"
            >
              <span>Code</span>
              <span className="text-[10px] text-outline font-mono">640</span>
            </button>
            <button
              onClick={() => setActiveFilter('vision')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                activeFilter === 'vision'
                  ? 'bg-primary-container text-on-primary-container font-semibold'
                  : 'bg-surface-container-lowest hover:bg-surface-container-high text-on-surface-variant'
              }`}
              type="button"
            >
              <span>Vision/Multimodal</span>
              <span className="text-[10px] text-outline font-mono">312</span>
            </button>
            <button
              onClick={() => setActiveFilter('embeddings')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                activeFilter === 'embeddings'
                  ? 'bg-primary-container text-on-primary-container font-semibold'
                  : 'bg-surface-container-lowest hover:bg-surface-container-high text-on-surface-variant'
              }`}
              type="button"
            >
              <span>Embeddings</span>
              <span className="text-[10px] text-outline font-mono">189</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Spec & Quant Table (8 Cols) vs Right Inspection (4 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 flex-1 bg-surface">
        {/* Left Column (8 cols) */}
        <div className="lg:col-span-8 flex flex-col p-6 gap-6 border-r border-outline-variant/30">
          {/* Main Model Metadata Card */}
          <div className="relative overflow-hidden bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 shadow-sm">
            <div className="absolute -right-8 -top-8 w-44 h-44 rounded-full bg-primary/5 blur-2xl pointer-events-none"></div>
            <div className="relative flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-lg bg-surface-container-highest border border-outline-variant/30 flex items-center justify-center text-primary font-bold text-[18px] font-mono shadow-sm">
                    Q
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-outline">
                      <span className="hover:text-primary cursor-pointer">Qwen</span>
                      <span>/</span>
                      <span className="text-tertiary flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">verified</span> Verified Org
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <h1 className="text-[18px] font-semibold text-on-surface tracking-tight">
                        Qwen3.8-27B-Instruct-GGUF
                      </h1>
                      <span className="px-2 py-0.5 rounded bg-surface-container-high text-primary font-mono text-[10px] font-semibold">
                        Native GGUF v3
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <a
                    className="px-2.5 py-1 bg-surface-container-high hover:bg-surface-variant text-on-surface rounded border border-outline-variant/30 flex items-center gap-1 transition-colors"
                    href="https://huggingface.co/Qwen/Qwen3.8-27B-Instruct-GGUF"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    <span>Open in HF</span>
                  </a>
                  <button
                    onClick={() => showToast('Bookmarked repository')}
                    className="p-1.5 bg-surface-container-high hover:bg-surface-variant text-on-surface-variant rounded border border-outline-variant/30 transition-colors"
                    type="button"
                    title="Bookmark"
                  >
                    <span className="material-symbols-outlined text-[14px]">bookmark</span>
                  </button>
                  <button
                    onClick={() => showToast('Link copied')}
                    className="p-1.5 bg-surface-container-high hover:bg-surface-variant text-on-surface-variant rounded border border-outline-variant/30 transition-colors"
                    type="button"
                    title="Share"
                  >
                    <span className="material-symbols-outlined text-[14px]">share</span>
                  </button>
                </div>
              </div>

              {/* Stats badges */}
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-on-surface-variant pt-1">
                <span className="flex items-center gap-1 text-on-surface font-semibold">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>27B Parameters
                </span>
                <span className="text-outline-variant">•</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">text_fields</span>Text Generation
                </span>
                <span className="text-outline-variant">•</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">policy</span>Apache 2.0
                </span>
                <span className="text-outline-variant">•</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">download</span>142,850 Downloads
                </span>
                <span className="text-outline-variant">•</span>
                <span className="flex items-center gap-1 text-error">
                  <span className="material-symbols-outlined text-[14px]">favorite</span>1,842 Likes
                </span>
                <span className="text-outline-variant">•</span>
                <span className="flex items-center gap-1 text-outline">
                  <span className="material-symbols-outlined text-[14px]">update</span>Updated 2 days ago
                </span>
              </div>

              <p className="text-[12.5px] text-on-surface-variant leading-relaxed bg-surface-container-lowest/60 p-3 rounded-lg border border-outline-variant/20">
                Official GGUF quantization weights provided for Qwen3.8-27B with enhanced reasoning
                capabilities, dual-GPU layer distribution support, and sliding window attention
                optimizations for Vulkan and ROCm runners.
              </p>
            </div>
          </div>

          {/* Local Storage Target Picker & Protected Download Status */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-[300px]">
                <span className="material-symbols-outlined text-outline text-[18px]">folder_open</span>
                <div className="flex flex-col flex-1">
                  <span className="font-mono text-[10px] text-outline uppercase font-semibold">
                    Local Storage Target
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex items-center gap-1 px-2.5 py-1 bg-surface-container-lowest rounded font-mono text-[12px] text-on-surface border border-outline-variant/20 flex-1">
                      <span className="text-primary font-semibold">/mnt/fast-nvme/ai-models/qwen/</span>
                      <span className="material-symbols-outlined text-outline text-[14px] ml-auto cursor-pointer">
                        arrow_drop_down
                      </span>
                    </div>
                    <button
                      onClick={() => showToast('Opening directory picker...')}
                      className="px-3 py-1 bg-surface-container-high hover:bg-surface-variant text-on-surface rounded font-mono text-[11px] border border-outline-variant/30 transition-colors"
                      type="button"
                    >
                      Browse
                    </button>
                  </div>
                </div>
              </div>

              {/* Free Space Gauge */}
              <div className="flex items-center gap-4 font-mono text-[11px] bg-surface-container-lowest border border-outline-variant/20 px-3.5 py-1.5 rounded-lg">
                <div className="flex flex-col">
                  <span className="text-outline text-[10px]">NVMe Partition</span>
                  <span className="text-tertiary font-semibold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    348.4 GB Free Space
                  </span>
                </div>
                <div className="w-24 flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-outline font-mono">
                    <span>NVMe</span>
                    <span>65% Free</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-variant rounded-full overflow-hidden">
                    <div className="h-full bg-tertiary rounded-full" style={{ width: '35%' }}></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] text-primary">
              <span className="material-symbols-outlined text-primary text-[15px]">shield</span>
              <span className="text-on-surface-variant">
                <strong className="text-on-surface">Protected Download Active:</strong> Existing files are
                fingerprinted via SHA256 before download. The application will never silently overwrite or
                truncate an existing local model file.
              </span>
            </div>
          </div>

          {/* Quantization Matrix Table */}
          <div className="flex flex-col bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-surface-container-high/60 border-b border-outline-variant/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-on-surface">
                  Available Quantization Formats
                </span>
                <span className="bg-surface-container-highest text-primary px-2 py-0.2 rounded font-mono text-[10px] font-semibold">
                  5 Matrix Variations
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[10px] text-outline">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-tertiary"></span>Optimal Fit
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-secondary-container"></span>In Index
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-error"></span>RAM Offload
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11.5px]">
                <thead>
                  <tr className="bg-surface-container-lowest text-outline text-[10px] uppercase tracking-wider border-b border-outline-variant/20">
                    <th className="py-2.5 px-4 font-semibold">File / Quant Method</th>
                    <th className="py-2.5 px-4 font-semibold">Size</th>
                    <th className="py-2.5 px-4 font-semibold">VRAM Req</th>
                    <th className="py-2.5 px-4 font-semibold">Dual RX 9070 Fit</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Status / Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10 text-on-surface">
                  {/* Row 1: Q2_K */}
                  <tr className="hover:bg-surface-container transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-outline text-[18px]">description</span>
                        <div className="flex flex-col">
                          <span className="font-semibold text-on-surface">
                            Qwen3.8-27B-Instruct-Q2_K.gguf
                          </span>
                          <span className="text-[10px] text-outline">2-bit K-quant • Medium perplexity loss</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-on-surface">9.8 GB</td>
                    <td className="py-3 px-4 text-on-surface-variant">Min 12 GB</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-semibold text-[10px] border border-tertiary/20">
                        <span className="material-symbols-outlined text-[13px]">check</span>Fits easily on
                        single GPU 0
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => showToast('Queued download: Qwen3.8-27B-Instruct-Q2_K.gguf')}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-surface-container-high hover:bg-primary hover:text-on-primary text-on-surface rounded font-semibold text-[11px] transition-colors border border-outline-variant/30 shadow-sm"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[14px]">download</span>
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>

                  {/* Row 2: Q4_K_M (Golden Pick) */}
                  <tr className="bg-surface-container-high/30 hover:bg-surface-container transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-tertiary text-[18px]">verified</span>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-on-surface">
                              Qwen3.8-27B-Instruct-Q4_K_M.gguf
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-tertiary/20 text-tertiary text-[9px] font-mono font-bold uppercase border border-tertiary/30">
                              Golden Pick
                            </span>
                          </div>
                          <span className="text-[10px] text-outline">
                            4-bit medium • Excellent quality retention
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-on-surface">17.3 GB</td>
                    <td className="py-3 px-4 text-on-surface-variant">Min 20 GB</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-semibold text-[10px] border border-tertiary/20">
                        <span className="material-symbols-outlined text-[13px]">done_all</span>Recommended: Fits
                        across Dual 9070
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-surface-container text-on-surface-variant text-[10px] flex items-center gap-1 border border-outline-variant/20">
                          <span className="material-symbols-outlined text-tertiary text-[13px]">
                            folder_check
                          </span>
                          Indexed
                        </span>
                        <button
                          onClick={onNavigateToModels}
                          className="px-2.5 py-1 bg-surface-container-highest hover:bg-surface-bright text-primary rounded font-semibold text-[11px] transition-colors border border-primary/30"
                        >
                          View Local
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Row 3: Q5_K_M (Downloading with Progress) */}
                  <tr className="bg-surface-container/60 hover:bg-surface-container transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`material-symbols-outlined text-primary text-[18px] ${
                            isPaused ? '' : 'animate-spin'
                          }`}
                        >
                          sync
                        </span>
                        <div className="flex flex-col">
                          <span className="font-semibold text-primary">
                            Qwen3.8-27B-Instruct-Q5_K_M.gguf
                          </span>
                          <span className="text-[10px] text-outline">
                            5-bit medium • Near-lossless instruction score
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-on-surface">20.4 GB</td>
                    <td className="py-3 px-4 text-on-surface-variant">Min 24 GB</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-semibold text-[10px] border border-tertiary/20">
                        <span className="material-symbols-outlined text-[13px]">check</span>Excellent Fit on
                        Dual GPUs
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-tertiary font-semibold">
                            {downloadProgress}% @ 84.2 MB/s
                          </span>
                          <span className="text-outline">ETA: 1m 24s</span>
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              onClick={() => {
                                setIsPaused(!isPaused);
                                showToast(isPaused ? 'Resumed download' : 'Paused download');
                              }}
                              className="p-1 hover:bg-surface-variant rounded text-on-surface-variant"
                              title={isPaused ? 'Resume' : 'Pause'}
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {isPaused ? 'play_arrow' : 'pause'}
                              </span>
                            </button>
                            <button
                              onClick={() => showToast('Cancelled download')}
                              className="p-1 hover:bg-surface-variant rounded text-error"
                              title="Cancel"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </div>
                        </div>
                        <div className="w-48 h-1.5 bg-surface-variant rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${downloadProgress}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>
                  </tr>

                  {/* Row 4: Q8_0 */}
                  <tr className="hover:bg-surface-container transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-outline text-[18px]">description</span>
                        <div className="flex flex-col">
                          <span className="font-semibold text-on-surface">
                            Qwen3.8-27B-Instruct-Q8_0.gguf
                          </span>
                          <span className="text-[10px] text-outline">
                            8-bit quant • Reference evaluation build
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-on-surface">28.9 GB</td>
                    <td className="py-3 px-4 text-on-surface-variant">Min 32 GB</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-semibold text-[10px] border border-outline-variant/30">
                        <span className="material-symbols-outlined text-outline text-[13px]">warning</span>
                        Tight Fit: 28.9/32 GB VRAM
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => showToast('Queued download: Qwen3.8-27B-Instruct-Q8_0.gguf')}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-surface-container-high hover:bg-primary hover:text-on-primary text-on-surface rounded font-semibold text-[11px] transition-colors border border-outline-variant/30 shadow-sm"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[14px]">download</span>
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>

                  {/* Row 5: FP16 */}
                  <tr className="hover:bg-surface-container transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-outline text-[18px]">description</span>
                        <div className="flex flex-col">
                          <span className="font-semibold text-on-surface">
                            Qwen3.8-27B-Instruct-FP16.gguf
                          </span>
                          <span className="text-[10px] text-outline">Unquantized float16 raw weights</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-on-surface">54.2 GB</td>
                    <td className="py-3 px-4 text-error font-semibold">Min 64 GB</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-error-container/20 text-error font-semibold text-[10px] border border-error/30">
                        <span className="material-symbols-outlined text-[13px]">error</span>Exceeds VRAM:
                        Requires RAM Offload
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => showToast('Queued download: Qwen3.8-27B-Instruct-FP16.gguf')}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-surface-container-high hover:bg-surface-variant text-on-surface-variant rounded font-semibold text-[11px] transition-colors border border-outline-variant/30 shadow-sm"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[14px]">download</span>
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Sub-Grids: Layout allocation & Threading */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-mono text-[10px] text-outline uppercase font-semibold">
                <span>Dual GPU VRAM Layout Allocation</span>
                <span className="text-tertiary">PCIe 4.0 x16 / x16</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 bg-surface-container-lowest p-2 rounded-lg border border-outline-variant/20">
                  <div className="flex justify-between font-mono text-[10px] mb-1">
                    <span className="text-on-surface font-semibold">GPU 0 (RX 9070)</span>
                    <span className="text-tertiary font-mono">10.2 / 16 GB</span>
                  </div>
                  <div className="w-full h-2 bg-surface-variant rounded-full overflow-hidden">
                    <div className="h-full bg-tertiary rounded-full" style={{ width: '63%' }}></div>
                  </div>
                  <span className="text-[9px] text-outline mt-1 block font-mono">Layers 00 - 32</span>
                </div>
                <div className="flex-1 bg-surface-container-lowest p-2 rounded-lg border border-outline-variant/20">
                  <div className="flex justify-between font-mono text-[10px] mb-1">
                    <span className="text-on-surface font-semibold">GPU 1 (RX 9070)</span>
                    <span className="text-tertiary font-mono">10.2 / 16 GB</span>
                  </div>
                  <div className="w-full h-2 bg-surface-variant rounded-full overflow-hidden">
                    <div className="h-full bg-tertiary rounded-full" style={{ width: '63%' }}></div>
                  </div>
                  <span className="text-[9px] text-outline mt-1 block font-mono">Layers 33 - 64</span>
                </div>
              </div>
            </div>

            <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between font-mono text-[10px] text-outline uppercase font-semibold">
                <span>Transfer Concurrency &amp; Threading</span>
                <span className="text-primary font-mono">Aria2 Multi-Chunk</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 font-mono">
                <div className="bg-surface-container-lowest p-2 rounded text-center border border-outline-variant/20">
                  <span className="text-outline block text-[9px]">Active Threads</span>
                  <span className="text-on-surface font-bold text-[15px]">16</span>
                </div>
                <div className="bg-surface-container-lowest p-2 rounded text-center border border-outline-variant/20">
                  <span className="text-outline block text-[9px]">Peak Bandwidth</span>
                  <span className="text-on-surface font-bold text-[15px]">112 MB/s</span>
                </div>
                <div className="bg-surface-container-lowest p-2 rounded text-center border border-outline-variant/20">
                  <span className="text-outline block text-[9px]">Hash Verification</span>
                  <span className="text-tertiary font-bold text-[15px]">SHA256</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (4 cols) */}
        <div className="lg:col-span-4 flex flex-col p-6 gap-6 bg-surface-container-lowest">
          {/* Runtime Compatibility Check */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2 shadow-sm">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[13px] text-on-surface font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-[18px]">memory</span>
                <span>Runtime Compatibility Check</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-mono text-[10px] font-semibold border border-tertiary/20">
                Verified Clean
              </span>
            </div>
            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex items-center justify-between p-2 rounded bg-surface-container border border-outline-variant/20">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
                  <span className="text-on-surface">llama.cpp b6821 Runner</span>
                </div>
                <span className="text-outline font-mono">Compatible</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-surface-container border border-outline-variant/20">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
                  <span className="text-on-surface">ROCm / Vulkan Shader Pipelines</span>
                </div>
                <span className="text-outline font-mono">Native ISA</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-surface-container border border-outline-variant/20">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[16px]">info</span>
                  <span className="text-on-surface">Vision / CLIP Projector</span>
                </div>
                <span className="text-outline font-mono">Not Required (Pure text)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-surface-container border border-outline-variant/20">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
                  <span className="text-on-surface">FlashAttention-2 Support</span>
                </div>
                <span className="text-outline font-mono">Enabled (Vulkan)</span>
              </div>
            </div>
          </div>

          {/* Architecture Specifications */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-on-surface font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-[18px]">tune</span>
                <span>Architecture Specifications</span>
              </span>
              <span className="font-mono text-[10px] text-outline">Qwen 3.8</span>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
              <div className="p-2 bg-surface-container-lowest rounded border border-outline-variant/20">
                <span className="text-outline block text-[9px] uppercase">Default Context</span>
                <span className="text-on-surface font-semibold font-mono">32,768 ctx</span>
              </div>
              <div className="p-2 bg-surface-container-lowest rounded border border-outline-variant/20">
                <span className="text-outline block text-[9px] uppercase">Extended Context</span>
                <span className="text-primary font-semibold font-mono">131,072 ctx</span>
              </div>
              <div className="p-2 bg-surface-container-lowest rounded border border-outline-variant/20">
                <span className="text-outline block text-[9px] uppercase">Tokenizer Engine</span>
                <span className="text-on-surface font-semibold font-mono">tiktoken (qwen)</span>
              </div>
              <div className="p-2 bg-surface-container-lowest rounded border border-outline-variant/20">
                <span className="text-outline block text-[9px] uppercase">Vocabulary Size</span>
                <span className="text-on-surface font-semibold font-mono">152,064 tokens</span>
              </div>
              <div className="p-2 bg-surface-container-lowest rounded border border-outline-variant/20">
                <span className="text-outline block text-[9px] uppercase">Chat Template</span>
                <span className="text-on-surface font-semibold font-mono">ChatML</span>
              </div>
              <div className="p-2 bg-surface-container-lowest rounded border border-outline-variant/20">
                <span className="text-outline block text-[9px] uppercase">Attention Type</span>
                <span className="text-on-surface font-semibold font-mono">GQA (Grouped Query)</span>
              </div>
            </div>
          </div>

          {/* README.md Summary */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2 flex-1 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-on-surface font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-[18px]">article</span>
                <span>README.md Summary</span>
              </span>
              <span className="text-outline font-mono text-[10px]">Source: HuggingFace</span>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg text-[12px] text-on-surface-variant flex flex-col gap-2 overflow-y-auto max-h-64 leading-relaxed font-mono">
              <div className="flex items-center gap-2 pb-1 bg-surface-container p-1 rounded text-outline text-[11px]">
                <span className="text-primary font-bold"># Usage Prompt Template</span>
              </div>
              <pre className="bg-surface-container-high p-2 rounded text-on-surface overflow-x-auto text-[10px] leading-tight">
                <code>{`<|im_start|>system
You are a helpful assistant specialized in mathematics and coding.<|im_end|>
<|im_start|>user
Solve the following equation step by step...<|im_end|>
<|im_start|>assistant`}</code>
              </pre>
              <p className="text-[11px]">
                <strong>Recommended Sampling Parameters:</strong>
                <br />• Temperature: 0.7
                <br />• Top-P: 0.8
                <br />• Repetition Penalty: 1.05
              </p>
              <p className="text-[11px]">
                <strong>Vulkan &amp; ROCm Specific Notes:</strong> When running across dual GPUs, pass{' '}
                <code className="bg-surface-container px-1 rounded text-primary font-mono">-ts 16,16</code> to
                equally divide the weight tensors and KV cache budget without latency overhead.
              </p>
            </div>
            <div className="flex items-center justify-between pt-1 font-mono text-[11px]">
              <button
                onClick={() => showToast('Opening complete model card markdown (3,400 words)...')}
                className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                type="button"
              >
                <span>Read complete model card (3,400 words)</span>
                <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
              </button>
              <span className="text-outline">SHA: 7e2f1a9b</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
