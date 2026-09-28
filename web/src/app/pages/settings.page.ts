import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { RuntimeInstallation } from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService } from '../core/runtime.service';
import { GlobalSettings, SettingsService } from '../core/settings.service';

type SettingsTab = 'general' | 'runtime';

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
          <button class="primary-button" (click)="saveSettings()" [disabled]="saving() || !settings()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </header>

      <nav class="settings-tabs" aria-label="Settings categories" role="tablist">
        <button role="tab" [attr.aria-selected]="tab() === 'general'" [class.active]="tab() === 'general'" (click)="tab.set('general')">Application</button>
        <button role="tab" [attr.aria-selected]="tab() === 'runtime'" [class.active]="tab() === 'runtime'" (click)="tab.set('runtime')">Runtime defaults</button>
      </nav>

      @if (loading()) { <p class="settings-message" role="status">Loading settings…</p> }
      @if (loadError()) {
        <div class="settings-alert" role="alert">
          <span>{{ loadError() }}</span>
          <button class="secondary-button" (click)="initialize()">Retry</button>
        </div>
      }

      @if (settings(); as s) {
        @if (tab() === 'general') {
          <div class="settings-grid">
            <section class="surface settings-card">
              <div class="section-heading">
                <div><h2>Local API</h2><p>Requests stay on this device.</p></div>
                <span class="status-tag" [class.ok]="api.connected()">{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Unavailable' }}</span>
              </div>
              <label class="field-label" for="api-url">Base URL</label>
              <div class="input-row">
                <input id="api-url" type="url" [value]="url" (input)="url = $any($event.target).value" spellcheck="false" placeholder="http://127.0.0.1:8765" (keydown.enter)="saveApiUrl()">
                <button class="secondary-button" (click)="saveApiUrl()">Save &amp; check</button>
              </div>
              <p class="help">Health check: <code>GET {{ api.baseUrl() }}/api/health</code>. The URL is stored in this browser.</p>
              @if (urlError()) { <p class="error-line" role="alert">{{ urlError() }}</p> }
              @else if (api.error()) { <p class="error-line">{{ api.error() }}</p> }
            </section>

            <section class="surface settings-card">
              <div class="section-heading"><div><h2>Application behavior</h2><p>Choose how saved model profiles are applied.</p></div></div>
              <label class="setting-field" for="profile-behavior">
                <span>Default profile behavior</span>
                <select id="profile-behavior" [value]="s.default_profile_behavior" (change)="updateBehavior($any($event.target).value)">
                  <option value="model">Use the model profile</option>
                  <option value="global">Use global defaults</option>
                </select>
              </label>
              <p class="help">Model-specific placement and load settings belong in each model’s profile.</p>
              <label class="toggle-row">
                <span><b>Keep last model loaded</b><small>Keep the active model available after a request finishes.</small></span>
                <input type="checkbox" [checked]="s.keep_last_model_loaded" (change)="updateKeepLoaded($any($event.target).checked)">
              </label>
              @if (saveError()) { <p class="error-line" role="alert">{{ saveError() }}</p> }
            </section>

            <section class="surface settings-card paths-card">
              <div class="section-heading"><div><h2>Local paths</h2><p>Read-only locations used by this installation.</p></div></div>
              <div class="path-grid">
                <label>Managed models directory<output>{{ s.managed_models_dir }}</output></label>
                <label>Configuration directory<output>{{ s.config_dir }}</output></label>
                <label>Data directory<output>{{ s.data_dir }}</output></label>
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
                <select id="default-backend" [value]="s.runtime_defaults.backend_name || ''" (change)="updateBackend($any($event.target).value)">
                  <option value="">Runtime default</option>
                  @for (b of backends(); track b.name) { <option [value]="b.name" [disabled]="!b.available">{{ b.name }}{{ b.available ? '' : ' (unavailable)' }}</option> }
                </select>
                <small>Available backends reported by the local runtime service.</small>
              </label>
              <label class="setting-field" for="default-runtime">
                <span>Default runtime</span>
                <select id="default-runtime" [value]="s.runtime_defaults.runtime_id || ''" (change)="updateRuntime($any($event.target).value)">
                  <option value="">Backend default</option>
                  @for (r of installations(); track r.id) { <option [value]="r.id" [disabled]="!r.enabled || !r.available">{{ r.name }} · {{ r.backend || r.kind }}{{ r.available ? '' : ' (unavailable)' }}</option> }
                </select>
                <small>Installed runtimes registered with AI Dream.</small>
              </label>
            </div>
            <aside class="model-profile-note">
              <b>Model configuration lives with each model</b>
              <p>Context size, GPU placement, split mode, tensor split, and other load options can vary by model. Configure them in the model profile from <a href="#/models">Models</a> or when loading from <a href="#/runtime">Runtime</a>.</p>
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
