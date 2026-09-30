import React from 'react';

interface ModelHubsScreenProps {
  onNavigateToModels: () => void;
  onNavigateToPlacement: () => void;
}

const repositories = [
  { id: 'Qwen/example-instruct-GGUF', task: 'Example repository · GGUF' },
  { id: 'community/example-code-GGUF', task: 'Example repository · GGUF' },
];

const files = [
  { name: 'example-instruct-Q4_K_M.gguf', quant: 'Q4_K_M' },
  { name: 'example-instruct-Q5_K_M.gguf', quant: 'Q5_K_M' },
  { name: 'example-instruct-F16.gguf', quant: 'F16' },
];

const PreviewButton = ({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) => (
  <button type="button" disabled title="Preview only. This reference does not search Hugging Face or start a download." className={`rounded-md border px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${primary ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-high text-on-surface-variant'}`}>
    {children}
  </button>
);

export const ModelHubsScreen: React.FC<ModelHubsScreenProps> = ({ onNavigateToModels, onNavigateToPlacement }) => (
  <section className="mx-auto grid w-full max-w-7xl gap-5 overflow-y-auto p-4 pb-12 text-on-surface sm:p-6" aria-labelledby="model-hubs-title">
    <header className="flex flex-col justify-between gap-4 border-b border-outline-variant pb-4 sm:flex-row sm:items-end">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Discovery / Hugging Face</p>
        <h1 id="model-hubs-title" className="mt-1 text-2xl font-semibold">Model Hubs <span className="font-normal text-on-surface-variant">&amp; Repositories</span></h1>
        <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">Search Hugging Face GGUF repositories, inspect downloadable files, and request transfers through the local service.</p>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded border border-warning/50 bg-warning/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-warning"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />Static reference · sample results</span>
    </header>

    <section className="grid gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-4" aria-label="Search Hugging Face GGUF repositories">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1.5 text-xs text-on-surface-variant">Repository or author query
          <input disabled readOnly value="example gguf search" className="min-w-0 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-70" />
        </label>
        <div className="flex items-end"><PreviewButton primary>Search repositories</PreviewButton></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant pt-3 text-[11px] text-on-surface-variant">
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="material-symbols-outlined text-primary">hub</span>Hugging Face · GGUF repositories only</span>
        <span>Search and transfers require the local AI Dream API.</span>
      </div>
    </section>

    <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div className="grid content-start gap-3" aria-label="Example Hugging Face search results">
        <div className="flex items-end justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-wide text-primary">Search results</p><h2 className="mt-1 text-sm font-semibold">Repositories</h2></div><span className="text-[10px] text-on-surface-variant">Illustrative only</span></div>
        {repositories.map((repo, index) => (
          <article key={repo.id} className={`flex items-start gap-3 rounded-lg border p-3 sm:p-4 ${index === 0 ? 'border-primary/50 bg-surface-container-low' : 'border-outline-variant bg-surface-container-low'}`}>
            <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-container-high font-mono text-sm font-semibold text-primary">{repo.id.charAt(0)}</span>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all text-xs font-medium">{repo.id}</h3><span className="rounded bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] text-warning">EXAMPLE</span></div><p className="mt-1 text-[10px] text-on-surface-variant">{repo.task}</p></div>
            <span aria-hidden="true" className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
          </article>
        ))}
        <p className="text-[11px] text-on-surface-variant">The production route returns repository metadata from Hugging Face. These records and query are not live search results.</p>
      </div>

      <aside className="grid content-start gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-4" aria-labelledby="repo-files-title">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-outline-variant pb-3">
          <div><p className="font-mono text-[10px] uppercase tracking-wide text-primary">Selected example repository</p><h2 id="repo-files-title" className="mt-1 break-all text-sm font-semibold">Qwen/example-instruct-GGUF</h2></div>
          <span className="rounded bg-warning/10 px-2 py-1 font-mono text-[9px] text-warning">Not live data</span>
        </div>
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium">Downloadable GGUF files</p><p className="mt-1 text-[10px] text-on-surface-variant">Example file names · sizes not reported</p></div><PreviewButton>Refresh files</PreviewButton></div>
        <ul className="grid gap-2" aria-label="Illustrative GGUF files">
          {files.map((file) => (
            <li key={file.name} className="flex flex-wrap items-center gap-2 rounded-md border border-outline-variant bg-surface-container p-3">
              <span aria-hidden="true" className="material-symbols-outlined text-primary">draft</span>
              <div className="min-w-0 flex-1"><p className="break-all font-mono text-[10px] text-on-surface">{file.name}</p><p className="mt-1 text-[10px] text-on-surface-variant">GGUF · {file.quant} · illustrative size</p></div>
              <PreviewButton primary>Download</PreviewButton>
            </li>
          ))}
        </ul>
        <div className="rounded-md border border-outline-variant bg-surface-container-lowest p-3 text-[11px] text-on-surface-variant">
          <p className="font-medium text-on-surface">Local transfer flow</p>
          <p className="mt-1">The production service manages destination and progress. Active transfers appear on Downloads; cancellation is managed there.</p>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-3">
          <button type="button" onClick={onNavigateToModels} className="rounded-md border border-outline-variant bg-surface-container-high px-3 py-2 text-xs text-on-surface hover:border-primary">Open Models</button>
          <button type="button" onClick={onNavigateToPlacement} className="rounded-md border border-outline-variant bg-surface-container-high px-3 py-2 text-xs text-on-surface hover:border-primary">Open Runtime Manager</button>
        </div>
      </aside>
    </section>

    <p className="border-t border-outline-variant pt-3 text-[11px] text-on-surface-variant">This reference covers Hugging Face GGUF search only. The production flow does not offer mirror selection or a per-download destination picker.</p>
  </section>
);
