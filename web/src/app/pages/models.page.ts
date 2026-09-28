import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ModelSourcesService } from '../core/model-sources.service';
import { ModelRecord, ModelSource } from '../core/control-plane.types';
import { RuntimeService } from '../core/runtime.service';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <div><div class="eyebrow">LIBRARY</div><h1>Models</h1>
        <p>Manage model folders and inspect the GGUF files in your local catalog.</p></div>
      <button class="secondary-button" (click)="rescan()" [disabled]="busy()" aria-label="Rescan model folders">
        {{ rescanning() ? 'Scanning…' : '↻ Rescan' }}
      </button>
    </header>

    @if (error()) { <div class="notice error" role="alert">{{ error() }}</div> }
    @if (notice()) { <div class="notice success" role="status">{{ notice() }}</div> }

    <section class="surface add-source" aria-labelledby="add-source-title">
      <div><h2 id="add-source-title">Add a model folder</h2>
        <p>Enter an existing local directory path. AI Dream will scan it for GGUF models.</p></div>
      <form (submit)="addSource($event)">
        <label class="sr-only" for="source-path">Model folder path</label>
        <input id="source-path" type="text" autocomplete="off" placeholder="/path/to/models"
          [value]="pathInput()" (input)="pathInput.set($any($event.target).value)" [disabled]="busy()">
        <button class="primary-button" [disabled]="busy() || !pathInput().trim()">{{ adding() ? 'Adding…' : 'Add folder' }}</button>
      </form>
    </section>

    <div class="library-layout">
      <section class="surface sources" aria-labelledby="sources-title">
        <div class="section-heading"><div><div class="eyebrow">CATALOG</div><h2 id="sources-title">Model folders</h2></div>
          <span class="count">{{ sources().length }}</span></div>
        @if (loading()) { <p class="muted" aria-live="polite">Loading model folders…</p> }
        @else if (!sources().length) { <div class="empty"><b>No model folders yet</b><span>Add a folder above to find local GGUF files.</span></div> }
        @else {
          <ul class="source-list">
            @for (source of sources(); track source.id) {
              <li><button class="source-item" [class.selected]="selectedId() === source.id" (click)="select(source)"
                  [attr.aria-current]="selectedId() === source.id ? 'true' : null">
                <span class="folder-icon" aria-hidden="true">▰</span><span class="source-copy"><b>{{ source.path }}</b>
                  <small>{{ source.exists ? (source.model_count + ' models · ' + size(source.total_bytes)) : 'Folder unavailable' }}</small></span>
                <span class="arrow" aria-hidden="true">›</span>
              </button></li>
            }
          </ul>
        }
      </section>

      <section class="surface details" aria-labelledby="models-title">
        @if (selected(); as source) {
          <div class="detail-head"><div><div class="eyebrow">FOLDER DETAILS</div><h2>{{ source.path }}</h2>
            <p>{{ source.readable ? 'Readable' : 'Not readable' }} · {{ source.managed ? 'Managed by AI Dream' : 'External folder' }}</p></div>
            <button class="danger-button" (click)="removeSource(source)" [disabled]="busy()">Remove from catalog</button>
          </div>
          <div class="summary" aria-label="Folder summary"><div><b>{{ source.model_count }}</b><span>models</span></div><div><b>{{ size(source.total_bytes) }}</b><span>total size</span></div><div><b>{{ source.exists ? 'Available' : 'Missing' }}</b><span>folder status</span></div></div>
          <div class="section-heading model-heading"><div><div class="eyebrow">LOCAL FILES</div><h2 id="models-title">Models in this folder</h2></div><span class="count">{{ visibleModels().length }}</span></div>
          @if (!source.exists || !source.readable) { <div class="empty"><b>Folder cannot be scanned</b><span>Check that this directory exists and is readable.</span></div> }
          @else if (loading()) { <p class="muted" aria-live="polite">Loading model catalog…</p> }
          @else if (!visibleModels().length) { <div class="empty"><b>No GGUF models found</b><span>Rescan after adding files to this folder.</span></div> }
          @else {
            <ul class="model-list">
              @for (model of visibleModels(); track model.id) {
                <li><article class="model-card" [class.model-selected]="selectedModelId() === model.id"><span class="model-icon" aria-hidden="true">⬡</span><div class="model-copy">
                  <h3>{{ modelName(model) }}</h3><p>{{ model.path }}</p><div class="model-tags"><span>{{ model.format || 'GGUF' }}</span><span>{{ size(model.size) }}</span>
                    @if (model.metadata['general.architecture']; as architecture) { <span>{{ architecture }}</span> }
                    @if (model.metadata['general.file_type']; as quant) { <span>{{ quant }}</span> }
                  </div>
                  <details><summary>Model metadata</summary><dl>@for (entry of metadataEntries(model); track entry[0]) {<dt>{{ entry[0] }}</dt><dd>{{ display(entry[1]) }}</dd>}</dl></details>
                  <button class="secondary-button" (click)="selectModel(model)" [attr.aria-pressed]="selectedModelId() === model.id">{{ selectedModelId() === model.id ? 'Selected for loading' : 'Select model' }}</button>
                </div></article></li>
              }
            </ul>
          }
          @if (selectedModel(); as model) {
            <section class="load-panel" aria-label="Model runtime actions">
              <div><div class="eyebrow">MODEL ACTIONS</div><b>{{ modelName(model) }}</b><small>{{ model.path }}</small></div>
              <div class="load-actions">
                <button class="primary-button" (click)="loadModel()" [disabled]="runtimeBusy()">{{ runtimeBusy() ? 'Loading…' : 'Load model' }}</button>
                <button class="secondary-button" (click)="reloadModel()" [disabled]="runtimeBusy()">Reload model</button>
                <button class="secondary-button" (click)="unloadModel()" [disabled]="runtimeBusy()">Unload model</button>
                <button class="secondary-button" (click)="refreshRuntimeStatus()" [disabled]="runtimeBusy()">Runtime status</button>
              </div>
              @if (runtimeStatus()) { <pre class="runtime-status" role="status">{{ runtimeStatus() }}</pre> }
              <a href="#/runtime">Configure runtime options</a>
            </section>
          }
        } @else {
          <div class="empty large"><span class="empty-icon" aria-hidden="true">⬡</span><b>Select a model folder</b><span>Folder details and discovered models will appear here.</span></div>
        }
      </section>
    </div>
  `,
  styles: [`
    :host{display:block}.page-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.page-head h1{margin:4px 0;font-size:30px}.page-head p,.add-source p,.detail-head p{margin:5px 0;color:var(--muted,#929baa)}
    .eyebrow{font-size:10px;letter-spacing:.14em;font-weight:700;color:var(--muted,#929baa)}h2{font-size:17px;margin:5px 0}.surface{background:var(--surface,#171a20);border:1px solid var(--border,#292d35);border-radius:12px;padding:18px}.add-source{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px}.add-source form{display:flex;gap:8px;width:min(620px,58%)}input{flex:1;min-width:120px;background:var(--bg,#101216);border:1px solid var(--border,#353943);border-radius:7px;padding:10px 12px;color:inherit;font:inherit}.primary-button,.secondary-button,.danger-button{border:1px solid var(--border,#353943);border-radius:7px;padding:9px 12px;color:inherit;background:var(--surface,#171a20);font:inherit;font-weight:600;cursor:pointer}.primary-button{background:var(--accent,#8b72ff);border-color:transparent;color:#fff}.danger-button{color:#ff9696}.primary-button:disabled,.secondary-button:disabled,.danger-button:disabled{opacity:.55;cursor:wait}.library-layout{display:grid;grid-template-columns:minmax(250px,.8fr) minmax(0,1.7fr);gap:16px;align-items:start}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.count{font-size:12px;background:var(--bg,#101216);border-radius:20px;padding:4px 9px;color:var(--muted,#929baa)}.source-list,.model-list{list-style:none;padding:0;margin:0}.source-list li+li,.model-list li+li{border-top:1px solid var(--border,#292d35)}.source-item{display:flex;align-items:center;gap:10px;width:100%;padding:12px 8px;text-align:left;border:0;background:transparent;color:inherit;border-radius:8px;cursor:pointer}.source-item.selected{background:color-mix(in srgb,var(--accent,#8b72ff) 15%,transparent)}.folder-icon{color:var(--accent,#a28eff)}.source-copy{min-width:0;flex:1}.source-copy b,.source-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-copy b{font-size:12px}.source-copy small,.arrow,.muted{color:var(--muted,#929baa);font-size:12px;margin-top:4px}.arrow{font-size:22px}.detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.detail-head h2{overflow-wrap:anywhere}.summary{display:flex;gap:26px;padding:14px 0;border-bottom:1px solid var(--border,#292d35);margin:8px 0 16px}.summary div{display:grid;gap:3px}.summary b{font-size:16px}.summary span{font-size:11px;color:var(--muted,#929baa)}.model-heading{margin-top:8px}.model-card{display:flex;gap:12px;padding:14px 4px}.model-icon{color:var(--accent,#a28eff);font-size:19px}.model-copy{min-width:0;flex:1}.model-copy h3{margin:0;font-size:14px}.model-copy p{font-size:11px;color:var(--muted,#929baa);overflow-wrap:anywhere;margin:4px 0 8px}.model-tags{display:flex;flex-wrap:wrap;gap:6px}.model-tags span{font-size:10px;padding:4px 7px;border-radius:12px;background:var(--bg,#101216);color:var(--muted,#c0c4ce)}details{margin-top:9px;font-size:11px}summary{cursor:pointer;color:var(--muted,#aeb4c0)}dl{display:grid;grid-template-columns:minmax(130px,.6fr) minmax(0,1fr);gap:5px 12px}dt{color:var(--muted,#929baa);overflow-wrap:anywhere}dd{margin:0;overflow-wrap:anywhere}.empty{padding:30px 12px;text-align:center;display:grid;gap:7px;color:var(--muted,#929baa);font-size:12px}.empty b{color:var(--text,#e8eaf0);font-size:14px}.empty.large{min-height:260px;place-content:center}.empty-icon{font-size:30px;color:var(--accent,#a28eff)}.notice{padding:11px 14px;border-radius:8px;margin-bottom:14px;font-size:13px}.error{background:#3a2024;color:#ffb4bb}.success{background:#1d382c;color:#9be0b5}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:820px){.library-layout{grid-template-columns:1fr}.add-source{align-items:stretch;flex-direction:column}.add-source form{width:100%}.page-head{align-items:flex-start}.detail-head{flex-direction:column}}
    .model-selected{background:color-mix(in srgb,var(--accent,#8b72ff) 8%,transparent)}.load-panel{display:grid;gap:12px;margin-top:20px;padding:14px;border:1px solid var(--border,#292d35);border-radius:9px;background:var(--bg,#101216)}.load-panel>div:first-child{display:grid;gap:5px;min-width:0}.load-panel small{overflow-wrap:anywhere;color:var(--muted,#929baa)}.load-actions{display:flex;flex-wrap:wrap;gap:8px}.load-panel a{font-size:12px;color:var(--accent,#a28eff)}.runtime-status{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;border-radius:7px;background:var(--surface,#171a20);font-size:11px}`]
})
export class ModelsPage implements OnInit {
  readonly sources = signal<ModelSource[]>([]);
  readonly models = signal<ModelRecord[]>([]);
  readonly selectedId = signal('');
  readonly pathInput = signal('');
  readonly loading = signal(false);
  readonly adding = signal(false);
  readonly rescanning = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly selectedModelId = signal('');
  readonly runtimeBusy = signal(false);
  readonly runtimeStatus = signal('');

  constructor(private readonly library: ModelSourcesService, private readonly runtime: RuntimeService) {}

  ngOnInit(): void { void this.refresh(); }

  selected(): ModelSource | undefined { return this.sources().find(source => source.id === this.selectedId()); }
  visibleModels(): ModelRecord[] {
    const source = this.selected();
    if (!source) return [];
    const prefix = source.path.replace(/[\\/]$/, '') + '/';
    return this.models().filter(model => model.path === source.path || model.path.startsWith(prefix));
  }

  select(source: ModelSource): void { this.selectedId.set(source.id); this.error.set(''); this.notice.set(''); }
  selectedModel(): ModelRecord | undefined {
    const id = this.selectedModelId();
    return this.visibleModels().find(model => model.id === id);
  }
  selectModel(model: ModelRecord): void { this.selectedModelId.set(model.id); this.runtimeStatus.set(''); this.error.set(''); }

  async loadModel(): Promise<void> {
    const model = this.selectedModel(); if (!model) return;
    await this.runRuntimeAction('Loading model…', () => this.runtime.load({ model_id: model.id }));
  }
  async reloadModel(): Promise<void> { await this.loadModel(); }
  async unloadModel(): Promise<void> { await this.runRuntimeAction('Unloading model…', () => this.runtime.unload()); }
  async refreshRuntimeStatus(): Promise<void> { await this.runRuntimeAction('', () => this.runtime.status()); }
  private async runRuntimeAction(startMessage: string, action: () => Promise<unknown>): Promise<void> {
    this.runtimeBusy.set(true); this.error.set(''); this.notice.set(startMessage);
    try {
      const result = await action(); this.runtimeStatus.set(JSON.stringify(result, null, 2));
      this.notice.set(startMessage ? (startMessage.startsWith('Loading') ? 'Model loaded.' : 'Model unloaded.') : 'Runtime status updated.');
    } catch (error) { this.notice.set(''); this.error.set(errorMessage(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  async refresh(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [sources, models] = await Promise.all([this.library.list(), this.library.models()]);
      this.sources.set(sources); this.models.set(models);
      if (!sources.some(source => source.id === this.selectedId())) this.selectedId.set(sources[0]?.id || '');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loading.set(false); }
  }

  async addSource(event: Event): Promise<void> {
    event.preventDefault(); const path = this.pathInput().trim(); if (!path) return;
    this.adding.set(true); this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const source = await this.library.add(path);
      this.pathInput.set('');
      await this.refresh(); this.selectedId.set(source.id);
      this.notice.set('Model folder added to the catalog.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.adding.set(false); this.busy.set(false); }
  }

  async removeSource(source: ModelSource): Promise<void> {
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      await this.library.remove(source.id);
      this.selectedId.set(''); await this.refresh();
      this.notice.set('Folder removed from the catalog. Files on disk were not deleted.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async rescan(): Promise<void> {
    this.rescanning.set(true); this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      this.models.set(await this.library.rescan());
      this.sources.set(await this.library.list());
      this.notice.set(`Scan complete. ${this.models().length} model${this.models().length === 1 ? '' : 's'} found.`);
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.rescanning.set(false); this.busy.set(false); }
  }

  modelName(model: ModelRecord): string {
    const file = model.path.split(/[\\/]/).pop();
    return String(model.metadata?.['general.name'] || file || model.id);
  }
  metadataEntries(model: ModelRecord): [string, unknown][] { return Object.entries(model.metadata || {}).sort(([a], [b]) => a.localeCompare(b)); }
  display(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }
  size(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
    if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The model catalog request failed.'; }
