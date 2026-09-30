import React from 'react';

const steps = [
  { number: '01', title: 'Model & device', note: 'Selection' },
  { number: '02', title: 'Load options', note: 'Inference' },
  { number: '03', title: 'Advanced', note: 'Runtime flags' },
];

const capabilityExamples = [
  'Placement: GPU layers, split mode, tensor split, main GPU',
  'Load: context size, threads, batch sizes, concurrency',
  'Advanced: NUMA, KV cache, flash attention, mmap, device override',
];

const Field = ({ label, value = 'Unavailable in static reference' }: { label: string; value?: string }) => (
  <label className="grid gap-1.5 text-xs text-on-surface-variant">
    <span>{label}</span>
    <input
      disabled
      value={value}
      readOnly
      className="min-w-0 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-70"
    />
  </label>
);

const SelectField = ({ label }: { label: string }) => (
  <label className="grid gap-1.5 text-xs text-on-surface-variant">
    <span>{label}</span>
    <select disabled defaultValue="" className="min-w-0 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-70">
      <option value="">Unavailable in static reference</option>
    </select>
  </label>
);

const DisabledAction = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    disabled
    title="Preview only. Connect the production Runtime Manager to use this action."
    className="inline-flex items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface-container-high px-3 py-2 text-xs font-medium text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-60"
  >
    {children}
  </button>
);

export const ProvidersRuntimesScreen: React.FC = () => (
  <section className="mx-auto grid w-full max-w-7xl gap-5 overflow-y-auto p-4 pb-12 text-on-surface sm:p-6" aria-labelledby="runtime-manager-title">
    <header className="flex flex-col justify-between gap-4 border-b border-outline-variant pb-4 sm:flex-row sm:items-end">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Engine subsystem / compute</p>
        <h1 id="runtime-manager-title" className="mt-1 text-2xl font-semibold">Runtime Manager</h1>
        <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">Register and probe local llama-server executables, then configure model loading using capabilities reported by the selected runtime.</p>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded border border-warning/50 bg-warning/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-warning">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" /> Static reference · preview only
      </span>
    </header>

    <section className="grid gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4" aria-labelledby="install-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="install-title" className="text-sm font-semibold">Runtime installations</h2>
          <p className="mt-1 text-xs text-on-surface-variant">Register an existing local llama-server executable. Registration records and probes it; it does not install packages or download runtimes.</p>
        </div>
        <span className="rounded bg-surface-container-high px-2 py-1 font-mono text-[10px] text-on-surface-variant">Inventory unavailable</span>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(180px,1fr)_auto] md:items-end">
        <Field label="Executable path" value="/path/to/llama-server" />
        <Field label="Name (optional)" value="Local runtime label" />
        <DisabledAction><span aria-hidden="true" className="material-symbols-outlined text-sm">search</span>Register & probe</DisabledAction>
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-outline-variant bg-surface-container-lowest p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-primary">terminal</span>
          <div><p className="text-xs font-medium">Runtime inventory is not connected</p><p className="mt-1 text-[11px] text-on-surface-variant">Actual executable paths, availability, versions, and probe results come from the local API.</p></div>
        </div>
        <DisabledAction><span aria-hidden="true" className="material-symbols-outlined text-sm">refresh</span>Probe inventory</DisabledAction>
      </div>
    </section>

    <section className="grid gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4" aria-labelledby="configuration-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="configuration-title" className="text-sm font-semibold">Configure model runtime</h2><p className="mt-1 text-xs text-on-surface-variant">Options and controls appear according to the selected runtime's advertised capabilities.</p></div>
        <span className="rounded border border-outline-variant bg-surface-container px-2 py-1 font-mono text-[10px] text-on-surface-variant">No probe data</span>
      </div>

      <ol className="grid gap-2 border-y border-outline-variant py-3 sm:grid-cols-3" aria-label="Runtime configuration steps">
        {steps.map((step, index) => (
          <li key={step.number} className="flex items-center gap-3 rounded-md bg-surface-container px-3 py-2">
            <span className="font-mono text-xs text-on-surface-variant">{step.number}</span>
            <span className="min-w-0"><b className="block text-xs font-medium">{step.title}</b><small className="text-[10px] text-on-surface-variant">{step.note}</small></span>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SelectField label="Model" />
        <SelectField label="Backend" />
        <SelectField label="Runtime" />
        <SelectField label="GPU / device" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.8fr)]">
        <section className="grid content-start gap-4 rounded-md border border-outline-variant bg-surface-container p-4" aria-labelledby="options-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 id="options-title" className="text-sm font-medium">Capability-backed options</h3><p className="mt-1 text-xs text-on-surface-variant">Unsupported flags stay hidden in the production manager.</p></div>
            <span className="font-mono text-[10px] text-warning">Waiting for runtime probe</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Placement options" />
            <Field label="Load options" />
            <Field label="Advanced flags" />
            <Field label="Runtime-specific device ID" />
          </div>
          <div className="rounded-md border border-outline-variant bg-surface-container-lowest p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Examples shown only when advertised</p>
            <ul className="mt-2 grid gap-1.5 text-[11px] text-on-surface-variant sm:grid-cols-2">
              {capabilityExamples.map((item) => <li key={item} className="flex gap-2"><span aria-hidden="true" className="text-primary">·</span>{item}</li>)}
            </ul>
          </div>
          <p className="text-[11px] text-on-surface-variant">No device names, memory readings, or supported flags are included in this static reference.</p>
        </section>

        <aside className="grid content-start gap-3 rounded-md border border-outline-variant bg-surface-container p-4" aria-labelledby="effective-title">
          <div><h3 id="effective-title" className="text-sm font-medium">Effective configuration</h3><p className="mt-1 text-xs text-on-surface-variant">Resolved from the selected model, runtime, and supported options.</p></div>
          <dl className="grid gap-2 rounded-md bg-surface-container-lowest p-3 text-xs">
            {['Model', 'Backend', 'Runtime', 'Device'].map((name) => <div key={name} className="flex justify-between gap-3 border-b border-outline-variant/60 pb-2 last:border-0 last:pb-0"><dt className="text-on-surface-variant">{name}</dt><dd className="text-right text-on-surface-variant">Unavailable</dd></div>)}
          </dl>
          <pre className="min-h-20 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-outline-variant bg-surface-container-lowest p-3 font-mono text-[10px] text-on-surface-variant">Command preview appears after choosing a model and runtime.</pre>
          <DisabledAction><span aria-hidden="true" className="material-symbols-outlined text-sm">code</span>Preview effective command</DisabledAction>
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant pt-4">
        <p className="text-[11px] text-on-surface-variant">Load and unload affect the selected local runtime. The reference does not execute commands.</p>
        <div className="flex flex-wrap gap-2">
          <DisabledAction><span aria-hidden="true" className="material-symbols-outlined text-sm">refresh</span>Refresh status</DisabledAction>
          <DisabledAction><span aria-hidden="true" className="material-symbols-outlined text-sm">stop</span>Unload model</DisabledAction>
          <DisabledAction><span aria-hidden="true" className="material-symbols-outlined text-sm">play_arrow</span>Load model</DisabledAction>
        </div>
      </div>
    </section>
  </section>
);
