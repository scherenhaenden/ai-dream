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
<div class="page-head"><div><div class="eyebrow">ENGINE SUBSYSTEM / COMPUTE</div><h1>Runtime Manager</h1><p>Manage registered runtime executables and configure model placement using detected capabilities.</p></div><span class="runtime-live"><i></i>{{ api.connected() ? 'LOCAL API' : 'API UNAVAILABLE' }}</span></div>
@if (!api.connected()) {<div class="chat-notice error-notice"><b>Local API unavailable</b><p>Start AI Dream, then retry.</p><button title="Retry the local API health check and reload runtime capabilities." (click)="initialize()">Retry</button></div>}
@if (loading()) {<p role="status">Loading runtime options…</p>}
<section class="surface install-card" aria-label="Registered runtime installations">
  <div class="install-heading"><div><h2>Runtime installations</h2><p>Register a local llama-server executable. Registration probes its advertised flags; it does not install packages or download runtimes.</p></div><span>{{ installations().length }} REGISTERED</span></div>
  <form class="install-form" (submit)="addInstallation($event)">
    <label>Executable path<input [value]="runtimeExecutable()" (input)="runtimeExecutable.set($any($event.target).value)" placeholder="/usr/bin/llama-server" title="Absolute path to an existing local llama-server executable. This action only records and probes it." required></label>
    <label>Name <small>Optional</small><input [value]="runtimeName()" (input)="runtimeName.set($any($event.target).value)" placeholder="llama.cpp local" title="Optional label shown in the runtime selector."></label>
    <button class="primary-button" type="submit" [disabled]="!api.connected()||managerBusy()">{{ managerBusy()==='add' ? 'Probing…' : 'Register & probe' }}</button>
  </form>
  @if (installations().length) {
    <div class="install-list">
      @for (item of installations(); track item.id) {
        <article class="install-row">
          <div class="install-info"><b>{{ item.name }}</b><span [class.install-offline]="!item.available||!item.enabled">{{ item.enabled ? (item.available ? 'AVAILABLE' : 'UNAVAILABLE') : 'DISABLED' }}</span><small [title]="item.executable">{{ item.executable }}</small><small>{{ item.backend || item.kind }} · {{ item.version || 'version not reported' }}</small></div>
          <div class="install-actions">
            <button class="secondary-button" type="button" (click)="probeInstallation(item)" [disabled]="managerBusy()!==''||!api.connected()" title="Recheck this executable and refresh its advertised capabilities">{{ managerBusy()===item.id ? 'Probing…' : 'Probe' }}</button>
            <button class="secondary-button" type="button" (click)="toggleInstallation(item)" [disabled]="managerBusy()!==''||!api.connected()" [title]="item.enabled ? 'Disable this registered entry; disabling an active runtime unloads its model.' : 'Enable this registered runtime entry.'">{{ item.enabled ? 'Disable' : 'Enable' }}</button>
            <button class="secondary-button" type="button" (click)="removeInstallation(item)" [disabled]="managerBusy()!==''||!api.connected()" title="Remove only this registry entry; the executable file is not deleted">Remove</button>
          </div>
        </article>
      }
    </div>
  } @else { <p class="install-empty">No explicit runtime is registered. The system-discovered backend can still be selected below.</p> }
</section>
<section class="surface runtime-card">
  <nav class="runtime-stage-list" aria-label="Runtime configuration steps">
    <button type="button" title="Choose a local model, backend, runtime, and reported device." [class.current]="settingsTab()==='placement'" (click)="settingsTab.set('placement')"><span>01</span><b>Model &amp; device</b><small>Selection</small></button>
    <button type="button" title="Configure only load options advertised by the selected runtime." [class.current]="settingsTab()==='load'" (click)="settingsTab.set('load')"><span>02</span><b>Load options</b><small>Inference</small></button>
    <button type="button" title="Configure additional advertised runtime flags and device overrides." [class.current]="settingsTab()==='advanced'" (click)="settingsTab.set('advanced')"><span>03</span><b>Advanced</b><small>Runtime flags</small></button>
  </nav>
  <div class="runtime-select-grid">
    <label class="model-select-field">Model<select title="Choose a local GGUF model to configure for this runtime. The currently loaded model is preselected, but you can choose another." [value]="modelId()" (change)="selectModel($any($event.target).value)"><option value="">Select a model</option>@for(m of models();track m.id){<option [value]="m.id">{{modelName(m)}}{{isLoadedModel(m)?' · LOADED':''}}</option>}</select>@if(detectedLoadedModel()){<small class="model-path" title="Detected from the active local runtime; selecting a different model remains available">Active runtime model: {{modelName(detectedLoadedModel()!)}} · other models can still be selected</small>}@else if(selectedModelPath()){<small class="model-path" [title]="selectedModelPath()">{{selectedModelPath()}}</small>}</label>
    <label>Backend<select title="Select an installed backend. Options and controls depend on its advertised capabilities." [value]="backendName()" (change)="setBackend($any($event.target).value)"><option value="">Select backend</option>@for(b of backends();track b.name){<option [value]="b.name" [selected]="b.name===backendName()" [disabled]="!b.available">{{b.name}}{{b.available?'':' (unavailable)'}}</option>}</select></label>
    @if(installations().length){<label>Runtime<select title="Choose a registered runtime executable or use the backend default." [value]="runtimeId()" (change)="setInstallation($any($event.target).value)"><option value="">Backend default</option>@for(r of installations();track r.id){<option [value]="r.id" [disabled]="!r.enabled||!r.available">{{r.name}} · {{r.backend||r.kind}}</option>}</select></label>}
    @if (supports('device_selection')) {<label>GPU / device<select title="Choose a runtime-native device ID from the selected backend inventory. This does not estimate free VRAM." [value]="manualDevice()? '' : device()" (change)="setDetectedDevice($any($event.target).value)"><option value="">Runtime default</option>@for(d of devices();track d.runtime_id||d.id){<option [value]="nativeId(d)">{{d.name}} · {{nativeId(d)}}</option>}</select></label>}
  </div>
  <div class="runtime-workspace">
  <section class="settings-panel" aria-label="Runtime load settings">
    <div class="panel-heading"><div><h2>Model load configuration</h2><p>Options are limited to capabilities advertised by the selected runtime.</p></div></div>
    @if(settingsTab()==='placement'){
      <div class="settings-grid">
        @for(f of placementNumbers;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input type="number" min="0" [value]="values()[f.key]??''" title="Set the number of model layers to offload. Model metadata can suggest a maximum, but does not prove available GPU memory." (input)="setValue(f.key,$any($event.target).value)">@if (modelLayerCount(); as layers) {<button class="metadata-suggestion" type="button" title="Use the exact block count declared in this model's GGUF metadata. This is a suggestion only; memory fit is not estimated." (click)="useModelLayerSuggestion()">Use model metadata · {{ layers }} layers</button>}</label>}}
        @if(supports('split_mode')){@if(splitModes().length){<label>Split mode<select title="Choose a split strategy advertised by this runtime." [value]="values().split_mode||''" (change)="setValue('split_mode',$any($event.target).value)"><option value="">Runtime default</option>@for(mode of splitModes();track mode){<option [value]="mode">{{mode}}</option>}</select></label>}@else{<label>Split mode<input title="Enter a runtime-supported split mode; accepted values were not listed by the capability probe." [value]="values().split_mode||''" (input)="setValue('split_mode',$any($event.target).value)"></label>}}
        @if(supports('tensor_split')){<label>Tensor split<input title="Set per-device tensor split weights in the format accepted by this runtime. No topology or balance is inferred." [value]="values().tensor_split||''" (input)="setValue('tensor_split',$any($event.target).value)"></label>}
        @if(supports('main_gpu')){<label>Main GPU<input type="number" min="0" title="Set the runtime's primary GPU index; available indices depend on its device list." [value]="values().main_gpu??''" (input)="setValue('main_gpu',$any($event.target).value)"></label>}
        @if(!hasPlacementOptions()){<p class="empty-options">No placement options are advertised by this runtime.</p>}
      </div>
    } @else if(settingsTab()==='load'){
      <div class="settings-grid">
        @for(f of loadNumbers;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input type="number" min="0" [value]="values()[f.key]??''" [title]="loadTooltip(f.key)" (input)="setValue(f.key,$any($event.target).value)"></label>}}
        @for(f of booleanFields;track f.key){@if(supports(f.cap)){<label class="check-setting" [title]="loadTooltip(f.key)"><input type="checkbox" [title]="loadTooltip(f.key)" [checked]="values()[f.key]??false" (change)="setValue(f.key,$any($event.target).checked)">{{f.label}}</label>}}
        @if(!hasLoadOptions()){<p class="empty-options">No load settings are advertised by this runtime.</p>}
      </div>
    } @else {
      <div class="settings-grid">
        @for(f of loadStrings;track f.key){@if(supports(f.cap)){<label>{{f.label}}<input [title]="loadTooltip(f.key)" [value]="values()[f.key]??''" (input)="setValue(f.key,$any($event.target).value)"></label>}}
        @if(supports('mmap')){<label class="check-setting" title="Use memory-mapped model loading; disabling it requires an explicitly advertised no-mmap option."><input type="checkbox" title="Memory-map model weights for loading. Disable is only supported when the runtime advertises it." [checked]="values().mmap??true" [disabled]="!supports('mmap_disable')" (change)="setValue('mmap',$any($event.target).checked)">Memory map</label>}
        @if(supports('continuous_batching')){<label class="check-setting" title="Allow continuous request batching if this runtime supports the selected direction."><input type="checkbox" title="Toggle continuous batching. Disabling is available only when the runtime advertises a disable flag." [checked]="values().continuous_batching??true" [disabled]="!supports('continuous_batching_disable')" (change)="setValue('continuous_batching',$any($event.target).checked)">Continuous batching</label>}
        @if(supports('device_selection')){<details class="manual-device"><summary title="Enter a runtime-native device ID only when the detected device selector is insufficient.">Manual device override</summary><label class="check-setting"><input type="checkbox" title="Enable a manually entered runtime-native device ID." [checked]="manualDevice()" (change)="toggleManualDevice($any($event.target).checked)">Use a manual runtime device ID</label>@if(manualDevice()){<label>Runtime device ID<input title="Exact device identifier passed to the selected runtime." [value]="device()" (input)="device.set($any($event.target).value)" placeholder="ROCm0, Vulkan1, CUDA0…"><small>Prefer the detected device selector above. The override is checked as a runtime-native ID.</small></label>@if(deviceError()){<small class="validation-error" role="alert">{{deviceError()}}</small>}}</details>}
        @if(!hasAdvancedOptions()){<p class="empty-options">No additional options are advertised by this runtime.</p>}
      </div>
    }
  </section>
  <aside class="placement-inspector" aria-label="Selected runtime configuration">
    <div class="inspector-heading"><span class="inspector-icon">01</span><div><b>Allocation summary</b><small>Current selections</small></div></div>
    <div class="allocation-state" [class.ready]="modelId() && backendName()"><i></i>{{ modelId() ? 'Model selected' : 'Select a model to continue' }}</div>
    <dl class="allocation-facts">
      <div><dt>Model</dt><dd>{{ selectedModelName() || 'Not selected' }}</dd></div>
      <div><dt>Backend</dt><dd>{{ backendName() || 'Runtime default' }}</dd></div>
      <div><dt>Runtime</dt><dd>{{ selectedRuntimeName() }}</dd></div>
      @if (supports('device_selection')) { <div><dt>Device</dt><dd>{{ selectedDeviceName() || 'Runtime default' }}</dd></div> }
      @if (supports('gpu_layers')) { <div><dt>GPU layers</dt><dd>{{ values().gpu_layers ?? 'Runtime default' }}</dd></div> }
      @if (supports('split_mode')) { <div><dt>Split mode</dt><dd>{{ values().split_mode || 'Runtime default' }}</dd></div> }
      @if (supports('tensor_split')) { <div><dt>Tensor split</dt><dd>{{ values().tensor_split || 'Runtime default' }}</dd></div> }
    </dl>
    @if (devices().length) {
      <div class="device-list-heading">AVAILABLE TO THIS RUNTIME <span>{{ devices().length }}</span></div>
      <div class="runtime-device-list">@for (d of devices(); track d.runtime_id || d.id) {<div class="runtime-device-row" [class.selected]="device()===nativeId(d)"><span class="device-indicator"></span><div><b>{{ d.name }}</b><small>{{ d.backend }} · {{ nativeId(d) }}</small></div>@if (d.memory_bytes != null) {<span class="device-memory">{{ formatMemory(d.memory_bytes) }}</span>}</div>}</div>
    } @else { <p class="inspector-note">No device inventory has been reported for this runtime.</p> }
    <p class="inspector-note">Link bandwidth, VRAM allocation estimates, and layer-to-device topology are not provided by this runtime.</p>
  </aside>
  </div>
  <div class="action-row"><button class="primary-button" title="Load the selected model with this runtime and the explicit settings shown above." (click)="load()" [disabled]="busy()||!modelId()||!api.connected()||!!deviceError()">Load model</button><button class="secondary-button" title="Stop the currently loaded runtime model." (click)="unload()" [disabled]="busy()||!api.connected()">Unload model</button><button class="secondary-button" title="Load the selected model again using the settings shown above." (click)="load()" [disabled]="busy()||!modelId()||!api.connected()||!!deviceError()">Reload model</button><button class="secondary-button" title="Refresh the status reported by the local runtime." (click)="refreshStatus()" [disabled]="busy()||!api.connected()">Runtime status</button><button class="secondary-button" title="Preview the exact llama.cpp command without starting a model server." (click)="showCommand()" [disabled]="busy()||!modelId()||!!deviceError()">Show effective llama.cpp command</button></div>
  @if(notice()){<p class="runtime-notice" role="status">{{notice()}}</p>}@if(error()){<p class="error-line" role="alert">{{error()}}</p>}
  @if(status()){<details class="status-panel"><summary title="Inspect the exact status response returned by the runtime API.">Runtime status</summary><pre>{{status()|json}}</pre></details>}
  @if(command()){<section class="command-panel"><label>Effective llama.cpp command<textarea readonly rows="3" title="Exact command assembled for this configuration; the command is not executed by this preview." [value]="command()"></textarea></label><button class="secondary-button" title="Copy the command preview to the clipboard." (click)="copyCommand()">{{copied()?'Copied':'Copy command'}}</button></section>}
</section>` , styles:[`
:host{display:block}.install-card{margin-bottom:12px;padding:13px;border:1px solid #2c3543;border-radius:5px;background:#151b25}.install-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}.install-heading h2{margin:0;font-size:13px}.install-heading p{margin:4px 0 0;color:#8d97a9;font-size:10px;line-height:1.5}.install-heading>span,.install-info>span{color:#8d98aa;font:8px ui-monospace,monospace}.install-form{display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(150px,1fr) auto;align-items:end;gap:8px;padding-bottom:10px;border-bottom:1px solid #2c3543}.install-form label{display:grid;gap:5px;color:#bdc4d2;font-size:10px}.install-form label small{display:inline;color:#8d97a9}.install-form input{box-sizing:border-box;width:100%;min-width:0;background:#10151e;border:1px solid #363f4e;border-radius:4px;padding:8px;color:var(--text);font:inherit}.install-form button,.install-actions button{margin:0;min-height:31px;padding:6px 9px;font-size:9px}.install-list{display:grid}.install-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #2c3543}.install-row:last-child{border-bottom:0}.install-info{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:3px 8px;min-width:0}.install-info>b{font-size:10px}.install-info>small{grid-column:1/-1;color:#8d97a9;font-size:9px;overflow-wrap:anywhere}.install-info>span{color:#83d7aa}.install-info>span.install-offline{color:#d7aa70}.install-actions{display:flex;flex-wrap:wrap;gap:5px}.install-empty{margin:0;padding:10px 0 0;color:#8d97a9;font-size:10px}.runtime-card{max-width:none;padding:20px;display:grid;gap:18px;min-width:0}.runtime-select-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:14px;min-width:0}.runtime-select-grid label,.settings-grid label,.command-panel label{display:grid;gap:7px;min-width:0;color:#bdc4d2;font-size:11px}.runtime-select-grid select,.settings-grid select,.settings-grid input:not([type=checkbox]),.command-panel textarea,.manual-device input:not([type=checkbox]){width:100%;min-width:0;max-width:100%;box-sizing:border-box;background:#10151e;border:1px solid #363f4e;border-radius:7px;padding:9px 10px;color:var(--text);font:inherit}.runtime-select-grid select{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-select-field{min-width:0}.model-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7f899b;font-size:9px}.settings-panel{min-width:0;padding:16px;border:1px solid #2e3747;border-radius:9px;background:#131923}.panel-heading{padding-bottom:12px;margin-bottom:11px;border-bottom:1px solid #2c3442}.panel-heading h2{margin:0;font-size:13px;font-weight:600}.panel-heading p{margin:5px 0 0;color:#8d97a9;font-size:10px;line-height:1.5}.runtime-tabs{display:flex;gap:7px;overflow:auto;border-bottom:1px solid #2c3442;margin-bottom:14px}.runtime-tabs button{flex:none;padding:8px 11px;border:0;border-bottom:2px solid transparent;background:transparent;color:#939aaa;font:inherit;font-size:10px;cursor:pointer}.runtime-tabs button.active{border-color:#7da8f4;color:#d2e1ff}.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,205px),1fr));gap:13px;min-width:0}.settings-grid .check-setting,.manual-device .check-setting{display:flex;align-items:center;gap:8px;min-height:35px}.settings-grid input[type=checkbox],.manual-device input[type=checkbox]{width:15px;height:15px;flex:none;accent-color:#8aaff0}.empty-options{grid-column:1/-1;margin:0;padding:14px;border:1px dashed #343e4d;border-radius:7px;color:#8e98a9;font-size:10px}.manual-device{grid-column:1/-1;font-size:10px}.manual-device summary{margin-bottom:10px;color:#bdc8da}.manual-device label{margin-bottom:8px}.manual-device small{color:#8e98a9;font-size:9px;line-height:1.5}.validation-error,.error-line{color:#ffb4ab!important}.action-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.action-row .primary-button,.action-row .secondary-button{margin:0;min-height:34px}.action-row .primary-button{border-color:#5473a7;background:#253750}.action-row .secondary-button{padding-inline:10px}.action-row button:disabled{opacity:.48;cursor:not-allowed}.runtime-notice{margin:0;color:#a8d8ba;font-size:10px}.status-panel,.command-panel{min-width:0;border:1px solid #2e3747;border-radius:8px;background:#10151e;padding:10px 12px}.status-panel summary{color:#bbc6d8;font-size:10px;cursor:pointer}.status-panel pre{max-height:260px;overflow:auto;margin:10px 0 0;padding:11px;border-radius:6px;background:#0b1018;color:#b8c8e2;font:10px/1.55 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.command-panel{display:grid;gap:10px}.command-panel textarea{resize:vertical;min-height:58px;font:10px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.command-panel .secondary-button{justify-self:start;margin:0}@media(max-width:620px){.install-form{grid-template-columns:1fr}.install-row{align-items:flex-start;flex-direction:column}.install-actions{width:100%}.install-actions>*{flex:1}.runtime-card{padding:14px}.settings-panel{padding:12px}.action-row>*{flex:1 1 145px}.runtime-select-grid{grid-template-columns:minmax(0,1fr)}}
]` , `
.page-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 auto 14px;padding:16px;background:#171c26;border:1px solid #2b3240;border-radius:6px}.page-head h1{font-size:22px;font-weight:600}.runtime-live{display:flex;align-items:center;gap:7px;flex:none;padding:6px 9px;border:1px solid #344638;border-radius:4px;color:#8edbb1;font:9px ui-monospace,monospace}.runtime-live i{width:7px;height:7px;border-radius:50%;background:#4edea3}.runtime-card{padding:15px;gap:12px}.settings-panel{border-radius:5px;background:#10151e}.runtime-tabs{gap:3px}.runtime-tabs button.active{border-color:#adc6ff;color:#d8e2ff}.action-row{padding-top:10px;border-top:1px solid #2c3442}.status-panel,.command-panel{border-radius:5px}@media(max-width:620px){.page-head{align-items:flex-start}}
`, `
.runtime-card{max-width:none;padding:12px;gap:9px}.runtime-stage-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;padding:5px;background:#0d121b;border:1px solid #282f3a;border-radius:4px}.runtime-stage-list button{display:grid;grid-template-columns:27px minmax(0,1fr);grid-template-rows:auto auto;align-items:center;column-gap:7px;min-width:0;padding:8px;border:1px solid transparent;border-radius:3px;background:transparent;text-align:left;color:#8994a6;cursor:pointer}.runtime-stage-list button.current{border-color:#465c7d;background:#1b2535;color:#cbdcff}.runtime-stage-list button>span{grid-row:1/3;display:grid;place-items:center;width:25px;height:25px;border:1px solid #39485e;border-radius:3px;color:#a9c5ff;font:10px ui-monospace,monospace}.runtime-stage-list button b{font-size:10px;font-weight:550;overflow-wrap:anywhere}.runtime-stage-list button small{margin-top:3px;color:#7f899a;font-size:8px}.runtime-select-grid{gap:8px;padding:10px;border:1px solid #2c3543;border-radius:4px;background:#151b25}.runtime-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(225px,.3fr);gap:8px;align-items:start}.settings-panel{border-radius:4px;background:#10151e;padding:12px}.panel-heading{padding-bottom:8px;margin-bottom:8px}.panel-heading h2{font-size:12px}.settings-grid{gap:8px}.settings-grid .check-setting{min-height:30px;padding:5px 7px;border:1px solid #2b3545;border-radius:3px;background:#141b25}.metadata-suggestion{justify-self:start;padding:4px 7px;border:1px solid #3d506b;border-radius:3px;background:#172334;color:#abc8ff;font-size:9px;cursor:pointer}.metadata-suggestion:hover{background:#202f45}.placement-inspector{min-width:0;padding:12px;border:1px solid #2c3543;border-radius:4px;background:#151b25}.inspector-heading{display:flex;align-items:center;gap:9px;padding-bottom:9px;border-bottom:1px solid #2c3543}.inspector-icon{display:grid;place-items:center;width:27px;height:27px;border:1px solid #3c506d;border-radius:3px;color:#adc6ff;font:9px ui-monospace,monospace}.inspector-heading b,.inspector-heading small{display:block}.inspector-heading b{font-size:11px;font-weight:550}.inspector-heading small{margin-top:3px;color:#8993a4;font-size:9px}.allocation-state{display:flex;align-items:center;gap:7px;margin:10px 0;padding:7px 8px;border:1px solid #3c4145;border-radius:3px;color:#aeb7c6;background:#111720;font:9px ui-monospace,monospace}.allocation-state i,.device-indicator{width:7px;height:7px;flex:none;border-radius:50%;background:#8490a0}.allocation-state.ready{border-color:#285342;color:#83d7aa}.allocation-state.ready i,.runtime-device-row.selected .device-indicator{background:#4edea3}.allocation-facts{margin:0}.allocation-facts>div{display:grid;grid-template-columns:80px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid #282f3a}.allocation-facts dt{color:#8993a4;font-size:9px}.allocation-facts dd{margin:0;color:#d0d8e6;text-align:right;font:9px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}.device-list-heading{display:flex;justify-content:space-between;gap:8px;margin:11px 0 5px;color:#8d98aa;font:8px ui-monospace,monospace}.runtime-device-list{display:grid;gap:4px}.runtime-device-row{display:flex;align-items:center;gap:7px;min-width:0;padding:7px;border:1px solid #2b3545;border-radius:3px;background:#111720}.runtime-device-row.selected{border-color:#516987;background:#1b2636}.runtime-device-row>div{display:grid;gap:3px;min-width:0;flex:1}.runtime-device-row b{color:#ccd5e4;font-size:9px;font-weight:500;overflow-wrap:anywhere}.runtime-device-row small,.device-memory{color:#8d98aa;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.inspector-note{margin:9px 0 0;color:#858f9f;font-size:9px;line-height:1.5}.action-row{padding-top:9px;border-top:1px solid #2c3442}@media(max-width:760px){.runtime-workspace{grid-template-columns:1fr}.placement-inspector{order:-1}}@media(max-width:520px){.runtime-stage-list{grid-template-columns:1fr}.runtime-stage-list button{grid-template-columns:27px minmax(0,1fr) auto;padding:6px}.runtime-stage-list button>span{grid-row:auto}.runtime-stage-list button small{margin:0}.runtime-select-grid{grid-template-columns:1fr}.runtime-card{padding:8px}}
`] })
export class RuntimePage implements OnInit {
  readonly models=signal<ModelRecord[]>([]); readonly backends=signal<RuntimeBackend[]>([]); readonly devices=signal<RuntimeDevice[]>([]); readonly allDevices=signal<RuntimeDevice[]>([]); readonly installations=signal<RuntimeInstallation[]>([]);
  readonly modelId=signal(''); readonly backendName=signal('llama.cpp'); readonly runtimeId=signal(''); readonly device=signal(''); readonly manualDevice=signal(false);
  private modelSelectionTouched=false;
  readonly values=signal<RuntimeValues>({}); readonly status=signal<unknown>(null); readonly loading=signal(false); readonly busy=signal(false);
  readonly notice=signal(''); readonly error=signal(''); readonly command=signal(''); readonly copied=signal(false); readonly splitModes=signal<string[]>([]);
  readonly settingsTab=signal<RuntimeTab>('placement');
  readonly runtimeExecutable=signal(''); readonly runtimeName=signal(''); readonly managerBusy=signal('');
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
    const {models,runtime}=await this.runtime.snapshot(); this.models.set(models); this.backends.set(runtime.backends); this.devices.set(runtime.devices); this.allDevices.set(runtime.devices); this.status.set(runtime.status); this.selectLoadedModelWhenUntouched();
    try { const installs=await this.runtime.installations(); this.installations.set(installs); } catch { this.installations.set([]); }
    if(!this.backends().some(b=>b.name===this.backendName())) this.backendName.set(this.backends()[0]?.name||'');
    const usable=this.installations().find(item=>item.enabled&&item.available);
    if(usable) this.setInstallation(usable.id);
    this.readSplitModes();
  } catch(e){this.error.set(errorMessage(e));} finally {this.loading.set(false);} }
  private get installation(){return this.installations().find(r=>r.id===this.runtimeId());}
  selectModel(modelId:string){this.modelSelectionTouched=true;this.modelId.set(modelId);}
  private statusSnapshot():Record<string,any>{const value=this.status();const root=value&&typeof value==='object'?value as Record<string,any>:{};const data=root['data']&&typeof root['data']==='object'?root['data']:root;const status=data['status']&&typeof data['status']==='object'?data['status']:data;return status&&typeof status==='object'?status:{};}
  detectedLoadedModel():ModelRecord|null{const status=this.statusSnapshot();const path=typeof status['model_path']==='string'?status['model_path']:status['model'];if(status['loaded']===false||typeof path!=='string')return null;return this.models().find(model=>this.sameModelPath(model.path,path))??null;}
  isLoadedModel(model:ModelRecord):boolean{return this.detectedLoadedModel()?.id===model.id;}
  private selectLoadedModelWhenUntouched(){if(this.modelSelectionTouched)return;const model=this.detectedLoadedModel();if(model)this.modelId.set(model.id);}
  private sameModelPath(left:string,right:string){const normalize=(value:string)=>value.replaceAll('\\','/').replace(/\/+$/,'');return normalize(left)===normalize(right);}
  private get backend(){return this.backends().find(b=>b.name===this.backendName()) as BackendWithOptions|undefined;}
  private get capabilities():ExtendedCapabilities|undefined{return this.installation?.capabilities??this.backend?.capabilities;}
  supports(k:CapabilityKey|'mmap_disable'|'continuous_batching_disable'){return (this.capabilities as Record<string,unknown>|undefined)?.[k]===true;}
  modelName(model:ModelRecord):string { const file=model.path.split(/[\\/]/).pop();return String(model.metadata?.['general.name']||file||model.id); }
  modelLayerCount():number|null { const model=this.models().find(item=>item.id===this.modelId());const architecture=model?.metadata?.['general.architecture'];const count=typeof architecture==='string'?model?.metadata?.[`${architecture}.block_count`]:undefined;return typeof count==='number'&&Number.isSafeInteger(count)&&count>0?count:null; }
  useModelLayerSuggestion(){ const layers=this.modelLayerCount();if(layers!==null)this.setValue('gpu_layers',layers); }
  loadTooltip(key:LoadKey):string { const descriptions:Partial<Record<LoadKey,string>>={context_size:'Maximum context window in tokens. Larger values require more memory; no VRAM estimate is available.',threads:'CPU worker thread count passed to the selected runtime.',batch_size:'Logical prompt batch size passed to the selected runtime.',physical_batch_size:'Physical micro-batch size passed to the selected runtime.',max_concurrent:'Maximum concurrent sequences/requests supported by the server.',threads_batch:'CPU threads used for prompt-batch processing.',numa:'NUMA memory placement policy accepted by the runtime.',kv_cache_type_k:'Quantization/data type for the key cache.',kv_cache_type_v:'Quantization/data type for the value cache.',flash_attention:'Enable the runtime-advertised flash-attention implementation.',unified_kv_cache:'Share KV cache allocation across sequences when supported.',offload_kv_cache:'Allow KV cache offload according to the runtime option.',keep_model_in_memory:'Lock model pages in host memory when the runtime supports it.',fit:'Ask llama.cpp to auto-adjust settings to detected memory. Disabled by default due observed server instability; enable only deliberately.'};return descriptions[key]||`Configure ${key} using the selected runtime's advertised option.`; }
  selectedModelName():string { const model=this.models().find(item=>item.id===this.modelId());return model?this.modelName(model):''; }
  selectedRuntimeName():string { return this.installation?.name || 'Backend default'; }
  selectedDeviceName():string { const d=this.devices().find(item=>this.nativeId(item)===this.device());return d?`${d.name} · ${this.nativeId(d)}`:''; }
  formatMemory(bytes:number):string { if(!Number.isFinite(bytes)||bytes<0)return 'Unavailable';return `${(bytes/(1024**3)).toFixed(1)} GB`; }
  selectedModelPath():string { return this.models().find(model=>model.id===this.modelId())?.path||''; }
  hasPlacementOptions():boolean {return this.supports('gpu_layers')||this.supports('split_mode')||this.supports('tensor_split')||this.supports('main_gpu');}
  hasLoadOptions():boolean {return this.loadNumbers.some(field=>this.supports(field.cap))||this.booleanFields.some(field=>this.supports(field.cap));}
  hasAdvancedOptions():boolean {return this.loadStrings.some(field=>this.supports(field.cap))||this.supports('mmap')||this.supports('continuous_batching')||this.supports('device_selection');}
  deviceError():string {if(!this.manualDevice())return '';const id=this.device().trim();return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(id)?'':'Enter a runtime device identifier such as ROCm0 or Vulkan1.';}
  setDetectedDevice(id:string){this.manualDevice.set(false);this.device.set(id);}
  toggleManualDevice(enabled:boolean){this.manualDevice.set(enabled);if(!enabled)this.device.set('');}
  setBackend(name:string){this.backendName.set(name);const match=this.installations().find(item=>item.backend===name&&item.enabled&&item.available);if(match){this.setInstallation(match.id);return;}this.runtimeId.set('');this.device.set('');this.manualDevice.set(false);this.devices.set(this.allDevices());this.readSplitModes();}
  setInstallation(id:string){const item=this.installations().find(r=>r.id===id);this.runtimeId.set(id);this.device.set('');this.manualDevice.set(false);if(item){this.backendName.set(item.backend||this.backendName()||'llama.cpp');const local=item.devices||[];this.devices.set(local.length?local:this.allDevices().filter(device=>device.runtime_id===id));}else{this.devices.set(this.allDevices());}this.readSplitModes();}
  nativeId(d:RuntimeDevice){return d.id;}
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
  async refreshStatus(){try{this.status.set(await this.runtime.status());this.selectLoadedModelWhenUntouched();}catch(e){this.error.set(errorMessage(e));}}
  async showCommand(){try{const result=await this.runtime.command(this.payload());this.command.set(result.data.command);}catch(e){this.error.set(errorMessage(e));}}
  async addInstallation(event:Event){event.preventDefault();const executable=this.runtimeExecutable().trim();if(!executable)return;this.managerBusy.set('add');this.error.set('');try{const value=await this.runtime.addInstallation({executable,...(this.runtimeName().trim()?{name:this.runtimeName().trim()}:{})});this.installations.update(items=>[...items.filter(item=>item.id!==value.id),value]);this.runtimeExecutable.set('');this.runtimeName.set('');this.setInstallation(value.id);this.notice.set(`Registered and probed ${value.name}.`);}catch(e){this.error.set(errorMessage(e));}finally{this.managerBusy.set('');}}
  async probeInstallation(item:RuntimeInstallation){this.managerBusy.set(item.id);this.error.set('');try{const value=await this.runtime.probeInstallation(item.id);this.installations.update(items=>items.map(current=>current.id===value.id?value:current));if(this.runtimeId()===value.id)this.setInstallation(value.id);this.notice.set(`Runtime probe complete: ${value.available?'available':'unavailable'}.`);}catch(e){this.error.set(errorMessage(e));}finally{this.managerBusy.set('');}}
  async toggleInstallation(item:RuntimeInstallation){this.managerBusy.set(item.id);this.error.set('');try{const value=await this.runtime.setInstallationEnabled(item.id,!item.enabled);this.installations.update(items=>items.map(current=>current.id===value.id?value:current));if(!value.enabled&&this.runtimeId()===value.id)this.setInstallation('');this.notice.set(`${value.name} ${value.enabled?'enabled':'disabled'}.`);}catch(e){this.error.set(errorMessage(e));}finally{this.managerBusy.set('');}}
  async removeInstallation(item:RuntimeInstallation){this.managerBusy.set(item.id);this.error.set('');try{await this.runtime.removeInstallation(item.id);this.installations.update(items=>items.filter(current=>current.id!==item.id));if(this.runtimeId()===item.id)this.setInstallation('');this.notice.set(`Removed ${item.name} from the registry. Its executable was not deleted.`);}catch(e){this.error.set(errorMessage(e));}finally{this.managerBusy.set('');}}
  copyCommand(){void navigator.clipboard?.writeText(this.command());this.copied.set(true);}
}
function errorMessage(e:unknown):string {
  if(e instanceof Error)return e.message;
  if(e&&typeof e==='object'){
    const value=e as {message?:unknown;error?:unknown};
    if(typeof value.message==='string')return value.message;
    if(typeof value.error==='string')return value.error;
    if(value.error&&typeof value.error==='object'&&'error' in value.error&&typeof (value.error as {error?:unknown}).error==='string')return (value.error as {error:string}).error;
    try{return JSON.stringify(e);}catch{return 'The runtime request failed with an unreadable error.';}
  }
  return String(e);
}
