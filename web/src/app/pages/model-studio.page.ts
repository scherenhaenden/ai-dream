import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ModelProfilesService } from '../core/model-profiles.service';
import { ModelSourcesService } from '../core/model-sources.service';
import {
  ModelProfile, ModelRecord, ModelSource, RuntimeCapabilities, RuntimeDevice,
  RuntimeInstallation, RuntimeLoadOptions, RuntimePlacement,
} from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService } from '../core/runtime.service';

type SettingsTab = 'placement' | 'load';
type NumberLoadKey = 'context_size' | 'threads' | 'batch_size' | 'physical_batch_size' | 'max_concurrent' | 'threads_batch';
type BoolLoadKey = 'continuous_batching' | 'flash_attention' | 'unified_kv_cache' | 'offload_kv_cache' | 'mmap' | 'keep_model_in_memory' | 'fit';
type StringLoadKey = 'numa' | 'kv_cache_type_k' | 'kv_cache_type_v';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <div>
        <div class="eyebrow">LOCAL MODELS</div>
        <h1>Models</h1>
        <p>Select a model and configure everything it needs right there. Profiles are optional presets, not a separate loading workflow.</p>
      </div>
      <button class="secondary" (click)="rescan()" [disabled]="busy()">{{ rescanning() ? 'Scanning…' : '↻ Rescan' }}</button>
    </header>

    @if (error()) { <div class="notice error" role="alert">{{ error() }}</div> }
    @if (notice()) { <div class="notice success" role="status">{{ notice() }}</div> }

    <section class="surface source-bar">
      <div>
        <b>Model folders</b>
        <small>{{ sources().length }} configured · {{ models().length }} models discovered</small>
      </div>
      <form (submit)="addSource($event)">
        <input aria-label="Model folder path" placeholder="/home/you/models" [value]="pathInput()"
          (input)="pathInput.set($any($event.target).value)" [disabled]="busy()">
        <button class="secondary" [disabled]="busy() || !pathInput().trim()">Add folder</button>
      </form>
    </section>

    @if (loading()) {
      <section class="surface empty">Loading local models…</section>
    } @else if (!models().length) {
      <section class="surface empty"><b>No local models found</b><span>Add a GGUF folder above and rescan.</span></section>
    } @else {
      <section class="model-grid" aria-label="Local models">
        @for (model of models(); track model.id) {
          <article class="model-card" [class.open]="selectedModelId() === model.id" [class.loaded]="isLoaded(model)">
            <button class="model-summary" (click)="toggleModel(model)" [attr.aria-expanded]="selectedModelId() === model.id">
              <span class="model-icon">⬡</span>
              <span class="model-main">
                <span class="model-title">{{ modelName(model) }}</span>
                <span class="model-path">{{ model.path }}</span>
                <span class="tags">
                  <span>{{ (model.format || 'GGUF').toUpperCase() }}</span>
                  <span>{{ size(model.size) }}</span>
                  @if (model.metadata['general.architecture']; as architecture) { <span>{{ architecture }}</span> }
                  @if (isLoaded(model)) { <span class="loaded-tag">● LOADED</span> }
                </span>
              </span>
              <span class="chevron">{{ selectedModelId() === model.id ? '⌃' : '⌄' }}</span>
            </button>

            @if (selectedModelId() === model.id) {
              <div class="model-config">
                <div class="config-head">
                  <div><div class="eyebrow">MODEL CONFIGURATION</div><h2>{{ modelName(model) }}</h2></div>
                  <div class="runtime-state" [class.active]="isLoaded(model)">{{ isLoaded(model) ? 'Loaded in memory' : 'Not loaded' }}</div>
                </div>

                <div class="quick-actions">
                  <button class="primary" (click)="loadModel(model)" [disabled]="runtimeBusy() || !configurationValid()">
                    {{ runtimeBusy() ? 'Working…' : (isLoaded(model) ? 'Reload model' : 'Load model') }}
                  </button>
                  <button class="secondary" (click)="unloadModel()" [disabled]="runtimeBusy() || !loadedModelPath()">Unload current model</button>
                  <button class="secondary" (click)="refreshRuntimeStatus()" [disabled]="runtimeBusy()">Refresh status</button>
                </div>

                <section class="preset-box">
                  <div class="preset-heading">
                    <div><b>Configuration preset</b><small>Optional. Loading a model does not require a preset.</small></div>
                    <button class="text-button" (click)="resetConfiguration()">Reset to runtime defaults</button>
                  </div>
                  <div class="form-grid compact">
                    <label>Saved preset
                      <select [value]="selectedProfileId()" (change)="applyProfile($any($event.target).value)">
                        <option value="">Runtime defaults / custom</option>
                        @for (profile of profiles(); track profile.id) { <option [value]="profile.id">{{ profile.name }}</option> }
                      </select>
                    </label>
                    <label>Preset name
                      <input [value]="profileName()" (input)="profileName.set($any($event.target).value)" placeholder="e.g. 2× GPU / 18K context">
                    </label>
                    <div class="preset-actions">
                      <button class="secondary" (click)="saveProfile(model)" [disabled]="profileBusy() || !profileName().trim() || !configurationValid()">
                        {{ profileBusy() ? 'Saving…' : (selectedProfileId() ? 'Update preset' : 'Save as preset') }}
                      </button>
                      @if (selectedProfileId()) { <button class="danger" (click)="deleteProfile()" [disabled]="profileBusy()">Delete</button> }
                    </div>
                  </div>
                </section>

                <div class="form-grid">
                  <label>Backend
                    <select [value]="backendName()" (change)="changeBackend($any($event.target).value)">
                      <option value="">Automatic</option>
                      @for (backend of backends(); track backend.name) {
                        <option [value]="backend.name" [disabled]="!backend.available">{{ backend.name }}{{ backend.available ? '' : ' · unavailable' }}</option>
                      }
                    </select>
                  </label>
                  <label>Runtime installation
                    <select [value]="runtimeId()" (change)="changeRuntime($any($event.target).value)">
                      <option value="">Automatic</option>
                      @for (runtime of matchingInstallations(); track runtime.id) {
                        <option [value]="runtime.id" [disabled]="!runtime.enabled || !runtime.available">{{ runtime.name }} · {{ runtime.backend || runtime.kind }}</option>
                      }
                    </select>
                  </label>
                </div>

                @if (capabilities(); as caps) {
                  <p class="capability-note">{{ caps.details || 'Runtime capabilities detected from the selected backend.' }}</p>
                }

                <nav class="tabs" role="tablist" aria-label="Model configuration sections">
                  <button role="tab" [class.active]="tab() === 'placement'" [attr.aria-selected]="tab() === 'placement'" (click)="tab.set('placement')">GPU & placement</button>
                  <button role="tab" [class.active]="tab() === 'load'" [attr.aria-selected]="tab() === 'load'" (click)="tab.set('load')">Memory & load</button>
                </nav>

                @if (tab() === 'placement') {
                  <div class="form-grid settings-grid">
                    @if (supports('gpu_layers')) {
                      <label>GPU layers<input type="number" min="0" [value]="placement().gpu_layers ?? ''" (input)="setPlacementNumber('gpu_layers', $any($event.target).value)"></label>
                    }
                    @if (supports('device_selection')) {
                      <label>Device
                        <select [value]="placement().device || ''" (change)="setPlacementText('device', $any($event.target).value)">
                          <option value="">Runtime default</option>
                          @for (device of matchingDevices(); track device.runtime_id || device.id) { <option [value]="device.runtime_id || device.id">{{ device.name }} · {{ device.runtime_id || device.id }}</option> }
                        </select>
                      </label>
                    }
                    @if (supports('tensor_split')) {
                      <label>Tensor split<input [value]="placement().tensor_split || ''" (input)="setPlacementText('tensor_split', $any($event.target).value)" placeholder="1,1"></label>
                    }
                    @if (supports('split_mode')) {
                      <label>Split mode<input [value]="placement().split_mode || ''" (input)="setPlacementText('split_mode', $any($event.target).value)" placeholder="layer"></label>
                    }
                    @if (supports('main_gpu')) {
                      <label>Main GPU<input type="number" min="0" [value]="placement().main_gpu ?? ''" (input)="setPlacementNumber('main_gpu', $any($event.target).value)"></label>
                    }
                    @if (!hasPlacementControls()) { <div class="empty inline">The selected runtime does not advertise manual placement controls.</div> }
                  </div>
                } @else {
                  <div class="form-grid settings-grid">
                    @for (field of numberFields; track field.key) {
                      @if (supports(field.key)) { <label>{{ field.label }}<input type="number" min="1" [value]="loadOptions()[field.key] ?? ''" (input)="setLoadNumber(field.key, $any($event.target).value)"></label> }
                    }
                    @for (field of stringFields; track field.key) {
                      @if (supports(field.key)) { <label>{{ field.label }}<input [value]="loadOptions()[field.key] ?? ''" (input)="setLoadText(field.key, $any($event.target).value)"></label> }
                    }
                    @for (field of boolFields; track field.key) {
                      @if (supports(field.key)) { <label class="check"><input type="checkbox" [checked]="loadOptions()[field.key] === true" (change)="setLoadBool(field.key, $any($event.target).checked)">{{ field.label }}</label> }
                    }
                  </div>
                }

                @if (profileError()) { <div class="inline-error" role="alert">{{ profileError() }}</div> }
                @if (runtimeStatus()) { <details class="status"><summary>Runtime details</summary><pre>{{ runtimeStatus() }}</pre></details> }
                <details class="metadata"><summary>Model metadata</summary><dl>@for (entry of metadataEntries(model); track entry[0]) { <dt>{{ entry[0] }}</dt><dd>{{ display(entry[1]) }}</dd> }</dl></details>
              </div>
            }
          </article>
        }
      </section>
    }
  `,
  styles: [`
    :host{display:block}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.page-head h1{margin:4px 0;font-size:30px}.page-head p{margin:4px 0;color:var(--muted,#98a0ad);max-width:760px}.eyebrow{font-size:10px;letter-spacing:.14em;font-weight:800;color:var(--muted,#98a0ad)}
    .surface,.model-card{background:var(--surface,#171a20);border:1px solid var(--border,#2b3039);border-radius:12px}.source-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;margin-bottom:14px}.source-bar>div{display:grid;gap:3px}.source-bar small,.preset-heading small{color:var(--muted,#98a0ad)}.source-bar form{display:flex;gap:8px;min-width:min(560px,60%)}input,select{box-sizing:border-box;width:100%;background:var(--bg,#101216);border:1px solid var(--border,#363c47);border-radius:7px;padding:9px 10px;color:inherit;font:inherit}.primary,.secondary,.danger,.text-button{border:1px solid var(--border,#363c47);border-radius:7px;padding:9px 12px;color:inherit;background:var(--surface,#171a20);font:inherit;font-weight:650;cursor:pointer}.primary{background:var(--accent,#806cff);border-color:transparent;color:white}.danger{color:#ff9ca5}.text-button{border:0;background:transparent;color:var(--accent,#9b8cff);padding:4px 0}.primary:disabled,.secondary:disabled,.danger:disabled{opacity:.5;cursor:wait}.notice{padding:10px 13px;border-radius:8px;margin-bottom:12px}.notice.error,.inline-error{background:#3b2025;color:#ffb7bd}.notice.success{background:#1d382c;color:#9be0b5}
    .model-grid{display:grid;gap:10px}.model-card{overflow:hidden}.model-card.loaded{border-color:color-mix(in srgb,#68d391 50%,var(--border,#2b3039))}.model-summary{display:flex;align-items:center;gap:12px;width:100%;padding:15px 16px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.model-card.open .model-summary{background:color-mix(in srgb,var(--accent,#806cff) 7%,transparent)}.model-icon{font-size:22px;color:var(--accent,#9b8cff)}.model-main{display:grid;gap:4px;min-width:0;flex:1}.model-title{font-size:15px;font-weight:750}.model-path{font-size:11px;color:var(--muted,#98a0ad);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tags{display:flex;flex-wrap:wrap;gap:6px}.tags span{font-size:10px;padding:3px 7px;border-radius:999px;background:var(--bg,#101216);color:#bbc2ce}.tags .loaded-tag{color:#9be0b5}.chevron{font-size:18px;color:var(--muted,#98a0ad)}
    .model-config{border-top:1px solid var(--border,#2b3039);padding:18px;display:grid;gap:16px}.config-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.config-head h2{margin:4px 0;font-size:19px}.runtime-state{font-size:11px;padding:6px 9px;border-radius:999px;background:var(--bg,#101216);color:var(--muted,#98a0ad)}.runtime-state.active{color:#9be0b5;background:#173126}.quick-actions,.preset-actions{display:flex;flex-wrap:wrap;gap:8px}.preset-box{padding:13px;border-radius:9px;border:1px solid var(--border,#303744);background:color-mix(in srgb,var(--bg,#101216) 65%,transparent)}.preset-heading{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:12px}.preset-heading>div{display:grid;gap:3px}.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.form-grid.compact{align-items:end}.form-grid label{display:grid;gap:6px;font-size:11px;color:#c2c8d2}.settings-grid{min-height:72px}.check{display:flex!important;align-items:center;gap:8px;min-height:38px}.check input{width:auto}.capability-note{margin:0;color:var(--muted,#98a0ad);font-size:11px}.tabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#303744)}.tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted,#98a0ad);padding:9px 11px;font:inherit;cursor:pointer}.tabs button.active{color:inherit;border-color:var(--accent,#806cff)}.status,.metadata{font-size:11px}.status pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:var(--bg,#101216);border-radius:7px}.metadata dl{display:grid;grid-template-columns:minmax(150px,.6fr) minmax(0,1fr);gap:5px 12px}.metadata dt{color:var(--muted,#98a0ad);overflow-wrap:anywhere}.metadata dd{margin:0;overflow-wrap:anywhere}.empty{padding:36px;text-align:center;display:grid;gap:7px;color:var(--muted,#98a0ad)}.empty.inline{grid-column:1/-1;padding:18px}.inline-error{padding:9px 11px;border-radius:7px;font-size:12px}
    @media(max-width:760px){.page-head,.source-bar,.preset-heading,.config-head{flex-direction:column}.source-bar form{min-width:0;width:100%}.quick-actions>*{flex:1}.form-grid{grid-template-columns:1fr}}
  `],
})
export class ModelStudioPage implements OnInit {
  readonly sources = signal<ModelSource[]>([]);
  readonly models = signal<ModelRecord[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly rescanning = signal(false);
  readonly pathInput = signal('');
  readonly error = signal('');
  readonly notice = signal('');

  readonly selectedModelId = signal('');
  readonly backends = signal<RuntimeBackend[]>([]);
  readonly installations = signal<RuntimeInstallation[]>([]);
  readonly devices = signal<RuntimeDevice[]>([]);
  readonly backendName = signal('');
  readonly runtimeId = signal('');
  readonly placement = signal<RuntimePlacement>({});
  readonly loadOptions = signal<RuntimeLoadOptions>({});
  readonly tab = signal<SettingsTab>('placement');
  readonly runtimeBusy = signal(false);
  readonly runtimeStatus = signal('');
  readonly loadedModelPath = signal('');

  readonly profiles = signal<ModelProfile[]>([]);
  readonly selectedProfileId = signal('');
  readonly profileName = signal('');
  readonly profileBusy = signal(false);
  readonly profileError = signal('');

  readonly numberFields: { key: NumberLoadKey; label: string }[] = [
    { key: 'context_size', label: 'Context size' }, { key: 'threads', label: 'CPU threads' },
    { key: 'batch_size', label: 'Batch size' }, { key: 'physical_batch_size', label: 'Physical batch size' },
    { key: 'max_concurrent', label: 'Max concurrent sequences' }, { key: 'threads_batch', label: 'Batch threads' },
  ];
  readonly stringFields: { key: StringLoadKey; label: string }[] = [
    { key: 'numa', label: 'NUMA policy' }, { key: 'kv_cache_type_k', label: 'KV cache K' }, { key: 'kv_cache_type_v', label: 'KV cache V' },
  ];
  readonly boolFields: { key: BoolLoadKey; label: string }[] = [
    { key: 'continuous_batching', label: 'Continuous batching' }, { key: 'flash_attention', label: 'Flash attention' },
    { key: 'unified_kv_cache', label: 'Unified KV cache' }, { key: 'offload_kv_cache', label: 'Offload KV cache' },
    { key: 'mmap', label: 'Memory map model' }, { key: 'keep_model_in_memory', label: 'Lock model in memory' },
    { key: 'fit', label: 'Fit automatically to available memory' },
  ];

  constructor(
    private readonly library: ModelSourcesService,
    private readonly runtime: RuntimeService,
    private readonly profileApi: ModelProfilesService,
  ) {}

  ngOnInit(): void { void this.refreshAll(); }

  async refreshAll(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [sources, models, snapshot, installations] = await Promise.all([
        this.library.list(), this.library.models(), this.runtime.snapshot(), this.runtime.installations().catch(() => []),
      ]);
      this.sources.set(sources); this.models.set(models); this.backends.set(snapshot.runtime.backends);
      this.devices.set(snapshot.runtime.devices); this.installations.set(installations);
      this.captureStatus(snapshot.runtime.status);
    } catch (error) { this.error.set(message(error)); }
    finally { this.loading.set(false); }
  }

  async toggleModel(model: ModelRecord): Promise<void> {
    if (this.selectedModelId() === model.id) { this.selectedModelId.set(''); return; }
    this.selectedModelId.set(model.id); this.error.set(''); this.notice.set(''); this.runtimeStatus.set('');
    this.resetConfiguration();
    try { this.profiles.set(await this.profileApi.list(model.id)); }
    catch (error) { this.profileError.set(message(error)); }
  }

  capabilities(): RuntimeCapabilities | null {
    const runtime = this.installations().find(item => item.id === this.runtimeId());
    if (runtime) return runtime.capabilities;
    const backend = this.backends().find(item => item.name === this.backendName());
    if (backend) return backend.capabilities;
    return this.backends().find(item => item.available)?.capabilities ?? null;
  }
  supports(key: string): boolean { return (this.capabilities() as unknown as Record<string, unknown> | null)?.[key] === true; }
  hasPlacementControls(): boolean { return ['gpu_layers','device_selection','tensor_split','split_mode','main_gpu'].some(key => this.supports(key)); }
  matchingInstallations(): RuntimeInstallation[] { return this.installations().filter(item => !this.backendName() || item.backend === this.backendName() || item.kind === this.backendName()); }
  matchingDevices(): RuntimeDevice[] { return this.devices().filter(item => !this.backendName() || item.backend === this.backendName()); }

  changeBackend(name: string): void { this.backendName.set(name); this.runtimeId.set(''); this.placement.set({}); this.loadOptions.set({}); }
  changeRuntime(id: string): void {
    this.runtimeId.set(id);
    const selected = this.installations().find(item => item.id === id);
    if (selected?.backend) this.backendName.set(selected.backend);
    this.placement.set({}); this.loadOptions.set({});
  }

  setPlacementNumber(key: 'gpu_layers' | 'main_gpu', raw: string): void {
    const next = { ...this.placement() };
    if (!raw.trim()) delete next[key]; else next[key] = Number(raw);
    this.placement.set(next);
  }
  setPlacementText(key: 'device' | 'tensor_split' | 'split_mode', raw: string): void {
    const next = { ...this.placement() };
    if (!raw.trim()) delete next[key]; else next[key] = raw.trim();
    this.placement.set(next);
  }
  setLoadNumber(key: NumberLoadKey, raw: string): void {
    const next = { ...this.loadOptions() };
    if (!raw.trim()) delete next[key]; else next[key] = Number(raw);
    this.loadOptions.set(next);
  }
  setLoadText(key: StringLoadKey, raw: string): void {
    const next = { ...this.loadOptions() };
    if (!raw.trim()) delete next[key]; else next[key] = raw.trim();
    this.loadOptions.set(next);
  }
  setLoadBool(key: BoolLoadKey, value: boolean): void { this.loadOptions.set({ ...this.loadOptions(), [key]: value }); }

  configurationValid(): boolean {
    for (const value of Object.values(this.placement())) if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return false;
    for (const value of Object.values(this.loadOptions())) if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) return false;
    return true;
  }

  resetConfiguration(): void {
    this.selectedProfileId.set(''); this.profileName.set(''); this.profileError.set('');
    this.backendName.set(''); this.runtimeId.set(''); this.placement.set({}); this.loadOptions.set({});
  }

  applyProfile(id: string): void {
    this.selectedProfileId.set(id); this.profileError.set('');
    if (!id) { this.resetConfiguration(); return; }
    const profile = this.profiles().find(item => item.id === id);
    if (!profile) return;
    this.profileName.set(profile.name); this.backendName.set(profile.backend_name || ''); this.runtimeId.set(profile.runtime_id || '');
    this.placement.set(structuredClone(profile.placement || {})); this.loadOptions.set(structuredClone(profile.load || {}));
  }

  async saveProfile(model: ModelRecord): Promise<void> {
    if (!this.profileName().trim()) return;
    this.profileBusy.set(true); this.profileError.set('');
    const payload = {
      model_id: model.id, name: this.profileName().trim(), backend_name: this.backendName() || null,
      runtime_id: this.runtimeId() || null, placement: this.placement(), load: this.loadOptions(), generation: {},
    };
    try {
      let saved: ModelProfile;
      if (this.selectedProfileId()) saved = await this.profileApi.update(this.selectedProfileId(), payload);
      else saved = await this.profileApi.create(payload);
      this.profiles.set(await this.profileApi.list(model.id)); this.selectedProfileId.set(saved.id); this.notice.set('Configuration preset saved.');
    } catch (error) { this.profileError.set(message(error)); }
    finally { this.profileBusy.set(false); }
  }

  async deleteProfile(): Promise<void> {
    const id = this.selectedProfileId(); if (!id) return;
    this.profileBusy.set(true); this.profileError.set('');
    try { await this.profileApi.remove(id); this.profiles.set(this.profiles().filter(item => item.id !== id)); this.resetConfiguration(); this.notice.set('Configuration preset deleted.'); }
    catch (error) { this.profileError.set(message(error)); }
    finally { this.profileBusy.set(false); }
  }

  async loadModel(model: ModelRecord): Promise<void> {
    this.runtimeBusy.set(true); this.error.set(''); this.notice.set(`Loading ${this.modelName(model)}…`);
    try {
      const result = await this.runtime.load({
        model_id: model.id,
        backend: this.backendName() || undefined,
        runtime_id: this.runtimeId() || undefined,
        placement: this.placement(),
        load: this.loadOptions(),
      });
      this.captureStatus(result); this.runtimeStatus.set(JSON.stringify(result, null, 2)); this.notice.set(`${this.modelName(model)} loaded in memory.`);
    } catch (error) { this.notice.set(''); this.error.set(message(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  async unloadModel(): Promise<void> {
    this.runtimeBusy.set(true); this.error.set('');
    try { const result = await this.runtime.unload(); this.captureStatus(result); this.runtimeStatus.set(JSON.stringify(result, null, 2)); this.notice.set('Model unloaded from memory.'); }
    catch (error) { this.error.set(message(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  async refreshRuntimeStatus(): Promise<void> {
    this.runtimeBusy.set(true); this.error.set('');
    try { const result = await this.runtime.status(); this.captureStatus(result); this.runtimeStatus.set(JSON.stringify(result, null, 2)); }
    catch (error) { this.error.set(message(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  private captureStatus(value: unknown): void {
    const root = value && typeof value === 'object' ? value as Record<string, any> : {};
    const data = root['data'] && typeof root['data'] === 'object' ? root['data'] : root;
    const status = data['status'] && typeof data['status'] === 'object' ? data['status'] : data;
    this.loadedModelPath.set(typeof status?.model === 'string' && status.loaded !== false ? status.model : '');
  }
  isLoaded(model: ModelRecord): boolean { return !!this.loadedModelPath() && normalize(model.path) === normalize(this.loadedModelPath()); }

  async rescan(): Promise<void> {
    this.rescanning.set(true); this.busy.set(true); this.error.set('');
    try { this.models.set(await this.library.rescan()); this.sources.set(await this.library.list()); this.notice.set(`Scan complete. ${this.models().length} models found.`); }
    catch (error) { this.error.set(message(error)); }
    finally { this.rescanning.set(false); this.busy.set(false); }
  }

  async addSource(event: Event): Promise<void> {
    event.preventDefault(); const path = this.pathInput().trim(); if (!path) return;
    this.busy.set(true); this.error.set('');
    try { await this.library.add(path); this.pathInput.set(''); await this.rescan(); this.notice.set('Model folder added and scanned.'); }
    catch (error) { this.error.set(message(error)); }
    finally { this.busy.set(false); }
  }

  modelName(model: ModelRecord): string { return String(model.metadata?.['general.name'] || model.path.split(/[\\/]/).pop() || model.id); }
  metadataEntries(model: ModelRecord): [string, unknown][] { return Object.entries(model.metadata || {}).sort(([a],[b]) => a.localeCompare(b)); }
  display(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }
  size(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
    if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }
}

function normalize(path: string): string { return path.replace(/\\/g, '/').replace(/\/$/, ''); }
function message(error: unknown): string { return error instanceof Error ? error.message : 'The local model request failed.'; }
