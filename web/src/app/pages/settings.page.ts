import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { RuntimeInstallation } from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService } from '../core/runtime.service';
import { GlobalSettings, SettingsService } from '../core/settings.service';

type SettingsTab = 'general' | 'runtime';

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: `
<div class="page-head"><div><div class="eyebrow">PREFERENCES</div><h1>Settings</h1><p>Application-wide preferences and runtime defaults.</p></div><span class="page-badge"><i></i>LOCAL</span></div>
<section class="surface settings-card api-card"><div class="section-title"><div><h2>Local API</h2><p>Requests stay on your machine.</p></div><span class="status-tag" [class.ok]="api.connected()">{{ api.connected() ? 'Connected' : api.connection() === 'checking' ? 'Checking' : 'Unavailable' }}</span></div><label class="field-label" for="api-url">Base URL</label><div class="input-row"><input id="api-url" type="url" [value]="url" (input)="url = $any($event.target).value" spellcheck="false" placeholder="http://127.0.0.1:8765" (keydown.enter)="saveApiUrl()"><button class="primary-button" (click)="saveApiUrl()">Save & check</button></div><p class="help">Health check: <code>GET {{ api.baseUrl() }}/api/health</code>. The base URL is stored in this browser's local storage.</p>@if (urlError()) {<p class="error-line" role="alert">{{urlError()}}</p>} @else if (api.error()) {<p class="error-line">{{ api.error() }}</p>}</section>
@if(loading()){<p role="status">Loading settings…</p>}
@if(loadError()){<section class="surface settings-card"><p class="error-line" role="alert">{{loadError()}}</p><button class="secondary-button" (click)="initialize()">Retry settings</button></section>}
@if(settings(); as s){
  <nav class="settings-tabs" aria-label="Settings categories" role="tablist">
    <button role="tab" [attr.aria-selected]="tab()==='general'" [class.active]="tab()==='general'" (click)="tab.set('general')">Application</button>
    <button role="tab" [attr.aria-selected]="tab()==='runtime'" [class.active]="tab()==='runtime'" (click)="tab.set('runtime')">Runtime defaults</button>
  </nav>
  @if(tab()==='general'){
    <section class="surface settings-card">
      <div class="section-title"><div><h2>Application behavior</h2><p>Settings that apply across models.</p></div></div>
      <div class="form-grid">
        <label>Default profile behavior<select [value]="s.default_profile_behavior" (change)="updateBehavior($any($event.target).value)"><option value="model">Use the model profile</option><option value="global">Use global defaults</option></select><small>Model-specific placement and load options belong to each model profile.</small></label>
        <label class="check-setting"><input type="checkbox" [checked]="s.keep_last_model_loaded" (change)="updateKeepLoaded($any($event.target).checked)">Keep last model loaded</label>
      </div>
      <div class="save-row"><button class="primary-button" (click)="saveSettings()" [disabled]="saving()">{{saving()?'Saving…':'Save settings'}}</button>@if(saved()){<span role="status">Saved</span>}</div>@if(saveError()){<p class="error-line" role="alert">{{saveError()}}</p>}
    </section>
    <section class="surface settings-card paths-card"><div class="section-title"><div><h2>Local paths</h2><p>Read-only diagnostics. AI Dream does not expose filesystem browsing here.</p></div></div><div class="form-grid"><label>Managed models directory<output>{{s.managed_models_dir}}</output></label><label>Configuration directory<output>{{s.config_dir}}</output></label><label>Data directory<output>{{s.data_dir}}</output></label></div></section>
  } @else {
    <section class="surface settings-card">
      <div class="section-title"><div><h2>Runtime defaults</h2><p>Choose the default engine for new model loads. GPU placement and load tuning are configured per model.</p></div></div>
      @if(runtimeError()){<p class="error-line" role="alert">{{runtimeError()}}</p>}
      <div class="form-grid runtime-grid">
        <label>Default backend<select [value]="s.runtime_defaults.backend_name||''" (change)="updateBackend($any($event.target).value)"><option value="">Use runtime default</option>@for(b of backends();track b.name){<option [value]="b.name" [disabled]="!b.available">{{b.name}}{{b.available?'':' (unavailable)'}}</option>}</select><small>Available choices come from the local runtime service.</small></label>
        <label>Default runtime<select [value]="s.runtime_defaults.runtime_id||''" (change)="updateRuntime($any($event.target).value)"><option value="">Use backend default</option>@for(r of installations();track r.id){<option [value]="r.id" [disabled]="!r.enabled||!r.available">{{r.name}} · {{r.backend||r.kind}}{{r.available?'':' (unavailable)'}}</option>}</select><small>Registered llama.cpp installations detected by AI Dream.</small></label>
      </div>
      <p class="info-note">Context size, GPU layers, device placement, tensor split, and other load options are model-specific. Configure them from <a href="#/runtime">Runtime</a> for the selected model.</p>
      <div class="save-row"><button class="primary-button" (click)="saveSettings()" [disabled]="saving()">{{saving()?'Saving…':'Save defaults'}}</button>@if(saved()){<span role="status">Saved</span>}</div>@if(saveError()){<p class="error-line" role="alert">{{saveError()}}</p>}
    </section>
  }
}`,
styles: [`
  :host{display:block}.settings-card{max-width:1050px;margin:0 auto 14px;padding:20px}.api-card{margin-bottom:14px}.settings-tabs{max-width:1050px;margin:0 auto 12px;display:flex;gap:6px;border-bottom:1px solid #2e3541}.settings-tabs button{padding:10px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);font:inherit;cursor:pointer}.settings-tabs button.active{color:var(--text);border-color:var(--accent)}.section-title{display:flex;justify-content:space-between;align-items:center;padding-bottom:15px;margin-bottom:18px;border-bottom:1px solid #2e3541}.section-title h2{font-size:14px;font-weight:600;margin:0}.section-title p,.help{color:#929aaa;font-size:11px;margin:5px 0 0}.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px 22px}.form-grid label{display:grid;align-content:start;gap:7px;color:#bdc4d2;font-size:12px}.form-grid select,.form-grid output{width:100%;box-sizing:border-box;background:#10151e;border:1px solid #363f4e;border-radius:7px;padding:10px 11px;color:var(--text);font:inherit}.form-grid small{color:#8892a2;font-size:10px;line-height:1.5}.check-setting{display:flex!important;align-items:center;gap:9px!important;min-height:40px}.check-setting input{width:16px;height:16px}.save-row{display:flex;align-items:center;gap:10px;margin-top:20px}.info-note{margin:18px 0 0;padding:11px 13px;border:1px solid #303a49;border-radius:7px;background:#141a24;color:#9da8ba;font-size:11px;line-height:1.6}.info-note a{color:#a9c4ff}.paths-card output{overflow-wrap:anywhere;color:#aab4c5;font:11px ui-monospace,monospace}.input-row{display:flex;gap:8px}.input-row input{max-width:520px;flex:1;min-width:0;background:#0f141d;border:1px solid #3b4351;border-radius:6px;padding:9px 10px;color:var(--text);font:11px ui-monospace,monospace}.field-label{display:block;color:#bdc4d2;font-size:11px;margin-bottom:7px}.status-tag{border:1px solid #484438;background:#29251c;color:var(--amber);border-radius:5px;padding:4px 7px;font:9px ui-monospace,monospace}.status-tag.ok{border-color:#275542;background:#162b24;color:var(--green)}.help code{overflow-wrap:anywhere}@media(max-width:600px){.settings-card{padding:15px}.input-row{align-items:stretch;flex-direction:column}}
`] })
export class SettingsPage implements OnInit {
  url=this.api.baseUrl(); readonly urlError=signal(''); readonly loading=signal(false); readonly saving=signal(false); readonly saved=signal(false);
  readonly loadError=signal(''); readonly runtimeError=signal(''); readonly saveError=signal(''); readonly settings=signal<GlobalSettings|null>(null);
  readonly tab=signal<SettingsTab>('general'); readonly backends=signal<RuntimeBackend[]>([]); readonly installations=signal<RuntimeInstallation[]>([]);
  constructor(readonly api:ApiService,private readonly settingsApi:SettingsService,private readonly runtime:RuntimeService){}
  ngOnInit(){void this.initialize();}
  saveApiUrl(){if(!this.api.setBaseUrl(this.url)){this.urlError.set('Use http://127.0.0.1:<port> or http://localhost:<port> with a port from 1 to 65535.');return;}this.urlError.set('');void this.initialize();}
  async initialize(){this.loading.set(true);this.loadError.set('');this.runtimeError.set('');try{await this.api.check();const response=await this.settingsApi.get();this.settings.set(response.data?.settings??null);if(!response.data?.settings)throw new Error('The settings endpoint returned no settings object.');try{const [{runtime},installations]=await Promise.all([this.runtime.snapshot(),this.runtime.installations()]);this.backends.set(runtime.backends);this.installations.set(installations);}catch(e){this.runtimeError.set(message(e));}}catch(e){this.loadError.set(message(e));}finally{this.loading.set(false);}}
  updateBackend(value:string){this.edit(s=>s.runtime_defaults.backend_name=value||null);}
  updateRuntime(value:string){this.edit(s=>s.runtime_defaults.runtime_id=value||null);}
  updateBehavior(value:string){if(value==='model'||value==='global')this.edit(s=>s.default_profile_behavior=value);}
  updateKeepLoaded(value:boolean){this.edit(s=>s.keep_last_model_loaded=value);}
  private edit(change:(settings:GlobalSettings)=>void){const current=this.settings();if(!current)return;const next=structuredClone(current);change(next);this.settings.set(next);this.saved.set(false);}
  async saveSettings(){const current=this.settings();if(!current)return;this.saving.set(true);this.saveError.set('');this.saved.set(false);try{const {managed_models_dir,config_dir,data_dir,...editable}=current;const response=await this.settingsApi.patch(editable);if(response.data?.settings)this.settings.set(response.data.settings);this.saved.set(true);}catch(e){this.saveError.set(message(e));}finally{this.saving.set(false);}}
}
function message(e:unknown):string{return e instanceof Error?e.message:String(e);}
