import React, { useState } from 'react';

interface ModelsLibraryScreenProps {
  onLoadModel: (modelName: string) => void;
  onNavigateToChat: () => void;
  onNavigateToPlacement: () => void;
}

export const ModelsLibraryScreen: React.FC<ModelsLibraryScreenProps> = ({
  onLoadModel,
  onNavigateToChat,
  onNavigateToPlacement,
}) => {
  const [activeFormat, setActiveFormat] = useState<'all' | 'gguf' | 'safetensors' | 'hf-cache'>('all');
  const [activeArch, setActiveArch] = useState<'all' | 'qwen' | 'llama' | 'mistral' | 'deepseek'>('all');
  const [activeQuant, setActiveQuant] = useState<'all' | 'q4' | 'q8' | 'fp16'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // Modals
  const [manageDirsOpen, setManageDirsOpen] = useState(false);
  const [addDirOpen, setAddDirOpen] = useState(false);
  const [newDirPath, setNewDirPath] = useState('');
  const [isRescanning, setIsRescanning] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Inspector profile data
  const [selectedModelKey, setSelectedModelKey] = useState<'qwen3.8' | 'llama3.3' | 'deepseek14b' | 'qwencoder32b'>('qwen3.8');

  const modelProfiles = {
    'qwen3.8': {
      title: 'Qwen3.8-27B-Instruct',
      path: '/mnt/fast-nvme/ai-models/qwen/Qwen3.8-27B-Instruct-Q4_K_M.gguf',
      hash: '98a7ff2e11...3c89',
      arch: 'qwen3',
      layers: '48 layers (Transformer)',
      heads: '64 heads / 8 kv-heads (GQA)',
      ctx: '32,768 tokens native',
      status: 'ACTIVE PROFILE',
    },
    'llama3.3': {
      title: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf',
      path: '/mnt/fast-nvme/ai-models/meta/Llama-3.3-70B-Instruct-Q4_K_M.gguf',
      hash: 'a140f2882c81...99bc',
      arch: 'llama-3.3',
      layers: '80 layers (Dense)',
      heads: '64 heads / 8 kv-heads (GQA)',
      ctx: '128,000 tokens native',
      status: 'STANDBY DISK',
    },
    deepseek14b: {
      title: 'DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf',
      path: '~/Models/deepseek/DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf',
      hash: '48fe710034a1...e201',
      arch: 'deepseek-v2-distill',
      layers: '48 layers',
      heads: '40 heads / 8 kv-heads',
      ctx: '65,536 tokens native',
      status: 'READY TO LOAD',
    },
    qwencoder32b: {
      title: 'Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf',
      path: '~/.cache/lm-studio/models/lmstudio-community/Qwen2.5-Coder-32B-Instruct-GGUF',
      hash: 'bf83a992bc01...881a',
      arch: 'qwen2.5',
      layers: '64 layers',
      heads: '40 heads / 8 kv-heads',
      ctx: '32,768 tokens native',
      status: 'EXTERNAL LINK',
    },
  };

  const currentProf = modelProfiles[selectedModelKey];

  const handleRescan = () => {
    setIsRescanning(true);
    showToast('Indexing 4 directories across 1.42 TB storage...');
    setTimeout(() => {
      setIsRescanning(false);
      showToast('Indexed 43 models. All caches up to date.');
    }, 1200);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied path to clipboard');
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

      {/* Dynamic Status Ribbon */}
      <div className="px-6 py-2 bg-surface-container-lowest border-b border-outline-variant/30 flex flex-wrap items-center justify-between text-[11px] font-mono shadow-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5 text-tertiary font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
            VULKAN RUNTIME ACTIVE
          </span>
          <span className="text-outline-variant">/</span>
          <span className="text-on-surface-variant">
            Active Instance: <span className="text-primary font-semibold">PID 48201</span> (llama.cpp b6821)
          </span>
          <span className="text-outline-variant">/</span>
          <span className="text-on-surface-variant">
            VRAM Committed: <span className="text-on-surface font-medium">22.0 GB / 32.0 GB</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-outline">
            Last background sync: <span className="text-on-surface">38s ago</span>
          </span>
          <button
            onClick={handleRescan}
            className="flex items-center gap-1 text-primary hover:text-primary-fixed-dim transition-colors cursor-pointer"
          >
            <span className={`material-symbols-outlined text-[14px] ${isRescanning ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Re-index Watchers</span>
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Header Block */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="px-1.5 py-0.5 rounded bg-surface-container-high text-primary font-mono text-[10px] font-semibold">
                WORKSPACE / FS-LAYER
              </div>
              <span className="font-mono text-[11px] text-outline">v1.4.2-native</span>
            </div>
            <h1 className="text-[22px] font-semibold text-on-surface tracking-tight">
              Local Models Library
            </h1>
            <p className="text-[13px] text-on-surface-variant max-w-3xl leading-relaxed">
              Unified catalog across physical file mounts, symlinks, and indexed runtime directories.
              Automatic hardware compatibility mapping for dual RX 9070 nodes.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => showToast('File picker opened for GGUF / Safetensors file import')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors text-[12px] border border-outline-variant/30 shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">file_open</span>
              <span>Import File</span>
            </button>
            <button
              onClick={handleRescan}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors text-[12px] border border-outline-variant/30 shadow-sm"
            >
              <span className={`material-symbols-outlined text-[16px] ${isRescanning ? 'animate-spin' : ''}`}>
                sync
              </span>
              <span>Rescan All</span>
            </button>
            <button
              onClick={() => setAddDirOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-fixed-dim transition-colors text-[12px] font-semibold shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
              <span>+ Add Model Directory</span>
            </button>
          </div>
        </div>

        {/* 4 Indexed Directories Hub Ribbon */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">folder_special</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[14px] font-semibold text-on-surface">
                  4 Indexed Model Directories
                </span>
                <span className="font-mono text-[11px] text-outline">
                  (1.42 TB Total Storage Allocated)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[12px]">
              <span className="flex items-center gap-1 text-on-surface-variant font-mono text-[11px] bg-surface-container px-2 py-0.5 rounded border border-outline-variant/20">
                <span className="material-symbols-outlined text-[14px] text-tertiary">check_circle</span>
                Inotify Watchers Active
              </span>
              <button
                onClick={() => setManageDirsOpen(true)}
                className="text-primary hover:underline text-[12px] cursor-pointer"
              >
                Manage Directories
              </button>
            </div>
          </div>

          {/* Mount Points Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* Dir 1 */}
            <div className="p-3 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors flex flex-col justify-between border border-outline-variant/20">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                    Primary
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-tertiary">
                    <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>Healthy
                  </span>
                </div>
                <p className="font-mono text-[12px] text-on-surface truncate font-semibold">~/Models</p>
                <p className="text-[11px] text-outline">18 models • 412 GB</p>
              </div>
              <div className="pt-2 flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
                <span>Scanned 4m ago</span>
                <button
                  onClick={() => showToast('Triggered scan for ~/Models')}
                  className="hover:text-primary"
                  title="Rescan folder"
                >
                  <span className="material-symbols-outlined text-[14px]">history</span>
                </button>
              </div>
            </div>

            {/* Dir 2 */}
            <div className="p-3 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors flex flex-col justify-between border border-outline-variant/20">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-variant text-on-surface font-semibold">
                    NVMe Fast
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-tertiary">
                    <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>Healthy
                  </span>
                </div>
                <p className="font-mono text-[12px] text-on-surface truncate font-semibold">
                  /mnt/fast-nvme/ai-models
                </p>
                <p className="text-[11px] text-outline">16 models • 680 GB</p>
              </div>
              <div className="pt-2 flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
                <span>Scanned 12m ago</span>
                <button
                  onClick={() => showToast('Triggered scan for NVMe path')}
                  className="hover:text-primary"
                  title="Rescan folder"
                >
                  <span className="material-symbols-outlined text-[14px]">history</span>
                </button>
              </div>
            </div>

            {/* Dir 3 */}
            <div className="p-3 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors flex flex-col justify-between border border-outline-variant/20">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-secondary-container/40 text-secondary font-semibold">
                    LM Studio Sync
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>External Index
                  </span>
                </div>
                <p className="font-mono text-[12px] text-on-surface truncate font-semibold">
                  ~/.cache/lm-studio/models
                </p>
                <p className="text-[11px] text-outline">7 models • 280 GB</p>
              </div>
              <div className="pt-2 flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
                <span>Scanned 1h ago</span>
                <button
                  onClick={() => showToast('Triggered scan for LM Studio cache')}
                  className="hover:text-primary"
                  title="Rescan folder"
                >
                  <span className="material-symbols-outlined text-[14px]">history</span>
                </button>
              </div>
            </div>

            {/* Dir 4 */}
            <div className="p-3 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors flex flex-col justify-between border border-outline-variant/20">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-container-highest text-outline font-semibold">
                    Cold Storage
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-outline">
                    <span className="w-1.5 h-1.5 rounded-full bg-outline"></span>Read-Only
                  </span>
                </div>
                <p className="font-mono text-[12px] text-on-surface truncate font-semibold">
                  /mnt/hdd-storage/hf-cache
                </p>
                <p className="text-[11px] text-outline">2 models • 48 GB</p>
              </div>
              <div className="pt-2 flex items-center justify-between font-mono text-[10px] text-on-surface-variant">
                <span>Scanned 2d ago</span>
                <button
                  onClick={() => showToast('Triggered scan for cold storage')}
                  className="hover:text-primary"
                  title="Rescan folder"
                >
                  <span className="material-symbols-outlined text-[14px]">history</span>
                </button>
              </div>
            </div>
          </div>

          {/* Reassurance Notice */}
          <div className="px-3 py-2 rounded bg-surface-container-highest/60 border border-outline-variant/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-on-surface-variant text-[12px]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[16px]">info</span>
              <span>
                Removing a location only unlinks it from the index; physical files and model weights
                are <strong className="text-on-surface">never deleted</strong>.
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <button onClick={handleRescan} className="text-primary hover:underline">
                Scan Folder
              </button>
              <span className="text-outline">•</span>
              <button
                onClick={() => showToast('Mount Config JSON loaded in editor')}
                className="text-on-surface hover:underline"
              >
                Mount Config JSON
              </button>
            </div>
          </div>
        </div>

        {/* Search & Multi-Tier Filter Bar */}
        <div className="space-y-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Main Search Input */}
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
                search
              </span>
              <input
                className="w-full h-10 pl-9 pr-14 rounded-lg bg-surface-container-low border border-outline-variant/30 text-on-surface text-[13px] placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search 43 local models by name, architecture, quant (Ctrl+F)..."
                type="text"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-surface-container font-mono text-[10px] text-outline border border-outline-variant/30">
                Ctrl+F
              </kbd>
            </div>

            {/* Format Filter Segmented Bar */}
            <div className="flex items-center bg-surface-container-low border border-outline-variant/30 p-1 rounded-lg gap-1">
              {(
                [
                  { id: 'all', label: 'All (43)' },
                  { id: 'gguf', label: 'GGUF (38)' },
                  { id: 'safetensors', label: 'Safetensors (3)' },
                  { id: 'hf-cache', label: 'HuggingFace Cache (2)' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveFormat(tab.id)}
                  className={`px-3 py-1 rounded font-mono text-[11px] transition-colors ${
                    activeFormat === tab.id
                      ? 'text-primary bg-surface-container-high font-semibold shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Secondary Filter Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 font-mono text-[11px]">
            <div className="flex flex-wrap items-center gap-3">
              {/* Architecture filters */}
              <div className="flex items-center gap-1.5">
                <span className="text-outline uppercase tracking-wider">Architecture:</span>
                <div className="inline-flex rounded-lg bg-surface-container p-0.5 border border-outline-variant/20">
                  {(['all', 'qwen', 'llama', 'mistral', 'deepseek'] as const).map((arch) => (
                    <button
                      key={arch}
                      onClick={() => setActiveArch(arch)}
                      className={`px-2 py-0.5 rounded capitalize ${
                        activeArch === arch
                          ? 'text-primary font-semibold bg-surface-container-high'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {arch === 'all' ? 'All' : arch}
                    </button>
                  ))}
                </div>
              </div>

              <span className="text-outline-variant">|</span>

              {/* Quant filters */}
              <div className="flex items-center gap-1.5">
                <span className="text-outline uppercase tracking-wider">Quant:</span>
                <div className="inline-flex rounded-lg bg-surface-container p-0.5 border border-outline-variant/20">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'q4', label: 'Q4_K_M' },
                      { id: 'q8', label: 'Q8_0' },
                      { id: 'fp16', label: 'FP16' },
                    ] as const
                  ).map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setActiveQuant(q.id)}
                      className={`px-2 py-0.5 rounded ${
                        activeQuant === q.id
                          ? 'text-primary font-semibold bg-surface-container-high'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-outline">
              <span>Sort:</span>
              <select className="bg-surface-container border border-outline-variant/30 text-on-surface px-2 py-1 rounded focus:outline-none cursor-pointer">
                <option>Last Modified (Desc)</option>
                <option>File Size (Largest)</option>
                <option>Parameter Count</option>
                <option>Alphabetical (A-Z)</option>
              </select>
              <button
                onClick={() => setInspectorOpen(!inspectorOpen)}
                className="p-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface border border-outline-variant/30"
                title="Toggle Inspector Side-Drawer"
              >
                <span className="material-symbols-outlined text-[16px]">dock_to_right</span>
              </button>
            </div>
          </div>
        </div>

        {/* Main Workspace Split Deck */}
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          {/* Primary Model List Column */}
          <div className="w-full xl:flex-1 space-y-4">
            {/* CARD 1: ACTIVE LOADED MODEL (QWEN 3.8 27B) */}
            <div
              onClick={() => setSelectedModelKey('qwen3.8')}
              className={`p-4 rounded-xl border transition-all shadow-md relative group cursor-pointer ${
                selectedModelKey === 'qwen3.8'
                  ? 'bg-surface-container-high border-primary/50 ring-1 ring-primary/30'
                  : 'bg-surface-container hover:bg-surface-container-high/70 border-outline-variant/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1 pb-2">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-container/30 text-tertiary font-mono text-[11px] font-semibold border border-tertiary/20">
                    <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
                    ACTIVE IN MEMORY
                  </span>
                  <span className="font-mono text-[11px] text-outline">
                    Server PID 48201 (llama.cpp Vulkan)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-surface-container-highest text-primary font-mono text-[11px]">
                    42.4 tok/s
                  </span>
                </div>
                <span className="font-mono text-[11px] text-outline">
                  Hugging Face • Added 3 days ago
                </span>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-2">
                <div>
                  <h2 className="text-[17px] font-semibold text-on-surface flex items-center gap-2">
                    <span>Qwen3.8-27B-Instruct</span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-variant font-mono text-on-surface-variant">
                      bfloat16 base
                    </span>
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[11px] text-outline truncate max-w-xl">
                      /mnt/fast-nvme/ai-models/qwen/Qwen3.8-27B-Instruct-Q4_K_M.gguf
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(
                          '/mnt/fast-nvme/ai-models/qwen/Qwen3.8-27B-Instruct-Q4_K_M.gguf'
                        );
                      }}
                      className="text-outline hover:text-primary transition-colors"
                      title="Copy path"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    27B Params
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    17.4 GB on disk
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-tertiary font-semibold">
                    GGUF v3
                  </span>
                  <span className="px-2 py-1 rounded bg-primary/20 text-primary font-semibold">
                    Q4_K_M Balanced
                  </span>
                </div>
              </div>

              {/* Hardware Telemetry Bar */}
              <div className="p-2.5 rounded-lg bg-surface-container-low space-y-2 border border-outline-variant/20">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-on-surface-variant flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-tertiary text-[15px]">verified</span>
                    Dual RX 9070 Hardware Topology: Fully Offloaded
                  </span>
                  <span className="text-on-surface font-medium">18.2 GB Allocated (32k context reserved)</span>
                </div>
                <div className="w-full h-2 rounded bg-surface-container-highest overflow-hidden flex">
                  <div className="h-full bg-error" style={{ width: '44.3%' }} title="GPU 0: 14.2 GB"></div>
                  <div className="h-full bg-tertiary" style={{ width: '12.5%' }} title="GPU 1: 4.0 GB"></div>
                  <div className="h-full bg-surface-variant flex-1" title="Headroom Remaining"></div>
                </div>
                <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                  <span>GPU 0 (RX 9070 16GB): 42 layers offloaded</span>
                  <span>GPU 1 (RX 9070 16GB): 22 layers offloaded</span>
                  <span>Host RAM: 0 layers (100% GPU offload)</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <div className="flex items-center gap-2 font-mono text-[11px] text-outline">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-primary text-[14px]">bolt</span>
                    llama.cpp Vulkan Backend
                  </span>
                  <span>•</span>
                  <span>
                    SHA: <code className="text-on-surface">d9e7a...0f12</code>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showToast('Running throughput benchmark on Qwen3.8-27B: 42.4 tok/s');
                    }}
                    className="px-2.5 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] transition-colors border border-outline-variant/30"
                  >
                    Benchmark
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showToast('Opened /mnt/fast-nvme/ai-models/qwen in host manager');
                    }}
                    className="px-2.5 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] transition-colors border border-outline-variant/30"
                  >
                    Open Folder
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToPlacement();
                    }}
                    className="px-2.5 py-1 rounded bg-surface-container-high text-primary hover:bg-surface-bright text-[12px] font-semibold transition-colors border border-primary/30"
                  >
                    Configure Placement
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToChat();
                    }}
                    className="px-3 py-1 rounded bg-tertiary text-on-tertiary text-[12px] font-semibold shadow-sm hover:brightness-110 transition-all flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[15px]">chat</span>
                    <span>Active Chat</span>
                  </button>
                </div>
              </div>
            </div>

            {/* CARD 2: LLAMA 3.3 70B */}
            <div
              onClick={() => setSelectedModelKey('llama3.3')}
              className={`p-4 rounded-xl border transition-all shadow-md group cursor-pointer ${
                selectedModelKey === 'llama3.3'
                  ? 'bg-surface-container-high border-primary/50 ring-1 ring-primary/30'
                  : 'bg-surface-container hover:bg-surface-container-high/70 border-outline-variant/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1 pb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-surface-container-highest text-outline font-mono text-[10px]">
                    STANDBY • ON DISK
                  </span>
                  <span className="font-mono text-[11px] text-outline">Meta Llama-3.3 Architecture</span>
                </div>
                <span className="font-mono text-[11px] text-outline">Local direct import • Added 1 week ago</span>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-2">
                <div>
                  <h2 className="text-[17px] font-semibold text-on-surface">
                    Llama-3.3-70B-Instruct-Q4_K_M.gguf
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[11px] text-outline truncate max-w-xl">
                      /mnt/fast-nvme/ai-models/meta/Llama-3.3-70B-Instruct-Q4_K_M.gguf
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard('/mnt/fast-nvme/ai-models/meta/Llama-3.3-70B-Instruct-Q4_K_M.gguf');
                      }}
                      className="text-outline hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    70.6B Params
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    42.8 GB
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-tertiary font-semibold">
                    GGUF
                  </span>
                  <span className="px-2 py-1 rounded bg-primary/20 text-primary font-semibold">
                    Q4_K_M
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-low space-y-1.5 border border-outline-variant/20">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-secondary font-medium flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-secondary text-[16px]">info</span>
                    Hybrid Placement Required: Dual RX 9070 (30 GB) + Host RAM Offload (14.5 GB)
                  </span>
                  <span className="text-outline">Est: ~18-24 tok/s</span>
                </div>
                <div className="w-full h-1.5 rounded bg-surface-container-highest overflow-hidden flex">
                  <div className="h-full bg-primary" style={{ width: '68%' }} title="VRAM Total Fill"></div>
                  <div className="h-full bg-secondary" style={{ width: '32%' }} title="System RAM Offload"></div>
                </div>
                <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                  <span>80 Layers Total (62 layers in VRAM, 18 layers in DDR5 System Memory)</span>
                  <span>Needs 44.5 GB Total Available</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <div className="flex items-center gap-2 font-mono text-[11px] text-outline">
                  <span>Ctx: 128,000 max</span>
                  <span>•</span>
                  <span>80 Layers Matrix</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToPlacement();
                    }}
                    className="px-2.5 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] transition-colors border border-outline-variant/30"
                  >
                    Placement Wizard
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoadModel('Llama-3.3-70B-Instruct');
                      showToast('Swapped active model to Llama-3.3-70B');
                    }}
                    className="px-3 py-1 rounded bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary-fixed-dim transition-colors shadow-sm flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                    <span>Load Model</span>
                  </button>
                </div>
              </div>
            </div>

            {/* CARD 3: DEEPSEEK R1 DISTILL 14B */}
            <div
              onClick={() => setSelectedModelKey('deepseek14b')}
              className={`p-4 rounded-xl border transition-all shadow-md group cursor-pointer ${
                selectedModelKey === 'deepseek14b'
                  ? 'bg-surface-container-high border-primary/50 ring-1 ring-primary/30'
                  : 'bg-surface-container hover:bg-surface-container-high/70 border-outline-variant/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1 pb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-mono text-[10px] font-medium border border-tertiary/20">
                    100% SINGLE GPU FITTING
                  </span>
                  <span className="font-mono text-[11px] text-outline">DeepSeek-AI Architecture</span>
                </div>
                <span className="font-mono text-[11px] text-outline">HF Hub Sync • Added yesterday</span>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-2">
                <div>
                  <h2 className="text-[17px] font-semibold text-on-surface flex items-center gap-2">
                    <span>DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf</span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-container-highest font-mono text-tertiary font-semibold">
                      Near FP16 Quality
                    </span>
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[11px] text-outline truncate max-w-xl">
                      ~/Models/deepseek/DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard('~/Models/deepseek/DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf');
                      }}
                      className="text-outline hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    14.8B Params
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    15.6 GB
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-tertiary font-semibold">
                    GGUF
                  </span>
                  <span className="px-2 py-1 rounded bg-secondary-container/30 text-secondary font-semibold">
                    Q8_0 Pristine
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-low flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-outline-variant/20">
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="material-symbols-outlined text-tertiary text-[16px]">check_box</span>
                  <span className="text-on-surface">
                    Fits completely in GPU 0 VRAM:{' '}
                    <span className="font-semibold text-tertiary">15.6 GB / 16.0 GB</span>
                  </span>
                </div>
                <span className="font-mono text-[11px] text-on-surface-variant">
                  Predicted speed: <span className="text-primary font-semibold">58.2 tok/s</span>
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <div className="flex items-center gap-2 font-mono text-[11px] text-outline">
                  <span>Ctx: 65,536 max</span>
                  <span>•</span>
                  <span>Location: Primary Mount</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showToast('Viewing full metadata sheet for DeepSeek 14B');
                    }}
                    className="px-2.5 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] transition-colors border border-outline-variant/30"
                  >
                    Details
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoadModel('DeepSeek-R1-Distill-14B');
                      showToast('Quick-loaded DeepSeek-R1-Distill-14B to GPU 0');
                    }}
                    className="px-3 py-1 rounded bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary-fixed-dim transition-colors shadow-sm flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">flash_on</span>
                    <span>Quick Load to GPU 0</span>
                  </button>
                </div>
              </div>
            </div>

            {/* CARD 4: QWEN 2.5 CODER 32B */}
            <div
              onClick={() => setSelectedModelKey('qwencoder32b')}
              className={`p-4 rounded-xl border transition-all shadow-md group cursor-pointer ${
                selectedModelKey === 'qwencoder32b'
                  ? 'bg-surface-container-high border-primary/50 ring-1 ring-primary/30'
                  : 'bg-surface-container hover:bg-surface-container-high/70 border-outline-variant/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1 pb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-surface-container-highest text-secondary font-mono text-[10px] flex items-center gap-1 font-semibold">
                    <span className="material-symbols-outlined text-[13px]">share</span>
                    Shared with LM Studio
                  </span>
                  <span className="font-mono text-[11px] text-outline">Code Specialization</span>
                </div>
                <span className="font-mono text-[11px] text-outline">
                  External Link • Zero Duplicate Disk Overhead
                </span>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-2">
                <div>
                  <h2 className="text-[17px] font-semibold text-on-surface">
                    Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[11px] text-outline truncate max-w-xl">
                      ~/.cache/lm-studio/models/lmstudio-community/Qwen2.5-Coder-32B-Instruct-GGUF
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard('~/.cache/lm-studio/models/lmstudio-community/Qwen2.5-Coder-32B-Instruct-GGUF');
                      }}
                      className="text-outline hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    32.5B Params
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-on-surface font-semibold">
                    19.8 GB
                  </span>
                  <span className="px-2 py-1 rounded bg-surface-container-low text-tertiary font-semibold">
                    GGUF
                  </span>
                  <span className="px-2 py-1 rounded bg-primary/20 text-primary font-semibold">
                    Q4_K_M
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-container-low flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-outline-variant/20">
                <span className="font-mono text-[11px] text-on-surface-variant">
                  Recommended: Split 50/50 over Dual RX 9070 (9.9 GB per GPU)
                </span>
                <span className="font-mono text-[11px] text-tertiary font-medium">Full GPU Execution ✓</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <div className="flex items-center gap-2 font-mono text-[11px] text-outline">
                  <span>Ctx: 32,768</span>
                  <span>•</span>
                  <span>Directory: ~/.cache/lm-studio</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showToast('Opened layer breakdown for Qwen Coder');
                    }}
                    className="px-2.5 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] transition-colors border border-outline-variant/30"
                  >
                    Details
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoadModel('Qwen2.5-Coder-32B');
                      showToast('Swapped active model to Qwen2.5-Coder-32B');
                    }}
                    className="px-3 py-1 rounded bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary-fixed-dim transition-colors shadow-sm flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                    <span>Load Model</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Collapsible Technical Inspector Drawer */}
          {inspectorOpen && (
            <div className="w-full xl:w-96 rounded-xl bg-surface-container p-4 border border-outline-variant/30 shadow-md space-y-4 shrink-0 transition-all">
              <div className="flex items-center justify-between pb-1 border-b border-outline-variant/20">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">terminal</span>
                  <h3 className="font-semibold text-on-surface text-[14px]">Model Inspector</h3>
                </div>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-tertiary font-semibold border border-tertiary/20">
                  {currentProf.status}
                </span>
              </div>

              {/* Target Identification */}
              <div className="p-3 rounded-lg bg-surface-container-low space-y-1 border border-outline-variant/20">
                <p className="font-mono text-[10px] text-outline uppercase tracking-wider">
                  Loaded Weight
                </p>
                <p className="font-mono text-[13px] text-on-surface font-semibold">
                  {currentProf.title}
                </p>
                <p className="font-mono text-[10px] text-outline break-all">{currentProf.path}</p>
              </div>

              {/* Checksum & Low-level Metadata */}
              <div className="space-y-2">
                <p className="font-mono text-[10px] text-outline uppercase tracking-wider font-semibold">
                  Header Metadata
                </p>
                <div className="p-3 rounded-lg bg-surface-container-low space-y-2 font-mono text-[11px] border border-outline-variant/20">
                  <div className="flex justify-between items-center">
                    <span className="text-on-surface-variant">SHA-256 Checksum:</span>
                    <span className="text-on-surface font-mono">{currentProf.hash}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-on-surface-variant">Architecture:</span>
                    <span className="text-primary font-semibold">{currentProf.arch}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-on-surface-variant">Layer Count:</span>
                    <span className="text-on-surface font-semibold">{currentProf.layers}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-on-surface-variant">Attention Heads:</span>
                    <span className="text-on-surface font-semibold">{currentProf.heads}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-on-surface-variant">Tensor Context Limit:</span>
                    <span className="text-on-surface font-semibold text-tertiary">
                      {currentProf.ctx}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-on-surface-variant">File Magic Token:</span>
                    <span className="text-outline">GGUF (v3 Little-Endian)</span>
                  </div>
                </div>
              </div>

              {/* Memory Footprint Simulator across KV-cache quantizations */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] text-outline uppercase tracking-wider font-semibold">
                    KV Cache Footprint Matrix
                  </p>
                  <span className="font-mono text-[10px] text-outline">@ 32,768 ctx</span>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low space-y-2.5 border border-outline-variant/20">
                  {/* FP16 KV */}
                  <div>
                    <div className="flex justify-between font-mono text-[11px] mb-1">
                      <span className="text-on-surface-variant">FP16 Standard KV Cache</span>
                      <span className="text-error font-semibold">4.80 GB VRAM</span>
                    </div>
                    <div className="w-full h-1.5 rounded bg-surface-container-highest overflow-hidden">
                      <div className="h-full bg-error rounded" style={{ width: '80%' }}></div>
                    </div>
                  </div>
                  {/* Q8_0 KV */}
                  <div>
                    <div className="flex justify-between font-mono text-[11px] mb-1">
                      <span className="text-on-surface-variant">Q8_0 High-Fidelity KV</span>
                      <span className="text-primary font-semibold">2.42 GB VRAM</span>
                    </div>
                    <div className="w-full h-1.5 rounded bg-surface-container-highest overflow-hidden">
                      <div className="h-full bg-primary rounded" style={{ width: '48%' }}></div>
                    </div>
                  </div>
                  {/* Q4_0 KV */}
                  <div>
                    <div className="flex justify-between font-mono text-[11px] mb-1">
                      <span className="text-on-surface-variant">Q4_0 Compact (Flash-Attn)</span>
                      <span className="text-tertiary font-semibold">1.28 GB VRAM</span>
                    </div>
                    <div className="w-full h-1.5 rounded bg-surface-container-highest overflow-hidden">
                      <div className="h-full bg-tertiary rounded" style={{ width: '25%' }}></div>
                    </div>
                  </div>
                  <p className="font-mono text-outline pt-1 text-[10px]">
                    * Calculations include GQA (Grouped Query Attention) ratio 8:1 for Qwen3 architecture.
                  </p>
                </div>
              </div>

              {/* Verified Backends Matrix */}
              <div className="space-y-2">
                <p className="font-mono text-[10px] text-outline uppercase tracking-wider font-semibold">
                  Verified Backends
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="p-2 rounded bg-surface-container-low flex items-center justify-between border border-outline-variant/20">
                    <span className="text-on-surface">llama.cpp Vulkan</span>
                    <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
                  </div>
                  <div className="p-2 rounded bg-surface-container-low flex items-center justify-between border border-outline-variant/20">
                    <span className="text-on-surface">ROCm HipBLAS</span>
                    <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
                  </div>
                  <div className="p-2 rounded bg-surface-container-low flex items-center justify-between border border-outline-variant/20">
                    <span className="text-on-surface">vLLM Engine</span>
                    <span className="material-symbols-outlined text-outline text-[16px]">
                      remove_circle_outline
                    </span>
                  </div>
                  <div className="p-2 rounded bg-surface-container-low flex items-center justify-between border border-outline-variant/20">
                    <span className="text-on-surface">ExLlamaV2</span>
                    <span className="material-symbols-outlined text-outline text-[16px]">block</span>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  onClick={() => showToast('Rendered 48-layer attention head histogram')}
                  className="flex-1 py-1.5 rounded bg-surface-container-high text-on-surface hover:bg-surface-bright text-[12px] font-medium transition-colors text-center border border-outline-variant/30"
                >
                  Layer Graph
                </button>
                <button
                  onClick={() => showToast('Exported GGUF metadata tensor JSON to workspace')}
                  className="flex-1 py-1.5 rounded bg-surface-container-high text-on-surface hover:bg-surface-bright text-[12px] font-medium transition-colors text-center border border-outline-variant/30"
                >
                  Export Specs
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MANAGE DIRECTORIES MODAL */}
      {manageDirsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl bg-surface-container p-6 shadow-2xl border border-outline-variant/40 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">folder_managed</span>
                <h3 className="text-[16px] font-semibold text-on-surface">
                  Indexed Storage Directories
                </h3>
              </div>
              <button
                onClick={() => setManageDirsOpen(false)}
                className="text-outline hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-[12px] text-on-surface-variant leading-relaxed">
              Filesystem locations scanned for model weights (GGUF, Safetensors, AWQ, EXL2). Real-time OS
              filesystem events (Inotify) maintain synchronized catalogs.
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {[
                { path: '~/Models', label: 'Primary', count: '18 models • 412 GB' },
                { path: '/mnt/fast-nvme/ai-models', label: 'Dedicated NVMe', count: '16 models • 680 GB' },
                { path: '~/.cache/lm-studio/models', label: 'External Index', count: '7 models • 280 GB' },
              ].map((d) => (
                <div
                  key={d.path}
                  className="p-3 rounded-lg bg-surface-container-low flex items-center justify-between gap-4 border border-outline-variant/20"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-on-surface">{d.path}</span>
                      <span className="px-1.5 py-0.2 rounded bg-primary/20 text-primary font-mono text-[10px]">
                        {d.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-outline">{d.count} • Inotify enabled</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => showToast(`Rescanned ${d.path}`)}
                      className="p-1 rounded text-outline hover:text-primary transition-colors"
                      title="Rescan"
                    >
                      <span className="material-symbols-outlined text-[16px]">sync</span>
                    </button>
                    <button
                      onClick={() => showToast(`Unlinked ${d.path} from index. Raw weights untouched.`)}
                      className="p-1 rounded text-outline hover:text-error transition-colors"
                      title="Unlink directory"
                    >
                      <span className="material-symbols-outlined text-[16px]">link_off</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 rounded bg-surface-container-highest/60 border border-outline-variant/30 flex items-center gap-2 text-[11px] font-mono text-on-surface-variant">
              <span className="material-symbols-outlined text-primary text-[16px]">shield</span>
              <span>Directory unlinking does not touch raw model weights on disk.</span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setManageDirsOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] border border-outline-variant/30"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setManageDirsOpen(false);
                  setAddDirOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary-fixed-dim"
              >
                Add New Directory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD DIRECTORY MODAL */}
      {addDirOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-surface-container p-6 shadow-2xl border border-outline-variant/40 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">create_new_folder</span>
                <h3 className="text-[16px] font-semibold text-on-surface">Index Directory</h3>
              </div>
              <button onClick={() => setAddDirOpen(false)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="space-y-3">
              <label className="block font-mono text-[10px] text-outline uppercase tracking-wider">
                Absolute Path or Mount
              </label>
              <input
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low border border-outline-variant/30 text-on-surface font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={newDirPath}
                onChange={(e) => setNewDirPath(e.target.value)}
                placeholder="/home/developer/models or /mnt/data/gguf"
                type="text"
              />
              <div className="space-y-2 pt-2 text-[12px]">
                <label className="flex items-center gap-2 cursor-pointer text-on-surface">
                  <input defaultChecked className="rounded bg-surface-container-low text-primary accent-primary" type="checkbox" />
                  <span>Enable inotify / kqueue file system watcher</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-on-surface">
                  <input defaultChecked className="rounded bg-surface-container-low text-primary accent-primary" type="checkbox" />
                  <span>Follow symbolic links to nested targets</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-on-surface">
                  <input className="rounded bg-surface-container-low text-primary accent-primary" type="checkbox" />
                  <span>Auto-compute SHA256 checksum during indexing (high I/O)</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button
                onClick={() => setAddDirOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] border border-outline-variant/30"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newDirPath) {
                    showToast(`Added ${newDirPath} to indexed watchers`);
                    setAddDirOpen(false);
                    setNewDirPath('');
                  } else {
                    showToast('Please enter a valid directory path');
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary-fixed-dim"
              >
                Add &amp; Scan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
