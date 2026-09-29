import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';

interface LogsResponse {
  data: { lines: string[]; source: string | null; supported: boolean; loaded: boolean; limit: number };
}
interface DiagnosticEvent {
  timestamp: string; incident_id: string; level: string; operation: string;
  error_type: string; detail: string; chat_id?: string;
}

@Component({
  selector: 'ai-logs-page', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="logs-page">
      <header class="page-heading"><div><div class="eyebrow">DEVELOPER / OBSERVABILITY</div><h1>Logs &amp; Traces</h1><p>{{ view()==='diagnostics' ? 'Local application errors with incident IDs and runtime causes.' : 'Recent output captured from the local llama-server process.' }}</p></div>
        <button class="refresh" title="Refresh the selected local log source" (click)="view()==='diagnostics' ? loadDiagnostics() : load()" [disabled]="loading()||diagnosticsLoading()">↻ <span>Refresh</span></button>
      </header>
      <nav class="log-tabs" role="tablist" aria-label="Log source">
        <button role="tab" [attr.aria-selected]="view()==='runtime'" [class.active]="view()==='runtime'" (click)="selectView('runtime')">Runtime output <span>{{lines().length}}</span></button>
        <button role="tab" [attr.aria-selected]="view()==='diagnostics'" [class.active]="view()==='diagnostics'" (click)="selectView('diagnostics')">Application errors <span>{{diagnostics().length}}</span></button>
      </nav>
      @if(view()==='runtime') {
      <section class="log-overview"><div class="source-icon">≋</div><div class="source-copy"><div class="source-line"><h2>{{ source() || 'llama-server output' }}</h2><span class="source-state" [class.offline]="!loaded()">{{ loaded() ? 'PROCESS ACTIVE' : 'NO ACTIVE PROCESS' }}</span></div>
          <p>{{ loaded() ? 'The lines below are read verbatim from the active server process output.' : 'No active llama-server process is currently producing capturable output.' }}</p></div>
        <div class="snapshot"><span>CAPTURED LINES</span><b [title]="'Returned lines after applying the requested limit: ' + lines().length">{{ lines().length }}</b></div>
      </section>
      <div class="log-toolbar"><div class="toolbar-start"><span class="endpoint" title="Read-only log snapshot endpoint">GET /api/logs</span><label for="log-limit">MAX LINES</label>
          <select id="log-limit" title="Maximum number of recent raw lines requested from the backend" [value]="limit()" [disabled]="loading()" (change)="changeLimit($any($event.target).value)"><option value="50">50</option><option value="100">100</option><option value="200">200</option><option value="500">500</option><option value="1000">1000</option></select>
          <code title="Current request limit">limit={{ limit() }}</code></div>
        <label class="filter"><span aria-hidden="true">⌕</span><input type="search" aria-label="Filter log text" title="Filter the fetched lines by literal text; no level or subsystem is inferred" placeholder="Filter captured text" [value]="filterText()" (input)="filterText.set($any($event.target).value)"></label>
      </div>
      @if (error()) {<div class="error" role="alert"><span>!</span><span>{{ error() }}</span><button title="Retry loading recent runtime output" (click)="load()">Retry</button></div>}
      <section class="log-panel" aria-label="Captured runtime output" [attr.aria-busy]="loading()">
        <header class="log-panel-header"><span><i [class.active]="api.connected() && loaded()"></i>{{ loading() ? 'READING SNAPSHOT' : api.connected() ? loaded() ? 'LIVE PROCESS · SNAPSHOT' : 'WAITING FOR PROCESS' : 'API OFFLINE' }}</span><span [title]="source() ? 'Output source reported by the active runtime: ' + source() : 'No runtime log source is active'">{{ source() || 'NO SOURCE' }}</span></header>
        @if (loading() && !hasSnapshot()) {<div class="empty-state"><b>Reading local runtime output…</b><code>GET /api/logs?limit={{ limit() }}</code></div>}
        @else if (!lines().length && !loading()) {
          <div class="empty-state"><span>≋</span><b>{{ emptyTitle() }}</b><p>{{ emptyDescription() }}</p><code>GET /api/logs?limit={{ limit() }}</code></div>
        } @else if (!filteredLines().length) {
          <div class="empty-state"><b>No captured lines match this filter</b><p>Clear the text filter to see the fetched output.</p></div>
        } @else {
          <pre class="log-lines" aria-label="Raw llama-server log lines">@for (line of filteredLines(); track $index) {<span class="log-line">{{ line }}&#10;</span>}</pre>
        }
      </section>
      <footer class="source-note"><span>ⓘ</span><span>Raw process output is kept separate from application incident events.</span></footer>
      } @else {
        <section class="diagnostics-overview"><div><span>LOCAL INCIDENT STORE</span><b>{{diagnostics().length}}</b></div><p>Errors are timestamped and retained locally. Chat prompts and conversation text are not recorded.</p></section>
        <label class="filter diagnostic-filter"><span aria-hidden="true">⌕</span><input type="search" aria-label="Filter application errors" title="Filter by incident ID, operation, error type, or diagnostic detail" placeholder="Filter incident or error text" [value]="filterText()" (input)="filterText.set($any($event.target).value)"></label>
        @if (diagnosticsError()) {<div class="error" role="alert"><span>!</span><span>{{diagnosticsError()}}</span><button title="Retry loading application diagnostics" (click)="loadDiagnostics()">Retry</button></div>}
        <section class="diagnostics-list" aria-label="Local application errors" [attr.aria-busy]="diagnosticsLoading()">
          @if(diagnosticsLoading()&&!diagnostics().length){<div class="empty-state"><b>Reading local incident history…</b><code>GET /api/diagnostics</code></div>}
          @else if(!filteredDiagnostics().length){<div class="empty-state"><span>✓</span><b>{{diagnostics().length?'No incidents match this filter':'No application errors recorded'}}</b><p>{{diagnostics().length?'Clear the filter to see recorded errors.':'When Chat or a runtime action fails, its local diagnostic detail and incident ID will appear here.'}}</p><code>GET /api/diagnostics</code></div>}
          @else {@for(event of filteredDiagnostics();track event.incident_id){<article class="diagnostic-event" [attr.id]="'incident-' + event.incident_id"><header><span class="severity">ERROR</span><time>{{formatTimestamp(event.timestamp)}}</time><code>{{event.operation}} · {{event.error_type}}</code></header><p>{{event.detail}}</p><footer><span>Incident <code>{{event.incident_id}}</code></span>@if(event.chat_id){<span>Thread {{event.chat_id}}</span>}</footer></article>}}
        </section>
      }
    </section>`,
  styles: [`
    :host{display:block;color:var(--text,#e1e5f0)}.logs-page{max-width:1500px;margin:0 auto;padding:18px 20px 32px;display:grid;gap:14px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{font:500 10px/1.4 ui-monospace,monospace;color:#8b93a5}.page-heading h1{font-size:21px;line-height:1.25;margin:3px 0;font-weight:650}.page-heading p{font-size:12px;color:#9ba4b6;margin:0}.refresh{font:500 12px ui-monospace,monospace;color:#dce3f3;background:#252b38;border:1px solid #353d4d;border-radius:4px;padding:8px 10px;cursor:pointer}.refresh:disabled{opacity:.55;cursor:wait}.log-overview{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:13px;align-items:center;padding:15px;background:#1b202a;border:1px solid #2a303c;border-radius:5px}.source-icon{width:36px;height:36px;display:grid;place-items:center;background:#242c39;border-radius:4px;color:#adc6ff;font:600 19px ui-monospace,monospace}.source-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.source-line h2{font-size:14px;margin:0;font-weight:600}.source-state{font:500 9px ui-monospace,monospace;color:#4edea3;background:#18302b;padding:4px 6px;border-radius:2px}.source-state.offline{color:#e3c17d;background:#302b20}.source-copy p{font-size:10px;line-height:1.45;color:#929bad;margin:5px 0 0}.snapshot{min-width:100px;padding:8px 10px;background:#151a23;border-radius:3px}.snapshot span{display:block;color:#8992a4;font:500 8px ui-monospace,monospace}.snapshot b{display:block;margin-top:5px;color:#dce4f2;font:650 16px ui-monospace,monospace}.log-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 9px;background:#171c26;border:1px solid #292f3b}.toolbar-start{display:flex;align-items:center;gap:8px;min-width:0}.endpoint{font:500 10px ui-monospace,monospace;color:#adc6ff}.toolbar-start label{margin-left:9px;color:#929bad;font:500 8px ui-monospace,monospace}.toolbar-start select{height:26px;background:#0e131d;color:#dce3f2;border:1px solid #343c49;border-radius:3px;font:10px ui-monospace,monospace}.toolbar-start code{color:#929bad;font:9px ui-monospace,monospace}.filter{display:flex;align-items:center;gap:6px;min-width:190px;padding:5px 8px;background:#0e131d;border:1px solid #303744;border-radius:3px;color:#8792a4}.filter input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#dce3f2;font:10px ui-monospace,monospace}.filter input::placeholder{color:#707b8d}.log-panel{min-height:360px;background:#0b1019;border:1px solid #2a303b;border-radius:4px;overflow:hidden}.log-panel-header{height:34px;padding:0 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #292f3b;background:#141a24;color:#aab4c4;font:500 9px ui-monospace,monospace}.log-panel-header>span{display:flex;align-items:center;gap:7px}.log-panel-header i{width:6px;height:6px;border-radius:50%;background:#778295}.log-panel-header i.active{background:#4edea3}.log-lines{max-height:min(64vh,760px);overflow:auto;margin:0;padding:11px 14px;color:#c7d0df;font:10px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.log-line{color:inherit}.empty-state{min-height:290px;padding:25px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.empty-state>span{color:#adc6ff;font:18px ui-monospace,monospace}.empty-state>b{font-size:12px;color:#c6cedd;font-weight:550}.empty-state p{max-width:470px;font-size:10px;line-height:1.5;color:#8d97a8}.empty-state code{margin-top:8px;padding:6px 8px;border-radius:3px;background:#141a24;color:#9fb4dc;font:9px ui-monospace,monospace}.error{display:flex;align-items:center;gap:8px;padding:10px;background:#2a2024;border:1px solid #483036;color:#ffb4ab;font-size:10px}.error button{margin-left:auto;border:0;background:transparent;color:#ffcfcb;cursor:pointer}.source-note{display:flex;align-items:flex-start;gap:7px;color:#929bad;font-size:10px;padding:3px 2px}.source-note>span:first-child{color:#adc6ff}@media(max-width:700px){.log-toolbar{align-items:stretch;flex-direction:column}.toolbar-start{flex-wrap:wrap}.filter{min-width:0}.log-panel{min-height:300px}.empty-state{min-height:230px}}@media(max-width:520px){.logs-page{padding:14px 10px 24px}.page-heading{align-items:flex-start}.refresh span{display:none}.log-overview{grid-template-columns:32px 1fr;padding:11px;gap:9px}.source-icon{width:30px;height:30px}.snapshot{grid-column:1/-1}}
  `, `
    .log-tabs{display:flex;border-bottom:1px solid #303744;gap:4px}.log-tabs button{display:flex;align-items:center;gap:8px;padding:10px 13px;border:0;border-bottom:2px solid transparent;background:transparent;color:#8994a8;font:10px ui-monospace,monospace;cursor:pointer}.log-tabs button.active{border-color:#adc6ff;color:#dce7fb}.log-tabs button span{padding:2px 5px;border-radius:2px;background:#252c38;color:#9eabc0;font-size:9px}.diagnostics-overview{display:flex;align-items:center;gap:18px;padding:13px;background:#171d27;border:1px solid #2b333f}.diagnostics-overview>div{min-width:92px;padding-right:16px;border-right:1px solid #343c49}.diagnostics-overview>div span{display:block;color:#8994a8;font:8px ui-monospace,monospace}.diagnostics-overview>div b{display:block;margin-top:4px;color:#ffb4ab;font:600 18px ui-monospace,monospace}.diagnostics-overview p{margin:0;color:#a4adbc;font-size:10px;line-height:1.5}.diagnostic-filter{min-width:0;max-width:520px}.diagnostics-list{display:grid;gap:8px;min-height:220px}.diagnostic-event{padding:11px 13px;background:#171c25;border:1px solid #303744;border-left:2px solid #d57568}.diagnostic-event header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagnostic-event .severity{padding:3px 5px;background:#3a2527;color:#ffb4ab;font:8px ui-monospace,monospace}.diagnostic-event time,.diagnostic-event header code,.diagnostic-event footer{color:#929daf;font:9px ui-monospace,monospace}.diagnostic-event header code{overflow-wrap:anywhere}.diagnostic-event p{margin:9px 0;color:#d1d7e2;font:11px/1.55 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}.diagnostic-event footer{display:flex;gap:14px;flex-wrap:wrap}.diagnostic-event footer code{color:#adc6ff}.inspector-tab-link{height:100%;display:flex;align-items:center;color:#8995aa;text-decoration:none;border-bottom:2px solid transparent}.inspector-tab-link:hover{color:#c7d8fb;border-color:#adc6ff}@media(max-width:520px){.diagnostics-overview{align-items:flex-start;flex-direction:column;gap:8px}.diagnostics-overview>div{border:0}.diagnostic-event header{align-items:flex-start;flex-direction:column;gap:6px}}
  `]
})
export class LogsPage implements OnInit {
  readonly api = inject(ApiService);
  readonly view = signal<'runtime' | 'diagnostics'>(new URLSearchParams(window.location.search).get('view') === 'diagnostics' ? 'diagnostics' : 'runtime');
  readonly lines = signal<string[]>([]);
  readonly diagnostics = signal<DiagnosticEvent[]>([]);
  readonly source = signal<string | null>(null);
  readonly supported = signal(false);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly diagnosticsError = signal('');
  readonly diagnosticsLoading = signal(false);
  readonly hasSnapshot = signal(false);
  readonly limit = signal(200);
  readonly filterText = signal(new URLSearchParams(window.location.search).get('incident') || '');
  readonly filteredLines = computed(() => {
    const query = this.filterText().trim().toLowerCase();
    return query ? this.lines().filter(line => line.toLowerCase().includes(query)) : this.lines();
  });
  readonly filteredDiagnostics = computed(() => {
    const query = this.filterText().trim().toLowerCase();
    return query ? this.diagnostics().filter(event =>
      `${event.incident_id} ${event.operation} ${event.error_type} ${event.detail}`.toLowerCase().includes(query)) : this.diagnostics();
  });

  ngOnInit() { void this.load(); void this.loadDiagnostics(); }
  selectView(view: 'runtime' | 'diagnostics') { this.view.set(view); }
  formatTimestamp(value: string) {
    const time = new Date(value);
    return Number.isNaN(time.valueOf()) ? value : time.toLocaleString();
  }
  async loadDiagnostics() {
    this.diagnosticsLoading.set(true); this.diagnosticsError.set('');
    try {
      const response = await this.api.request<{data: {events: DiagnosticEvent[]}}>(`/api/diagnostics?limit=${this.limit()}`);
      this.diagnostics.set(Array.isArray(response.data.events) ? response.data.events : []);
    } catch (error) {
      this.diagnosticsError.set(error instanceof Error ? error.message : 'Could not read local diagnostics');
      this.diagnostics.set([]);
    } finally { this.diagnosticsLoading.set(false); }
  }
  async load() {
    this.loading.set(true); this.error.set('');
    try {
      const response = await this.api.request<LogsResponse>(`/api/logs?limit=${this.limit()}`);
      this.lines.set(response.data.lines || []); this.source.set(response.data.source);
      this.supported.set(response.data.supported); this.loaded.set(response.data.loaded);
      this.hasSnapshot.set(true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read local runtime output');
      this.lines.set([]); this.source.set(null); this.supported.set(false); this.loaded.set(false);
    } finally { this.loading.set(false); }
  }
  changeLimit(value: string) { const limit = Number(value); if ([50, 100, 200, 500, 1000].includes(limit)) { this.limit.set(limit); void this.load(); } }
  emptyTitle() {
    if (!this.api.connected()) return 'Local API is unavailable';
    if (!this.supported()) return 'This runtime does not expose captured server output';
    if (!this.loaded()) return 'No active llama-server process';
    return 'No output lines captured yet';
  }
  emptyDescription() {
    if (!this.api.connected()) return 'Reconnect to the local AI Dream API to request a log snapshot.';
    if (!this.supported()) return 'Only runtime backends that provide a bounded log snapshot can appear here.';
    if (!this.loaded()) return 'Load a model with llama.cpp to start a server process and capture its real output.';
    return 'The server is active, but its output log is currently empty.';
  }
}
