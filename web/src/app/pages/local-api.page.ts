import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'ai-local-api-page', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="api-page">
      <header class="page-heading"><div><div class="eyebrow">DEVELOPER / LOCAL NODE</div><h1>Local API Server</h1><p>Loopback API status and client connection details.</p></div>
        <button class="refresh" (click)="refresh()" [disabled]="api.connection() === 'checking'" title="Check API connection">↻ <span>Refresh status</span></button>
      </header>
      <section class="overview" aria-label="Local API status">
        <div class="overview-copy"><div class="title-line"><h2>AI Dream Local API</h2><span class="compat">AI DREAM REST</span></div>
          <div class="state-line" [class.is-online]="api.connected()"><i></i><strong [title]="api.connected() ? 'GET /api/health returned an HTTP success response' : 'Connection state for the configured local API'">{{ stateLabel() }}</strong><code [title]="'Loopback API base URL: ' + api.baseUrl()">{{ api.baseUrl() }}</code></div>
          <p>Local-only HTTP service for AI Dream. This address is restricted to loopback; no LAN binding or remote inference gateway is exposed here.</p>
        </div>
        <div class="overview-metrics"><div><span>CONNECTION</span><b [title]="'Reachability of ' + api.baseUrl() + '/api/health'">{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Unavailable' }}</b></div>
          <div><span>INTERFACE</span><b title="The AI Dream service binds to loopback; remote LAN binding is not available">127.0.0.1</b></div><div><span>LAST CHECK</span><b title="Time of the most recent local API health check">{{ checkedAt() || 'Not checked' }}</b></div></div>
      </section>
      <div class="action-strip"><div><span class="pulse" [class.online]="api.connected()"></span><b>LOCAL SERVICE</b><span class="muted">{{ api.connection() === 'checking' ? 'Checking /api/health' : api.connected() ? 'Health endpoint responding' : (api.error() || 'Health endpoint unavailable') }}</span></div>
        <button class="copy" title="Copy the configured local API base URL" (click)="copyBase()">{{ copied() ? 'Copied' : 'Copy base URL' }}</button>
      </div>
      <div class="api-grid">
        <section class="panel config"><header class="panel-heading"><div><span class="panel-icon">⌘</span><h2>Connection &amp; security</h2></div><span class="tag">LOOPBACK ONLY</span></header>
          <div class="config-row"><div><b>Base URL</b><small>Configured in this app</small></div><code [title]="'Current local API base: ' + api.baseUrl()">{{ api.baseUrl() }}</code></div>
          <div class="config-row"><div><b>Health check</b><small>Read-only service probe</small></div><code title="Returns AI Dream service health; it does not load a model">GET /api/health</code></div>
          <div class="security-note"><span>●</span><div><b>No remote bind</b><small>API calls stay on this machine. The service does not provide API-key, LAN-exposure, or client-session controls.</small></div></div>
          <button class="recheck" title="Request GET /api/health from the configured loopback base URL" (click)="refresh()" [disabled]="api.connection() === 'checking'">Check connection <span>→</span></button>
        </section>
        <section class="panel endpoints"><header class="panel-heading"><div><span class="panel-icon">⌘</span><h2>Implemented endpoints</h2></div><span class="count">{{ endpoints.length }} GET</span></header>
          <p class="panel-intro">Read routes currently available on the local service. This is not an OpenAI-compatible <code title="No /v1 OpenAI API is implemented">/v1</code> server.</p>
          @for (endpoint of endpoints; track endpoint.path) {
            <div class="endpoint-row" [title]="'Read-only route: ' + endpoint.note"><span class="method" title="HTTP GET read request">GET</span><code [title]="'Local AI Dream API route: ' + endpoint.path">{{ endpoint.path }}</code><span class="endpoint-note">{{ endpoint.note }}</span><span class="route-state" [class.offline]="!api.connected()" [title]="api.connected() ? 'API health check is responding; route status is not probed separately' : 'The API is currently unreachable'">{{ api.connected() ? 'AVAILABLE' : 'API OFFLINE' }}</span></div>
          }
        </section>
        <section class="panel recipe"><header class="panel-heading"><div><span class="panel-icon" title="The example uses the local health route">&lt;/&gt;</span><h2>Quick connection check</h2></div><button class="copy" title="Copy the health-check JavaScript snippet" (click)="copyExample()">{{ exampleCopied() ? 'Copied' : 'Copy' }}</button></header>
          <p class="panel-intro">Verify reachability from a local client.</p><pre><code [title]="'JavaScript fetch example for ' + api.baseUrl() + '/api/health'">const response = await fetch('{{ api.baseUrl() }}/api/health');
const result = await response.json();
console.log(result.data.status, result.data.service);</code></pre>
        </section>
        <section class="panel limits"><header class="panel-heading"><div><span class="panel-icon">◎</span><h2>Service boundary</h2></div></header>
          <div class="boundary"><b>Local inference API</b><span>Not exposed</span></div><div class="boundary"><b>External client sessions</b><span>Not tracked</span></div><div class="boundary"><b>Server control actions</b><span>Not available here</span></div>
          <p>Model loading and runtime management remain in their dedicated AI Dream workflows.</p>
        </section>
      </div>
    </section>`,
  styles: [`
    :host{display:block;color:var(--text,#e1e5f0)}.api-page{max-width:1500px;margin:0 auto;padding:18px 20px 32px;display:grid;gap:14px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{font:500 10px/1.4 ui-monospace,monospace;color:#8b93a5}.page-heading h1{font-size:21px;line-height:1.25;margin:3px 0;font-weight:650}.page-heading p,.panel-intro{font-size:12px;color:#9ba4b6;margin:0}.refresh,.copy,.recheck{font:500 12px ui-monospace,monospace;color:#dce3f3;background:#252b38;border:1px solid #353d4d;border-radius:4px;padding:8px 10px;cursor:pointer}.refresh:disabled,.recheck:disabled{opacity:.55;cursor:wait}.overview{background:#1b202a;border:1px solid #2a303c;border-radius:5px;padding:18px;display:grid;grid-template-columns:minmax(300px,1fr) auto;gap:20px;align-items:center}.title-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.title-line h2{font-size:20px;margin:0;font-weight:650}.compat,.tag{font:500 10px ui-monospace,monospace;color:#adc6ff;background:#242b39;padding:4px 6px;border-radius:3px}.state-line{display:flex;gap:8px;align-items:center;margin:8px 0;color:#ffb4ab;font:500 12px ui-monospace,monospace;flex-wrap:wrap}.state-line.is-online{color:#4edea3}.state-line i,.pulse{width:7px;height:7px;border-radius:50%;background:#ffb4ab;display:inline-block;flex:none}.state-line.is-online i,.pulse.online{background:#4edea3}.state-line code{color:#4edea3}.overview-copy>p{font-size:12px;line-height:1.55;color:#a8afbf;margin:0;max-width:760px}.overview-metrics{display:grid;grid-template-columns:repeat(3,minmax(105px,1fr));gap:6px}.overview-metrics div{background:#151a23;padding:10px;border-radius:3px;min-width:0}.overview-metrics span{display:block;color:#8992a4;font:500 9px ui-monospace,monospace;margin-bottom:7px}.overview-metrics b{font:600 12px ui-monospace,monospace;overflow-wrap:anywhere}.action-strip{min-height:38px;padding:6px 10px;background:#171c26;border:1px solid #262d39;display:flex;align-items:center;justify-content:space-between;gap:12px}.action-strip>div{display:flex;align-items:center;gap:8px;min-width:0}.action-strip>div>b{font:600 10px ui-monospace,monospace;color:#c6cede}.muted{font-size:11px;color:#8f98aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy{padding:6px 9px;white-space:nowrap}.api-grid{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(340px,1.15fr);gap:12px}.panel{background:#1b202a;border:1px solid #292f3b;border-radius:4px;padding:14px;min-width:0}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.panel-heading>div{display:flex;align-items:center;gap:8px;min-width:0}.panel-heading h2{font-size:14px;margin:0;font-weight:600}.panel-icon{color:#adc6ff;font:600 16px ui-monospace,monospace}.count{font:500 10px ui-monospace,monospace;color:#4edea3}.config-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 2px;border-bottom:1px solid #2a303b}.config-row b,.security-note b{display:block;font-size:12px;font-weight:550}.config-row small,.security-note small{display:block;color:#929bad;font-size:10px;margin-top:4px}.config-row code{font:11px ui-monospace,monospace;color:#c5d5ff;text-align:right;overflow-wrap:anywhere}.security-note{display:flex;gap:10px;padding:12px 10px;margin-top:12px;background:#151a23;border-radius:3px}.security-note>span{color:#4edea3}.recheck{margin-top:12px}.recheck span{color:#adc6ff;margin-left:4px}.endpoints{grid-row:span 2}.panel-intro{line-height:1.5;margin:-2px 0 10px}.panel-intro code{color:#b9c9ee}.endpoint-row{display:grid;grid-template-columns:34px minmax(110px,1fr) minmax(110px,1fr) auto;align-items:center;gap:8px;padding:9px 4px;border-top:1px solid #292f3b}.method{font:600 9px ui-monospace,monospace;color:#adc6ff;background:#252c39;text-align:center;padding:4px;border-radius:2px}.endpoint-row>code{font:11px ui-monospace,monospace;color:#d9e1f2;overflow-wrap:anywhere}.endpoint-note{font-size:10px;color:#8e97a8}.route-state{font:500 9px ui-monospace,monospace;color:#4edea3;white-space:nowrap}.route-state.offline{color:#ffb4ab}.recipe pre{margin:8px 0 0;background:#0e131d;padding:13px;overflow:auto;border-radius:3px;white-space:pre-wrap}.recipe pre code{font:11px/1.7 ui-monospace,monospace;color:#cbd5e8}.boundary{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;border-bottom:1px solid #2a303b;font-size:11px}.boundary span{font:10px ui-monospace,monospace;color:#919aab;text-align:right}.limits>p{font-size:10px;color:#8f98aa;line-height:1.5;margin:12px 0 0}@media(max-width:850px){.overview{grid-template-columns:1fr}.overview-metrics{grid-template-columns:repeat(3,1fr)}.api-grid{grid-template-columns:1fr}.endpoints{grid-row:auto}}@media(max-width:520px){.api-page{padding:14px 10px 24px}.page-heading{align-items:flex-start}.refresh span{display:none}.overview-metrics{grid-template-columns:1fr}.endpoint-row{grid-template-columns:32px minmax(120px,1fr) auto}.endpoint-note{grid-column:2/-1}.endpoint-row .route-state{grid-column:3;grid-row:1}.endpoint-row>code{grid-column:2;grid-row:1}}
  `]
})
export class LocalApiPage {
  readonly api = inject(ApiService);
  readonly checkedAt = signal('');
  readonly copied = signal(false);
  readonly exampleCopied = signal(false);
  readonly endpoints = [
    { path: '/api/health', note: 'Service health' },
    { path: '/api/hardware', note: 'Detected hardware' },
    { path: '/api/models', note: 'Local model catalog' },
    { path: '/api/runtime', note: 'Runtime inventory' },
    { path: '/api/capabilities', note: 'Typed capability declarations' },
    { path: '/api/capability-map', note: 'Compact capability map' },
    { path: '/api/model-manifests', note: 'Observed model manifests and orchestration metadata' },
    { path: '/api/capability-preferences', note: 'Read or update route preferences, Auto/Guided/Manual defaults and LRU/Never eviction policy' },
    { path: '/api/resources', note: 'RAM, GPU, CPU and temporary disk snapshot' },
    { path: '/api/models/residency', note: 'Loaded model residency and leases' },
    { path: '/api/models/residency/actions', note: 'Pin, unpin or unload an existing allowlisted orchestration resident (POST)' },
    { path: '/api/skills', note: 'Validated declarative skill catalog and readiness' },
    { path: '/api/runs', note: 'Bounded orchestration run summaries' },
    { path: '/api/runs/{id}', note: 'Run state and plan details' },
    { path: '/api/runs/{id}/events?after=', note: 'Reconnectable server-sent run events' },
    { path: '/api/runs/{id}/cancel', note: 'Request cooperative run cancellation' },
    { path: '/api/artifacts', note: 'Upload binary artifact or list owner-scoped artifacts' },
    { path: '/api/artifacts/{id}/metadata', note: 'Read typed artifact metadata' },
    { path: '/api/artifacts/{id}/content', note: 'Read artifact bytes separately from JSON metadata' },
    { path: '/api/artifacts/{id}', note: 'Delete an owner-scoped temporary artifact' },
    { path: '/api/chats', note: 'Saved chat sessions' },
    { path: '/api/agent/tools', note: 'Agent tool registry' },
    { path: '/api/logs?limit=', note: 'Bounded recent llama-server output' },
  ];

  constructor() {
    effect(() => {
      if (this.api.connection() !== 'checking') this.checkedAt.set(new Date().toLocaleTimeString());
    });
  }
  stateLabel() { return this.api.connected() ? 'RUNNING' : this.api.connection() === 'checking' ? 'CHECKING' : 'UNAVAILABLE'; }
  async refresh() { await this.api.check(); this.checkedAt.set(new Date().toLocaleTimeString()); }
  async copyBase() { await navigator.clipboard.writeText(this.api.baseUrl()); this.copied.set(true); setTimeout(() => this.copied.set(false), 1600); }
  async copyExample() {
    await navigator.clipboard.writeText(`const response = await fetch('${this.api.baseUrl()}/api/health');\nconst result = await response.json();\nconsole.log(result.data.status, result.data.service);`);
    this.exampleCopied.set(true); setTimeout(() => this.exampleCopied.set(false), 1600);
  }
}
