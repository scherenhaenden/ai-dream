import React, { useState } from 'react';

export const KnowledgeRAGScreen: React.FC = () => {
  const [collectionFilter, setCollectionFilter] = useState<'all' | 'hot' | 'encrypted'>('all');
  const [searchQuery, setSearchQuery] = useState(
    'How does heterogeneous GPU device placement distribute transformer layers?'
  );
  const [isSearching, setIsSearching] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(true);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleSemanticSearch = () => {
    setIsSearching(true);
    showToast('Executing vector cosine lookup against Development Docs...');
    setTimeout(() => {
      setIsSearching(false);
      showToast('Found 2 high-confidence vectors (3.1ms)');
    }, 500);
  };

  return (
    <div className="flex flex-col w-full text-on-surface select-none pb-12 p-6 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-12 right-6 z-50 px-3 py-2 rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-2xl flex items-center gap-2 text-[12px] font-mono animate-bounce">
          <span className="material-symbols-outlined text-tertiary text-[16px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-low border border-outline-variant/30 p-5 rounded-xl shadow-sm">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 font-mono text-[11px] text-tertiary">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
            <span className="font-semibold uppercase">ZERO TELEMETRY ACTIVE</span>
            <span className="text-outline">EMBED_ENGINE::LOCAL_ROCM</span>
          </div>
          <h1 className="text-[22px] font-semibold text-on-surface tracking-tight">
            Knowledge Base (Local RAG)
          </h1>
          <p className="text-[13px] text-on-surface-variant max-w-2xl leading-relaxed">
            Create private vector stores indexed completely on-device. No external cloud calls, high-throughput
            local tensor quantization and hardware-accelerated HNSW searches.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={() => showToast('multilingual-e5-large (1024d) active on GPU 1')}
            className="flex items-center gap-1.5 px-3 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] font-semibold rounded-lg border border-outline-variant/30 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-outline">memory</span>
            <span>Embedding Models</span>
          </button>
          <button
            onClick={() => showToast('Opening directory picker for markdown/PDF ingestion...')}
            className="flex items-center gap-1.5 px-3 h-8 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] font-semibold rounded-lg border border-outline-variant/30 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] text-outline">drive_folder_upload</span>
            <span>Import Folder</span>
          </button>
          <button
            onClick={() => setNewCollectionOpen(true)}
            className="flex items-center gap-1.5 px-3 h-8 bg-primary text-on-primary text-[12px] font-semibold rounded-lg hover:bg-primary-fixed-dim transition-all shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">library_add</span>
            <span>+ New Collection</span>
          </button>
        </div>
      </div>

      {/* Top Instrumentation & Telemetry Metric Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-surface-container-low border border-outline-variant/30 p-3.5 rounded-xl flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-outline text-[10px] font-mono">
            <span className="uppercase">Active Stores</span>
            <span className="material-symbols-outlined text-[16px] text-tertiary">folder_special</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1 font-mono">
            <span className="text-[18px] font-bold text-on-surface">3</span>
            <span className="text-[10px] text-tertiary">100% In-VRAM</span>
          </div>
          <span className="text-[11px] text-on-surface-variant truncate">HNSW Graph Indices</span>
        </div>

        <div className="bg-surface-container-low border border-outline-variant/30 p-3.5 rounded-xl flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-outline text-[10px] font-mono">
            <span className="uppercase">Total Documents</span>
            <span className="material-symbols-outlined text-[16px] text-primary">description</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1 font-mono">
            <span className="text-[18px] font-bold text-on-surface">246</span>
            <span className="text-[10px] text-on-surface-variant">files</span>
          </div>
          <span className="text-[11px] text-on-surface-variant truncate">PDF, MD, Code, JSON</span>
        </div>

        <div className="bg-surface-container-low border border-outline-variant/30 p-3.5 rounded-xl flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-outline text-[10px] font-mono">
            <span className="uppercase">Vector Chunks</span>
            <span className="material-symbols-outlined text-[16px] text-secondary">scatter_plot</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1 font-mono">
            <span className="text-[18px] font-bold text-on-surface">68,410</span>
            <span className="text-[10px] text-primary">+1.4k today</span>
          </div>
          <span className="text-[11px] text-on-surface-variant truncate">1024-dim precision</span>
        </div>

        <div className="bg-surface-container-low border border-outline-variant/30 p-3.5 rounded-xl flex flex-col justify-between shadow-sm col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-outline text-[10px] font-mono">
            <span className="uppercase">Embedding Engine</span>
            <span className="material-symbols-outlined text-[16px] text-primary">psychology</span>
          </div>
          <div className="mt-2 flex flex-col">
            <span className="font-mono text-[12px] text-on-surface font-semibold truncate">
              multilingual-e5-lg
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
              <span className="font-mono text-[10px] text-tertiary truncate">Local GPU Offload</span>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-low border border-outline-variant/30 p-3.5 rounded-xl flex flex-col justify-between shadow-sm col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-outline text-[10px] font-mono">
            <span className="uppercase">Vector Engine</span>
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">database</span>
          </div>
          <div className="mt-2 flex flex-col">
            <span className="font-mono text-[12px] text-on-surface font-semibold truncate">
              HNSWLib (SQLite)
            </span>
            <span className="font-mono text-[10px] text-outline truncate">Cosine Metric • ef=64</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Split: Collections Grid (7 cols) vs Pipeline & Semantic Test Sandbox (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Collections Grid */}
        <div className="xl:col-span-7 space-y-4">
          <div className="flex items-center justify-between bg-surface-container-low border border-outline-variant/30 px-4 py-2 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-on-surface">Vector Collections</span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 bg-surface-container-high rounded text-on-surface-variant">
                3 Installed
              </span>
            </div>

            <div className="flex items-center gap-1 font-mono text-[10px] text-outline">
              <span className="uppercase mr-1">Filter:</span>
              {(['all', 'hot', 'encrypted'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCollectionFilter(mode)}
                  className={`px-2 py-0.5 rounded transition-colors uppercase ${
                    collectionFilter === mode
                      ? 'bg-surface-container-highest text-primary font-bold'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Collection 1: Development Docs */}
          {(collectionFilter === 'all' || collectionFilter === 'hot') && (
            <div className="bg-surface-container-low hover:bg-surface-container transition-all border border-outline-variant/30 rounded-xl p-5 shadow-sm space-y-3.5 border-l-4 border-l-primary">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant/20 flex items-center justify-center text-primary shrink-0 shadow-inner">
                    <span className="material-symbols-outlined text-[24px]">developer_mode_tv</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[16px] font-semibold text-on-surface">Development Docs</h2>
                      <span className="px-1.5 py-0.2 bg-tertiary/15 text-tertiary font-mono text-[10px] rounded border border-tertiary/20 font-semibold">
                        ACTIVE QUERY STORE
                      </span>
                      <span className="px-1.5 py-0.2 bg-surface-container-highest text-on-surface-variant font-mono text-[10px] rounded">
                        512 token / 64 overlap
                      </span>
                    </div>
                    <p className="text-[12px] text-on-surface-variant leading-relaxed">
                      C++ headers, Vulkan specification, llama.cpp forks, custom tensor kernel documentation, and local API references.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
                  <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                  <span className="text-tertiary font-semibold">HOT</span>
                </div>
              </div>

              {/* Technical Specs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-surface-container-lowest border border-outline-variant/20 p-2.5 rounded-lg font-mono text-[11px]">
                <div>
                  <span className="text-outline text-[9px] block">CORPUS SIZE</span>
                  <span className="text-on-surface font-semibold">128 Docs · 142 MB</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">VECTOR COUNT</span>
                  <span className="text-on-surface font-semibold">43,291 chunks</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">EMBED DIMENSIONS</span>
                  <span className="text-primary font-semibold">1024d (Float16)</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">LAST REINDEXED</span>
                  <span className="text-on-surface-variant">Today @ 15:42</span>
                </div>
              </div>

              {/* Index Engine Visualizer Strip */}
              <div className="relative bg-surface-container-lowest border border-outline-variant/20 h-14 rounded-lg overflow-hidden flex items-center px-4 justify-between font-mono text-[11px]">
                <div className="absolute inset-0 opacity-15 flex items-center justify-around pointer-events-none">
                  <svg className="w-full h-10 text-primary" fill="none" preserveAspectRatio="none" viewBox="0 0 400 40">
                    <path
                      d="M0 25 Q 30 5, 60 28 T 120 12 T 180 32 T 240 18 T 300 35 T 360 8 T 400 22 L 400 40 L 0 40 Z"
                      fill="currentColor"
                      fillOpacity="0.2"
                    ></path>
                    <path
                      d="M0 25 Q 30 5, 60 28 T 120 12 T 180 32 T 240 18 T 300 35 T 360 8 T 400 22"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    ></path>
                  </svg>
                </div>
                <div className="relative z-10 flex items-center gap-2">
                  <span className="text-outline">INDEX ENGINE:</span>
                  <span className="text-on-surface font-semibold">HNSW M=16 efConstruction=200</span>
                </div>
                <div className="relative z-10 flex items-center gap-1 text-tertiary">
                  <span className="material-symbols-outlined text-[14px]">bolt</span>
                  <span>Sub-2.4ms cosine lookup</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => showToast('Loaded search index for Development Docs')}
                    className="px-3 py-1.5 bg-primary text-on-primary font-semibold text-[12px] rounded-lg hover:bg-primary-fixed-dim flex items-center gap-1 transition-all shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[15px]">manage_search</span>
                    <span>Explore &amp; Search</span>
                  </button>
                  <button
                    onClick={() => showToast('File picker opened for Development Docs ingestion')}
                    className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] rounded-lg flex items-center gap-1 border border-outline-variant/30 transition-all"
                  >
                    <span className="material-symbols-outlined text-[15px]">note_add</span>
                    <span>Add Documents</span>
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => showToast('Rebuilding HNSW cosine index...')}
                    className="p-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg border border-outline-variant/30 transition-colors"
                    title="Trigger Full Reindex"
                  >
                    <span className="material-symbols-outlined text-[16px]">sync</span>
                  </button>
                  <button
                    onClick={() => showToast('Store settings: M=16, efSearch=64')}
                    className="p-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg border border-outline-variant/30 transition-colors"
                    title="Store Settings"
                  >
                    <span className="material-symbols-outlined text-[16px]">settings</span>
                  </button>
                  <button
                    onClick={() => showToast('Exported DevDocs_Vectors.sqlite')}
                    className="p-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface rounded-lg border border-outline-variant/30 transition-colors"
                    title="Export Vector SQLite Dump"
                  >
                    <span className="material-symbols-outlined text-[16px]">file_download</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Collection 2: Workstation Hardware Specs & ROCm Guides */}
          {(collectionFilter === 'all' || collectionFilter === 'hot') && (
            <div className="bg-surface-container-low hover:bg-surface-container transition-all border border-outline-variant/30 rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant/20 flex items-center justify-center text-on-surface-variant shrink-0 shadow-inner">
                    <span className="material-symbols-outlined text-[24px]">memory</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[16px] font-semibold text-on-surface">
                        Workstation Hardware Specs &amp; ROCm Guides
                      </h2>
                      <span className="px-1.5 py-0.2 bg-surface-container-highest text-tertiary font-mono text-[10px] rounded border border-tertiary/20">
                        Ready
                      </span>
                    </div>
                    <p className="text-[12px] text-on-surface-variant leading-relaxed">
                      Architectural manuals for Dual Radeon RX 9070, memory topologies, HIP compiler flags, and NUMA node configurations.
                    </p>
                  </div>
                </div>
                <span className="font-mono text-[11px] text-outline">v1.2</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-surface-container-lowest border border-outline-variant/20 p-2.5 rounded-lg font-mono text-[11px]">
                <div>
                  <span className="text-outline text-[9px] block">FILES</span>
                  <span className="text-on-surface font-semibold">32 documents</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">CHUNKS</span>
                  <span className="text-on-surface font-semibold">8,910 chunks</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">FOOTPRINT</span>
                  <span className="text-on-surface font-semibold">28.4 MB</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">RERANKER</span>
                  <span className="text-secondary font-semibold">bge-reranker-large</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-outline">
                  <span className="material-symbols-outlined text-[16px] text-tertiary">check_circle</span>
                  <span>In-memory sync complete</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <button
                    onClick={() => showToast('Switched sandbox target to Hardware Specs')}
                    className="px-3 py-1 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg border border-outline-variant/30"
                  >
                    Search
                  </button>
                  <button
                    onClick={() => showToast('Opening collection config...')}
                    className="px-3 py-1 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg border border-outline-variant/30"
                  >
                    Configure
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Collection 3: Financial & Tax Records */}
          {(collectionFilter === 'all' || collectionFilter === 'encrypted') && (
            <div className="bg-surface-container-low hover:bg-surface-container transition-all border border-outline-variant/30 rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant/20 flex items-center justify-center text-primary-fixed shrink-0 shadow-inner">
                    <span className="material-symbols-outlined text-[24px]">lock</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[16px] font-semibold text-on-surface">
                        Financial &amp; Tax Records (Strict Local)
                      </h2>
                      <span className="px-1.5 py-0.2 bg-surface-container-highest text-secondary font-mono text-[10px] rounded border border-secondary/30">
                        AES-256 Encrypted
                      </span>
                      <span className="px-1.5 py-0.2 bg-surface-container-highest text-outline font-mono text-[10px] rounded">
                        Protected
                      </span>
                    </div>
                    <p className="text-[12px] text-on-surface-variant leading-relaxed">
                      Private ledgers, 1099-MISC filings, operating expense spreadsheets, and tax disclosures. Indexed with zero write-back to cloud or shared drives.
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[18px] text-primary" title="TPM 2.0 Security Key Authenticated">
                  verified_user
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-surface-container-lowest border border-outline-variant/20 p-2.5 rounded-lg font-mono text-[11px]">
                <div>
                  <span className="text-outline text-[9px] block">FILES</span>
                  <span className="text-on-surface font-semibold">86 documents</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">CHUNKS</span>
                  <span className="text-on-surface font-semibold">16,209 chunks</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">ENCRYPTION KEY</span>
                  <span className="text-tertiary font-semibold">TPM 2.0 Bound</span>
                </div>
                <div>
                  <span className="text-outline text-[9px] block">CHUNK SIZE</span>
                  <span className="text-on-surface-variant">384 tokens</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1 font-mono text-[11px] text-tertiary">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                  <span>Encrypted store locked to node UUID</span>
                </div>
                <button
                  onClick={() => showToast('TPM 2.0 unlock prompt verified')}
                  className="px-3 py-1 bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] rounded-lg border border-outline-variant/30"
                >
                  Unlock / Inspect
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (5 cols): Pipeline Queue & Semantic Sandbox */}
        <div className="xl:col-span-5 space-y-4">
          {/* Live Ingestion Queue Card */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">data_saver_on</span>
                <span className="text-[14px] font-semibold text-on-surface">Ingestion Pipeline</span>
              </div>
              <span className="font-mono text-[10px] px-2 py-0.5 bg-surface-container-high text-tertiary rounded flex items-center gap-1 border border-tertiary/20">
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>
                WORKER: RUNNING
              </span>
            </div>

            <div className="space-y-2 font-mono text-[11px]">
              {/* Active file */}
              <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-on-surface font-medium truncate max-w-[240px]">
                    amd-rocm-6.2-programming-manual.pdf
                  </span>
                  <span className="text-primary font-bold">74%</span>
                </div>
                <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: '74%' }}></div>
                </div>
                <div className="flex items-center justify-between text-outline text-[10px] pt-0.5">
                  <span className="flex items-center gap-1 text-on-surface-variant">
                    <span className="material-symbols-outlined text-[13px] text-primary animate-spin">cyclone</span>
                    Embedding Batch (1,480 / 2,000)
                  </span>
                  <span className="text-tertiary">380 tokens/sec</span>
                </div>
              </div>

              {/* Completed file */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="material-symbols-outlined text-[16px] text-tertiary shrink-0">task_alt</span>
                  <span className="text-on-surface-variant truncate">vulkan_compute_notes.md</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-outline">32 chunks</span>
                  <span className="text-tertiary font-semibold">Indexed</span>
                </div>
              </div>
            </div>
          </div>

          {/* Semantic Test Sandbox */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px] text-secondary">manage_search</span>
                <span className="text-[14px] font-semibold text-on-surface">Semantic Test Sandbox</span>
              </div>
              <div className="flex items-center gap-1 font-mono text-[10px] text-outline">
                <span>Target:</span>
                <span className="text-primary font-medium">Dev Docs</span>
              </div>
            </div>

            {/* Prompt input */}
            <div className="space-y-1">
              <label className="font-mono text-[10px] text-outline block">SEMANTIC VECTOR PROMPT</label>
              <div className="relative">
                <input
                  className="w-full bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-[12px] p-2.5 pr-9 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary shadow-inner font-sans"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSemanticSearch();
                  }}
                  type="text"
                />
                <button
                  onClick={handleSemanticSearch}
                  className="absolute right-2 top-2 text-primary hover:text-primary-fixed transition-colors cursor-pointer"
                  title="Search Vector Space"
                >
                  <span className={`material-symbols-outlined text-[18px] ${isSearching ? 'animate-spin' : ''}`}>
                    send
                  </span>
                </button>
              </div>
            </div>

            {/* Top-K Matches */}
            <div className="space-y-2">
              <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                <span>TOP-K MATCHES (k=2 returned)</span>
                <span className="text-tertiary">Latency: 3.1ms</span>
              </div>

              {/* Match 1 */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg space-y-1.5 shadow-inner">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0 font-mono text-[11px]">
                    <span className="material-symbols-outlined text-[16px] text-primary">picture_as_pdf</span>
                    <span className="text-on-surface font-medium truncate">rocm_orchestration.pdf</span>
                    <span className="text-outline text-[10px]">#p.42</span>
                  </div>
                  <span className="px-1.5 py-0.2 bg-tertiary/15 text-tertiary font-mono text-[10px] font-semibold rounded border border-tertiary/20">
                    94.2% match
                  </span>
                </div>
                <div className="p-2 rounded bg-surface-container border border-outline-variant/20 text-on-surface text-[12px] leading-relaxed">
                  "...layer allocation partitions{' '}
                  <mark className="bg-primary/25 text-primary-fixed px-0.5 rounded font-medium">
                    transformer attention blocks
                  </mark>{' '}
                  evenly across available ROCm compute handles. When{' '}
                  <mark className="bg-primary/25 text-primary-fixed px-0.5 rounded font-medium">
                    GPU_0 and GPU_1
                  </mark>{' '}
                  negotiate peer-to-peer VRAM memory buses, pipeline parallel stages allocate layers 0..15 to primary device node and 16..31 to secondary device node with zero CPU roundtrip latency..."
                </div>
                <div className="flex items-center justify-between font-mono text-[10px] text-outline pt-0.5">
                  <span>Vector Distance: <strong className="text-on-surface">0.058 (Cosine)</strong></span>
                  <span>Token Count: <strong className="text-on-surface">184 tokens</strong></span>
                </div>
              </div>

              {/* Match 2 */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg space-y-1.5 shadow-inner">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0 font-mono text-[11px]">
                    <span className="material-symbols-outlined text-[16px] text-outline">code</span>
                    <span className="text-on-surface font-medium truncate">tensor_split_runtime.cpp</span>
                    <span className="text-outline text-[10px]">#L182</span>
                  </div>
                  <span className="px-1.5 py-0.2 bg-primary/15 text-primary font-mono text-[10px] font-semibold rounded border border-primary/20">
                    89.7% match
                  </span>
                </div>
                <div className="p-2 rounded bg-surface-container border border-outline-variant/20 text-on-surface-variant text-[12px] leading-relaxed font-mono">
                  "...auto dev_ratio = calculate_vram_headroom(); for (int i = 0; i &lt; n_layers; ++i) &#123; int target_gpu = (i &lt; split_boundary) ? 0 : 1; assign_layer_to_accelerator(i, target_gpu); &#125;..."
                </div>
                <div className="flex items-center justify-between font-mono text-[10px] text-outline pt-0.5">
                  <span>Vector Distance: <strong className="text-on-surface">0.103 (Cosine)</strong></span>
                  <span>Token Count: <strong className="text-on-surface">92 tokens</strong></span>
                </div>
              </div>
            </div>

            {/* Collapsible Accordion: Telemetry & Injection Buffer Preview */}
            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/20 overflow-hidden">
              <button
                onClick={() => setAccordionOpen(!accordionOpen)}
                className="w-full p-2.5 flex items-center justify-between text-left hover:bg-surface-container transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-on-surface font-semibold">
                  <span className="material-symbols-outlined text-[16px] text-tertiary">tune</span>
                  <span>Pipeline Telemetry &amp; Injection Buffer Preview</span>
                </div>
                <span
                  className={`material-symbols-outlined text-[16px] text-outline transition-transform ${
                    accordionOpen ? 'rotate-0' : '-rotate-90'
                  }`}
                >
                  expand_more
                </span>
              </button>

              {accordionOpen && (
                <div className="p-3 space-y-2 bg-surface-container-low font-mono text-[11px] border-t border-outline-variant/20">
                  <div className="grid grid-cols-2 gap-2 text-on-surface-variant">
                    <div className="flex justify-between">
                      <span className="text-outline">Reranker Delta:</span>
                      <span className="text-tertiary font-mono">+0.14 boost</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-outline">Context Injected:</span>
                      <span className="text-on-surface font-mono">276 / 32,768 tok</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-outline">Embedding Warmth:</span>
                      <span className="text-on-surface font-mono">Cached in VRAM</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-outline">Prompt Overhead:</span>
                      <span className="text-tertiary font-mono">+0.4% total ctx</span>
                    </div>
                  </div>

                  <div className="space-y-1 pt-1">
                    <span className="text-outline uppercase text-[9px]">Formatted Prompt Augmentation</span>
                    <pre className="p-2 rounded bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant font-mono text-[10.5px] overflow-x-auto leading-tight">
                      {`<|system|>
[RETRIEVED_CONTEXT collection="Development Docs" score="0.942"]
Source: rocm_orchestration.pdf (p.42)
"...layer allocation partitions transformer attention blocks evenly across available ROCm compute handles..."
[END_RETRIEVED_CONTEXT]`}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* NEW COLLECTION MODAL */}
      {newCollectionOpen && (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-container p-6 shadow-2xl border border-outline-variant/40 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">library_add</span>
                <h3 className="text-[16px] font-semibold text-on-surface">New RAG Collection</h3>
              </div>
              <button onClick={() => setNewCollectionOpen(false)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-[11px]">
              <div className="space-y-1">
                <label className="text-on-surface uppercase text-[10px]">Collection Title</label>
                <input
                  className="w-full h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-lg focus:outline-none focus:ring-1 focus:ring-primary font-sans"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  placeholder="e.g., Codebase Specs v2"
                />
              </div>

              <div className="space-y-1">
                <label className="text-on-surface uppercase text-[10px]">Chunk Size (Tokens)</label>
                <input
                  defaultValue={512}
                  className="w-full h-8 px-3 bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-lg"
                  type="number"
                />
              </div>

              <div className="space-y-1">
                <label className="text-on-surface uppercase text-[10px]">Embedding Model</label>
                <select className="w-full h-8 px-2 bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-lg">
                  <option>multilingual-e5-large (1024d) - Active VRAM</option>
                  <option>nomic-embed-text-v1.5 (768d)</option>
                  <option>bge-large-en-v1.5 (1024d)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setNewCollectionOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface text-[12px] border border-outline-variant/30"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  showToast(`Created collection "${newColName || 'New Store'}"`);
                  setNewCollectionOpen(false);
                  setNewColName('');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-primary text-on-primary font-semibold text-[12px] hover:bg-primary-fixed-dim"
              >
                Create Store
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
