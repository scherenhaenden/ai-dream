import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../core/api.service';
import { ModelRecord, RuntimeCapabilities, RuntimeDevice, RuntimeInstallation, RuntimeLoadOptions, RuntimePlacement } from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService, RuntimeSettingsRequest } from '../core/runtime.service';

type CapabilityKey = keyof RuntimeCapabilities;
type PlacementKey = keyof RuntimePlacement;
type LoadKey = keyof RuntimeLoadOptions;
type BackendWithOptions = RuntimeBackend & { split_modes?: string[]; split_mode_options?: string[] };
type ExtendedCapabilities = RuntimeCapabilities & { continuous_batching_disable?: boolean; split_modes?: string[] };
type RuntimeValues = Partial<RuntimePlacement & RuntimeLoadOptions>;
type RuntimeTab = 'placement' | 'load' | 'advanced';

@Component({ standalone: true, imports: [JsonPipe], changeDetection: ChangeDetectionStrategy.OnPush, template: `
<div class="page-head"><div><div class="eyebrow">SYSTEM</div><h1>Runtime</h1><p>Choose and load a model without sending a chat message.</p></div></div>
@if (!api.connected()) {<div class="chat-notice error-notice"><b>Local API unavailable</b><p>Start AI Dream, then retry.</p><button (click)="initialize()">Retry</button></div>}
@if (loading()) {<p role="status">Loading runtime options…</p>}
<section class="surface runtime-card">
  <div class="runtime-select-grid">
    <label class="model-select-field">Model<select [value]="modelId()" (change)="modelId.set($any($event.target).value)"><option value="">Select a model</option>@for(m of models();track m.id){<option [value]="m.id">{{modelName(m)}}</option>}</select>@if(selectedModelPath()){<small class="model-path" [title]="selectedModelPath()">{{selectedModelPath()}}</small>}</label>
    <label>Backend<select [value]="backendName()" (change)="setBackend($any($event.target).value)"><option value="">Select backend</option>@for(b of backends();track b.name){<option [value]="b.name" [disabled]="!b.available">{{b.name}}{{b.available?'':' (unavailable)'}}</option>}</select></label>
    @if(installations().length){<label>Runtime<select [value]="runtimeId()" (change)="setInstallation($any($event.target).value)"><option value="">Backend default</option>@for(r of installations();track r.id){<option [value]="r.id" [disabled]="!r.enabled||!r.available">{{r.name}} · {{r.backend||r.kind}}</option>}</select></label>}
    @if (supports('device_selection')) {<label>GPU / device<select [value]="manualDevice()? '' : device()" (change)="setDetectedDevice($any($event.target).value)"><option value="">Runtime default</option>@for(d of devices();track d.runtime_id||d.id){<option [value]="nativeId(d)">{{d.name}} · {{nativeId(d)}}</option>}</select></label>}
  </div>
  <section class="settings-panel" aria-label="Runtime load settings">
    <div class="panel-heading"><div><h2>Model load configuration</h2><p>Options are limited to capabilities advertised by the selected runtime.</p></div></div>
    <nav class="runtime-tabs" aria-label="Runtime setting categories" role="tablist"><button role="tab" [attr.aria-selected]="settingsTab()==='placement'" [class.active]="settingsTab()==='placement'" (click)="settingsTab.set('placement')">Placement</button><button role="tab" [attr.aria-selected]="settingsTab()==='load'" [class.active]="settingsTab()==='load'" (click)="settingsTab.set('load')">Load settings</button><button role="tab" [attr.aria-selected]="settingsTab()==='advanced'" [class.active]="settingsTab()==='advanced'" (click)="settingsTab.set('advanced')">Advanced</button></nav>
    @if(settingsTab()==='placement'){
      <div class="settings-grid">
        @for(f of placementNumbers;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input type="number" min="0" [value]="values()[f.key]??''" (input)="setValue(f.key,$any($event.target).value)"></label>}}
        @if(supports('split_mode')){@if(splitModes().length){<label>Split mode<select [value]="values().split_mode||''" (change)="setValue('split_mode',$any($event.target).value)"><option value="">Runtime default</option>@for(mode of splitModes();track mode){<option [value]="mode">{{mode}}</option>}</select></label>}@else{<label>Split mode<input [value]="values().split_mode||''" (input)="setValue('split_mode',$any($event.target).value)"></label>}}
        @if(supports('tensor_split')){<label>Tensor split<input [value]="values().tensor_split||''" (input)="setValue('tensor_split',$any($event.target).value)"></label>}
        @if(supports('main_gpu')){<label>Main GPU<input type="number" min="0" [value]="values().main_gpu??''" (input)="setValue('main_gpu',$any($event.target).value)"></label>}
        @if(!hasPlacementOptions()){<p class="empty-options">No placement options are advertised by this runtime.</p>}
      </div>
    } @else if(settingsTab()==='load'){
      <div class="settings-grid">
        @for(f of loadNumbers;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input type="number" min="0" [value]="values()[f.key]??''" (input)="setValue(f.key,$any($event.target).value)"></label>}}
        @for(f of booleanFields;track f.key){@if(supports(f.cap)){<label class="check-setting"><input type="checkbox" [checked]="values()[f.key]??false" (change)="setValue(f.key,$any($event.target).checked)">{{f.label}}</label>}}
        @if(!hasLoadOptions()){<p class="empty-options">No load settings are advertised by this runtime.</p>}
      </div>
    } @else {
      <div class="settings-grid">
        @for(f of loadStrings;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input [value]="values()[f.key]??''" (input)="setValue(f.key,$any($event.target).value)"></label>}}
        @if(supports('mmap')){<label class="check-setting"><input type="checkbox" [checked]="values().mmap??true" [disabled]="!supports('mmap_disable')" (change)="setValue('mmap',$any($event.target).checked)">Memory map</label>}
        @if(supports('continuous_batching')){<label class="check-setting"><input type="checkbox" [checked]="values().continuous_batching??true" [disabled]="!supports('continuous_batching_disable')" (change)="setValue('continuous_batching',$any($event.target).checked)">Continuous batching</label>}
        @if(supports('device_selection')){<details class="manual-device"><summary>Manual device override</summary><label class="check-setting"><input type="checkbox" [checked]="manualDevice()" (change)="toggleManualDevice($any($event.target).checked)">Use a manual runtime device ID</label>@if(manualDevice()){<label>Runtime device ID<input [value]="device()" (input)="device.set($any($event.target).value)" placeholder="ROCm0, Vulkan1, CUDA0…"><small>Prefer the detected device selector above. The override is checked as a runtime-native ID.</small></label>@if(deviceError()){<small class="validation-error" role="alert">{{deviceError()}}</small>}}</details>}
        @if(!hasAdvancedOptions()){<p class="empty-options">No additional options are advertised by this runtime.</p>}
      </div>
    }
  </section>
  <div class="action-row"><button class="primary-button" (click)="load()" [disabled]="busy()||!modelId()||!api.connected()||!!deviceError()">Load model</button><button class="secondary-button" (click)="unload()" [disabled]="busy()||!api.connected()">Unload model</button><button class="secondary-button" (click)="load()" [disabled]="busy()||!modelId()||!api.connected()||!!deviceError()">Reload model</button><button class="secondary-button" (click)="refreshStatus()" [disabled]="busy()||!api.connected()">Runtime status</button><button class="secondary-button" (click)="showCommand()" [disabled]="busy()||!modelId()||!!deviceError()">Show effective llama.cpp command</button></div>
  @if(notice()){<p class="runtime-notice" role="status">{{notice()}}</p>}@if(error()){<p class="error-line" role="alert">{{error()}}</p>}
  @if(status()){<details class="status-panel"><summary>Runtime status</summary><pre>{{status()|json}}</pre></details>}
  @if(command()){<section class="command-panel"><label>Effective llama.cpp command<textarea readonly rows="3" [value]="command()"></textarea></label><button class="secondary-button" (click)="copyCommand()">{{copied()?'Copied':'Copy command'}}</button></section>}
</section>` , styles:[`
:host{display:block}.runtime-card{max-width:1050px;margin:0 auto;padding:20px;display:grid;gap:18px;min-width:0}.runtime-select-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:14px;min-width:0}.runtime-select-grid label,.settings-grid label,.command-panel label{display:grid;gap:7px;min-width:0;color:#bdc4d2;font-size:11px}.runtime-select-grid select,.settings-grid select,.settings-grid input:not([type=checkbox]),.command-panel textarea,.manual-device input:not([type=checkbox]){width:100%;min-width:0;max-width:100%;box-sizing:border-box;background:#10151e;border:1px solid #363f4e;border-radius:7px;padding:9px 10px;color:var(--text);font:inherit}.runtime-select-grid select{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-select-field{min-width:0}.model-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7f899b;font-size:9px}.settings-panel{min-width:0;padding:16px;border:1px solid #2e3747;border-radius:9px;background:#131923}.panel-heading{padding-bottom:12px;margin-bottom:11px;border-bottom:1px solid #2c3442}.panel-heading h2{margin:0;font-size:13px;font-weight:600}.panel-heading p{margin:5px 0 0;color:#8d97a9;font-size:10px;line-height:1.5}.runtime-tabs{display:flex;gap:7px;overflow:auto;border-bottom:1px solid #2c3442;margin-bottom:14px}.runtime-tabs button{flex:none;padding:8px 11px;border:0;border-bottom:2px solid transparent;background:transparent;color:#939aaa;font:inherit;font-size:10px;cursor:pointer}.runtime-tabs button.active{border-color:#7da8f4;color:#d2e1ff}.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,205px),1fr));gap:13px;min-width:0}.settings-grid .check-setting,.manual-device .check-setting{display:flex;align-items:center;gap:8px;min-height:35px}.settings-grid input[type=checkbox],.manual-device input[type=checkbox]{width:15px;height:15px;flex:none;accent-color:#8aaff0}.empty-options{grid-column:1/-1;margin:0;padding:14px;border:1px dashed #343e4d;border-radius:7px;color:#8e98a9;font-size:10px}.manual-device{grid-column:1/-1;font-size:10px}.manual-device summary{margin-bottom:10px;color:#bdc8da}.manual-device label{margin-bottom:8px}.manual-device small{color:#8e98a9;font-size:9px;line-height:1.5}.validation-error,.error-line{color:#ffb4ab!important}.action-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.action-row .primary-button,.action-row .secondary-button{margin:0;min-height:34px}.action-row .primary-button{border-color:#5473a7;background:#253750}.action-row .secondary-button{padding-inline:10px}.action-row button:disabled{opacity:.48;cursor:not-allowed}.runtime-notice{margin:0;color:#a8d8ba;font-size:10px}.status-panel,.command-panel{min-width:0;border:1px solid #2e3747;border-radius:8px;background:#10151e;padding:10px 12px}.status-panel summary{color:#bbc6d8;font-size:10px;cursor:pointer}.status-panel pre{max-height:260px;overflow:auto;margin:10px 0 0;padding:11px;border-radius:6px;background:#0b1018;color:#b8c8e2;font:10px/1.55 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.command-panel{display:grid;gap:10px}.command-panel textarea{resize:vertical;min-height:58px;font:10px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.command-panel .secondary-button{justify-self:start;margin:0}@media(max-width:620px){.runtime-card{padding:14px}.settings-panel{padding:12px}.action-row>*{flex:1 1 145px}.runtime-select-grid{grid-template-columns:minmax(0,1fr)}}
`] })
export class RuntimePage implements OnInit {
  readonly models=signal<ModelRecord[]>([]); readonly backends=signal<RuntimeBackend[]>([]); readonly devices=signal<RuntimeDevice[]>([]); readonly allDevices=signal<RuntimeDevice[]>([]); readonly installations=signal<RuntimeInstallation[]>([]);
  readonly modelId=signal(''); readonly backendName=signal('llama.cpp'); readonly runtimeId=signal(''); readonly device=signal(''); readonly manualDevice=signal(false);
  readonly values=signal<RuntimeValues>({}); readonly status=signal<unknown>(null); readonly loading=signal(false); readonly busy=signal(false);
  readonly notice=signal(''); readonly error=signal(''); readonly command=signal(''); readonly copied=signal(false); readonly splitModes=signal<string[]>([]);
  readonly settingsTab=signal<RuntimeTab>('placement');
  readonly placementNumbers: {key: PlacementKey; label:string; cap:CapabilityKey}[] = [{key:'gpu_layers',label:'GPU layers',cap:'gpu_layers'}];
  readonly loadNumbers: {key: LoadKey; label:string; cap:CapabilityKey}[] = [
    {key:'context_size',label:'Context size',cap:'context_size'}, {key:'threads',label:'Threads',cap:'threads'},
    {key:'batch_size',label:'Batch size',cap:'batch_size'}, {key:'physical_batch_size',label:'Physical batch size',cap:'physical_batch_size'},
    {key:'max_concurrent',label:'Max concurrent',cap:'max_concurrent'}, {key:'threads_batch',label:'Batch threads',cap:'threads_batch'},
  ];
  readonly loadStrings: {key: LoadKey; label:string; cap:CapabilityKey}[] = [
    {key:'numa',label:'NUMA policy',cap:'numa'}, {key:'kv_cache_type_k',label:'KV cache type K',cap:'kv_cache_type_k'},
    {key:'kv_cache_type_v',label:'KV cache type V',cap:'kv_cache_type_v'},
  ];
  readonly booleanFields: {key: LoadKey; label:string; cap:CapabilityKey}[] = [
    {key:'flash_attention',label:'Flash attention',cap:'flash_attention'}, {key:'unified_kv_cache',label:'Unified KV cache',cap:'unified_kv_cache'},
    {key:'offload_kv_cache',label:'Offload KV cache',cap:'offload_kv_cache'},
    {key:'keep_model_in_memory',label:'Keep model in memory',cap:'keep_model_in_memory'}, {key:'fit',label:'Fit to available memory',cap:'fit'},
  ];
  constructor(readonly api:ApiService, private readonly runtime:RuntimeService) {}
  ngOnInit(){ void this.initialize(); }
  async initialize(){ this.loading.set(true); this.error.set(''); try { await this.api.check(); if(!this.api.connected()) return;
    const {models,runtime}=await this.runtime.snapshot(); this.models.set(models); this.backends.set(runtime.backends); this.devices.set(runtime.devices); this.allDevices.set(runtime.devices); this.status.set(runtime.status);
    try { const installs=await this.runtime.installations(); this.installations.set(installs); } catch { this.installations.set([]); }
    if(!this.backends().some(b=>b.name===this.backendName())) this.backendName.set(this.backends()[0]?.name||'');
    if(this.installations().length) this.setInstallation(this.installations()[0].id);
    this.readSplitModes();
  } catch(e){this.error.set(errorMessage(e));} finally {this.loading.set(false);} }
  private get installation(){return this.installations().find(r=>r.id===this.runtimeId());}
  private get backend(){return this.backends().find(b=>b.name===this.backendName()) as BackendWithOptions|undefined;}
  private get capabilities():ExtendedCapabilities|undefined{return this.installation?.capabilities??this.backend?.capabilities;}
  supports(k:CapabilityKey|'mmap_disable'|'continuous_batching_disable'){return (this.capabilities as Record<string,unknown>|undefined)?.[k]===true;}
  modelName(model:ModelRecord):string { const file=model.path.split(/[\\/]/).pop();return String(model.metadata?.['general.name']||file||model.id); }
  selectedModelPath():string { return this.models().find(model=>model.id===this.modelId())?.path||''; }
  hasPlacementOptions():boolean {return this.supports('gpu_layers')||this.supports('split_mode')||this.supports('tensor_split')||this.supports('main_gpu');}
  hasLoadOptions():boolean {return this.loadNumbers.some(field=>this.supports(field.cap))||this.booleanFields.some(field=>this.supports(field.cap));}
  hasAdvancedOptions():boolean {return this.loadStrings.some(field=>this.supports(field.cap))||this.supports('mmap')||this.supports('continuous_batching')||this.supports('device_selection');}
  deviceError():string {if(!this.manualDevice())return '';const id=this.device().trim();return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(id)?'':'Enter a runtime device identifier such as ROCm0 or Vulkan1.';}
  setDetectedDevice(id:string){this.manualDevice.set(false);this.device.set(id);}
  toggleManualDevice(enabled:boolean){this.manualDevice.set(enabled);if(!enabled)this.device.set('');}
  setBackend(name:string){this.backendName.set(name);const match=this.installations().find(item=>item.backend===name&&item.enabled&&item.available);if(match){this.setInstallation(match.id);return;}this.runtimeId.set('');this.device.set('');this.manualDevice.set(false);this.devices.set(this.allDevices());this.readSplitModes();}
  setInstallation(id:string){const item=this.installations().find(r=>r.id===id);this.runtimeId.set(id);this.device.set('');this.manualDevice.set(false);if(item){this.backendName.set(item.backend||this.backendName()||'llama.cpp');this.devices.set(item.devices||[]);}else{this.devices.set(this.allDevices());}this.readSplitModes();}
  nativeId(d:RuntimeDevice){return d.runtime_id||d.id;}
  setValue(key: keyof RuntimeValues, value: unknown){
    const integerKeys: Array<keyof RuntimeValues> = ['gpu_layers','context_size','threads','batch_size','physical_batch_size','max_concurrent','threads_batch','main_gpu'];
    const normalized=integerKeys.includes(key)&&value!==''?Number(value):value;
    this.values.update(current=>({...current,[key]:normalized}));
  }
  private readSplitModes(){const backend=this.backend; const installation=this.installation as (RuntimeInstallation & {split_modes?: string[];split_mode_options?: string[]})|undefined;
    const caps=this.capabilities; this.splitModes.set(installation?.split_modes??installation?.split_mode_options??backend?.split_modes??backend?.split_mode_options??caps?.split_modes??[]);}
  private payload():RuntimeSettingsRequest {
    const placement:RuntimePlacement={}; const load:RuntimeLoadOptions={}; const value=this.values();
    for(const key of ['gpu_layers','split_mode','tensor_split','main_gpu'] as const) if(this.supports(key)&&value[key]!==undefined&&value[key]!=='') placement[key]=value[key] as never;
    for(const key of ['context_size','threads','batch_size','physical_batch_size','max_concurrent','threads_batch','continuous_batching','numa','kv_cache_type_k','kv_cache_type_v','flash_attention','unified_kv_cache','offload_kv_cache','mmap','keep_model_in_memory','fit'] as const){
      if(!this.supports(key)||value[key]===undefined||value[key]==='') continue;
      if(key==='mmap'&&value.mmap===false&&!this.supports('mmap_disable')) continue;
      if(key==='continuous_batching'&&value.continuous_batching===false&&!this.supports('continuous_batching_disable')) continue;
      load[key]=value[key] as never;
    }
    if(this.supports('device_selection')&&this.device()) placement.device=this.device();
    return {model_id:this.modelId(),backend:this.installation?(this.installation.backend||undefined):this.backendName(),runtime_id:this.runtimeId()||undefined,placement,load};
  }
  async load(){this.busy.set(true);this.error.set('');this.notice.set('Loading model…');this.command.set('');try{this.status.set(await this.runtime.load(this.payload()));this.notice.set('Model loaded.');await this.refreshStatus();}catch(e){this.notice.set('');this.error.set(errorMessage(e));}finally{this.busy.set(false);}}
  async unload(){this.busy.set(true);this.error.set('');try{this.status.set(await this.runtime.unload());this.notice.set('Model unloaded.');}catch(e){this.error.set(errorMessage(e));}finally{this.busy.set(false);}}
  async refreshStatus(){try{this.status.set(await this.runtime.status());}catch(e){this.error.set(errorMessage(e));}}
  async showCommand(){try{const result=await this.runtime.command(this.payload());this.command.set(result.command);}catch(e){this.error.set(errorMessage(e));}}
  copyCommand(){void navigator.clipboard?.writeText(this.command());this.copied.set(true);}
}
function errorMessage(e:unknown):string{return e instanceof Error?e.message:String(e);}
