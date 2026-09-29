import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ActivatedRoute } from '@angular/router';

type Capability = 'knowledge' | 'logs';
const CAPABILITIES = {
  knowledge: {
    title: 'Local Knowledge', kicker: 'WORKSPACE / LOCAL RAG', icon: '▧',
    description: 'Local document indexing and retrieval are not available in this AI Dream build.',
    boundary: 'The local API does not expose a knowledge-store, indexing, or retrieval endpoint. No collections or search results are available to display.',
    status: 'RAG ENGINE NOT CONNECTED',
    checks: [{ label: 'Document store', state: 'Not available' }, { label: 'Indexing', state: 'Not available' }, { label: 'Retrieval', state: 'Not available' }],
  },
  logs: {
    title: 'Logs & Traces', kicker: 'DEVELOPER / OBSERVABILITY', icon: '≋',
    description: 'Application log history and distributed traces are not exposed by the local API.',
    boundary: 'There is no logs or traces endpoint in the current backend contract. This view will not fabricate events, timestamps, request counts, or latency charts.',
    status: 'LOG STREAM NOT EXPOSED',
    checks: [{ label: 'Application logs', state: 'Not exposed' }, { label: 'Request traces', state: 'Not exposed' }, { label: 'Export', state: 'Not available' }],
  },
} satisfies Record<Capability, { title: string; kicker: string; icon: string; description: string; boundary: string; status: string; checks: {label: string; state: string}[] }>;

@Component({
  selector: 'ai-capability-unavailable-page', standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="capability-page">
      <header class="page-heading"><div><div class="eyebrow" [title]="capability.kicker">{{ capability.kicker }}</div><h1>{{ capability.title }}</h1><p>{{ capability.description }}</p></div>
        <span class="availability" title="The frontend route exists, but this backend capability is not implemented"><i></i>CAPABILITY UNAVAILABLE</span></header>
      <section class="overview"><div class="overview-icon" [title]="capability.status">{{ capability.icon }}</div><div class="overview-copy"><div class="status" [title]="capability.boundary">{{ capability.status }}</div><h2 [title]="api.connected() ? 'GET /api/health responds; this capability still has no API endpoint' : 'No response from the configured local API'">{{ api.connected() ? 'Local API is reachable' : 'Waiting for the local API' }}</h2><p>{{ capability.boundary }}</p></div>
        <div class="api-address"><span>LOCAL API</span><code [title]="'Configured local API base URL: ' + api.baseUrl()">{{ api.baseUrl() }}</code><small [title]="'API connection state: ' + api.connection()">{{ api.connected() ? 'Connection healthy' : api.connection() === 'checking' ? 'Checking connection' : 'Currently offline' }}</small></div></section>
      <div class="capability-grid">
        <section class="panel status-panel"><header><div><span class="panel-icon">{{ capability.icon }}</span><h2>Subsystem availability</h2></div><span class="count">{{ capability.checks.length }} CHECKS</span></header>
          @for (item of capability.checks; track item.label) {<div class="check-row" [title]="item.label + ': ' + item.state + '; no backend endpoint provides this capability'"><span>{{ item.label }}</span><b>{{ item.state }}</b></div>}
          <p class="panel-note">No local data is stored or queried from this view.</p>
        </section>
        <section class="panel next-panel"><header><div><span class="panel-icon">⌘</span><h2>Available destinations</h2></div></header>
          <a routerLink="/local-api" title="Open the local API status and implemented route list"><span><b>Local API</b><small>Inspect the implemented loopback endpoints</small></span><span>→</span></a>
          <a routerLink="/tools-permissions" title="Open the backend-reported read-only agent registry"><span><b>Tools &amp; Permissions</b><small>See the read-only capabilities that do exist</small></span><span>→</span></a>
          <a routerLink="/runtime" title="Open the real runtime installation, selection, and model loading view"><span><b>Runtime Manager</b><small>Configure and inspect local inference runtimes</small></span><span>→</span></a>
        </section>
      </div>
      <footer class="source-note"><span>ⓘ</span><span>This screen reflects a missing backend capability, not an error in your local data. The API will need a real {{ kindLabel() }} subsystem before this page can show functional data.</span></footer>
    </section>`,
  styles: [`
    :host{display:block;color:var(--text,#e1e5f0)}.capability-page{max-width:1400px;margin:0 auto;padding:18px 20px 32px;display:grid;gap:14px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{font:500 10px/1.4 ui-monospace,monospace;color:#8b93a5}.page-heading h1{font-size:21px;line-height:1.25;margin:3px 0;font-weight:650}.page-heading p{font-size:12px;color:#9ba4b6;margin:0}.availability{display:flex;align-items:center;gap:7px;padding:7px 9px;background:#29251f;border:1px solid #39342a;border-radius:3px;color:#e2c58b;font:500 9px ui-monospace,monospace;white-space:nowrap}.availability i{width:6px;height:6px;border-radius:50%;background:#d6a84f}.overview{display:grid;grid-template-columns:44px minmax(0,1fr) minmax(180px,250px);gap:14px;align-items:center;padding:18px;background:#1b202a;border:1px solid #2a303c;border-radius:5px}.overview-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:4px;background:#242c39;color:#adc6ff;font:600 20px ui-monospace,monospace}.status{color:#e0bf80;font:500 9px ui-monospace,monospace}.overview-copy h2{font-size:16px;margin:5px 0;font-weight:620}.overview-copy p{max-width:740px;color:#a3abba;font-size:11px;line-height:1.55;margin:0}.api-address{background:#151a23;padding:10px;border-radius:3px;min-width:0}.api-address span,.api-address small{display:block;color:#8992a4;font:9px ui-monospace,monospace}.api-address code{display:block;margin:6px 0;color:#d2dcf1;font:10px ui-monospace,monospace;overflow-wrap:anywhere}.capability-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.panel{background:#1b202a;border:1px solid #292f3b;border-radius:4px;padding:14px;min-width:0}.panel header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.panel header>div{display:flex;align-items:center;gap:8px}.panel-icon{color:#adc6ff;font:600 16px ui-monospace,monospace}.panel h2{font-size:13px;margin:0;font-weight:600}.count{color:#929bad;font:500 9px ui-monospace,monospace}.check-row{display:flex;justify-content:space-between;gap:12px;padding:11px 2px;border-top:1px solid #2a303b;font-size:11px;color:#c6ccda}.check-row b{font:500 9px ui-monospace,monospace;color:#a2aabc;text-align:right}.panel-note{margin:11px 0 0;color:#8d96a7;font-size:10px}.next-panel a{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 3px;border-top:1px solid #2a303b;text-decoration:none;color:#cbd2df}.next-panel a:hover{background:#202632}.next-panel a>span:first-child{display:block;min-width:0}.next-panel a b{display:block;font-size:11px;font-weight:550}.next-panel a small{display:block;margin-top:4px;color:#919aab;font-size:10px}.next-panel a>span:last-child{color:#adc6ff}.source-note{display:flex;align-items:flex-start;gap:7px;color:#929bad;font-size:10px;padding:3px 2px}.source-note>span:first-child{color:#adc6ff}@media(max-width:800px){.overview{grid-template-columns:40px minmax(0,1fr)}.api-address{grid-column:1/-1}.capability-grid{grid-template-columns:1fr}}@media(max-width:560px){.capability-page{padding:14px 10px 24px}.page-heading{align-items:flex-start;flex-direction:column}.availability{align-self:flex-start}.overview{grid-template-columns:30px minmax(0,1fr);gap:9px;padding:12px}.overview-icon{width:30px;height:30px;font-size:16px}}
  `]
})
export class CapabilityUnavailablePage {
  readonly api = inject(ApiService);
  readonly kind = inject(ActivatedRoute).snapshot.data['capability'] as Capability;
  readonly capability = CAPABILITIES[this.kind] ?? CAPABILITIES.knowledge;
  kindLabel() { return this.kind === 'knowledge' ? 'knowledge index and retrieval' : 'log collection and trace query'; }
}
