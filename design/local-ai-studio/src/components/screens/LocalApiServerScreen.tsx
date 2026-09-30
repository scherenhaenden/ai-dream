import React from 'react';

const endpoints = [
  { path: '/api/health', note: 'Service health' },
  { path: '/api/hardware', note: 'Detected hardware' },
  { path: '/api/models', note: 'Local model catalog' },
  { path: '/api/runtime', note: 'Runtime inventory' },
  { path: '/api/chats', note: 'Saved chat sessions' },
  { path: '/api/agent/tools', note: 'Agent tool registry' },
  { path: '/api/logs?limit=', note: 'Bounded recent llama-server output' },
];

const exampleBaseUrl = 'http://127.0.0.1:8765';

export const LocalApiServerScreen: React.FC = () => (
  <div className="flex min-h-0 w-full flex-col gap-4 overflow-y-auto p-4 pb-12 text-on-surface sm:p-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-outline">Developer / Local Node</div>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Local API Server</h1>
        <p className="mt-1 text-[13px] text-on-surface-variant">Loopback API status and client connection details.</p>
      </div>
      <button type="button" disabled title="Live health checks are available in the Angular application; this React reference is a static design preview." className="inline-flex cursor-not-allowed items-center gap-2 self-start rounded border border-outline-variant bg-surface-container-high px-3 py-2 font-mono text-xs text-on-surface-variant opacity-70 sm:self-auto">
        <span aria-hidden="true">↻</span> Refresh status
      </button>
    </header>

    <section aria-labelledby="api-status-heading" className="grid gap-5 rounded-lg border border-outline-variant/50 bg-surface-container p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="api-status-heading" className="text-lg font-semibold">AI Dream Local API</h2>
          <span className="rounded border border-outline-variant/50 bg-surface-container-high px-2 py-1 font-mono text-[10px] text-primary">AI DREAM REST</span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
          <strong className="text-warning">Status not checked in this design preview</strong>
          <code className="break-all text-on-surface-variant">GET /api/health</code>
        </div>
        <p className="max-w-3xl text-xs leading-relaxed text-on-surface-variant">
          In the Angular app, Refresh status checks the configured local API with <code className="text-on-surface">GET /api/health</code>.
          The address is configured in Settings. The service is loopback-only; this page does not configure or control the server.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[390px]">
        <div className="rounded bg-surface-container-low p-3"><span className="block font-mono text-[9px] text-outline">CONNECTION</span><strong className="mt-1 block text-xs">Check in Angular</strong></div>
        <div className="rounded bg-surface-container-low p-3"><span className="block font-mono text-[9px] text-outline">INTERFACE</span><strong className="mt-1 block font-mono text-xs">127.0.0.1</strong></div>
        <div className="rounded bg-surface-container-low p-3"><span className="block font-mono text-[9px] text-outline">LAST CHECK</span><strong className="mt-1 block text-xs">Provided by Angular</strong></div>
      </div>
    </section>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section aria-labelledby="connection-heading" className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-container p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><span className="font-mono text-primary" aria-hidden="true">⌘</span><h2 id="connection-heading" className="text-sm font-semibold">Connection details</h2></div>
          <span className="rounded bg-tertiary/10 px-2 py-1 font-mono text-[10px] text-tertiary">LOOPBACK ONLY</span>
        </div>
        <dl className="divide-y divide-outline-variant/30">
          <div className="flex flex-col justify-between gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div><dt className="text-xs font-semibold">Configured base URL</dt><dd className="mt-1 text-[10px] text-on-surface-variant">Read and edited in Settings</dd></div>
            <dd className="break-all text-left font-mono text-xs text-primary sm:text-right">Example: {exampleBaseUrl}</dd>
          </div>
          <div className="flex flex-col justify-between gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div><dt className="text-xs font-semibold">Health check</dt><dd className="mt-1 text-[10px] text-on-surface-variant">Read-only service probe</dd></div>
            <dd className="font-mono text-xs text-on-surface sm:text-right">GET /api/health</dd>
          </div>
        </dl>
        <div className="mt-3 flex gap-3 rounded bg-surface-container-low p-3">
          <span className="text-tertiary" aria-hidden="true">●</span>
          <p className="text-[11px] leading-relaxed text-on-surface-variant">Requests stay on this machine. The API does not expose LAN binding, API-key rotation, or client-session controls.</p>
        </div>
      </section>

      <section aria-labelledby="endpoints-heading" className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-container p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><span className="font-mono text-primary" aria-hidden="true">⌘</span><h2 id="endpoints-heading" className="text-sm font-semibold">Implemented endpoints</h2></div>
          <span className="font-mono text-[10px] text-tertiary">7 documented GET routes</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-on-surface-variant">Routes documented by the Angular page. Availability follows the API health check; each route is not probed separately. This is not an OpenAI-compatible <code className="text-on-surface">/v1</code> server.</p>
        <ul className="divide-y divide-outline-variant/30">
          {endpoints.map((endpoint) => (
            <li key={endpoint.path} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[44px_minmax(150px,1fr)_minmax(120px,1fr)] sm:items-center">
              <span className="rounded bg-primary-container/15 px-1.5 py-1 text-center font-mono text-[9px] font-semibold text-primary">GET</span>
              <code className="break-all font-mono text-[11px] text-on-surface">{endpoint.path}</code>
              <span className="col-start-2 text-[10px] text-on-surface-variant sm:col-start-auto">{endpoint.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="example-heading" className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-container p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2"><span className="font-mono text-primary" aria-hidden="true">&lt;/&gt;</span><h2 id="example-heading" className="text-sm font-semibold">Example client check</h2></div>
        <p className="mb-3 text-xs text-on-surface-variant">Sample only. Replace the base URL with the address shown in Settings; this example is not executed here.</p>
        <pre className="overflow-x-auto rounded bg-surface-container-lowest p-3 text-[11px] leading-relaxed text-on-surface"><code>{'const baseUrl = "' + exampleBaseUrl + '"; // example address\nconst response = await fetch(baseUrl + \'/api/health\');\nconst result = await response.json();\nconsole.log(result.data.status, result.data.service);'}</code></pre>
      </section>

      <section aria-labelledby="boundary-heading" className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-container p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2"><span className="font-mono text-primary" aria-hidden="true">◎</span><h2 id="boundary-heading" className="text-sm font-semibold">Service boundary</h2></div>
        <ul className="divide-y divide-outline-variant/30">
          <li className="flex justify-between gap-3 py-2 text-xs"><span>LAN exposure</span><span className="font-mono text-tertiary">Not exposed</span></li>
          <li className="flex justify-between gap-3 py-2 text-xs"><span>External client sessions</span><span className="font-mono text-outline">Not tracked</span></li>
          <li className="flex justify-between gap-3 py-2 text-xs"><span>Server control actions</span><span className="font-mono text-outline">Not available here</span></li>
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">Model loading and runtime management remain in their dedicated AI Dream workflows.</p>
      </section>
    </div>
  </div>
);
