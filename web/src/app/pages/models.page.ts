import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ModelSourcesService } from '../core/model-sources.service';
import { ModelProfile, ModelRecord, ModelSource, RuntimeCapabilities, RuntimeDevice, RuntimeInstallation, RuntimeLoadOptions, RuntimePlacement } from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService } from '../core/runtime.service';
import { ModelProfilesService } from '../core/model-profiles.service';

type ProfileTab = 'placement' | 'load';
type ModelSortKey = 'name' | 'size' | 'architecture' | 'quantization' | 'context';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <div><div class="eyebrow">LIBRARY</div><h1>Models</h1>
        <p>Add GGUF folders from AI Dream or other model applications, then select a file to load or tune its profile.</p></div>
      <button class="secondary-button" (click)="rescan()" [disabled]="busy()" aria-label="Rescan model folders" title="Scan registered folders again for GGUF files">
        {{ rescanning() ? 'Scanning…' : '↻ Rescan' }}
      </button>
    </header>

    @if (error()) { <div class="notice error" role="alert">{{ error() }}</div> }
    @if (notice()) { <div class="notice success" role="status">{{ notice() }}</div> }

    <section class="surface add-source" aria-labelledby="add-source-title">
      <div><h2 id="add-source-title">Add a model folder</h2>
        <p>Enter any existing local directory containing GGUF files, including folders used by other applications. AI Dream scans it without moving or deleting files.</p></div>
      <form (submit)="addSource($event)">
        <label class="sr-only" for="source-path">Model folder path</label>
        <input id="source-path" type="text" autocomplete="off" placeholder="/home/you/models or another app’s GGUF folder" title="Enter an existing local folder to add it to the catalog; files are not moved or deleted"
          [value]="pathInput()" (input)="pathInput.set($any($event.target).value)" [disabled]="busy()">
        <button class="primary-button" [disabled]="busy() || !pathInput().trim()" title="Register and scan this folder for GGUF models">{{ adding() ? 'Adding…' : 'Add folder' }}</button>
      </form>
    </section>

    <div class="library-layout">
      <section class="surface sources" aria-labelledby="sources-title">
        <div class="section-heading"><div><div class="eyebrow">CATALOG</div><h2 id="sources-title">Model folders</h2></div>
          <span class="count" title="Registered local model folders">{{ sources().length }}</span></div>
        @if (loading()) { <p class="muted" aria-live="polite">Loading model folders…</p> }
        @else if (!sources().length) { <div class="empty"><b>No model folders yet</b><span>Add a folder above to find local GGUF files.</span></div> }
        @else {
          <ul class="source-list">
            @for (source of sources(); track source.id) {
              <li><button class="source-item" [class.selected]="selectedId() === source.id" (click)="select(source)" [title]="source.path + (source.exists ? ' — inspect models in this folder' : ' — folder unavailable')"
                  [attr.aria-current]="selectedId() === source.id ? 'true' : null">
                <span class="folder-icon" aria-hidden="true">▰</span><span class="source-copy"><b>{{ source.path }}</b>
                  <small>{{ source.exists ? (source.model_count + ' models · ' + size(source.total_bytes)) : 'Folder unavailable' }}</small></span>
                <span class="arrow" aria-hidden="true">›</span>
              </button></li>
            }
          </ul>
        }
      </section>

      <section class="surface details" aria-labelledby="models-title">
        @if (selected(); as source) {
          <div class="detail-head"><div><div class="eyebrow">FOLDER DETAILS</div><h2>{{ source.path }}</h2>
            <p>{{ source.readable ? 'Readable' : 'Not readable' }} · {{ source.managed ? 'Managed by AI Dream' : 'External folder' }}</p></div>
            <button class="danger-button" (click)="removeSource(source)" [disabled]="busy()" title="Unregister this folder only; model files on disk are not deleted">Remove from catalog</button>
          </div>
          <div class="summary" aria-label="Folder summary"><div><b>{{ source.model_count }}</b><span>models</span></div><div><b>{{ size(source.total_bytes) }}</b><span>total size</span></div><div><b>{{ source.exists ? 'Available' : 'Missing' }}</b><span>folder status</span></div></div>
          <div class="model-browser-layout">
          <section class="model-browser" aria-label="Local models">
            <div class="section-heading model-heading"><div><div class="eyebrow">LOCAL FILES</div><h2 id="models-title">Models in this folder</h2></div><span class="count" title="Models matching the current folder and filter">{{ visibleModels().length }}</span></div>
            <div class="model-controls"><label class="model-search" title="Filter by model name, path, GGUF architecture, or metadata"><span aria-hidden="true">⌕</span><input type="search" placeholder="Filter by name, architecture, or quantization" [value]="modelFilter()" (input)="modelFilter.set($any($event.target).value)" title="Filter this folder’s indexed models"></label><div class="model-sort"><label title="Choose the catalog field used to order models">Sort by<select aria-label="Sort models by" [value]="modelSortKey()" (change)="setModelSort($any($event.target).value)" title="Name, file size, GGUF architecture, quantization, or available context length"><option value="name">Name</option><option value="size">Size</option><option value="architecture">Architecture</option><option value="quantization">Quantization</option><option value="context">Context length</option></select></label><button type="button" (click)="toggleModelSortDirection()" [attr.aria-label]="modelSortDirection() === 'asc' ? 'Sort descending' : 'Sort ascending'" [title]="modelSortDirection() === 'asc' ? 'Reverse order: descending' : 'Reverse order: ascending'">{{ modelSortDirection() === 'asc' ? 'Ascending ↑' : 'Descending ↓' }}</button></div></div>
            @if (!source.exists || !source.readable) { <div class="empty"><b>Folder cannot be scanned</b><span>Check that this directory exists and is readable.</span></div> }
            @else if (loading()) { <p class="muted" aria-live="polite">Loading model catalog…</p> }
            @else if (!visibleModels().length) { <div class="empty"><b>No GGUF models found</b><span>Rescan after adding files to this folder.</span></div> }
            @else {
              <ul class="model-list">
                @for (model of visibleModels(); track model.id) {
                  <li><article class="model-card" [class.model-selected]="selectedModelId() === model.id" [title]="modelName(model) + ' · ' + size(model.size) + ' · ' + (model.metadata['general.architecture'] || 'Architecture unavailable')"><span class="model-icon" aria-hidden="true">⬡</span><div class="model-copy">
                    <h3>{{ modelName(model) }}</h3><p [title]="'Local file path: ' + model.path">{{ model.path }}</p><div class="model-tags"><span [title]="'File format reported by the local model catalog: ' + (model.format || 'GGUF')">{{ model.format || 'GGUF' }}</span><span [title]="'File size reported by the local model catalog: ' + size(model.size)">{{ size(model.size) }}</span>
                      @if (model.metadata['general.architecture']; as architecture) { <span [title]="'Architecture read from GGUF metadata: ' + architecture">{{ architecture }}</span> }
                      @if (modelQuantization(model); as quant) { <span [title]="'Quantization inferred from GGUF metadata or filename: ' + quant">{{ quant }}</span> }
                      @if (modelContextLength(model); as contextLength) { <span [title]="'Context length read from available GGUF metadata: ' + contextLength">{{ contextLength }} ctx</span> }
                    </div>
                    <details><summary title="Show fields read from this GGUF header">Model metadata</summary><dl>@for (entry of metadataEntries(model); track entry[0]) {<dt [title]="entry[0]">{{ entry[0] }}</dt><dd [title]="entry[0] + ': ' + display(entry[1])">{{ display(entry[1]) }}</dd>}</dl></details>
                    <button class="secondary-button configure-model-button" (click)="selectModel(model)" [attr.aria-pressed]="selectedModelId() === model.id" title="Select this model and load its saved runtime profile">{{ selectedModelId() === model.id ? 'Configuring this model' : 'Configure model' }}</button>
                  </div></article></li>
                }
              </ul>
            }
          </section>
          @if (selectedModel(); as model) {
            <aside class="load-panel" aria-label="Model runtime actions">
              <div><div class="eyebrow">MODEL SETUP</div><b>{{ modelName(model) }}</b><small>{{ model.path }}</small><p class="setup-hint">Choose a saved profile or configure placement and load settings for this model, then load it into the runtime.</p></div>
              <section class="profile-panel" aria-label="Model profile">
                <div class="profile-title"><div><div class="eyebrow">CONFIGURATION PROFILE</div><b>Settings saved specifically for this model</b></div><button class="secondary-button" (click)="refreshProfiles()" [disabled]="profileBusy()" aria-label="Refresh profiles" title="Reload saved profiles and runtime capabilities for this model">↻</button></div>
                <div class="profile-grid">
                  <label title="Choose a profile saved for this model, or configure unsaved values">Saved profile<select [value]="selectedProfileId()" (change)="selectProfile($any($event.target).value)" title="Selecting a profile fills the model-specific runtime settings"><option value="">Unsaved settings</option>@for(profile of profiles();track profile.id){<option [value]="profile.id">{{profile.name}}</option>}</select></label>
                  <label title="Name used to save this model’s placement and load options">Profile name<input [value]="profileName()" (input)="profileName.set($any($event.target).value)" placeholder="e.g. Balanced on two GPUs" title="Enter a name before saving this profile"></label>
                  <label title="Select an available backend; options come from runtime discovery">Backend<select [value]="profileBackend()" (change)="profileBackend.set($any($event.target).value);refreshProfileCapabilities()" title="Runtime capability controls update when the backend changes"><option value="">Runtime default</option>@for(backend of profileBackends();track backend.name){<option [value]="backend.name" [disabled]="!backend.available">{{backend.name}}</option>}</select></label>
                  <label title="Choose an installed runtime compatible with the selected backend">Runtime<select [value]="profileRuntimeId()" (change)="profileRuntimeId.set($any($event.target).value);refreshProfileCapabilities()" title="Only enabled and available runtime installations can be selected"><option value="">Backend default</option>@for(runtime of profileInstallations();track runtime.id){<option [value]="runtime.id" [disabled]="!runtime.enabled||!runtime.available">{{runtime.name}} · {{runtime.backend||runtime.kind}}</option>}</select></label>
                </div>
                <nav class="profile-tabs" aria-label="Profile settings" role="tablist"><button role="tab" [attr.aria-selected]="profileTab()==='placement'" [class.active]="profileTab()==='placement'" (click)="profileTab.set('placement')" title="Configure device placement supported by the selected runtime">Placement</button><button role="tab" [attr.aria-selected]="profileTab()==='load'" [class.active]="profileTab()==='load'" (click)="profileTab.set('load')" title="Configure model loading options supported by the selected runtime">Load settings</button></nav>
                @if(profileTab()==='placement'){
                  <div class="profile-grid placement-grid">
                  @if(profileSupports('gpu_layers')){<label title="Number of model layers to offload to the selected device; blank uses runtime behavior">GPU layers<input type="number" [value]="profilePlacement().gpu_layers??''" (input)="setProfilePlacement('gpu_layers',$any($event.target).value)" placeholder="Runtime default" title="Enter a layer count; leave blank for the runtime default"></label>}
                  @if(profileSupports('device_selection')){<label title="Select a device identifier discovered by this runtime">Detected device<select [value]="manualDevice()? '' : profilePlacement().device||''" (change)="setDetectedDevice($any($event.target).value)" title="Choose a discovered device or leave on runtime default"><option value="">Runtime default</option>@for(device of profileDevices();track device.runtime_id||device.id){<option [value]="device.runtime_id||device.id">{{device.name}} · {{device.runtime_id||device.id}}</option>}</select></label>
                    <details class="advanced-device"><summary title="Manually enter a device ID when it is not listed above">Advanced device override</summary><label class="profile-check" title="Enable manual runtime device selection"><input type="checkbox" [checked]="manualDevice()" (change)="toggleManualDevice($any($event.target).checked)">Use a manual runtime device ID</label>@if(manualDevice()){<label title="Runtime-specific device identifier">Runtime device ID<input [value]="profilePlacement().device||''" (input)="setManualDevice($any($event.target).value)" placeholder="ROCm0, Vulkan0, CUDA0…" title="Use the identifier syntax supported by the selected runtime"><small>Use an identifier supported by the selected llama.cpp runtime. The detected device selector remains the recommended choice.</small></label>@if(manualDeviceError()){<small class="error" role="alert">{{manualDeviceError()}}</small>}}</details>
                  }
                  @if(profileSupports('split_mode')&&splitModes().length){<label title="Choose how the runtime divides model tensors across devices">Split mode<select [value]="profilePlacement().split_mode||''" (change)="setProfilePlacement('split_mode',$any($event.target).value)" title="Split modes are reported by the selected runtime"><option value="">Runtime default</option>@for(mode of splitModes();track mode){<option [value]="mode">{{mode}}</option>}</select></label>}
                  @if(profileSupports('tensor_split')){<label title="Per-device tensor split ratios in the format accepted by the runtime">Tensor split<input [value]="profilePlacement().tensor_split||''" (input)="setProfilePlacement('tensor_split',$any($event.target).value)" placeholder="Runtime default" title="Leave blank to let the runtime choose tensor placement"></label>}
                  @if(profileSupports('main_gpu')){<label title="Device index used as the main GPU by the runtime">Main GPU<input type="number" [value]="profilePlacement().main_gpu??''" (input)="setProfilePlacement('main_gpu',$any($event.target).value)" placeholder="Runtime default" title="Enter a runtime device index or leave blank for the default"></label>}
                  </div>
                } @else {
                  <div class="profile-grid load-grid">
                  @for(field of profileNumberFields;track field.key){@if(profileSupports(field.key)){<label [title]="profileFieldHelp(field.key)">{{field.label}}<input type="number" [value]="profileLoad()[field.key]??''" (input)="setProfileLoad(field.key,$any($event.target).value)" [placeholder]="profileFieldHelp(field.key)" [title]="profileFieldHelp(field.key)"></label>}}
                  @for(field of profileStringFields;track field.key){@if(profileSupports(field.key)){<label [title]="profileFieldHelp(field.key)">{{field.label}}<input [value]="profileLoad()[field.key]??''" (input)="setProfileLoad(field.key,$any($event.target).value)" [placeholder]="profileFieldHelp(field.key)" [title]="profileFieldHelp(field.key)"></label>}}
                  @for(field of profileBoolFields;track field.key){@if(profileSupports(field.key)){<label class="profile-check" [title]="profileFieldHelp(field.key)"><input type="checkbox" [checked]="profileBoolValue(field.key)" [disabled]="field.key==='mmap'&&!profileSupports('mmap_disable')||field.key==='continuous_batching'&&!profileSupports('continuous_batching_disable')" (change)="setProfileLoad(field.key,$any($event.target).checked)" [title]="profileFieldHelp(field.key)">{{field.label}}</label>}}
                  </div>
                }
                @if(profileError()){<p class="error" role="alert">{{profileError()}}</p>}@if(profileNotice()){<p class="profile-notice" role="status">{{profileNotice()}}</p>}
                <div class="load-actions"><button class="secondary-button" (click)="saveProfile()" [disabled]="profileBusy()||!profileName().trim()||!canUseProfile()" title="Save this model’s backend, placement, and load settings under the profile name">{{profileBusy()?'Saving…':selectedProfileId()?'Save profile':'Create profile'}}</button>@if(selectedProfileId()){<button class="danger-button" (click)="deleteProfile()" [disabled]="profileBusy()" title="Delete the saved profile; this does not delete the model">Delete profile</button>}</div>
              </section>
              <div class="load-actions">
                <button class="primary-button" (click)="loadModel()" [disabled]="runtimeBusy()||!canUseProfile()" title="Load this local model with the selected profile and placement">{{ runtimeBusy() ? 'Loading…' : 'Load model' }}</button>
                <button class="secondary-button" (click)="reloadModel()" [disabled]="runtimeBusy()" title="Reload the selected model using the current profile settings">Reload model</button>
                <button class="secondary-button" (click)="unloadModel()" [disabled]="runtimeBusy()" title="Unload the model from the active runtime">Unload model</button>
                <button class="secondary-button" (click)="refreshRuntimeStatus()" [disabled]="runtimeBusy()" title="Query the local API for the active runtime status">Runtime status</button>
              </div>
              @if (runtimeStatus(); as status) {
                <section class="runtime-status-card" aria-label="Runtime status" role="status">
                  <div class="runtime-status-heading"><div><div class="eyebrow">RUNTIME</div><h3>Runtime status</h3></div>
                    <span class="status-chip" [class.loaded]="runtimeStatusValue('loaded') === true" title="Loaded state reported by the local runtime API">{{ runtimeStatusValue('loaded') === true ? 'Model loaded' : 'No model loaded' }}</span>
                    <button class="secondary-button" type="button" (click)="toggleRuntimeJson()" title="Toggle the raw status response returned by the local API">{{ showRuntimeJson() ? 'Hide JSON' : 'Show JSON' }}</button>
                  </div>
                  @if (runtimeStatusValue('loaded') === true) {
                    <dl class="runtime-status-grid">
                      <div><dt title="Model identifier reported by the active runtime">Model</dt><dd>{{ runtimeStatusValue('model') || '—' }}</dd></div>
                      <div><dt title="Active backend name reported by the runtime">Backend</dt><dd>{{ runtimeStatusValue('backend') || '—' }}</dd></div>
                      <div><dt title="Runtime installation identifier, if the API provides one">Runtime</dt><dd>{{ runtimeStatusValue('runtime_id') || 'Default runtime' }}</dd></div>
                      <div><dt title="Elapsed time reported by the runtime status response">Running for</dt><dd>{{ runtimeUptime() }}</dd></div>
                      <div><dt title="Placement values reported by the runtime; not a hardware estimate">Placement</dt><dd>{{ runtimePlacementSummary() }}</dd></div>
                    </dl>
                  } @else { <p class="runtime-empty">No model is loaded. Configure this model above and choose <b>Load model</b> to start the persistent runtime.</p> }
                  @if (showRuntimeJson()) { <pre class="runtime-status-json">{{ runtimeStatusJson() }}</pre> }
                </section>
              }
              <a href="#/runtime" title="Open runtime installations, backends, and options">Configure runtime options</a>
            </aside>
          }
          </div>
        } @else {
          <div class="empty large"><span class="empty-icon" aria-hidden="true">⬡</span><b>Select a model folder</b><span>Folder details and discovered models will appear here.</span></div>
        }
      </section>
    </div>
  `,
  styles: [`
    :host{display:block}.page-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.page-head h1{margin:4px 0;font-size:30px}.page-head p,.add-source p,.detail-head p{margin:5px 0;color:var(--muted,#929baa)}
    .eyebrow{font-size:10px;letter-spacing:.14em;font-weight:700;color:var(--muted,#929baa)}h2{font-size:17px;margin:5px 0}.surface{background:var(--surface,#171a20);border:1px solid var(--border,#292d35);border-radius:12px;padding:18px}.add-source{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px}.add-source form{display:flex;gap:8px;width:min(620px,58%)}input{flex:1;min-width:120px;background:var(--bg,#101216);border:1px solid var(--border,#353943);border-radius:7px;padding:10px 12px;color:inherit;font:inherit}.primary-button,.secondary-button,.danger-button{border:1px solid var(--border,#353943);border-radius:7px;padding:9px 12px;color:inherit;background:var(--surface,#171a20);font:inherit;font-weight:600;cursor:pointer}.primary-button{background:var(--accent,#8b72ff);border-color:transparent;color:#fff}.danger-button{color:#ff9696}.primary-button:disabled,.secondary-button:disabled,.danger-button:disabled{opacity:.55;cursor:wait}.library-layout{display:grid;grid-template-columns:minmax(250px,.8fr) minmax(0,1.7fr);gap:16px;align-items:start}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.count{font-size:12px;background:var(--bg,#101216);border-radius:20px;padding:4px 9px;color:var(--muted,#929baa)}.source-list,.model-list{list-style:none;padding:0;margin:0}.source-list li+li,.model-list li+li{border-top:1px solid var(--border,#292d35)}.source-item{display:flex;align-items:center;gap:10px;width:100%;padding:12px 8px;text-align:left;border:0;background:transparent;color:inherit;border-radius:8px;cursor:pointer}.source-item.selected{background:color-mix(in srgb,var(--accent,#8b72ff) 15%,transparent)}.folder-icon{color:var(--accent,#a28eff)}.source-copy{min-width:0;flex:1}.source-copy b,.source-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-copy b{font-size:12px}.source-copy small,.arrow,.muted{color:var(--muted,#929baa);font-size:12px;margin-top:4px}.arrow{font-size:22px}.detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.detail-head h2{overflow-wrap:anywhere}.summary{display:flex;gap:26px;padding:14px 0;border-bottom:1px solid var(--border,#292d35);margin:8px 0 16px}.summary div{display:grid;gap:3px}.summary b{font-size:16px}.summary span{font-size:11px;color:var(--muted,#929baa)}.model-heading{margin-top:8px}.model-card{display:flex;gap:12px;padding:14px 4px}.model-icon{color:var(--accent,#a28eff);font-size:19px}.model-copy{min-width:0;flex:1}.model-copy h3{margin:0;font-size:14px}.model-copy p{font-size:11px;color:var(--muted,#929baa);overflow-wrap:anywhere;margin:4px 0 8px}.model-tags{display:flex;flex-wrap:wrap;gap:6px}.model-tags span{font-size:10px;padding:4px 7px;border-radius:12px;background:var(--bg,#101216);color:var(--muted,#c0c4ce)}details{margin-top:9px;font-size:11px}summary{cursor:pointer;color:var(--muted,#aeb4c0)}dl{display:grid;grid-template-columns:minmax(130px,.6fr) minmax(0,1fr);gap:5px 12px}dt{color:var(--muted,#929baa);overflow-wrap:anywhere}dd{margin:0;overflow-wrap:anywhere}.empty{padding:30px 12px;text-align:center;display:grid;gap:7px;color:var(--muted,#929baa);font-size:12px}.empty b{color:var(--text,#e8eaf0);font-size:14px}.empty.large{min-height:260px;place-content:center}.empty-icon{font-size:30px;color:var(--accent,#a28eff)}.notice{padding:11px 14px;border-radius:8px;margin-bottom:14px;font-size:13px}.error{background:#3a2024;color:#ffb4bb}.success{background:#1d382c;color:#9be0b5}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:820px){.library-layout{grid-template-columns:1fr}.add-source{align-items:stretch;flex-direction:column}.add-source form{width:100%}.page-head{align-items:flex-start}.detail-head{flex-direction:column}}
    .page-head{padding:0 0 12px;border-bottom:1px solid var(--border,#292d35);margin-bottom:12px}.page-head h1{font-size:24px}.page-head p{font-size:12px;line-height:1.45}.surface{border-radius:5px;padding:12px}.add-source{padding:10px 12px;margin-bottom:10px;background:var(--bg,#101216)}.add-source h2{font-size:13px}.add-source p{font-size:11px;max-width:550px}.add-source form{max-width:560px}.library-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.sources{padding:11px 12px}.sources .section-heading{margin-bottom:8px}.sources .section-heading h2{font-size:13px}.source-list{display:flex;gap:7px;overflow:auto;padding-bottom:2px}.source-list li{flex:0 0 min(310px,38vw);border:0}.source-item{height:58px;padding:8px 10px;border:1px solid var(--border,#292d35);border-radius:4px;background:var(--bg,#101216)}.source-item.selected{border-color:var(--accent,#8b72ff);background:color-mix(in srgb,var(--accent,#8b72ff) 10%,var(--bg,#101216))}.folder-icon{font-size:15px}.source-copy b{font-size:11px}.source-copy small{font-size:10px}.details{min-width:0}.detail-head{align-items:center}.detail-head h2{font-size:13px;font-family:ui-monospace,monospace}.detail-head p{font-size:10px}.danger-button,.secondary-button,.primary-button{border-radius:4px;font-size:11px;padding:7px 9px}.summary{gap:0;margin:8px 0 11px;padding:9px 0;border-block:1px solid var(--border,#292d35)}.summary div{min-width:110px;padding:0 14px;border-right:1px solid var(--border,#292d35)}.summary div:first-child{padding-left:0}.summary div:last-child{border:0}.summary b{font:600 13px ui-monospace,monospace}.summary span{font-size:9px}.model-browser-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:12px;align-items:start}.model-browser{min-width:0}.model-heading{margin:0 0 8px}.model-heading h2{font-size:14px}.model-search{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:0 9px;border:1px solid var(--border,#353943);border-radius:4px;background:var(--bg,#101216);color:var(--muted,#929baa)}.model-search input{border:0;background:transparent;outline:0;padding:8px 0;font-size:11px}.model-search input:focus{box-shadow:none}.model-list{display:block;max-height:62vh;overflow:auto}.model-list li{min-width:0;border:0;border-bottom:1px solid var(--border,#292d35)}.model-card{box-sizing:border-box;padding:10px 7px;border:1px solid transparent;border-radius:4px;background:transparent}.model-card.model-selected{border-color:var(--accent,#8b72ff);background:color-mix(in srgb,var(--accent,#8b72ff) 8%,var(--bg,#101216))}.model-icon{flex:0 0 18px}.model-copy h3{font-size:12px;overflow-wrap:anywhere}.model-copy p{font:10px/1.4 ui-monospace,monospace}.model-tags{gap:4px}.model-tags span{border-radius:3px;padding:3px 6px;font:9px ui-monospace,monospace}.model-copy details{font-size:10px}.configure-model-button{margin-top:8px}.empty{padding:24px 12px}.load-panel{position:sticky;top:8px;max-height:76vh;overflow:auto;gap:9px;margin:0;padding:12px;border-radius:5px;background:var(--bg,#101216)}.load-panel>div:first-child{gap:4px}.load-panel>div:first-child>b{font-size:13px}.setup-hint{font-size:11px}.runtime-status-card,.profile-panel{border-radius:5px;padding:11px}.runtime-status-grid div{border-radius:4px}.profile-grid{gap:9px}.profile-grid input:not([type=checkbox]),.profile-grid select{border-radius:4px}.profile-tabs button{padding:7px 9px}.count{border-radius:3px}@media(max-width:820px){.library-layout{grid-template-columns:1fr}.model-browser-layout{grid-template-columns:minmax(0,1fr)}.load-panel{position:static;max-height:none}.source-list li{flex-basis:min(310px,78vw)}.detail-head{align-items:flex-start}}
    .model-selected{background:color-mix(in srgb,var(--accent,#8b72ff) 8%,transparent)}.load-panel{display:grid;gap:12px;margin-top:20px;padding:14px;border:1px solid var(--border,#292d35);border-radius:9px;background:var(--bg,#101216)}.load-panel>div:first-child{display:grid;gap:5px;min-width:0}.load-panel small{overflow-wrap:anywhere;color:var(--muted,#929baa)}.setup-hint{margin:0;color:var(--muted,#929baa);font-size:12px;line-height:1.5}.configure-model-button{margin-top:10px}.load-actions{display:flex;flex-wrap:wrap;gap:8px}.load-panel a{font-size:12px;color:var(--accent,#a28eff)}.runtime-status-card{display:grid;gap:12px;padding:14px;border:1px solid var(--border,#30394a);border-radius:9px;background:var(--surface,#171a20)}.runtime-status-heading{display:flex;align-items:center;gap:10px}.runtime-status-heading>div{margin-right:auto}.runtime-status-heading h3{margin:4px 0 0;font-size:14px}.status-chip{border-radius:20px;padding:5px 9px;background:#342b20;color:#e8bd79;font-size:11px}.status-chip.loaded{background:#1d382c;color:#9be0b5}.runtime-status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0}.runtime-status-grid div{min-width:0;padding:9px;border-radius:7px;background:var(--bg,#101216)}.runtime-status-grid dt{color:var(--muted,#929baa);font-size:10px}.runtime-status-grid dd{margin:5px 0 0;overflow-wrap:anywhere;font-size:11px}.runtime-empty{margin:0;color:var(--muted,#929baa);font-size:12px;line-height:1.5}.runtime-status-json{max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border-radius:7px;background:var(--bg,#101216);font-size:11px}.profile-panel{display:grid;gap:12px;padding:14px;border:1px solid var(--border,#30394a);border-radius:9px;background:color-mix(in srgb,var(--surface,#171a20) 78%,#111722)}.profile-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.profile-title>div{display:grid;gap:5px}.profile-title b{font-size:12px}.profile-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.profile-grid label{display:grid;gap:6px;color:#bdc4d2;font-size:11px}.profile-grid input:not([type=checkbox]),.profile-grid select{box-sizing:border-box;width:100%;min-width:0;background:#10151e;border:1px solid #363f4e;border-radius:6px;padding:8px 9px;color:inherit;font:inherit}.profile-grid .profile-check{display:flex;align-items:center;gap:8px;min-height:34px}.profile-notice{margin:0;color:#9be0b5;font-size:11px}.profile-tabs{display:flex;gap:6px;border-bottom:1px solid var(--border,#30394a)}.profile-tabs button{padding:8px 11px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted,#929baa);font:inherit;font-size:11px;cursor:pointer}.profile-tabs button.active{color:var(--text,#e8eaf0);border-color:var(--accent,#8b72ff)}.advanced-device{grid-column:1/-1;padding-top:3px;font-size:11px}.advanced-device summary{margin-bottom:9px}.advanced-device .profile-check{margin-bottom:8px}.advanced-device small{display:block;margin-top:5px;line-height:1.5;color:var(--muted,#929baa)}.model-controls{display:flex;align-items:center;gap:8px;margin-bottom:10px}.model-controls .model-search{flex:1;margin:0}.model-sort{display:flex;align-items:end;gap:5px}.model-sort label{display:grid;gap:4px;color:var(--muted,#929baa);font-size:9px}.model-sort select,.model-sort button{height:32px;padding:5px 8px;border:1px solid var(--border,#353943);border-radius:4px;background:var(--bg,#101216);color:var(--text,#e8eaf0);font:10px ui-monospace,monospace}.model-sort button{cursor:pointer;white-space:nowrap}.model-sort button:focus-visible,.model-sort select:focus-visible{outline:2px solid var(--accent,#8b72ff);outline-offset:1px}@media(max-width:820px){.model-controls{align-items:stretch;flex-direction:column}.model-sort{justify-content:flex-end}.model-sort label{flex:1}.model-sort select{width:100%}}`]
})
export class ModelsPage implements OnInit {
  readonly sources = signal<ModelSource[]>([]);
  readonly models = signal<ModelRecord[]>([]);
  readonly selectedId = signal('');
  readonly pathInput = signal('');
  readonly loading = signal(false);
  readonly adding = signal(false);
  readonly rescanning = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly selectedModelId = signal('');
  readonly modelFilter = signal('');
  readonly modelSortKey = signal<ModelSortKey>('name');
  readonly modelSortDirection = signal<'asc' | 'desc'>('asc');
  readonly runtimeBusy = signal(false);
  readonly runtimeStatus = signal<Record<string, unknown> | null>(null);
  readonly showRuntimeJson = signal(false);
  toggleRuntimeJson(): void { this.showRuntimeJson.update(value => !value); }

  readonly profiles = signal<ModelProfile[]>([]); readonly selectedProfileId=signal(''); readonly profileName=signal('');
  readonly profilePlacement=signal<RuntimePlacement>({}); readonly profileLoad=signal<RuntimeLoadOptions>({});
  readonly profileCapabilities=signal<RuntimeCapabilities|null>(null); readonly profileDevices=signal<RuntimeDevice[]>([]); readonly splitModes=signal<string[]>([]);
  readonly profileBackends=signal<RuntimeBackend[]>([]); readonly profileInstallations=signal<RuntimeInstallation[]>([]);
  readonly profileBackend=signal(''); readonly profileRuntimeId=signal('');
  readonly profileBusy=signal(false); readonly profileError=signal(''); readonly profileNotice=signal('');
  readonly profileTab=signal<ProfileTab>('placement'); readonly manualDevice=signal(false);
  readonly profileNumberFields: {key:'context_size'|'threads'|'batch_size'|'physical_batch_size'|'max_concurrent'|'threads_batch';label:string}[]=[
    {key:'context_size',label:'Context size'},{key:'threads',label:'Threads'},{key:'batch_size',label:'Batch size'},
    {key:'physical_batch_size',label:'Physical batch size'},{key:'max_concurrent',label:'Max concurrent'},{key:'threads_batch',label:'Batch threads'}];
  readonly profileBoolFields: {key:'continuous_batching'|'flash_attention'|'unified_kv_cache'|'offload_kv_cache'|'mmap'|'keep_model_in_memory'|'fit';label:string}[]=[
    {key:'continuous_batching',label:'Continuous batching'},{key:'flash_attention',label:'Flash attention'},{key:'unified_kv_cache',label:'Unified KV cache'},
    {key:'offload_kv_cache',label:'Offload KV cache'},{key:'mmap',label:'Memory map'},{key:'keep_model_in_memory',label:'Keep model in memory'},{key:'fit',label:'Fit to available memory'}];
  readonly profileStringFields: {key:'numa'|'kv_cache_type_k'|'kv_cache_type_v';label:string}[]=[
    {key:'numa',label:'NUMA policy'},{key:'kv_cache_type_k',label:'KV cache type K'},{key:'kv_cache_type_v',label:'KV cache type V'}];
  constructor(private readonly library: ModelSourcesService, private readonly runtime: RuntimeService, private readonly profileApi: ModelProfilesService) {}

  ngOnInit(): void { void this.refresh(); }

  selected(): ModelSource | undefined { return this.sources().find(source => source.id === this.selectedId()); }
  visibleModels(): ModelRecord[] {
    const source = this.selected();
    if (!source) return [];
    const prefix = source.path.replace(/[\\/]$/, '') + '/';
    const query = this.modelFilter().trim().toLocaleLowerCase();
    return this.models().filter(model => (model.path === source.path || model.path.startsWith(prefix)) && (!query || `${this.modelName(model)} ${model.path} ${model.format} ${JSON.stringify(model.metadata)}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => this.compareModels(a, b));
  }

  setModelSort(value: string): void {
    if (!['name', 'size', 'architecture', 'quantization', 'context'].includes(value)) return;
    const key = value as ModelSortKey;
    this.modelSortKey.set(key);
    this.modelSortDirection.set(key === 'context' ? 'desc' : 'asc');
  }
  toggleModelSortDirection(): void { this.modelSortDirection.update(direction => direction === 'asc' ? 'desc' : 'asc'); }
  private compareModels(a: ModelRecord, b: ModelRecord): number {
    const key = this.modelSortKey();
    const left = this.modelSortValue(a, key);
    const right = this.modelSortValue(b, key);
    if (left == null || right == null) {
      if (left == null && right != null) return 1;
      if (left != null && right == null) return -1;
    } else {
      const comparison = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
      if (comparison) return comparison * (this.modelSortDirection() === 'asc' ? 1 : -1);
    }
    return this.modelName(a).localeCompare(this.modelName(b), undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
  }
  private modelSortValue(model: ModelRecord, key: ModelSortKey): string | number | null {
    switch (key) {
      case 'name': return this.modelName(model);
      case 'size': return Number.isFinite(model.size) && model.size >= 0 ? model.size : null;
      case 'architecture': return typeof model.metadata?.['general.architecture'] === 'string' ? model.metadata['general.architecture'] as string : null;
      case 'quantization': return this.modelQuantization(model) || null;
      case 'context': return this.modelContextLength(model);
    }
  }

  select(source: ModelSource): void { this.selectedId.set(source.id); this.error.set(''); this.notice.set(''); }
  selectedModel(): ModelRecord | undefined {
    const id = this.selectedModelId();
    return this.visibleModels().find(model => model.id === id);
  }
  selectModel(model: ModelRecord): void { this.selectedModelId.set(model.id); this.runtimeStatus.set(null); this.showRuntimeJson.set(false); this.error.set(''); void this.refreshProfiles(); }

  profileFieldHelp(key: string): string {
    const help: Record<string, string> = {
      context_size: 'Maximum context window in tokens requested from the runtime.',
      threads: 'CPU threads used for generation when supported by the runtime.',
      batch_size: 'Maximum logical token batch size used during prompt processing.',
      physical_batch_size: 'Physical micro-batch size used while processing prompts.',
      max_concurrent: 'Maximum parallel requests or slots supported by this runtime.',
      threads_batch: 'CPU threads used for batch and prompt processing.',
      continuous_batching: 'Allow the runtime to combine active requests into batches.',
      flash_attention: 'Request the runtime’s Flash Attention implementation.',
      unified_kv_cache: 'Request a unified key/value cache across sequences.',
      offload_kv_cache: 'Request that key/value cache operations be offloaded when supported.',
      mmap: 'Memory-map model files instead of reading them through the usual buffered path.',
      keep_model_in_memory: 'Ask the runtime to keep the loaded model resident in memory.',
      fit: 'Ask the backend to fit model layers to available memory where supported.',
      numa: 'NUMA placement policy understood by the selected runtime.',
      kv_cache_type_k: 'Data type used for the key portion of the KV cache.',
      kv_cache_type_v: 'Data type used for the value portion of the KV cache.'
    };
    return `${help[key] || 'Runtime-specific model loading option.'} Blank or disabled values use the runtime default.`;
  }

  async loadModel(): Promise<void> {
    const model = this.selectedModel(); if (!model) return;
    await this.runRuntimeAction('Loading model…', () => this.runtime.load({ model_id: model.id, profile_id: this.selectedProfileId() || undefined, backend: this.profileBackend() || undefined, runtime_id: this.profileRuntimeId() || undefined, placement: this.profilePlacement(), load: this.profileLoad() }));
  }
  async reloadModel(): Promise<void> { await this.loadModel(); }
  async unloadModel(): Promise<void> { await this.runRuntimeAction('Unloading model…', () => this.runtime.unload()); }
  async refreshRuntimeStatus(): Promise<void> { await this.runRuntimeAction('', () => this.runtime.status()); }
  profileSupports(key: string): boolean { return (this.profileCapabilities() as unknown as Record<string,unknown>|null)?.[key] === true; }
  manualDeviceError():string {
    if(!this.manualDevice())return '';
    const id=this.profilePlacement().device?.trim()||'';
    return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(id)?'':'Enter a runtime device identifier such as ROCm0 or Vulkan1.';
  }
  canUseProfile():boolean{return !this.manualDevice()||!this.manualDeviceError();}
  toggleManualDevice(enabled:boolean):void {
    this.manualDevice.set(enabled);
    if(enabled&&!this.profilePlacement().device)this.setProfilePlacement('device','');
    if(!enabled)this.setProfilePlacement('device','');
  }
  setDetectedDevice(id:string):void { this.manualDevice.set(false);this.setProfilePlacement('device',id); }
  setManualDevice(id:string):void { this.setProfilePlacement('device',id.trim()); }
  profileBoolValue(key:typeof this.profileBoolFields[number]['key']):boolean {
    const value=this.profileLoad()[key];return value===undefined?(key==='mmap'||key==='continuous_batching'):value;
  }
  setProfilePlacement(key:'gpu_layers'|'device'|'split_mode'|'tensor_split'|'main_gpu',value:string):void {
    const next={...this.profilePlacement()};
    if(value==='') delete next[key];
    else if(key==='gpu_layers'||key==='main_gpu') next[key]=Number(value);
    else next[key]=value;
    this.profilePlacement.set(next);
  }
  setProfileLoad(key:typeof this.profileNumberFields[number]['key']|typeof this.profileBoolFields[number]['key']|typeof this.profileStringFields[number]['key'],value:string|boolean):void {
    const next={...this.profileLoad()} as Record<string,unknown>;
    if(value==='') delete next[key]; else next[key]=typeof value==='string'&&key!=='continuous_batching'&&key!=='flash_attention'&&key!=='unified_kv_cache'&&key!=='offload_kv_cache'&&key!=='mmap'&&key!=='keep_model_in_memory'&&key!=='fit'?Number(value):value;
    this.profileLoad.set(next as RuntimeLoadOptions);
  }
  selectProfile(id:string):void {
    this.selectedProfileId.set(id);const profile=this.profiles().find(item=>item.id===id);
    this.profileName.set(profile?.name||'');this.profilePlacement.set(profile?structuredClone(profile.placement):{});this.profileLoad.set(profile?structuredClone(profile.load):{});
    this.profileBackend.set(profile?.backend_name||'');this.profileRuntimeId.set(profile?.runtime_id||'');
    this.manualDevice.set(Boolean(profile?.placement?.device&&!this.profileDevices().some(device=>(device.runtime_id||device.id)===profile.placement.device)));
    this.profileNotice.set('');this.profileError.set('');
    this.refreshProfileCapabilities();
  }
  async refreshProfiles():Promise<void> {
    const model=this.selectedModel();if(!model)return;this.profileError.set('');
    try{const profiles=await this.profileApi.list(model.id);this.profiles.set(profiles);if(!profiles.some(p=>p.id===this.selectedProfileId()))this.selectProfile('');
      const [{runtime},installations]=await Promise.all([this.runtime.snapshot(),this.runtime.installations().catch(()=>[])]);
      this.profileBackends.set(runtime.backends);this.profileInstallations.set(installations);
      if(!this.selectedProfileId()){this.profileBackend.set('');this.profileRuntimeId.set('');}
      this.refreshProfileCapabilities(runtime.backends,installations,runtime.devices);
      const selected=this.profiles().find(item=>item.id===this.selectedProfileId());
      this.manualDevice.set(Boolean(selected?.placement.device&&!this.profileDevices().some(device=>(device.runtime_id||device.id)===selected.placement.device)));
    }catch(error){this.profileError.set(errorMessage(error));}
  }
  refreshProfileCapabilities(backends=this.profileBackends(),installations=this.profileInstallations(),fallbackDevices=this.profileDevices()):void {
    const installation=installations.find(item=>item.id===this.profileRuntimeId());
    const backend=backends.find(item=>item.name===(installation?.backend||this.profileBackend()))||backends.find(item=>item.name===this.profileBackend())||backends.find(item=>item.available)||backends[0];
    this.profileCapabilities.set(installation?.capabilities||backend?.capabilities||null);
    this.profileDevices.set(installation?.devices||fallbackDevices||[]);
    const runtimeWithModes=installation as (RuntimeInstallation&{split_modes?:string[];split_mode_options?:string[]})|undefined;
    this.splitModes.set(runtimeWithModes?.split_modes||runtimeWithModes?.split_mode_options||[]);
  }
  async saveProfile():Promise<void>{const model=this.selectedModel();if(!model)return;this.profileBusy.set(true);this.profileError.set('');this.profileNotice.set('');try{
    const current=this.profiles().find(p=>p.id===this.selectedProfileId());const patch={name:this.profileName().trim(),backend_name:this.profileBackend()||null,runtime_id:this.profileRuntimeId()||null,placement:this.profilePlacement(),load:this.profileLoad()};
    const saved=current?await this.profileApi.update(current.id,patch):await this.profileApi.create({model_id:model.id,...patch});
    this.profiles.set(current?this.profiles().map(p=>p.id===saved.id?saved:p):[...this.profiles(),saved]);this.selectProfile(saved.id);this.profileNotice.set('Model profile saved.');
  }catch(error){this.profileError.set(errorMessage(error));}finally{this.profileBusy.set(false);}}
  async deleteProfile():Promise<void>{const id=this.selectedProfileId();if(!id)return;this.profileBusy.set(true);this.profileError.set('');try{await this.profileApi.remove(id);this.profiles.set(this.profiles().filter(p=>p.id!==id));this.selectProfile('');this.profileNotice.set('Model profile deleted.');}catch(error){this.profileError.set(errorMessage(error));}finally{this.profileBusy.set(false);}}
  runtimeStatusValue(key: string): unknown { return this.runtimeStatus()?.[key] ?? null; }
  runtimeStatusJson(): string { return JSON.stringify(this.runtimeStatus(), null, 2); }
  runtimeUptime(): string {
    const seconds = this.runtimeStatusValue('uptime_seconds');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
    if (seconds < 60) return `${Math.floor(seconds)} sec`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${Math.floor(seconds % 60)} sec`;
  }
  runtimePlacementSummary(): string {
    const placement = this.runtimeStatusValue('placement');
    if (!Array.isArray(placement) || !placement.length) return 'Runtime default';
    return placement.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(' · ');
  }

  private async runRuntimeAction(startMessage: string, action: () => Promise<unknown>): Promise<void> {
    this.runtimeBusy.set(true); this.error.set(''); this.notice.set(startMessage);
    try {
      const result = await action(); this.runtimeStatus.set(isRecord(result) ? result : { result }); this.showRuntimeJson.set(false);
      this.notice.set(startMessage ? (startMessage.startsWith('Loading') ? 'Model loaded.' : 'Model unloaded.') : 'Runtime status updated.');
    } catch (error) { this.notice.set(''); this.error.set(errorMessage(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  async refresh(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [sources, models] = await Promise.all([this.library.list(), this.library.models()]);
      this.sources.set(sources); this.models.set(models);
      if (!sources.some(source => source.id === this.selectedId())) this.selectedId.set(sources[0]?.id || '');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loading.set(false); }
  }

  async addSource(event: Event): Promise<void> {
    event.preventDefault(); const path = this.pathInput().trim(); if (!path) return;
    this.adding.set(true); this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const source = await this.library.add(path);
      this.pathInput.set('');
      await this.refresh(); this.selectedId.set(source.id);
      this.notice.set('Model folder added to the catalog.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.adding.set(false); this.busy.set(false); }
  }

  async removeSource(source: ModelSource): Promise<void> {
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      await this.library.remove(source.id);
      this.selectedId.set(''); await this.refresh();
      this.notice.set('Folder removed from the catalog. Files on disk were not deleted.');
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async rescan(): Promise<void> {
    this.rescanning.set(true); this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      this.models.set(await this.library.rescan());
      this.sources.set(await this.library.list());
      this.notice.set(`Scan complete. ${this.models().length} model${this.models().length === 1 ? '' : 's'} found.`);
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.rescanning.set(false); this.busy.set(false); }
  }

  modelName(model: ModelRecord): string {
    const file = model.path.split(/[\\/]/).pop();
    return String(model.metadata?.['general.name'] || file || model.id);
  }
  modelContextLength(model: ModelRecord): number | null {
    const architecture = model.metadata?.['general.architecture'];
    const value = (typeof architecture === 'string' ? model.metadata?.[`${architecture}.context_length`] : null)
      ?? model.metadata?.['llama.context_length'];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }
  modelQuantization(model: ModelRecord): string {
    const fileType = model.metadata?.['general.file_type'];
    if (typeof fileType === 'number' && Number.isInteger(fileType)) return MODEL_FILE_TYPES[fileType] || `Type ${fileType}`;
    const filename = model.path.split(/[\\/]/).pop() || '';
    const hint = filename.match(/(?:^|[-_.])(IQ\d_[A-Z0-9_]+|Q\d(?:_K(?:_[SML])?|_[01])|F16|F32|BF16)(?=$|[-_.])/i)?.[1];
    return hint ? `${hint.toUpperCase()} (filename)` : '';
  }
  metadataEntries(model: ModelRecord): [string, unknown][] { return Object.entries(model.metadata || {}).sort(([a], [b]) => a.localeCompare(b)); }
  display(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }
  size(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
    if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The model catalog request failed.'; }

const MODEL_FILE_TYPES: Record<number, string> = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1',
  10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M',
  16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS', 21: 'IQ3_XXS',
  22: 'IQ1_S', 23: 'IQ4_NL', 24: 'IQ3_S', 25: 'IQ2_S', 26: 'IQ4_XS', 27: 'I8',
  28: 'I16', 29: 'I32', 30: 'I64', 31: 'F64', 32: 'IQ1_M', 33: 'BF16',
  34: 'Q4_0_4_4', 35: 'Q4_0_4_8', 36: 'Q4_0_8_8'
};
