import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { SettingsService, GlobalSettings } from '../core/settings.service';
import { RuntimeService, RuntimeBackend } from '../core/runtime.service';
import { RuntimeInstallation } from '../core/control-plane.types';

type SettingsTab = 'general' | 'runtime';

@Component({
  selector: 'app-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">PREFERENCES</div>
        <h1>Settings</h1>
        <p>Application-wide preferences and runtime defaults.</p>
      </div>
      <span class="page-badge"><i></i>LOCAL</span>
    </div>

    <section class="surface settings-card api-card">
      <div class="section-title">
        <div>
          <h2>Local API</h2>
          <p>Requests stay on your machine.</p>
        </div>
        <span class="status-tag" [class.ok]="api.connected()">{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Unavailable' }}</span>
      </div>
      <label class="field-label" for="api-url">Base URL</label>
      <div class="input-row">
        <input id="api-url" type="url" [value]="url" (input)="url = $any($event.target).value" spellcheck="false" placeholder="http://127.0.0.1:8765" (keydown.enter)="saveApiUrl()">
        <button class="primary-button" (click)="saveApiUrl()">Save & check</button>
      </div>
      <p class="help">Health check: <code>GET {{ api.baseUrl() }}/api/health</code>. The base URL is stored in this browser's local storage.</p>
      @if (urlError()) {<p class="error-line" role="alert">{{urlError()}}</p>}
      @else if (api.error()) {<p class="error-line">{{ api.error() }}</p>}
    </section>

    @if(loading()){
      <p role="status">Loading settings…</p>
    }
    @if(loadError()){
      <section class="surface settings-card">
        <p class="error-line" role="alert">{{loadError()}}</p>
        <button class="secondary-button" (click)="initialize()">Retry settings</button>
      </section>
    }

    @if(settings(); as s){
      <nav class="settings-tabs" aria-label="Settings categories" role="tablist">
        <button role="tab" [attr.aria-selected]="tab()==='general'" [class.active]="tab()==='general'" (click)="tab.set('general')">Application</button>
        <button role="tab" [attr.aria-selected]="tab()==='runtime'" [class.active]="tab()==='runtime'" (click)="tab.set('runtime')">Runtime defaults</button>
      </nav>

      @if(tab()==='general'){
        <section class="surface settings-card">
          <div class="section-title">
            <div>
              <h2>Application behavior</h2>
              <p>Settings that apply across models.</p>
            </div>
          </div>
          <div class="form-grid">
            <label>
              Default profile behavior
              <select [value]="s.default_profile_behavior" (change)="updateBehavior($any($event.target).value)">
                <option value="model">Use the model profile</option>
                <option value="global">Use global defaults</option>
              </select>
              <small>Model-specific placement and load options belong to each model profile.</small>
            </label>
            <label class="check-setting">
              <input type="checkbox" [checked]="s.keep_last_model_loaded" (change)="updateKeepLoaded($any($event.target).checked)">
              <span>Keep last model loaded</span>
            </label>
          </div>
          <div class="save-row">
            <button class="primary-button" (click)="saveSettings()" [disabled]="saving()">{{saving()?'Saving…':'Save settings'}}</button>
            @if(saved()){<span role="status" class="saved-status">Saved</span>}
          </div>
          @if(saveError()){<p class="error-line" role="alert">{{saveError()}}</p>}
        </section>

        <section class="surface settings-card paths-card">
          <div class="section-title">
            <div>
              <h2>Local paths</h2>
              <p>Read-only diagnostics. AI Dream does not expose filesystem browsing here.</p>
            </div>
          </div>
          <div class="form-grid">
            <label>Managed models directory<output>{{s.managed_models_dir}}</output></label>
            <label>Configuration directory<output>{{s.config_dir}}</output></label>
            <label>Data directory<output>{{s.data_dir}}</output></label>
          </div>
        </section>
      } @else {
        <section class="surface settings-card">
          <div class="section-title">
            <div>
              <h2>Runtime defaults</h2>
              <p>Choose the default engine for new model loads. GPU placement and load tuning are configured per model.</p>
            </div>
          </div>
          @if(runtimeError()){<p class="error-line" role="alert">{{runtimeError()}}</p>}
          <div class="form-grid runtime-grid">
            <label>
              Default backend
              <select [value]="s.runtime_defaults.backend_name||''" (change)="updateBackend($any($event.target).value)">
                <option value="">Use runtime default</option>
                @for(b of backends();track b.name){<option [value]="b.name" [disabled]="!b.available">{{b.name}}{{b.available?'':' (unavailable)'}}</option>}
              </select>
              <small>Available choices come from the local runtime service.</small>
            </label>
            <label>
              Default runtime
              <select [value]="s.runtime_defaults.runtime_id||''" (change)="updateRuntime($any($event.target).value)">
                <option value="">Use backend default</option>
                @for(r of installations();track r.id){<option [value]="r.id" [disabled]="!r.enabled||!r.available">{{r.name}} · {{r.backend||r.kind}}{{r.available?'':' (unavailable)'}}</option>}
              </select>
              <small>Registered llama.cpp installations detected by AI Dream.</small>
            </label>
          </div>
          <p class="info-note">
            ℹ
            <span>Context size, GPU layers, device placement, tensor split, and other load options are model-specific. Configure them from <a href="/#/runtime">Runtime</a> for the selected model.</span>
          </p>
          <div class="save-row">
            <button class="primary-button" (click)="saveSettings()" [disabled]="saving()">{{saving()?'Saving…':'Save defaults'}}</button>
            @if(saved()){<span role="status" class="saved-status">Saved</span>}
          </div>
          @if(saveError()){<p class="error-line" role="alert">{{saveError()}}</p>}
        </section>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .settings-card { max-width: 1050px; margin: 0 auto 16px; padding: 20px; }
    .api-card { margin-bottom: 16px; }
    .settings-tabs {
      max-width: 1050px; margin: 0 auto 16px; display: flex; gap: 8px; border-bottom: 1px solid #282f3d; padding-bottom: 0px;
    }
    .settings-tabs button {
      padding: 10px 16px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #8991a2; font: inherit; cursor: pointer; font-size: 13px; font-weight: 500;
    }
    .settings-tabs button:hover { color: #dee2f1; }
    .settings-tabs button.active { color: #adc6ff; border-bottom-color: #adc6ff; font-weight: 600; }
    .section-title { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid #282f3d; }
    .section-title h2 { font-size: 14px; font-weight: 600; margin: 0; color: #dee2f1; display: flex; align-items: center; gap: 8px; }
    .section-title p, .help { color: #8991a2; font-size: 12px; margin: 6px 0 0; font-family: 'JetBrains Mono', monospace; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 20px 24px; }
    .form-grid label { display: grid; align-content: start; gap: 8px; color: #8991a2; font-size: 12px; font-family: 'JetBrains Mono', monospace; }
    .form-grid select, .form-grid output { width: 100%; box-sizing: border-box; background: #171c26; border: 1px solid #282f3d; border-radius: 8px; padding: 10px 12px; color: #dee2f1; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .form-grid select:focus { outline: none; border-color: #a0caff; }
    .form-grid small { color: #8991a2; font-size: 11px; line-height: 1.5; margin-top: 4px; }
    .check-setting { display: flex !important; align-items: center; gap: 10px !important; min-height: 42px; font-weight: 600; color: #dee2f1; grid-template-columns: auto 1fr; cursor: pointer; }
    .check-setting span { font-family: 'Inter', sans-serif; font-size: 13px;}
    .check-setting input { width: 16px; height: 16px; accent-color: #3b82f6; border-radius: 4px; cursor: pointer; }
    .save-row { display: flex; align-items: center; gap: 12px; margin-top: 24px; }
    .saved-status { color: #34d399; font-size: 12px; font-family: 'JetBrains Mono', monospace; font-weight: 500; display: flex; align-items: center; gap: 4px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
    .info-note { margin: 20px 0 0; padding: 12px 16px; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; background: rgba(2, 44, 34, 0.2); color: #8991a2; font-size: 11px; line-height: 1.6; display: flex; align-items: flex-start; gap: 8px; }
    .info-note .icon { color: #34d399; font-size: 16px; }
    .info-note a { color: #a0caff; text-decoration: none; }
    .info-note a:hover { text-decoration: underline; }
    .paths-card output { overflow-wrap: anywhere; color: #dee2f1; }
    .input-row { display: flex; gap: 10px; margin-bottom: 8px; }
    .input-row input { max-width: 520px; flex: 1; min-width: 0; background: #171c26; border: 1px solid #282f3d; border-radius: 8px; padding: 10px 12px; color: #dee2f1; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .input-row input:focus { outline: none; border-color: #a0caff; }
    .field-label { display: block; color: #8991a2; font-size: 12px; margin-bottom: 8px; font-family: 'JetBrains Mono', monospace; }
    .status-tag { border: 1px solid #484438; background: #29251c; color: #fbbf24; border-radius: 6px; padding: 4px 8px; font-size: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
    .status-tag.ok { border-color: rgba(52, 211, 153, 0.3); background: rgba(2, 44, 34, 0.4); color: #34d399; }
    .help code { overflow-wrap: anywhere; background: #171c26; padding: 2px 4px; border-radius: 4px; }
    .primary-button { padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px 0 rgba(37, 99, 235, 0.2); transition: background 0.2s; }
    .primary-button:hover { background: #3b82f6; }
    .primary-button:disabled { background: #303540; color: #8c909f; cursor: not-allowed; box-shadow: none; }
    .secondary-button { padding: 8px 16px; background: #171c26; color: #dee2f1; border: 1px solid #282f3d; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .secondary-button:hover { background: #252a35; }
    @media(max-width: 600px) {
      .settings-card { padding: 16px; }
      .input-row { align-items: stretch; flex-direction: column; }
    }
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
        const [{ runtime }, installations] = await Promise.all([
          this.runtime.snapshot(),
          this.runtime.installations()
        ]);
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

  updateBehavior(value: string) {
    if (value === 'model' || value === 'global') this.edit(s => s.default_profile_behavior = value as 'model' | 'global');
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
      setTimeout(() => this.saved.set(false), 2500); // clear saved state visually after short period
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
