import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';

interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, string>;
  read_only: boolean;
}
interface ToolCatalogResponse {
  data: {
    tools: AgentTool[];
    limits: { max_tool_calls: number; max_seconds: number; max_output_chars: number };
    policy: { filesystem_write: boolean; shell: boolean; network_tools: boolean };
  };
}

@Component({
  selector: 'ai-tools-permissions-page', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tools-page">
      <header class="page-heading"><div><div class="eyebrow">DEVELOPER / AGENT POLICY</div><h1>Tools &amp; Permissions</h1><p>Capabilities exposed to the local agent, read from its active registry.</p></div>
        <button class="refresh" title="Fetch the currently registered read-only tools and enforced per-turn limits" (click)="load()" [disabled]="loading()">↻ <span>Refresh registry</span></button></header>
      <section class="policy-banner"><div class="shield">◇</div><div class="banner-copy"><div class="banner-title"><h2>Read-only tool boundary</h2><span class="state-pill" [class.offline]="error()">{{ error() ? 'REGISTRY UNAVAILABLE' : loading() ? 'LOADING' : tools().length + ' REGISTERED' }}</span></div>
          <p>Agent tools are allow-listed queries into local hardware, model catalog, and runtime status. There are no shell, filesystem-write, or network tools.</p></div>
        <div class="policy-totals"><div><b>{{ readOnlyCount() }}</b><span>READ-ONLY</span></div><div><b>{{ limits()?.max_tool_calls ?? '—' }}</b><span>CALLS / TURN</span></div><div><b>{{ limits()?.max_seconds ?? '—' }}s</b><span>TIME LIMIT</span></div></div>
      </section>
      @if (error()) {<div class="load-error"><span>!</span><span>{{ error() }}</span><button title="Retry reading GET /api/agent/tools" (click)="load()">Retry</button></div>}
      @if (loading() && tools().length === 0) {<div class="loading">Reading <code>GET /api/agent/tools</code>…</div>}
      @if (!loading() && !error() && tools().length === 0) {<div class="loading">The API returned no registered agent tools.</div>}
      <div class="tools-grid">
        @for (group of groups(); track group.key) {
          <section class="group-panel"><header class="group-heading"><div><span class="group-icon">{{ group.icon }}</span><h2>{{ group.label }}</h2></div><span class="count">{{ group.tools.length }} TOOLS</span></header>
            <p class="group-description">{{ group.description }}</p>
            @for (tool of group.tools; track tool.name) {
              <article class="tool-row"><div class="tool-title"><div><b [title]="tool.description">{{ tool.name }}</b><span class="readonly" title="The backend registry marks this capability as read-only">READ ONLY</span></div><span class="enabled" title="This tool is present in the active backend registry">REGISTERED</span></div>
                <p>{{ tool.description }}</p><div class="tool-meta"><span title="This tool queries local state without modifying it">Access: <b>Read-only</b></span><span [title]="parameterSummary(tool)">{{ parameterSummary(tool) }}</span></div>
              </article>
            }
          </section>
        }
      </div>
      <section class="permissions-grid">
        <div class="panel denied"><header><span>×</span><h2>Not available to the agent</h2></header>
          <div class="deny-row"><span title="No registered tool runs arbitrary operating-system commands">Arbitrary shell commands</span><b [title]="policy()?.shell ? 'Agent shell tools are enabled' : 'The fixed registry exposes no shell operation'">{{ policy()?.shell ? 'ENABLED' : 'BLOCKED' }}</b></div>
          <div class="deny-row"><span title="The registry has no file creation, modification, or deletion operation">Filesystem writes / deletion</span><b [title]="policy()?.filesystem_write ? 'Agent write tools are enabled' : 'No filesystem write tool is registered'">{{ policy()?.filesystem_write ? 'ENABLED' : 'BLOCKED' }}</b></div>
          <div class="deny-row"><span title="No network-fetch or browser action is exposed as an agent tool">Network tools</span><b [title]="policy()?.network_tools ? 'Agent network tools are enabled' : 'No network tool is registered'">{{ policy()?.network_tools ? 'ENABLED' : 'BLOCKED' }}</b></div>
          <p>These are enforced by the fixed registry. This screen is informational; it does not offer fake permission toggles.</p>
        </div>
        <div class="panel constraints"><header><span>◎</span><h2>Per-turn limits</h2></header>
          <div class="limit-row"><span title="Maximum registered tool invocations during one agent turn">Tool calls</span><b [title]="'Maximum tool calls in one turn: ' + limits()?.max_tool_calls">{{ limits()?.max_tool_calls ?? '—' }} max</b></div>
          <div class="limit-row"><span title="Wall-clock ceiling for a single agent turn">Execution time</span><b [title]="'Maximum execution time in seconds: ' + limits()?.max_seconds">{{ limits()?.max_seconds ?? '—' }} seconds</b></div>
          <div class="limit-row"><span title="Maximum assistant response length returned by the agent">Assistant output</span><b [title]="'Maximum output characters: ' + limits()?.max_output_chars">{{ limits()?.max_output_chars ?? '—' }} chars</b></div>
          <small>Limits are applied by the agent runtime for each turn.</small>
        </div>
      </section>
      <footer class="source-note"><span>ⓘ</span><span>Registry source: <code>GET /api/agent/tools</code>. Tool names, descriptions, parameters, and limits are returned by the backend.</span></footer>
    </section>`,
  styles: [`
    :host{display:block;color:var(--text,#e1e5f0)}.tools-page{max-width:1500px;margin:0 auto;padding:18px 20px 32px;display:grid;gap:14px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{font:500 10px/1.4 ui-monospace,monospace;color:#8b93a5}.page-heading h1{font-size:21px;line-height:1.25;margin:3px 0;font-weight:650}.page-heading p{font-size:12px;color:#9ba4b6;margin:0}.refresh{font:500 12px ui-monospace,monospace;color:#dce3f3;background:#252b38;border:1px solid #353d4d;border-radius:4px;padding:8px 10px;cursor:pointer}.refresh:disabled{opacity:.55;cursor:wait}.policy-banner{display:grid;grid-template-columns:40px minmax(250px,1fr) auto;align-items:center;gap:14px;padding:15px;background:#1b202a;border:1px solid #2a303c;border-radius:5px}.shield{width:36px;height:36px;display:grid;place-items:center;background:#1d302d;color:#4edea3;border-radius:4px;font-size:23px}.banner-title{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.banner-title h2{font-size:15px;margin:0;font-weight:620}.state-pill{font:500 9px ui-monospace,monospace;color:#4edea3;background:#17312c;padding:4px 6px;border-radius:2px}.state-pill.offline{color:#ffb4ab;background:#382628}.banner-copy>p{font-size:11px;line-height:1.5;color:#a1a9b9;margin:6px 0 0}.policy-totals{display:flex;gap:6px}.policy-totals>div{background:#151a23;padding:8px 10px;min-width:80px;border-radius:3px}.policy-totals b{display:block;font:650 16px ui-monospace,monospace;color:#e2e7f2}.policy-totals span{display:block;font:500 8px ui-monospace,monospace;color:#8b94a5;margin-top:4px}.tools-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.group-panel,.panel{background:#1b202a;border:1px solid #292f3b;border-radius:4px;padding:13px;min-width:0}.group-heading,.panel header{display:flex;align-items:center;justify-content:space-between;gap:10px}.group-heading>div,.panel header{display:flex;align-items:center;gap:8px}.group-icon{font:600 17px ui-monospace,monospace;color:#adc6ff}.group-heading h2,.panel h2{font-size:13px;margin:0;font-weight:600}.count{font:500 9px ui-monospace,monospace;color:#4edea3}.group-description{font-size:10px;color:#929bad;line-height:1.4;margin:7px 0 10px}.tool-row{background:#151a23;border:1px solid #252c38;border-radius:3px;padding:10px;margin-top:7px}.tool-title{display:flex;justify-content:space-between;gap:8px;align-items:center}.tool-title>div{display:flex;gap:7px;align-items:center;min-width:0;flex-wrap:wrap}.tool-title b{font:600 11px ui-monospace,monospace;color:#e0e6f2;overflow-wrap:anywhere}.readonly,.enabled{font:500 8px ui-monospace,monospace;padding:3px 5px;border-radius:2px;color:#4edea3;background:#1a2c2a;white-space:nowrap}.enabled{color:#b6c9ff;background:#222b3c}.tool-row>p{font-size:10px;color:#a0a8b7;line-height:1.45;margin:7px 0}.tool-meta{display:flex;justify-content:space-between;gap:10px;padding-top:7px;border-top:1px solid #272e39;font:9px ui-monospace,monospace;color:#8e97a7}.tool-meta b{font-weight:500;color:#4edea3}.permissions-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.panel header{justify-content:flex-start;margin-bottom:9px}.panel header>span{font:600 16px ui-monospace,monospace;color:#ffb4ab}.constraints header>span{color:#adc6ff}.deny-row,.limit-row{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;border-top:1px solid #2a303b;font-size:10px;color:#c3cad8}.deny-row b{font:500 9px ui-monospace,monospace;color:#ffb4ab}.limit-row b{font:500 10px ui-monospace,monospace;color:#d8e2ff}.panel>p,.constraints>small{display:block;font-size:9px;color:#8f98aa;line-height:1.5;margin:10px 0 0}.source-note{display:flex;align-items:flex-start;gap:7px;color:#929bad;font-size:10px;padding:3px 2px}.source-note>span:first-child{color:#adc6ff}.source-note code{font:10px ui-monospace,monospace;color:#cad5ec}.load-error,.loading{padding:12px;background:#1b202a;border:1px solid #303745;color:#b9c1d1;font-size:11px}.load-error{display:flex;gap:10px;align-items:center}.load-error>span:first-child{color:#ffb4ab}.load-error button{margin-left:auto;background:none;border:0;color:#adc6ff;cursor:pointer}.loading code{color:#c4d2f2}@media(max-width:850px){.policy-banner{grid-template-columns:40px 1fr}.policy-totals{grid-column:2;flex-wrap:wrap}.tools-grid{grid-template-columns:1fr}}@media(max-width:560px){.tools-page{padding:14px 10px 24px}.page-heading{align-items:flex-start}.refresh span{display:none}.policy-banner{grid-template-columns:32px minmax(0,1fr);gap:9px;padding:11px}.shield{width:30px;height:30px}.policy-totals{grid-column:1/-1}.policy-totals>div{flex:1;min-width:65px;padding:7px}.permissions-grid{grid-template-columns:1fr}.tool-meta{flex-wrap:wrap}}
  `]
})
export class ToolsPermissionsPage implements OnInit {
  readonly api = inject(ApiService);
  readonly tools = signal<AgentTool[]>([]);
  readonly limits = signal<ToolCatalogResponse['data']['limits'] | null>(null);
  readonly policy = signal<ToolCatalogResponse['data']['policy'] | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly readOnlyCount = computed(() => this.tools().filter(tool => tool.read_only).length);
  readonly groups = computed(() => {
    const groups = new Map<string, AgentTool[]>();
    for (const tool of this.tools()) {
      const key = tool.name.split('.', 1)[0] || 'other';
      groups.set(key, [...(groups.get(key) || []), tool]);
    }
    const metadata: Record<string, { label: string; description: string; icon: string }> = {
      hardware: { label: 'System & Hardware', description: 'Read-only hardware diagnostics from the local detector.', icon: '▦' },
      models: { label: 'Local Model Catalog', description: 'Queries against models already present in configured local folders.', icon: '⬡' },
      runtime: { label: 'Runtime Status', description: 'Runtime installation and backend capability information.', icon: '⌘' },
    };
    return [...groups].map(([key, tools]) => ({ key, tools,
      ...(metadata[key] || { label: key, description: 'Read-only registry queries.', icon: '◇' }) }));
  });

  ngOnInit() { void this.load(); }
  async load() {
    this.loading.set(true); this.error.set('');
    try {
      const response = await this.api.request<ToolCatalogResponse>('/api/agent/tools');
      this.tools.set(response.data.tools || []); this.limits.set(response.data.limits); this.policy.set(response.data.policy);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read the local agent registry');
      this.tools.set([]); this.limits.set(null); this.policy.set(null);
    } finally { this.loading.set(false); }
  }
  parameterSummary(tool: AgentTool) {
    const entries = Object.entries(tool.parameters || {});
    return entries.length ? `Inputs: ${entries.map(([key, type]) => `${key}: ${type}`).join(', ')}` : 'No arguments';
  }
}
