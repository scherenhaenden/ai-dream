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
    <div class="flex-1 flex flex-col h-full bg-[#090e18] overflow-y-auto p-6 space-y-6 text-[#e0e2ec]">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#282f3d]">
        <div>
          <h1 class="text-xl font-bold tracking-tight flex items-center gap-2">
            <span class="material-symbols-outlined text-[#a0caff]">settings</span>
            Workstation Engine & Hardware Preferences
          </h1>
          <p class="text-xs text-[#8991a2] mt-1 font-mono">
            Low-level compilation flags, llama.cpp execution parameters, and local network bindings.
          </p>
        </div>
        <div class="flex items-center gap-3">
          @if (saved()) {
            <span class="text-xs font-mono text-emerald-400 flex items-center gap-1 animate-pulse" role="status">
              <span class="material-symbols-outlined text-sm">check_circle</span>
              Saved
            </span>
          }
          <button (click)="saveSettings()" [disabled]="saving()" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-500/20 disabled:opacity-50">
            {{ saving() ? 'Saving...' : 'Save Changes' }}
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <nav class="flex gap-2 border-b border-[#282f3d] pb-2" aria-label="Settings categories" role="tablist">
        <button role="tab" [attr.aria-selected]="tab() === 'general'" [class]="tab() === 'general' ? 'px-4 py-2 text-sm font-semibold text-blue-400 border-b-2 border-blue-400' : 'px-4 py-2 text-sm font-medium text-[#8991a2] hover:text-[#e0e2ec]'" (click)="tab.set('general')">Application</button>
        <button role="tab" [attr.aria-selected]="tab() === 'runtime'" [class]="tab() === 'runtime' ? 'px-4 py-2 text-sm font-semibold text-blue-400 border-b-2 border-blue-400' : 'px-4 py-2 text-sm font-medium text-[#8991a2] hover:text-[#e0e2ec]'" (click)="tab.set('runtime')">Runtime defaults</button>
      </nav>

      @if (loading()) {
        <p class="text-xs font-mono text-[#8991a2]" role="status">Loading settings…</p>
      }
      @if (loadError()) {
        <div class="p-4 bg-red-950/20 border border-red-500/30 rounded-lg space-y-2">
          <p class="text-xs font-mono text-red-400" role="alert">{{ loadError() }}</p>
          <button (click)="initialize()" class="px-3 py-1 bg-red-900/50 hover:bg-red-900 text-red-100 rounded text-xs">Retry</button>
        </div>
      }

      @if (settings(); as s) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          @if (tab() === 'general') {
            <!-- API Server & Network -->
            <div class="bg-[#111722] border border-[#282f3d] rounded-xl p-5 space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-sm font-bold font-mono">
                  <span class="material-symbols-outlined text-[#a0caff]">lan</span>
                  API Server
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono border" [class]="api.connected() ? 'bg-emerald-950/30 text-emerald-400 border-emerald-500/30' : 'bg-amber-950/30 text-amber-400 border-amber-500/30'">
                  {{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Unavailable' }}
                </span>
              </div>
              <div class="space-y-4 text-xs">
                <div>
                  <label for="api-url" class="text-[#8991a2] font-mono block mb-1">Base URL</label>
                  <div class="flex gap-2">
                    <input id="api-url" type="url" [value]="url" (input)="url = $any($event.target).value" spellcheck="false" placeholder="http://127.0.0.1:8765" (keydown.enter)="saveApiUrl()" class="flex-1 bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]">
                    <button (click)="saveApiUrl()" class="px-3 py-2 bg-[#282f3d] hover:bg-[#363f4e] text-white rounded-lg font-bold">Check</button>
                  </div>
                  <p class="text-[10px] text-[#8991a2] mt-1">Health check: <code>GET {{ api.baseUrl() }}/api/health</code>. Stored in browser local storage.</p>
                  @if (urlError()) { <p class="text-red-400 mt-1" role="alert">{{ urlError() }}</p> }
                  @else if (api.error()) { <p class="text-amber-400 mt-1">{{ api.error() }}</p> }
                </div>
              </div>
            </div>

            <!-- Application Behavior -->
            <div class="bg-[#111722] border border-[#282f3d] rounded-xl p-5 space-y-4">
              <div class="flex items-center gap-2 text-sm font-bold font-mono">
                <span class="material-symbols-outlined text-[#a0caff]">tune</span>
                Application Behavior
              </div>
              <div class="space-y-4 text-xs">
                <div>
                  <label class="text-[#8991a2] font-mono block mb-1">Default Profile Behavior</label>
                  <select [value]="s.default_profile_behavior" (change)="updateBehavior($any($event.target).value)" class="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]">
                    <option value="model">Use the model profile</option>
                    <option value="global">Use global defaults</option>
                  </select>
                  <p class="text-[10px] text-[#8991a2] mt-1">Model-specific placement and load options belong to each model profile.</p>
                </div>
                <div class="flex items-center justify-between p-3 bg-[#171c26] rounded-lg border border-[#282f3d]">
                  <div>
                    <div class="font-mono font-bold">Keep last model loaded</div>
                    <div class="text-[11px] text-[#8991a2]">Do not unload the model after requests complete.</div>
                  </div>
                  <input type="checkbox" [checked]="s.keep_last_model_loaded" (change)="updateKeepLoaded($any($event.target).checked)" class="w-4 h-4 accent-blue-600 rounded cursor-pointer">
                </div>
              </div>
              @if (saveError()) { <p class="text-red-400 text-xs mt-2" role="alert">{{ saveError() }}</p> }
            </div>

            <!-- Local Paths -->
            <div class="bg-[#111722] border border-[#282f3d] rounded-xl p-5 space-y-4 md:col-span-2">
              <div class="flex items-center gap-2 text-sm font-bold font-mono">
                <span class="material-symbols-outlined text-[#a0caff]">folder</span>
                Local Paths (Read-only)
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label class="text-[#8991a2] font-mono block mb-1">Managed Models</label>
                  <div class="bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-[#aab4c5] font-mono break-all">{{ s.managed_models_dir }}</div>
                </div>
                <div>
                  <label class="text-[#8991a2] font-mono block mb-1">Configuration</label>
                  <div class="bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-[#aab4c5] font-mono break-all">{{ s.config_dir }}</div>
                </div>
                <div>
                  <label class="text-[#8991a2] font-mono block mb-1">Data</label>
                  <div class="bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-[#aab4c5] font-mono break-all">{{ s.data_dir }}</div>
                </div>
              </div>
            </div>

          } @else {
            <!-- Runtime Defaults -->
            <div class="bg-[#111722] border border-[#282f3d] rounded-xl p-5 space-y-4 md:col-span-2">
              <div class="flex items-center gap-2 text-sm font-bold font-mono">
                <span class="material-symbols-outlined text-[#a0caff]">memory</span>
                Runtime Engine Defaults
              </div>
              <p class="text-xs text-[#8991a2] mb-4">Choose the default engine for new model loads. GPU placement and load tuning are configured per model.</p>

              @if (runtimeError()) { <p class="text-xs font-mono text-red-400 p-3 bg-red-950/20 border border-red-500/30 rounded-lg mb-4" role="alert">{{ runtimeError() }}</p> }

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label class="text-[#8991a2] font-mono block mb-1">Default Backend</label>
                  <select [value]="s.runtime_defaults.backend_name || ''" (change)="updateBackend($any($event.target).value)" class="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]">
                    <option value="">Use runtime default</option>
                    @for (b of backends(); track b.name) {
                      <option [value]="b.name" [disabled]="!b.available">{{ b.name }}{{ b.available ? '' : ' (unavailable)' }}</option>
                    }
                  </select>
                  <p class="text-[10px] text-[#8991a2] mt-1">Available choices come from the local runtime service.</p>
                </div>

                <div>
                  <label class="text-[#8991a2] font-mono block mb-1">Default Runtime</label>
                  <select [value]="s.runtime_defaults.runtime_id || ''" (change)="updateRuntime($any($event.target).value)" class="w-full bg-[#171c26] border border-[#282f3d] rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#a0caff]">
                    <option value="">Use backend default</option>
                    @for (r of installations(); track r.id) {
                      <option [value]="r.id" [disabled]="!r.enabled || !r.available">{{ r.name }} · {{ r.backend || r.kind }}{{ r.available ? '' : ' (unavailable)' }}</option>
                    }
                  </select>
                  <p class="text-[10px] text-[#8991a2] mt-1">Registered llama.cpp installations detected by AI Dream.</p>
                </div>
              </div>

              <div class="p-4 mt-4 bg-blue-950/20 border border-blue-500/30 rounded-lg space-y-1.5">
                <div class="flex items-center gap-2 text-blue-400 font-bold font-mono text-xs">
                  <span class="material-symbols-outlined text-base">info</span>
                  Model-Specific Configuration
                </div>
                <p class="text-[11px] text-[#8991a2] leading-relaxed">
                  Context size, GPU layers, device placement, tensor split, and other load options are model-specific. Configure them from the Runtime page for the selected model.
                </p>
              </div>
              @if (saveError()) { <p class="text-red-400 text-xs mt-2" role="alert">{{ saveError() }}</p> }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
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
