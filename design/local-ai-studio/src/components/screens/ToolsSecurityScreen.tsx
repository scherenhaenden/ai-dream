import React from 'react';

const registeredTools = [
  {
    name: 'hardware.status',
    description: 'Get CPU, memory, operating system, and detected GPU status.',
    parameters: 'No arguments',
    group: 'System & hardware',
  },
  {
    name: 'models.list',
    description: 'List GGUF models already present in configured local folders.',
    parameters: 'No arguments',
    group: 'Local model catalog',
  },
  {
    name: 'models.info',
    description: 'Get metadata for a model already in the local catalog.',
    parameters: 'model_id: string',
    group: 'Local model catalog',
  },
  {
    name: 'runtime.status',
    description: 'Get llama.cpp installation and backend status.',
    parameters: 'No arguments',
    group: 'Runtime status',
  },
];

export const ToolsSecurityScreen: React.FC = () => (
  <section className="flex flex-col w-full max-w-6xl mx-auto text-on-surface p-4 sm:p-6 space-y-5">
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 bg-surface-container-low border border-outline-variant/30 p-5 rounded-xl">
      <div>
        <div className="font-mono text-[11px] text-outline uppercase">Developer / Agent policy</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Tools &amp; Permissions</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-on-surface-variant">
          Read-only capabilities reported by the local agent registry. This reference preview does not connect to the registry.
        </p>
      </div>
      <button type="button" disabled aria-disabled="true" title="Unavailable in this static design preview" className="shrink-0 flex items-center justify-center gap-2 min-h-9 px-3 bg-surface-container-high text-on-surface-variant/60 text-[12px] font-semibold rounded-lg border border-outline-variant/30 cursor-not-allowed">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">refresh</span>
        Refresh registry unavailable
      </button>
    </header>

    <section aria-label="Registry availability" className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 p-4 rounded-xl border border-warning/30 bg-warning/5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[14px] font-semibold">Backend registry status</h2>
          <span className="px-2 py-1 rounded bg-warning/10 border border-warning/20 text-warning font-mono text-[10px]">UNAVAILABLE IN PREVIEW</span>
        </div>
        <p className="mt-1 text-[12px] text-on-surface-variant leading-relaxed">
          The entries and limits below are sample registry data based on the current local API contract. This screen has not fetched the backend, so it cannot confirm which capabilities are registered or currently available.
        </p>
      </div>
      <div className="flex flex-wrap md:flex-nowrap gap-2" aria-label="Sample per-turn limits">
        <div className="min-w-24 rounded-lg bg-surface-container-lowest/70 border border-outline-variant/20 px-3 py-2">
          <span className="block font-mono text-[9px] text-outline">EXAMPLE CALL LIMIT</span>
          <strong className="block mt-1 font-mono text-[14px]">4 / turn</strong>
        </div>
        <div className="min-w-24 rounded-lg bg-surface-container-lowest/70 border border-outline-variant/20 px-3 py-2">
          <span className="block font-mono text-[9px] text-outline">EXAMPLE TIME LIMIT</span>
          <strong className="block mt-1 font-mono text-[14px]">45 seconds</strong>
        </div>
        <div className="min-w-24 rounded-lg bg-surface-container-lowest/70 border border-outline-variant/20 px-3 py-2">
          <span className="block font-mono text-[9px] text-outline">EXAMPLE OUTPUT LIMIT</span>
          <strong className="block mt-1 font-mono text-[14px]">12,000 chars</strong>
        </div>
      </div>
    </section>

    <section aria-labelledby="registry-heading" className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
      <header className="p-4 sm:px-5 border-b border-outline-variant/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="registry-heading" className="text-[14px] font-semibold">Example read-only tool registry</h2>
          <span className="font-mono text-[10px] text-outline">GET /api/agent/tools · sample contract</span>
        </div>
        <p className="mt-1 text-[11px] text-on-surface-variant">The live route supplies registered names, descriptions, argument schemas, policy flags, and turn limits.</p>
      </header>
      <ul className="divide-y divide-outline-variant/20">
        {registeredTools.map((tool) => (
          <li key={tool.name} className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-mono text-[12px] font-semibold text-on-surface">{tool.name}</h3>
                <span className="px-1.5 py-0.5 rounded bg-tertiary/10 border border-tertiary/20 text-tertiary font-mono text-[9px]">READ ONLY · SAMPLE</span>
              </div>
              <p className="mt-1 text-[12px] text-on-surface-variant">{tool.description}</p>
            </div>
            <div className="sm:text-right shrink-0">
              <span className="block font-mono text-[9px] uppercase text-outline">{tool.group}</span>
              <span className="block mt-1 font-mono text-[10px] text-on-surface-variant">Inputs: {tool.parameters}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>

    <section aria-labelledby="boundary-heading" className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
        <h2 id="boundary-heading" className="text-[14px] font-semibold">Registry boundary</h2>
        <p className="mt-1 text-[12px] text-on-surface-variant">The fixed registry contains read-only queries against hardware status, the local GGUF catalog, and runtime status.</p>
        <ul className="mt-3 space-y-2 text-[11px] text-on-surface-variant">
          <li className="flex gap-2"><span aria-hidden="true" className="text-tertiary">✓</span>Capabilities are reported by the backend registry.</li>
          <li className="flex gap-2"><span aria-hidden="true" className="text-error">×</span>No shell-execution tool is registered.</li>
          <li className="flex gap-2"><span aria-hidden="true" className="text-error">×</span>No filesystem-write tool is registered.</li>
          <li className="flex gap-2"><span aria-hidden="true" className="text-error">×</span>No network-fetch tool is registered.</li>
        </ul>
      </div>
      <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
        <h2 className="text-[14px] font-semibold">Per-turn bounds</h2>
        <p className="mt-1 text-[12px] text-on-surface-variant">The agent runtime enforces limits for each turn. Values shown above are illustrative until returned by the live registry endpoint.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="px-2 py-1 rounded bg-surface-container-high text-[10px] font-mono text-on-surface-variant">Tool-call count</span>
          <span className="px-2 py-1 rounded bg-surface-container-high text-[10px] font-mono text-on-surface-variant">Wall-clock time</span>
          <span className="px-2 py-1 rounded bg-surface-container-high text-[10px] font-mono text-on-surface-variant">Output characters</span>
        </div>
      </div>
    </section>

    <p className="text-[11px] text-outline">Static design reference only. Registry membership, policy flags, argument schemas, and limits should be displayed from the backend response in the production route.</p>
  </section>
);
