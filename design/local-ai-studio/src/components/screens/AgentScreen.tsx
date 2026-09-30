import React from 'react';

const topics = [
  { icon: 'memory', title: 'Inspect hardware', detail: 'Detected devices and system memory' },
  { icon: 'inventory_2', title: 'Find a local model', detail: 'Models in configured folders' },
  { icon: 'speed', title: 'Check runtime status', detail: 'Installed runtime and reported capabilities' },
];

export const AgentScreen: React.FC = () => (
  <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 text-on-surface sm:p-6" aria-labelledby="agent-title">
    <header className="mx-auto w-full max-w-5xl">
      <p className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">Workspace / Read-only assistant</p>
      <h1 id="agent-title" className="mt-2 text-2xl font-semibold">Agent</h1>
      <p className="mt-1 text-sm text-on-surface-variant">Illustrative entry point for read-only questions about local hardware, models, and runtime status; no agent session is connected here.</p>
    </header>

    <div className="mx-auto mt-5 grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="flex min-h-[22rem] flex-col rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant pb-3">
          <div>
            <p className="text-xs text-on-surface-variant">STATIC PREVIEW</p>
            <h2 className="mt-1 font-medium">Example agent entry point</h2>
          </div>
          <span className="rounded border border-tertiary/50 bg-tertiary/10 px-2 py-1 text-xs text-tertiary">Read-only tools</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <span aria-hidden="true" className="material-symbols-outlined text-3xl text-primary">smart_toy</span>
          <h3 className="mt-3 font-medium">What would you like to inspect?</h3>
          <p className="mt-1 max-w-md text-sm text-on-surface-variant">The production agent uses a locally selected model and a bounded set of read-only tools. This reference shows the intended entry point.</p>
        </div>
        <label htmlFor="agent-prompt" className="sr-only">Message the local agent</label>
        <div className="flex items-end gap-2 rounded-md border border-outline bg-surface px-3 py-2">
          <textarea id="agent-prompt" rows={2} disabled placeholder="Ask about this device, your models, or runtime…" className="min-w-0 flex-1 resize-y bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant disabled:cursor-not-allowed" />
          <button type="button" disabled aria-label="Send to agent" className="rounded bg-primary px-3 py-2 text-sm font-medium text-on-surface opacity-60">Send</button>
        </div>
        <p className="mt-2 text-xs text-on-surface-variant">Interaction is disabled in this visual reference.</p>
      </div>

      <aside className="rounded-lg border border-outline-variant bg-surface-container-low p-4" aria-label="Agent capabilities">
        <h2 className="font-medium">Example inspection topics</h2>
        <ul className="mt-3 space-y-3">
          {topics.map((topic) => (
            <li key={topic.title} className="flex gap-3 rounded-md border border-outline-variant bg-surface-container px-3 py-3">
              <span aria-hidden="true" className="material-symbols-outlined text-primary">{topic.icon}</span>
              <div><h3 className="text-sm font-medium">{topic.title}</h3><p className="mt-1 text-xs text-on-surface-variant">{topic.detail}</p></div>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-outline-variant pt-3 text-xs leading-relaxed text-on-surface-variant">Production limits each turn to at most four tool calls and 45 seconds. Actual availability depends on the local API and selected model.</p>
      </aside>
    </div>
  </section>
);
