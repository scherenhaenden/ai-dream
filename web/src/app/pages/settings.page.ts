import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { RuntimeInstallation } from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService } from '../core/runtime.service';
import { GlobalSettings, SettingsService } from '../core/settings.service';

type SettingsSection = 'api' | 'application' | 'paths' | 'runtime';

@Component({
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

    @if (loading()) {
      <p role="status" class="surface loading-surface" style="max-width:1050px; margin:0 auto 14px; padding:20px;">Loading settings…</p>
    }
    @if (loadError()) {
      <section class="surface settings-card">
        <p class="error-line" role="alert">{{ loadError() }}</p>
        <button class="secondary-button" (click)="initialize()">Retry settings</button>
      </section>
    }

    <div class="settings-layout">
      <!-- Side Navigation -->
      <nav class="settings-nav" aria-label="Settings categories">
        <button [class.active]="activeSection() === 'api'" (click)="activeSection.set('api')">
          <span class="icon">lan</span> Local API
        </button>
        <button [class.active]="activeSection() === 'application'" (click)="activeSection.set('application')" [disabled]="!settings()">
          <span class="icon">settings_applications</span> Application
        </button>
        <button [class.active]="activeSection() === 'runtime'" (click)="activeSection.set('runtime')" [disabled]="!settings()">
          <span class="icon">memory</span> Runtime Defaults
        </button>
        <button [class.active]="activeSection() === 'paths'" (click)="activeSection.set('paths')" [disabled]="!settings()">
          <span class="icon">folder_open</span> Local Paths
        </button>
      </nav>

      <!-- Main Content Area -->
      <div class="settings-content">
        @if (activeSection() === 'api') {
          <section class="surface settings-card">
            <div class="section-title">
              <div>
                <h2>Local API Connection</h2>
                <p>Requests stay on your machine. Network binding and ports.</p>
              </div>
              <span class="status-tag" [class.ok]="api.connected()">{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Unavailable' }}</span>
            </div>
            <label class="field-label" for="api-url">Base URL</label>
            <div class="input-row">
              <input id="api-url" type="url" [value]="url" (input)="url = $any($event.target).value" spellcheck="false" placeholder="http://127.0.0.1:8765" (keydown.enter)="saveApiUrl()">
              <button class="primary-button" (click)="saveApiUrl()">Save & check</button>
            </div>
            <p class="help">Health check: <code>GET {{ api.baseUrl() }}/api/health</code>. The base URL is stored in this browser's local storage.</p>
            @if (urlError()) {
              <p class="error-line" role="alert">{{ urlError() }}</p>
            } @else if (api.error()) {
              <p class="error-line">{{ api.error() }}</p>
            }
          </section>
        }

        @if (settings(); as s) {
          @if (activeSection() === 'application') {
            <section class="surface settings-card">
              <div class="section-title">
                <div>
                  <h2>Application behavior</h2>
                  <p>Settings that apply across models globally.</p>
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
                  Keep last model loaded
                </label>
              </div>
              <div class="save-row">
                <button class="primary-button" (click)="saveSettings()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save settings' }}</button>
                @if (saved()) { <span role="status" class="saved-msg">✓ Saved</span> }
              </div>
              @if (saveError()) { <p class="error-line" role="alert">{{ saveError() }}</p> }
            </section>
          }

          @if (activeSection() === 'runtime') {
            <section class="surface settings-card">
              <div class="section-title">
                <div>
                  <h2>Runtime defaults</h2>
                  <p>Choose the default engine for new model loads.</p>
                </div>
              </div>
              @if (runtimeError()) { <p class="error-line" role="alert">{{ runtimeError() }}</p> }
              <div class="form-grid runtime-grid">
                <label>
                  Default backend
                  <select [value]="s.runtime_defaults.backend_name||''" (change)="updateBackend($any($event.target).value)">
                    <option value="">Use runtime default</option>
                    @for (b of backends(); track b.name) {
                      <option [value]="b.name" [disabled]="!b.available">{{ b.name }}{{ b.available ? '' : ' (unavailable)' }}</option>
                    }
                  </select>
                  <small>Available choices come from the local runtime service.</small>
                </label>
                <label>
                  Default runtime
                  <select [value]="s.runtime_defaults.runtime_id||''" (change)="updateRuntime($any($event.target).value)">
                    <option value="">Use backend default</option>
                    @for (r of installations(); track r.id) {
                      <option [value]="r.id" [disabled]="!r.enabled||!r.available">{{ r.name }} · {{ r.backend || r.kind }}{{ r.available ? '' : ' (unavailable)' }}</option>
                    }
                  </select>
                  <small>Registered llama.cpp installations detected by AI Dream.</small>
                </label>
              </div>
              <p class="info-note">Context size, GPU layers, device placement, tensor split, and other load options are model-specific. Configure them from <a href="#/runtime">Runtime</a> for the selected model.</p>
              <div class="save-row">
                <button class="primary-button" (click)="saveSettings()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save defaults' }}</button>
                @if (saved()) { <span role="status" class="saved-msg">✓ Saved</span> }
              </div>
              @if (saveError()) { <p class="error-line" role="alert">{{ saveError() }}</p> }
            </section>
          }

          @if (activeSection() === 'paths') {
            <section class="surface settings-card paths-card">
              <div class="section-title">
                <div>
                  <h2>Local paths</h2>
                  <p>Read-only diagnostics. AI Dream does not expose filesystem browsing here.</p>
                </div>
              </div>
              <div class="form-grid">
                <label>Managed models directory<output>{{ s.managed_models_dir }}</output></label>
                <label>Configuration directory<output>{{ s.config_dir }}</output></label>
                <label>Data directory<output>{{ s.data_dir }}</output></label>
              </div>
            </section>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .settings-layout {
      display: flex;
      gap: 24px;
      max-width: 1050px;
      margin: 0 auto;
      align-items: flex-start;
    }
    .settings-nav {
      flex: 0 0 220px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: #10151e;
      border: 1px solid #2e3541;
      border-radius: 12px;
      padding: 8px;
    }
    .settings-nav button {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: none;
      background: transparent;
      color: #929aaa;
      font-size: 13px;
      font-family: inherit;
      text-align: left;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .settings-nav button:hover:not(:disabled) {
      background: #1a2230;
      color: #dee2f1;
    }
    .settings-nav button.active {
      background: #253750;
      color: #a0caff;
      font-weight: 500;
    }
    .settings-nav button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .settings-nav .icon {
      font-family: 'Material Symbols Outlined', sans-serif;
      font-size: 18px;
      font-weight: normal;
      font-style: normal;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      display: inline-block;
      white-space: nowrap;
      word-wrap: normal;
      direction: ltr;
      -webkit-font-feature-settings: 'liga';
      -webkit-font-smoothing: antialiased;
    }

    .settings-content {
      flex: 1;
      min-width: 0;
    }
    .settings-card {
      padding: 24px;
      border: 1px solid #2e3541;
      border-radius: 12px;
      margin-bottom: 20px;
      background: #111722;
    }
    .section-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      margin-bottom: 20px;
      border-bottom: 1px solid #2e3541;
    }
    .section-title h2 {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
      color: #dee2f1;
    }
    .section-title p, .help {
      color: #8991a2;
      font-size: 12px;
      margin: 6px 0 0;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
      gap: 20px 24px;
    }
    .form-grid label {
      display: grid;
      align-content: start;
      gap: 8px;
      color: #bdc4d2;
      font-size: 12px;
    }
    .form-grid select, .form-grid output {
      width: 100%;
      box-sizing: border-box;
      background: #171c26;
      border: 1px solid #2e3541;
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text);
      font: inherit;
    }
    .form-grid small {
      color: #8892a2;
      font-size: 11px;
      line-height: 1.5;
    }
    .check-setting {
      display: flex !important;
      align-items: center;
      gap: 10px !important;
      min-height: 40px;
    }
    .check-setting input {
      width: 16px;
      height: 16px;
      accent-color: #5473a7;
    }
    .save-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 24px;
    }
    .saved-msg {
      color: #4edea3;
      font-size: 12px;
      font-family: ui-monospace, monospace;
    }
    .info-note {
      margin: 20px 0 0;
      padding: 12px 16px;
      border: 1px solid #105a3b;
      border-radius: 8px;
      background: rgba(16, 90, 59, 0.15);
      color: #4edea3;
      font-size: 12px;
      line-height: 1.6;
    }
    .info-note a {
      color: #adc6ff;
    }
    .paths-card output {
      overflow-wrap: anywhere;
      color: #aab4c5;
      font: 11px ui-monospace, monospace;
    }
    .input-row {
      display: flex;
      gap: 10px;
    }
    .input-row input {
      max-width: 520px;
      flex: 1;
      min-width: 0;
      background: #171c26;
      border: 1px solid #2e3541;
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text);
      font: 12px ui-monospace, monospace;
    }
    .field-label {
      display: block;
      color: #bdc4d2;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .status-tag {
      border: 1px solid #484438;
      background: #29251c;
      color: var(--amber);
      border-radius: 6px;
      padding: 4px 8px;
      font: 10px ui-monospace, monospace;
    }
    .status-tag.ok {
      border-color: #275542;
      background: #162b24;
      color: var(--green);
    }
    .help code {
      overflow-wrap: anywhere;
    }
    @media (max-width: 768px) {
      .settings-layout {
        flex-direction: column;
      }
      .settings-nav {
        flex: auto;
        width: 100%;
        flex-direction: row;
        overflow-x: auto;
      }
      .settings-nav button {
        white-space: nowrap;
      }
      .settings-card {
        padding: 16px;
      }
      .input-row {
        flex-direction: column;
        align-items: stretch;
      }
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
  readonly settings = signal<GlobalSettings|null>(null);

  readonly activeSection = signal<SettingsSection>('api');
  readonly backends = signal<RuntimeBackend[]>([]);
  readonly installations = signal<RuntimeInstallation[]>([]);

  constructor(readonly api: ApiService, private readonly settingsApi: SettingsService, private readonly runtime: RuntimeService) {}

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
        const [{runtime}, installations] = await Promise.all([this.runtime.snapshot(), this.runtime.installations()]);
        this.backends.set(runtime.backends);
        this.installations.set(installations);
      } catch (e) {
        this.runtimeError.set(message(e));
      }

      // If settings are loaded and we were on API but it's connected, we might want to stay or switch, let's keep it user's choice.
      if (this.activeSection() === 'api' && this.settings()) {
          this.activeSection.set('application');
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
      setTimeout(() => this.saved.set(false), 2500);
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
