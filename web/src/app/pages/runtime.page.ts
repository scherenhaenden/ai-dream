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

@Component({ standalone: true, imports: [JsonPipe], changeDetection: ChangeDetectionStrategy.OnPush, template: `
<div class="page-head"><div><div class="eyebrow">SYSTEM</div><h1>Runtime</h1><p>Choose and load a model without sending a chat message.</p></div></div>
@if (!api.connected()) {<div class="chat-notice error-notice"><b>Local API unavailable</b><p>Start AI Dream, then retry.</p><button (click)="initialize()">Retry</button></div>}
@if (loading()) {<p role="status">Loading runtime options…</p>}
<section class="surface" style="padding:20px;display:grid;gap:16px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
<label>Model<select [value]="modelId()" (change)="modelId.set($any($event.target).value)"><option value="">Select a model</option>@for(m of models();track m.id){<option [value]="m.id">{{m.id}} — {{m.path}}</option>}</select></label>
@if(installations().length){<label>Runtime<select [value]="runtimeId()" (change)="setInstallation($any($event.target).value)">@for(r of installations();track r.id){<option [value]="r.id" [disabled]="!r.enabled||!r.available">{{r.name}} — {{r.backend||r.kind}}</option>}</select></label>}@else{<label>Backend<select [value]="backendName()" (change)="setBackend($any($event.target).value)">@for(b of backends();track b.name){<option [value]="b.name" [disabled]="!b.available">{{b.name}}</option>}</select></label>}
@if (supports('device_selection')) {<label>GPU / device<select [value]="device()" (change)="device.set($any($event.target).value)"><option value="">Runtime default</option>@for(d of devices();track d.runtime_id||d.id){<option [value]="nativeId(d)">{{d.name}} ({{nativeId(d)}})</option>}</select></label>}
</div>
<details><summary>Advanced settings</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding-top:12px">
@for(f of placementNumbers;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input type="number" min="0" [value]="values()[f.key]??''" (input)="setValue(f.key,$any($event.target).value)"></label>}}
@if(supports('split_mode')){@if(splitModes().length){<label>Split mode<select [value]="values().split_mode||''" (change)="setValue('split_mode',$any($event.target).value)"><option value="">Runtime default</option>@for(mode of splitModes();track mode){<option [value]="mode">{{mode}}</option>}</select></label>}@else{<label>Split mode<input [value]="values().split_mode||''" (input)="setValue('split_mode',$any($event.target).value)"></label>}}
@if(supports('tensor_split')){<label>Tensor split<input [value]="values().tensor_split||''" placeholder="1,1" (input)="setValue('tensor_split',$any($event.target).value)"></label>}
@if(supports('main_gpu')){<label>Main GPU<input type="number" min="0" [value]="values().main_gpu??''" (input)="setValue('main_gpu',$any($event.target).value)"></label>}
@for(f of loadNumbers;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input type="number" min="0" [value]="values()[f.key]??''" (input)="setValue(f.key,$any($event.target).value)"></label>}}
@for(f of loadStrings;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input [value]="values()[f.key]??''" (input)="setValue(f.key,$any($event.target).value)"></label>}}
@for(f of booleanFields;track f.key){@if(supports(f.cap)){<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" [checked]="values()[f.key]??false" (change)="setValue(f.key,$any($event.target).checked)">{{f.label}}</label>}}
@if(supports('mmap')){<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" [checked]="values().mmap??true" [disabled]="!supports('mmap_disable')" (change)="setValue('mmap',$any($event.target).checked)">Memory map</label>}
@if(supports('continuous_batching')){<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" [checked]="values().continuous_batching??true" [disabled]="!supports('continuous_batching_disable')" (change)="setValue('continuous_batching',$any($event.target).checked)">Continuous batching</label>}
@if(supports('device_selection')){<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" [checked]="manualDevice()" (change)="manualDevice.set($any($event.target).checked)">Manual device override</label>@if(manualDevice()){<label>Runtime device identifier<input [value]="device()" placeholder="ROCm0, Vulkan1…" (input)="device.set($any($event.target).value)"></label>}}</div></details>
<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="send-button" (click)="load()" [disabled]="busy()||!modelId()||!api.connected()">Load model</button><button class="secondary-button" (click)="unload()" [disabled]="busy()||!api.connected()">Unload model</button><button class="secondary-button" (click)="load()" [disabled]="busy()||!modelId()||!api.connected()">Reload model</button><button class="secondary-button" (click)="refreshStatus()" [disabled]="busy()||!api.connected()">Runtime status</button><button class="secondary-button" (click)="showCommand()" [disabled]="busy()||!modelId()">Show effective llama.cpp command</button></div>
@if(status()){<pre>{{status()|json}}</pre>}@if(notice()){<p role="status">{{notice()}}</p>}@if(error()){<p class="error-line" role="alert">{{error()}}</p>}
@if(command()){<div><label>Effective command<textarea readonly rows="3" [value]="command()"></textarea></label><button class="secondary-button" (click)="copyCommand()">{{copied()?'Copied':'Copy command'}}</button></div>}
</section>` })
export class RuntimePage implements OnInit {
  readonly models=signal<ModelRecord[]>([]); readonly backends=signal<RuntimeBackend[]>([]); readonly devices=signal<RuntimeDevice[]>([]); readonly installations=signal<RuntimeInstallation[]>([]);
  readonly modelId=signal(''); readonly backendName=signal('llama.cpp'); readonly runtimeId=signal(''); readonly device=signal(''); readonly manualDevice=signal(false);
  readonly values=signal<RuntimeValues>({}); readonly status=signal<unknown>(null); readonly loading=signal(false); readonly busy=signal(false);
  readonly notice=signal(''); readonly error=signal(''); readonly command=signal(''); readonly copied=signal(false); readonly splitModes=signal<string[]>([]);
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
    const {models,runtime}=await this.runtime.snapshot(); this.models.set(models); this.backends.set(runtime.backends); this.devices.set(runtime.devices); this.status.set(runtime.status);
    try { const installs=await this.runtime.installations(); this.installations.set(installs); } catch { this.installations.set([]); }
    if(!this.backends().some(b=>b.name===this.backendName())) this.backendName.set(this.backends()[0]?.name||'');
    if(this.installations().length) this.setInstallation(this.installations()[0].id);
    this.readSplitModes();
  } catch(e){this.error.set(errorMessage(e));} finally {this.loading.set(false);} }
  private get installation(){return this.installations().find(r=>r.id===this.runtimeId());}
  private get backend(){return this.backends().find(b=>b.name===this.backendName()) as BackendWithOptions|undefined;}
  private get capabilities():ExtendedCapabilities|undefined{return this.installation?.capabilities??this.backend?.capabilities;}
  supports(k:CapabilityKey|'mmap_disable'|'continuous_batching_disable'){return (this.capabilities as Record<string,unknown>|undefined)?.[k]===true;}
  setBackend(name:string){this.backendName.set(name);this.readSplitModes();}
  setInstallation(id:string){const item=this.installations().find(r=>r.id===id);this.runtimeId.set(id);if(item){this.backendName.set(item.backend||this.backendName()||'llama.cpp');this.devices.set(item.devices||[]);this.device.set('');}this.readSplitModes();}
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
