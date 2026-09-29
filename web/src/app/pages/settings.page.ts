import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { RuntimeCapabilities, RuntimeDevice, RuntimeInstallation, RuntimeLoadOptions, RuntimePlacement } from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService } from '../core/runtime.service';
import { GlobalSettings, SettingsService } from '../core/settings.service';

type SettingsTab = 'general' | 'runtime';
type DefaultCapability = keyof RuntimeCapabilities;

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings-page">
      <header class="settings-header">
        <div>
          <div class="eyebrow">PREFERENCES</div>
          <h1>Settings</h1>
          <p>Local defaults for the AI Dream application.</p>
        </div>
        <div class="header-actions">
          @if (saved()) { <span class="save-status" role="status">Saved</span> }
          <button class="primary-button" title="Save the current application and runtime defaults to the local settings store" (click)="saveSettings()" [disabled]="saving() || !settings()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </header>

      <nav class="settings-tabs" aria-label="Settings categories" role="tablist">
        <button role="tab" title="Application connection, behavior, and local path settings" [attr.aria-selected]="tab() === 'general'" [class.active]="tab() === 'general'" (click)="tab.set('general')">Application</button>
        <button role="tab" title="Default runtime and placement options reported as supported by installed backends" [attr.aria-selected]="tab() === 'runtime'" [class.active]="tab() === 'runtime'" (click)="tab.set('runtime')">Runtime defaults</button>
      </nav>

      @if (loading()) { <p class="settings-message" role="status">Loading settings…</p> }
      @if (loadError()) {
        <div class="settings-alert" role="alert">
          <span>{{ loadError() }}</span>
          <button class="secondary-button" title="Reload settings and runtime capability data from the local API" (click)="initialize()">Retry</button>
        </div>
      }

      @if (settings(); as s) {
        @if (tab() === 'general') {
          <div class="settings-grid">
            <section class="surface settings-card">
              <div class="section-heading">
                <div><h2>Local API</h2><p>Requests stay on this device.</p></div>
              <span class="status-tag" [class.ok]="api.connected()" [title]="'Reachability of ' + api.baseUrl() + '/api/health'">{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Unavailable' }}</span>
              </div>
              <label class="field-label" for="api-url">Base URL</label>
              <div class="input-row">
                <input id="api-url" title="Loopback-only HTTP URL of the AI Dream API; saved in this browser" type="url" [value]="url" (input)="url = $any($event.target).value" spellcheck="false" placeholder="http://127.0.0.1:8765" (keydown.enter)="saveApiUrl()">
                <button class="secondary-button" title="Validate the local URL, save it in this browser, and run GET /api/health" (click)="saveApiUrl()">Save &amp; check</button>
              </div>
              <p class="help">Health check: <code [title]="'Read-only health probe at ' + api.baseUrl() + '/api/health'">GET {{ api.baseUrl() }}/api/health</code>. The URL is stored in this browser.</p>
              @if (urlError()) { <p class="error-line" role="alert">{{ urlError() }}</p> }
              @else if (api.error()) { <p class="error-line">{{ api.error() }}</p> }
            </section>

            <section class="surface settings-card">
              <div class="section-heading"><div><h2>Application behavior</h2><p>Choose how saved model profiles are applied.</p></div></div>
              <label class="setting-field" for="profile-behavior">
                <span>Default profile behavior</span>
                <select id="profile-behavior" title="Choose whether model-specific profiles or global runtime defaults take precedence" [value]="s.default_profile_behavior" (change)="updateBehavior($any($event.target).value)">
                  <option value="model">Use the model profile</option>
                  <option value="global">Use global defaults</option>
                </select>
              </label>
              <p class="help">Model-specific placement and load settings belong in each model’s profile.</p>
              <label class="toggle-row">
                <span><b>Keep last model loaded</b><small>Keep the active model available after a request finishes.</small></span>
                <input type="checkbox" title="Keep the most recently loaded model available between inference requests; increases ongoing resource use" [checked]="s.keep_last_model_loaded" (change)="updateKeepLoaded($any($event.target).checked)">
              </label>
              @if (saveError()) { <p class="error-line" role="alert">{{ saveError() }}</p> }
            </section>

            <section class="surface settings-card paths-card">
              <div class="section-heading"><div><h2>Local paths</h2><p>Read-only locations used by this installation.</p></div></div>
              <div class="path-grid">
                <label title="AI Dream's managed destination for model downloads">Managed models directory<output [title]="s.managed_models_dir">{{ s.managed_models_dir }}</output></label>
                <label title="AI Dream configuration and runtime defaults location">Configuration directory<output [title]="s.config_dir">{{ s.config_dir }}</output></label>
                <label title="AI Dream local application data location">Data directory<output [title]="s.data_dir">{{ s.data_dir }}</output></label>
              </div>
            </section>
          </div>
        } @else {
          <section class="surface settings-card runtime-card">
            <div class="section-heading"><div><h2>Runtime defaults</h2><p>Choose the engine used when a model does not select one explicitly.</p></div></div>
            @if (runtimeError()) { <p class="settings-alert inline-alert" role="alert">{{ runtimeError() }}</p> }
            <div class="runtime-fields">
              <label class="setting-field" for="default-backend">
                <span>Default backend</span>
                <select id="default-backend" title="Select a backend reported by the local runtime inventory; unavailable backends cannot be selected" [value]="s.runtime_defaults.backend_name || ''" (change)="updateBackend($any($event.target).value)">
                  <option value="">Runtime default</option>
                  @for (b of backends(); track b.name) { <option [value]="b.name" [disabled]="!b.available" [title]="b.name + (b.available ? ' is reported as available by the runtime' : ' is reported as unavailable by the runtime')">{{ b.name }}{{ b.available ? '' : ' (unavailable)' }}</option> }
                </select>
                <small>Available backends reported by the local runtime service.</small>
              </label>
              <label class="setting-field" for="default-runtime">
                <span>Default runtime</span>
                <select id="default-runtime" title="Select a registered runtime installation. Only enabled and available installations can be used." [value]="s.runtime_defaults.runtime_id || ''" (change)="updateRuntime($any($event.target).value)">
                  <option value="">Backend default</option>
                  @for (r of installations(); track r.id) { <option [value]="r.id" [disabled]="!r.enabled || !r.available" [title]="r.name + ' · installation ID ' + r.id + (r.available ? ' · available' : ' · unavailable')">{{ r.name }} · {{ r.backend || r.kind }}{{ r.available ? '' : ' (unavailable)' }}</option> }
                </select>
                <small>Installed runtimes registered with AI Dream.</small>
              </label>
            </div>
            <div class="runtime-tuning-grid">
              <section class="tuning-column"><div class="tuning-heading"><b>Backend &amp; placement</b><small>EXECUTION</small></div>
                @if (supportsDefault('gpu_layers')) { <label class="setting-field"><span>GPU offload layers</span><input type="number" min="0" title="Number of model layers to offload to the GPU; blank defers to the selected runtime" [value]="s.runtime_defaults.placement.gpu_layers ?? ''" (input)="updatePlacement('gpu_layers', $any($event.target).value)"></label> }
                @if (supportsDefault('device_selection')) { <label class="setting-field"><span>Device selection</span><select title="Select a runtime-reported device; Runtime default leaves placement to the backend" [value]="s.runtime_defaults.placement.device || ''" (change)="updatePlacement('device', $any($event.target).value)"><option value="">Runtime default</option>@for (d of defaultDevices(); track d.runtime_id || d.id) { <option [value]="d.runtime_id || d.id" [title]="d.name + ' · runtime device ID ' + (d.runtime_id || d.id)">{{ d.name }} · {{ d.runtime_id || d.id }}</option> }</select></label> }
                @if (supportsDefault('main_gpu')) { <label class="setting-field"><span>Main GPU index</span><input type="number" min="0" title="Index of the primary GPU, using the selected runtime's device ordering" [value]="s.runtime_defaults.placement.main_gpu ?? ''" (input)="updatePlacement('main_gpu', $any($event.target).value)"></label> }
                @if (supportsDefault('split_mode')) { <label class="setting-field"><span>Split mode</span><input title="Backend-specific model split strategy; blank uses the runtime default" [value]="s.runtime_defaults.placement.split_mode || ''" (input)="updatePlacement('split_mode', $any($event.target).value)" placeholder="Runtime default"></label> }
                @if (supportsDefault('tensor_split')) { <label class="setting-field"><span>Tensor split</span><input title="Backend-specific per-device tensor split; blank uses the runtime default" [value]="s.runtime_defaults.placement.tensor_split || ''" (input)="updatePlacement('tensor_split', $any($event.target).value)" placeholder="Runtime default"></label> }
                @if (!hasDefaultPlacementOptions()) { <p class="tuning-empty">No placement capabilities reported.</p> }
              </section>
              <section class="tuning-column"><div class="tuning-heading"><b>Batching &amp; context</b><small>INFERENCE</small></div>
                @for (f of defaultLoadNumbers; track f.key) { @if (supportsDefault(f.cap)) { <label class="setting-field"><span>{{ f.label }}</span><input type="number" min="0" [title]="'Runtime-reported ' + f.label + ' load option; blank defers to the runtime'" [value]="s.runtime_defaults.load[f.key] ?? ''" (input)="updateLoad(f.key, $any($event.target).value)"></label> } }
                @if (!hasDefaultLoadNumbers()) { <p class="tuning-empty">No numeric load options reported.</p> }
              </section>
              <section class="tuning-column"><div class="tuning-heading"><b>Acceleration flags</b><small>RUNTIME OPTIONS</small></div>
                @for (f of defaultLoadFlags; track f.key) { @if (supportsDefault(f.cap)) { <label class="toggle-row compact-toggle" [title]="f.description"><span><b>{{ f.label }}</b><small>{{ f.description }}</small></span><input type="checkbox" [title]="f.description" [checked]="s.runtime_defaults.load[f.key] ?? false" (change)="updateLoad(f.key, $any($event.target).checked)"></label> } }
                @if (!hasDefaultLoadFlags()) { <p class="tuning-empty">No acceleration flags reported.</p> }
              </section>
            </div>
            <aside class="model-profile-note">
              <b>Model configuration lives with each model</b>
              <p>Context size, GPU placement, split mode, tensor split, and other load options can vary by model. Configure them in the model profile from <a href="#/models" title="Open the local model catalog and its model-specific configuration">Models</a> or when loading from <a href="#/runtime" title="Open runtime installation, selection, and load controls">Runtime</a>.</p>
            </aside>
            @if (saveError()) { <p class="error-line" role="alert">{{ saveError() }}</p> }
          </section>
        }
      }
    </div>
  `,
  styles: [`
    :host { display:block; min-height:100%; }
    .settings-page { width:min(1050px,100%); margin:0 auto; color:var(--text); }
    .settings-header { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; margin:0 0 22px; }
    .settings-header h1 { margin:0; font-size:23px; font-weight:550; letter-spacing:-.4px; }
    .settings-header p { margin:7px 0 0; color:#929aaa; font-size:12px; }
    .header-actions { display:flex; align-items:center; gap:12px; }
    .save-status { color:var(--green); font:10px ui-monospace,monospace; }
    .settings-tabs { display:flex; gap:5px; border-bottom:1px solid #2e3541; margin-bottom:14px; }
    .settings-tabs button { padding:10px 13px; border:0; border-bottom:2px solid transparent; background:transparent; color:#8991a2; font:inherit; font-size:11px; cursor:pointer; }
    .settings-tabs button:hover { color:#d7deeb; }
    .settings-tabs button.active { color:#c5d8ff; border-color:#80aaff; }
    .settings-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .settings-card { min-width:0; padding:18px; }
    .section-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-bottom:13px; margin-bottom:15px; border-bottom:1px solid #2e3541; }
    .section-heading h2 { margin:0; color:#d9deea; font-size:13px; font-weight:550; }
    .section-heading p { margin:5px 0 0; color:#8992a2; font-size:10px; line-height:1.5; }
    .status-tag { flex:none; border:1px solid #484438; background:#29251c; color:var(--amber); border-radius:5px; padding:4px 7px; font:9px ui-monospace,monospace; }
    .status-tag.ok { border-color:#275542; background:#162b24; color:var(--green); }
    .field-label,.setting-field>span { display:block; color:#bdc4d2; font-size:10px; margin-bottom:7px; }
    .input-row { display:flex; align-items:center; gap:8px; }
    .input-row input,.setting-field select { min-width:0; width:100%; box-sizing:border-box; border:1px solid #3b4351; border-radius:6px; background:#10151e; color:var(--text); padding:9px 10px; font:11px ui-monospace,monospace; }
    .input-row input { flex:1; }
    .input-row input:focus,.setting-field select:focus { outline:2px solid #5473a7; outline-offset:1px; }
    .secondary-button,.primary-button { flex:none; border:1px solid #3c4657; border-radius:6px; background:#222a38; color:#c7d6f4; padding:8px 11px; cursor:pointer; font-size:10px; white-space:nowrap; }
    .secondary-button:hover { background:#2b3648; }
    .primary-button { border-color:#5473a7; background:#253750; }
    .primary-button:hover { background:#2b4162; }
    .primary-button:disabled { opacity:.55; cursor:not-allowed; }
    .help,.setting-field small { display:block; margin:8px 0 0; color:#848d9d; font-size:10px; line-height:1.55; }
    .help code { color:#bdc8da; font:10px ui-monospace,monospace; overflow-wrap:anywhere; }
    .error-line { margin:9px 0 0; color:var(--red); font-size:10px; line-height:1.5; overflow-wrap:anywhere; }
    .settings-alert { display:flex; align-items:center; justify-content:space-between; gap:12px; max-width:100%; margin:0 0 13px; padding:11px 13px; border:1px solid #68423f; border-radius:7px; background:#281a1c; color:#e6b9b3; font-size:10px; }
    .settings-alert .secondary-button { margin:0; border-color:#77514d; background:#372324; color:#ffd0c7; }
    .settings-message { margin:14px 0; color:#929aaa; font-size:11px; }
    .toggle-row { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:17px; padding:11px 12px; border:1px solid #2e3541; border-radius:7px; background:#111721; cursor:pointer; }
    .toggle-row b,.toggle-row small { display:block; }
    .toggle-row b { color:#cbd2df; font-size:10px; font-weight:550; }
    .toggle-row small { margin-top:4px; color:#858e9e; font-size:9px; line-height:1.45; }
    .toggle-row input { width:16px; height:16px; flex:none; accent-color:#739ce8; }
    .paths-card { grid-column:1 / -1; }
    .path-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .path-grid label { min-width:0; color:#929aaa; font-size:10px; }
    .path-grid output { display:block; margin-top:6px; padding:9px 10px; border:1px solid #303745; border-radius:6px; background:#10151e; color:#adb8ca; font:10px/1.5 ui-monospace,monospace; overflow-wrap:anywhere; }
    .runtime-card { padding:19px; }
    .runtime-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .setting-field { display:block; min-width:0; }
    .setting-field select { display:block; }
    .model-profile-note { margin-top:18px; padding:13px 14px; border:1px solid #303d52; border-radius:7px; background:#141b27; }
    .model-profile-note b { color:#c7d6f4; font-size:10px; font-weight:550; }
    .model-profile-note p { margin:6px 0 0; color:#929aaa; font-size:10px; line-height:1.65; }
    .model-profile-note a { color:#a9c5ff; text-decoration:none; }
    .model-profile-note a:hover { text-decoration:underline; }
    @media(max-width:720px) { .settings-grid { grid-template-columns:1fr; }.paths-card { grid-column:auto; }.path-grid { grid-template-columns:1fr; }.settings-header { align-items:flex-start; }.runtime-fields { grid-template-columns:1fr; } }
    @media(max-width:480px) { .settings-header { flex-direction:column; align-items:stretch; gap:14px; }.header-actions { justify-content:space-between; }.input-row { align-items:stretch; flex-direction:column; }.input-row .secondary-button { align-self:flex-start; }.settings-tabs button { padding:9px 10px; } }
  `, `
.settings-page{max-width:none}.settings-header{padding:16px;background:#171c26;border:1px solid #2b3240;border-radius:6px;margin-bottom:14px}.settings-header h1{font-size:22px;font-weight:600}.settings-tabs{margin-bottom:10px}.settings-tabs button{font-size:10px}.settings-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.settings-grid>.settings-card:first-child{grid-column:1/-1}.settings-card{padding:15px;border-radius:6px}.section-heading{padding-bottom:10px;margin-bottom:12px}.input-row input,.setting-field select,.path-grid output{border-radius:4px}.toggle-row,.model-profile-note{border-radius:4px}.runtime-card{padding:16px}.runtime-fields{gap:12px}.paths-card{grid-column:1/-1}@media(max-width:720px){.settings-grid{grid-template-columns:1fr}}
`, `
.runtime-tuning-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}.tuning-column{display:grid;align-content:start;gap:10px;min-width:0;padding:12px;background:#10151e;border:1px solid #2c3543;border-radius:4px}.tuning-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:8px;border-bottom:1px solid #2b3240}.tuning-heading b{color:#b9cfff;font-size:11px;font-weight:550}.tuning-heading small{color:#7f8da4;font:8px ui-monospace,monospace}.tuning-column .setting-field>span{margin-bottom:5px}.tuning-column .setting-field input,.tuning-column .setting-field select{display:block;width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #333e4e;border-radius:3px;background:#0d121b;color:#d4deee;font:10px ui-monospace,monospace}.tuning-empty{margin:0;color:#8993a4;font-size:9px;line-height:1.5}.compact-toggle{margin:0;padding:8px;border-radius:3px;background:#0d121b}.compact-toggle b{font-size:9px}.compact-toggle small{font-size:8px}@media(max-width:900px){.runtime-tuning-grid{grid-template-columns:1fr 1fr}.runtime-tuning-grid .tuning-column:last-child{grid-column:1/-1}}@media(max-width:720px){.settings-grid{grid-template-columns:1fr}.runtime-tuning-grid{grid-template-columns:1fr}.runtime-tuning-grid .tuning-column:last-child{grid-column:auto}}
  `]
})
export class SettingsPage implements OnInit {
  url = this.api.baseUrl();
  readonly urlError = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly loadError = signal('');
  readonly runtimeError = signal('');
  readonly saveError = signal('');
  readonly settings = signal<GlobalSettings | null>(null);
  readonly tab = signal<SettingsTab>('general');
  readonly backends = signal<RuntimeBackend[]>([]);
  readonly installations = signal<RuntimeInstallation[]>([]);
  readonly defaultLoadNumbers: { key: keyof RuntimeLoadOptions; label: string; cap: DefaultCapability }[] = [
    { key: 'context_size', label: 'Context size', cap: 'context_size' },
    { key: 'threads', label: 'CPU threads', cap: 'threads' },
    { key: 'batch_size', label: 'Batch size', cap: 'batch_size' },
    { key: 'physical_batch_size', label: 'Physical batch size', cap: 'physical_batch_size' },
    { key: 'max_concurrent', label: 'Max concurrent', cap: 'max_concurrent' },
    { key: 'threads_batch', label: 'Batch threads', cap: 'threads_batch' },
  ];
  readonly defaultLoadFlags: { key: keyof RuntimeLoadOptions; label: string; description: string; cap: DefaultCapability }[] = [
    { key: 'flash_attention', label: 'Flash attention', description: 'Runtime attention kernel', cap: 'flash_attention' },
    { key: 'unified_kv_cache', label: 'Unified KV cache', description: 'Pool the key/value cache', cap: 'unified_kv_cache' },
    { key: 'offload_kv_cache', label: 'Offload KV cache', description: 'Place cache on accelerator', cap: 'offload_kv_cache' },
    { key: 'keep_model_in_memory', label: 'Keep model loaded', description: 'Retain model after requests', cap: 'keep_model_in_memory' },
    { key: 'fit', label: 'Fit to available memory', description: 'Clamp settings to runtime estimate', cap: 'fit' },
  ];

  constructor(
    readonly api: ApiService,
    private readonly settingsApi: SettingsService,
    private readonly runtime: RuntimeService
  ) {}

  ngOnInit() {
    void this.initialize();
  }

  saveApiUrl() {
    if (!this.api.setBaseUrl(this.url)) {
      this.urlError.set('Use http://127.0.0.1:<port> or http://localhost:<port> with a port from 1 to 65535.');
      return;
    }
    this.urlError.set('');
    void this.initialize();
  }

  async initialize() {
    this.loading.set(true);
    this.loadError.set('');
    this.runtimeError.set('');
    try {
      await this.api.check();
      const response = await this.settingsApi.get();
      this.settings.set(response.data?.settings ?? null);
      if (!response.data?.settings) throw new Error('The settings endpoint returned no settings object.');
      try {
        const [{ runtime }, installations] = await Promise.all([this.runtime.snapshot(), this.runtime.installations()]);
        this.backends.set(runtime.backends);
        this.installations.set(installations);
      } catch (e) {
        this.runtimeError.set(message(e));
      }
    } catch (e) {
      this.loadError.set(message(e));
    } finally {
      this.loading.set(false);
    }
  }

  updateBackend(value: string) {
    this.edit(s => s.runtime_defaults.backend_name = value || null);
  }

  updateRuntime(value: string) {
    this.edit(s => s.runtime_defaults.runtime_id = value || null);
  }

  supportsDefault(cap: DefaultCapability): boolean {
    const runtimeId = this.settings()?.runtime_defaults.runtime_id;
    const selected = this.installations().find(item => item.id === runtimeId);
    const backendName = this.settings()?.runtime_defaults.backend_name;
    const backend = this.backends().find(item => item.name === backendName);
    if (selected) return selected.capabilities?.[cap] === true;
    return backend?.capabilities?.[cap] === true;
  }

  defaultDevices(): RuntimeDevice[] {
    const runtimeId = this.settings()?.runtime_defaults.runtime_id;
    const selected = this.installations().find(item => item.id === runtimeId);
    return selected?.devices ?? [];
  }

  hasDefaultPlacementOptions(): boolean {
    return ['gpu_layers', 'device_selection', 'main_gpu', 'split_mode', 'tensor_split'].some(cap => this.supportsDefault(cap as DefaultCapability));
  }

  hasDefaultLoadNumbers(): boolean { return this.defaultLoadNumbers.some(field => this.supportsDefault(field.cap)); }
  hasDefaultLoadFlags(): boolean { return this.defaultLoadFlags.some(field => this.supportsDefault(field.cap)); }

  updatePlacement(key: keyof RuntimePlacement, value: string) {
    const parsed = ['gpu_layers', 'main_gpu'].includes(key) ? (value === '' ? undefined : Number(value)) : (value || undefined);
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) return;
    this.edit(s => {
      const next = { ...s.runtime_defaults.placement };
      if (parsed === undefined) delete next[key];
      else Object.assign(next, { [key]: parsed });
      s.runtime_defaults.placement = next;
    });
  }

  updateLoad(key: keyof RuntimeLoadOptions, value: string | boolean) {
    const numeric = ['context_size', 'threads', 'batch_size', 'physical_batch_size', 'max_concurrent', 'threads_batch'].includes(key);
    const parsed = typeof value === 'boolean' ? value : numeric ? (value === '' ? undefined : Number(value)) : (value || undefined);
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) return;
    this.edit(s => {
      const next = { ...s.runtime_defaults.load };
      if (parsed === undefined) delete next[key];
      else Object.assign(next, { [key]: parsed });
      s.runtime_defaults.load = next;
    });
  }

  updateBehavior(value: string) {
    if (value === 'model' || value === 'global') this.edit(s => s.default_profile_behavior = value);
  }

  updateKeepLoaded(value: boolean) {
    this.edit(s => s.keep_last_model_loaded = value);
  }

  private edit(change: (settings: GlobalSettings) => void) {
    const current = this.settings();
    if (!current) return;
    const next = structuredClone(current);
    change(next);
    this.settings.set(next);
    this.saved.set(false);
  }

  async saveSettings() {
    const current = this.settings();
    if (!current) return;
    this.saving.set(true);
    this.saveError.set('');
    this.saved.set(false);
    try {
      const { managed_models_dir, config_dir, data_dir, ...editable } = current;
      const response = await this.settingsApi.patch(editable);
      if (response.data?.settings) this.settings.set(response.data.settings);
      this.saved.set(true);
    } catch (e) {
      this.saveError.set(message(e));
    } finally {
      this.saving.set(false);
    }
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
