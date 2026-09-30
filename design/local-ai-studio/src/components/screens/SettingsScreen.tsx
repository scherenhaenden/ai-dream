import React from 'react';

const PreviewField = ({ label, value = 'Unavailable in static reference' }: { label: string; value?: string }) => (
  <label className="grid min-w-0 gap-1.5 text-xs text-on-surface-variant">
    <span>{label}</span>
    <input disabled readOnly value={value} className="min-w-0 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-mono text-xs text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-70" />
  </label>
);

const PreviewSelect = ({ label, choices }: { label: string; choices?: string[] }) => (
  <label className="grid min-w-0 gap-1.5 text-xs text-on-surface-variant">
    <span>{label}</span>
    <select disabled defaultValue="" className="min-w-0 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-xs text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-70">
      <option value="">No live setting loaded</option>
      {choices?.map((choice) => <option key={choice}>{choice}</option>)}
    </select>
  </label>
);

const PreviewButton = ({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) => (
  <button type="button" disabled title="Preview only. This reference is not connected to Settings or the local API." className={`rounded-md border px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${primary ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-container-high text-on-surface-variant'}`}>
    {children}
  </button>
);

export const SettingsScreen: React.FC = () => (
  <section className="mx-auto grid h-full w-full max-w-6xl content-start gap-5 overflow-y-auto p-4 pb-12 text-on-surface sm:p-6" aria-labelledby="settings-title">
    <header className="flex flex-col justify-between gap-4 border-b border-outline-variant pb-4 sm:flex-row sm:items-end">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Preferences</p>
        <h1 id="settings-title" className="mt-1 text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-on-surface-variant">Application behavior and defaults for local runtimes.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-warning/50 bg-warning/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-warning">Static preview · values not loaded</span>
        <PreviewButton primary>Save changes</PreviewButton>
      </div>
    </header>

    <nav aria-label="Settings categories" className="flex gap-2 border-b border-outline-variant pb-2">
      <button type="button" disabled aria-current="page" className="border-b-2 border-primary px-3 py-2 text-xs font-medium text-primary disabled:cursor-default">Application</button>
      <button type="button" disabled className="px-3 py-2 text-xs text-on-surface-variant disabled:cursor-default">Runtime defaults</button>
    </nav>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="grid content-start gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:p-5" aria-labelledby="local-api-settings-title">
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant pb-3">
          <div><h2 id="local-api-settings-title" className="text-sm font-semibold">Local API</h2><p className="mt-1 text-xs text-on-surface-variant">The URL is stored in this browser and checked with a health request.</p></div>
          <span className="rounded border border-outline-variant bg-surface-container px-2 py-1 font-mono text-[9px] text-on-surface-variant">Health not checked</span>
        </div>
        <PreviewField label="API base URL" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] text-on-surface-variant">Health probe: GET <code className="text-on-surface">/api/health</code></p>
          <PreviewButton>Save URL &amp; check</PreviewButton>
        </div>
        <p className="rounded-md border border-outline-variant bg-surface-container p-3 text-[11px] leading-relaxed text-on-surface-variant">Production accepts a loopback HTTP address such as localhost or 127.0.0.1 with a valid port. This mock does not show or probe a configured endpoint.</p>
      </section>

      <section className="grid content-start gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:p-5" aria-labelledby="behavior-title">
        <div className="border-b border-outline-variant pb-3"><h2 id="behavior-title" className="text-sm font-semibold">Application behavior</h2><p className="mt-1 text-xs text-on-surface-variant">Choose how global defaults interact with model-specific profiles.</p></div>
        <PreviewSelect label="Default profile behavior" choices={['Use the model profile', 'Use global defaults']} />
        <p className="text-[11px] leading-relaxed text-on-surface-variant">Model profiles can override global placement and load options when selected.</p>
        <label className="flex items-center justify-between gap-4 rounded-md border border-outline-variant bg-surface-container p-3 opacity-75">
          <span><b className="block text-xs font-medium text-on-surface">Keep last model loaded</b><small className="mt-1 block text-[10px] text-on-surface-variant">Retain the active model between inference requests.</small></span>
          <input type="checkbox" disabled aria-label="Keep last model loaded; preview only" className="h-4 w-4 accent-primary" />
        </label>
      </section>

      <section className="grid content-start gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:p-5 lg:col-span-2" aria-labelledby="local-paths-title">
        <div className="border-b border-outline-variant pb-3"><h2 id="local-paths-title" className="text-sm font-semibold">Local paths</h2><p className="mt-1 text-xs text-on-surface-variant">Read-only directories reported by this AI Dream installation.</p></div>
        <div className="grid gap-3 md:grid-cols-3">
          <PreviewField label="Managed models directory" />
          <PreviewField label="Configuration directory" />
          <PreviewField label="Application data directory" />
        </div>
      </section>

      <section className="grid content-start gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:p-5 lg:col-span-2" aria-labelledby="runtime-defaults-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant pb-3">
          <div><h2 id="runtime-defaults-title" className="text-sm font-semibold">Runtime defaults</h2><p className="mt-1 text-xs text-on-surface-variant">Defaults apply when a model does not select its own configuration.</p></div>
          <span className="rounded border border-outline-variant bg-surface-container px-2 py-1 font-mono text-[9px] text-on-surface-variant">Options depend on probe</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <PreviewSelect label="Default backend" />
          <PreviewSelect label="Default runtime installation" />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <section className="grid content-start gap-3 rounded-md border border-outline-variant bg-surface-container p-3" aria-labelledby="placement-defaults-title">
            <div><h3 id="placement-defaults-title" className="text-xs font-semibold">Backend &amp; placement</h3><p className="mt-1 text-[10px] text-on-surface-variant">Shown only when supported by the selected backend or runtime.</p></div>
            <PreviewField label="GPU layers / main GPU" />
            <PreviewField label="Runtime device selection" />
            <PreviewField label="Split mode / tensor split" />
          </section>
          <section className="grid content-start gap-3 rounded-md border border-outline-variant bg-surface-container p-3" aria-labelledby="load-defaults-title">
            <div><h3 id="load-defaults-title" className="text-xs font-semibold">Batching &amp; context</h3><p className="mt-1 text-[10px] text-on-surface-variant">Numeric fields appear only when advertised.</p></div>
            <PreviewField label="Context size / CPU threads" />
            <PreviewField label="Batch / physical batch size" />
            <PreviewField label="Maximum concurrent / batch threads" />
          </section>
          <section className="grid content-start gap-3 rounded-md border border-outline-variant bg-surface-container p-3" aria-labelledby="runtime-flags-title">
            <div><h3 id="runtime-flags-title" className="text-xs font-semibold">Runtime flags</h3><p className="mt-1 text-[10px] text-on-surface-variant">Only flags reported by the selected runtime can be configured.</p></div>
            <ul className="grid gap-2 text-[11px] text-on-surface-variant">
              {['Flash attention', 'Unified KV cache', 'Offload KV cache', 'Keep model loaded', 'Fit to available memory'].map((flag) => <li key={flag} className="flex items-center justify-between gap-3 rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-2"><span>{flag}</span><input type="checkbox" disabled aria-label={`${flag}; preview only`} className="h-3.5 w-3.5 accent-primary" /></li>)}
            </ul>
          </section>
        </div>
        <p className="rounded-md border border-outline-variant bg-surface-container p-3 text-[11px] leading-relaxed text-on-surface-variant">No runtime inventory or capability probe is connected here. Values, available backends, installations, devices, and supported flags remain unavailable in this reference; model-specific settings belong with the model profile.</p>
      </section>
    </div>
  </section>
);
