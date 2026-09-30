import React from 'react';

interface ModelsLibraryScreenProps {
  onNavigateToChat: () => void;
  onNavigateToPlacement: () => void;
}

const samples = [
  { name: 'Example Qwen model', file: 'example-qwen-instruct-Q4_K_M.gguf', path: '/models/example-qwen-instruct-Q4_K_M.gguf', arch: 'Qwen family', quant: 'Q4_K_M', size: 'Illustrative size' },
  { name: 'Example Llama model', file: 'example-llama-instruct-Q5_K_M.gguf', path: '/models/example-llama-instruct-Q5_K_M.gguf', arch: 'Llama family', quant: 'Q5_K_M', size: 'Illustrative size' },
  { name: 'Example embedding model', file: 'example-embedding-model.gguf', path: '/models/example-embedding-model.gguf', arch: 'Architecture from GGUF metadata', quant: 'Metadata dependent', size: 'Illustrative size' },
];

const StaticField = ({ label, value = 'Unavailable in static reference' }: { label: string; value?: string }) => (
  <label className="grid gap-1.5 text-xs text-on-surface-variant">
    <span>{label}</span>
    <input disabled readOnly value={value} className="min-w-0 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-70" />
  </label>
);

const PreviewButton = ({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) => (
  <button type="button" disabled title="Preview only. This reference is not connected to the local model catalog or runtime." className={`rounded-md border px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${primary ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-high text-on-surface-variant'}`}>
    {children}
  </button>
);

export const ModelsLibraryScreen: React.FC<ModelsLibraryScreenProps> = ({ onNavigateToChat, onNavigateToPlacement }) => (
  <section className="mx-auto grid w-full max-w-7xl gap-5 overflow-y-auto p-4 pb-12 text-on-surface sm:p-6" aria-labelledby="models-title">
    <header className="flex flex-col justify-between gap-4 border-b border-outline-variant pb-4 sm:flex-row sm:items-end">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Local model catalog</p>
        <h1 id="models-title" className="mt-1 text-2xl font-semibold">Models</h1>
        <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">Scan registered folders for GGUF files, inspect available metadata, and configure runtime loading for a selected model.</p>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded border border-warning/50 bg-warning/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-warning"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />Static reference · sample records</span>
    </header>

    <section className="grid gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" aria-label="Model folders">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <StaticField label="Existing local folder containing GGUF files" value="/home/you/models" />
        <PreviewButton>Add folder</PreviewButton>
      </div>
      <PreviewButton>Rescan folders</PreviewButton>
      <p className="text-[11px] text-on-surface-variant sm:col-span-2">Folder registration records an existing path and scans it; model files are not moved. Counts and paths are not connected to this device.</p>
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
      <div className="grid content-start gap-3" aria-label="Illustrative local model catalog">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Local catalog</h2><p className="mt-1 text-xs text-on-surface-variant">Example records · not discovered models</p></div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Filter model format" disabled defaultValue="all" className="rounded-md border border-outline-variant bg-surface-container-low px-2 py-1.5 text-xs text-on-surface-variant disabled:opacity-70"><option value="all">All formats</option><option>GGUF</option></select>
            <select aria-label="Sort models" disabled defaultValue="name" className="rounded-md border border-outline-variant bg-surface-container-low px-2 py-1.5 text-xs text-on-surface-variant disabled:opacity-70"><option value="name">Sort: name</option><option>File size</option><option>Architecture</option><option>Quantization</option><option>Context length</option></select>
          </div>
        </div>

        {samples.map((model, index) => (
          <article key={model.file} className={`overflow-hidden rounded-lg border bg-surface-container-low ${index === 0 ? 'border-primary/50' : 'border-outline-variant'}`}>
            <div className="flex items-start gap-3 p-3 sm:p-4">
              <span aria-hidden="true" className="material-symbols-outlined rounded-md bg-surface-container-high p-2 text-primary">deployed_code</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{model.name}</h3><span className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] text-warning">EXAMPLE</span></div>
                <p className="mt-1 break-all font-mono text-[10px] text-on-surface-variant">{model.path}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {[model.arch, 'GGUF', model.quant, model.size].map((tag) => <span key={tag} className="rounded border border-outline-variant bg-surface-container px-2 py-1 text-on-surface-variant">{tag}</span>)}
                  <span className="rounded border border-outline-variant bg-surface-container px-2 py-1 text-on-surface-variant">Loaded state unavailable</span>
                </div>
              </div>
              <span aria-hidden="true" className="material-symbols-outlined text-on-surface-variant">expand_more</span>
            </div>
          </article>
        ))}
      </div>

      <aside className="grid content-start gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4" aria-labelledby="model-config-title">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-[10px] uppercase tracking-wide text-primary">Selected example</p><h2 id="model-config-title" className="mt-1 text-sm font-semibold">Example Qwen model</h2></div><span className="rounded bg-warning/10 px-2 py-1 font-mono text-[9px] text-warning">Not live data</span></div>
        <p className="text-xs text-on-surface-variant">The production Models page configures this model in place. Only backend options advertised by the selected runtime are shown there.</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <StaticField label="Backend" />
          <StaticField label="Runtime installation" />
          <StaticField label="GPU / device" />
          <StaticField label="Placement and load options" value="Shown when supported by runtime" />
          <StaticField label="Loaded status" />
        </div>
        <div className="flex flex-wrap gap-2"><PreviewButton primary>Load model</PreviewButton><PreviewButton>Unload current model</PreviewButton><PreviewButton>Refresh status</PreviewButton></div>
        <div className="grid gap-2 border-t border-outline-variant pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Useful destinations</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onNavigateToPlacement} className="rounded-md border border-outline-variant bg-surface-container-high px-3 py-2 text-xs text-on-surface hover:border-primary">Open Runtime Manager</button>
            <button type="button" onClick={onNavigateToChat} className="rounded-md border border-outline-variant bg-surface-container-high px-3 py-2 text-xs text-on-surface hover:border-primary">Open Chat</button>
          </div>
        </div>
      </aside>
    </section>

    <p className="border-t border-outline-variant pt-3 text-[11px] text-on-surface-variant">Catalog metadata is read from local files and GGUF headers in production. Missing fields remain unavailable; the static records above do not imply installed models, active runtimes, or benchmark results.</p>
  </section>
);
