import { afterNextRender, ChangeDetectionStrategy, Component, Injector, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ModelProfilesService } from '../core/model-profiles.service';
import { ModelSourcesService } from '../core/model-sources.service';
import { CapabilityService, ModelCapabilityEvidence } from '../core/capability.service';
import {
  ModelProfile, ModelRecord, ModelSource, RuntimeCapabilities, RuntimeDevice,
  RuntimeInstallation, RuntimeLoadOptions, RuntimePlacement,
} from '../core/control-plane.types';
import { RuntimeBackend, RuntimeService } from '../core/runtime.service';
import { ProviderConnectionsService } from '../core/provider-connections.service';

type SettingsTab = 'placement' | 'load';
type NumberLoadKey = 'context_size' | 'threads' | 'batch_size' | 'physical_batch_size' | 'max_concurrent' | 'threads_batch';
type BoolLoadKey = 'continuous_batching' | 'flash_attention' | 'unified_kv_cache' | 'offload_kv_cache' | 'mmap' | 'keep_model_in_memory' | 'fit';
type StringLoadKey = 'numa' | 'kv_cache_type_k' | 'kv_cache_type_v';
type ModelSortKey = 'name' | 'size' | 'architecture' | 'quantization' | 'context';
type ModelCapabilitySummary = { role: string; inputs: string[]; outputs: string[]; source: string };

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <div>
        <div class="eyebrow">LOCAL MODELS</div>
        <h1>Models</h1>
        <p>Select a model and configure everything it needs right there. Profiles are optional presets, not a separate loading workflow.</p>
      </div>
      <button class="secondary" (click)="rescan()" [disabled]="busy()" title="Scan registered folders again for GGUF files">{{ rescanning() ? 'Scanning…' : '↻ Rescan' }}</button>
    </header>

    @if (error()) { <div class="notice error" role="alert">{{ error() }}</div> }
    @if (notice()) { <div class="notice success" role="status">{{ notice() }}</div> }

    <section class="surface source-bar">
      <div>
        <b>Model folders</b>
        <small [title]="'Logical model_count and physical file_count reported separately by the local catalog'">{{ sources().length }} folders · {{ logicalModelCount() }} models · {{ physicalFileCount() }} GGUF files</small>
      </div>
      <form (submit)="addSource($event)">
        <input aria-label="Model folder path" title="Enter an existing local directory containing GGUF files; registration does not move model files" placeholder="/home/you/models" [value]="pathInput()"
          (input)="pathInput.set($any($event.target).value)" [disabled]="busy()">
        <button class="secondary" [disabled]="busy() || !pathInput().trim()" title="Register and scan this folder for local GGUF models">Add folder</button>
      </form>
    </section>

    @if (providers.discoveredModels().length) {
      <section class="surface remote-model-discovery" aria-label="Remote provider model discovery">
        <b>Remote provider discovery</b>
        <label>Discovered models<select aria-label="Remote provider models (discovery only)" disabled>
          <option selected>Discovery only · loading and inference unavailable</option>
          @for (model of providers.discoveredModels(); track model.id) { <option disabled [value]="model.id">{{ model.name }} · {{ model.connection_name }} · unavailable</option> }
        </select></label>
        <small>These namespaced entries are not local model files. Model Studio cannot configure or run remote inference; local GGUF models and their IDs are unchanged.</small>
      </section>
    }

    @if (loading()) {
      <section class="surface empty">Loading local models…</section>
    } @else if (!models().length) {
      <section class="surface empty"><b>No local models found</b><span>Add a GGUF folder above and rescan.</span></section>
    } @else {
      <section class="model-library" aria-label="Local models">
        <div class="model-toolbar"><span title="Logical models indexed by the local catalog">{{ visibleModels().length }} models</span><label title="Choose the catalog field used to order models">Sort by <select aria-label="Sort models by" [value]="sortKey()" (change)="setSortKey($any($event.target).value)" title="Sort using available file and GGUF metadata"><option value="name">Name</option><option value="size">File size</option><option value="architecture">Architecture</option><option value="quantization">Quantization</option><option value="context">Context length</option></select></label><button class="secondary" type="button" (click)="toggleSortDirection()" [title]="sortDirection() === 'asc' ? 'Reverse order: descending' : 'Reverse order: ascending'" [attr.aria-label]="sortDirection() === 'asc' ? 'Sort descending' : 'Sort ascending'">{{ sortDirection() === 'asc' ? 'Ascending ↑' : 'Descending ↓' }}</button></div>
      <section class="model-grid" aria-label="Local models">
        @for (model of visibleModels(); track model.id) {
          <article class="model-card" [class.open]="selectedModelId() === model.id" [class.loaded]="isLoaded(model)">
            <button class="model-summary" (click)="toggleModel(model)" [attr.aria-expanded]="selectedModelId() === model.id" [title]="modelName(model) + ' · ' + size(model.size) + ' · ' + (model.metadata['general.architecture'] || 'Architecture unavailable')">
              <span class="model-icon">⬡</span>
                <span class="model-main">
                  <span class="model-title">{{ modelName(model) }}</span>
                  <span class="model-path" [title]="'Local model path: ' + model.path">{{ model.path }}</span>
                  @let modelCaps = modelCapabilities(model);
                  <span class="tags">
                  <span class="model-state present" title="Present: returned by the local model catalog">● PRESENT</span>
                  @if (isRunnable(model)) { <span class="model-state runnable" [title]="runnableEvidenceTitle(model)">↗ RUNNABLE</span> }
                  @if (isVerified(model)) { <span class="model-state verified" [title]="verifiedEvidenceTitle(model)">✓ VERIFIED</span> }
                  @if (isLoaded(model)) { <span class="loaded-tag" title="Loaded: the active runtime reports this exact model path">● LOADED</span> }
                  @if (loadErrorModelId() === model.id) { <span class="model-state failed" title="The most recent load request for this model failed">! ERROR</span> }
                  <span [title]="'Format reported by the local catalog: ' + (model.format || 'GGUF')">{{ (model.format || 'GGUF').toUpperCase() }}</span>
                  <span [title]="'File size reported by the local catalog: ' + size(model.size)">{{ size(model.size) }}</span>
                  @if (model.metadata['general.architecture']; as architecture) { <span [title]="'Architecture read from GGUF metadata: ' + architecture">{{ architecture }}</span> }
                  @if (modelQuantization(model); as quantization) { <span [title]="'Quantization read from GGUF metadata or inferred from filename: ' + quantization">{{ quantization }}</span> }
                  @if (modelContextLength(model); as contextLength) { <span [title]="'Context length read from available GGUF metadata: ' + contextLength">{{ contextLength }} ctx</span> }
                  <span class="capability-role" [title]="'Model role · ' + modelCaps.source">ROLE {{ modelCaps.role }}</span>
                  @for (input of modelCaps.inputs; track input) { <span class="capability-tag input" [title]="'Accepted input type · ' + modelCaps.source">IN {{ input }}</span> }
                  @for (output of modelCaps.outputs; track output) { <span class="capability-tag output" [title]="'Produced output type · ' + modelCaps.source">OUT {{ output }}</span> }
                </span>
              </span>
              <span class="chevron">{{ selectedModelId() === model.id ? '⌃' : '⌄' }}</span>
            </button>

            @if (selectedModelId() === model.id) {
              <div class="model-config">
                <div class="config-head">
                  <div><div class="eyebrow">MODEL CONFIGURATION</div><h2>{{ modelName(model) }}</h2></div>
                <div class="runtime-state" [class.active]="isLoaded(model)" [title]="isLoaded(model) ? 'Runtime status matches this model path' : 'This model path is not reported as the active loaded model'">{{ isLoaded(model) ? 'Loaded in memory' : 'Not loaded' }}</div>
                </div>

                <div class="quick-actions">
                  <button class="primary" (click)="loadModel(model)" [disabled]="runtimeBusy() || !configurationValid()" title="Load this model with the selected backend, placement, and runtime options">
                    {{ runtimeBusy() ? 'Working…' : (isLoaded(model) ? 'Reload model' : 'Load model') }}
                  </button>
                  <button class="secondary" (click)="unloadModel()" [disabled]="runtimeBusy() || !loadedModelPath()" title="Unload the model currently reported by the runtime">Unload current model</button>
                  <button class="secondary" (click)="refreshRuntimeStatus()" [disabled]="runtimeBusy()" title="Query the local API for current runtime status">Refresh status</button>
                  <button class="secondary" type="button" (click)="openRuntime(model)" title="Open runtime configuration for this model and selected preset">Runtime settings</button>
                  @if (isLoaded(model)) { <button class="secondary" type="button" (click)="useInChat(model)" title="Open Chat with this loaded model and preset selected">Use in Chat</button> }
                </div>

                @if (modelEvidence()[model.id]; as evidence) {
                  <section class="model-evidence" aria-label="Model capability evidence">
                    <b>Capability evidence</b>
                    @if (evidence.error) { <p role="status">{{ evidence.error }}</p> }
                    @if (evidence.manifest; as manifest) {
                      <p>Manifest: {{ manifest.id }} · {{ manifest.provenance?.source || 'source unknown' }} · {{ manifest.provenance?.status || 'status unknown' }}</p>
                      @if (manifest.description) { <p>{{ manifest.description }}</p> }
                      @if (manifest.artifacts?.length) {
                        <div class="manifest-artifacts"><b>Artifacts</b><ul>@for (artifact of manifest.artifacts; track $index) { <li>{{ artifact.role || 'role unknown' }}{{ artifact.model_id ? ' · ' + artifact.model_id : '' }}{{ artifact.optional ? ' · optional' : '' }}</li> }</ul></div>
                      }
                      @if (manifest.modalities?.inputs?.length || manifest.modalities?.outputs?.length) { <p>Declared modalities: IN {{ manifest.modalities?.inputs?.join(', ') || 'Not reported' }} · OUT {{ manifest.modalities?.outputs?.join(', ') || 'Not reported' }}</p> }
                      @if (manifest.capabilities?.length) {
                        <div class="manifest-capabilities" aria-label="Declared model capabilities">
                          @for (capability of manifest.capabilities; track capability.id) {
                            <article><code>{{ capability.id }}</code><span>IN {{ manifestKinds(capability.inputs) }} · OUT {{ manifestKinds(capability.outputs) }}</span><small>Evidence: {{ capability.evidence?.source || 'unknown source' }} · {{ capability.evidence?.status || 'unknown status' }}{{ capability.evidence?.verified_at ? ' · ' + (capability.evidence?.verified_at || '') : '' }}</small></article>
                          }
                        </div>
                      }
                      @if (manifest.runtime_compatibility?.length) { <p>Runtime compatibility: @for (runtime of manifest.runtime_compatibility; track $index) { <span>{{ runtime.runtime_id || runtime.backend || 'runtime kind not reported' }} · {{ runtime.status || 'status not reported' }}@if (!$last) {; } </span> }</p> }
                      @if (manifest.provenance?.verified_at; as verifiedAt) { <small>Verified at {{ verifiedAt }}</small> }
                      @if (evidence.verificationAvailable) { <button type="button" class="secondary" (click)="verifyModel(model)" [disabled]="verificationBusy() || runtimeBusy()">{{ verificationBusy() ? 'Verifying on local runtime…' : 'Verify on local runtime' }}</button> }
                      @else { <p>Verification unavailable: {{ evidence.verificationUnavailableReason || 'A bounded local semantic verifier is not configured.' }}</p> }
                      @if (evidence.verification; as verification) {
                        @if (verification.success) { <p role="status">Runtime verification succeeded at {{ verification.completed_at }}.</p> }
                      }
                      @if (verificationError()) { <p role="alert">{{ verificationError() }}</p> }
                    } @else { <p>No model manifest is associated with this catalog entry.</p> }
                    @if (isRunnable(model)) { <p>{{ runnableEvidenceTitle(model) }}</p> }
                    @else { <p>No compatible local capability route is currently reported. This does not prove the model file is invalid.</p> }
                    @if (isVerified(model)) { <p>{{ verifiedEvidenceTitle(model) }}</p> }
                  </section>
                }

                <section class="preset-box">
                  <div class="preset-heading">
                    <div><b>Configuration preset</b><small>Optional. Loading a model does not require a preset.</small></div>
                      <button class="text-button" (click)="resetConfiguration()" title="Clear custom backend, placement, and load values so the runtime applies its defaults">Reset to runtime defaults</button>
                  </div>
                  <div class="form-grid compact">
                    <label title="Choose a saved configuration for this model, or keep custom runtime values">Saved preset
                      <select [value]="selectedProfileId()" (change)="applyProfile($any($event.target).value)" title="Apply the selected model-specific preset">
                        <option value="">Runtime defaults / custom</option>
                        @for (profile of profiles(); track profile.id) { <option [value]="profile.id">{{ profile.name }}</option> }
                      </select>
                    </label>
                    <label title="Name used to save this model-specific configuration">Preset name
                      <input [value]="profileName()" (input)="profileName.set($any($event.target).value)" placeholder="e.g. 2× GPU / 18K context" title="Enter a name before saving the configuration">
                    </label>
                    <div class="preset-actions">
                      <button class="secondary" (click)="saveProfile(model)" [disabled]="profileBusy() || !profileName().trim() || !configurationValid()" title="Save the current backend, placement, and load settings for this model">
                        {{ profileBusy() ? 'Saving…' : (selectedProfileId() ? 'Update preset' : 'Save as preset') }}
                      </button>
                      @if (selectedProfileId()) { <button class="danger" (click)="deleteProfile()" [disabled]="profileBusy()" title="Delete the saved preset; the model file is not affected">Delete</button> }
                    </div>
                  </div>
                </section>

                <div class="form-grid">
                  <label title="Select an available backend reported by runtime discovery">Backend
                    <select [value]="backendName()" (change)="changeBackend($any($event.target).value)" title="Automatic lets runtime selection choose the backend">
                      <option value="">Automatic</option>
                      @for (backend of backends(); track backend.name) {
                        <option [value]="backend.name" [disabled]="!backend.available">{{ backend.name }}{{ backend.available ? '' : ' · unavailable' }}</option>
                      }
                    </select>
                  </label>
                  <label title="Choose an installed runtime compatible with the selected backend">Runtime installation
                    <select [value]="runtimeId()" (change)="changeRuntime($any($event.target).value)" title="Only enabled, available installations can be selected">
                      <option value="">Automatic</option>
                      @for (runtime of matchingInstallations(); track runtime.id) {
                        <option [value]="runtime.id" [disabled]="!runtime.enabled || !runtime.available">{{ runtime.name }} · {{ runtime.backend || runtime.kind }}</option>
                      }
                    </select>
                  </label>
                </div>

                @if (capabilities(); as caps) {
                  <p class="capability-note" title="Capability information returned by the selected runtime or backend">{{ caps.details || 'Runtime capabilities detected from the selected backend.' }}</p>
                }

                <nav class="tabs" role="tablist" aria-label="Model configuration sections">
                  <button role="tab" [class.active]="tab() === 'placement'" [attr.aria-selected]="tab() === 'placement'" (click)="tab.set('placement')" title="Show device placement options advertised by this runtime">GPU & placement</button>
                  <button role="tab" [class.active]="tab() === 'load'" [attr.aria-selected]="tab() === 'load'" (click)="tab.set('load')" title="Show model loading options advertised by this runtime">Memory & load</button>
                </nav>

                @if (tab() === 'placement') {
                  <div class="form-grid settings-grid">
                    @if (supports('gpu_layers')) {
                      <div class="form-field"><label title="Number of layers to offload to the selected device; blank leaves the runtime default">GPU layers<input type="number" min="0" [value]="placement().gpu_layers ?? ''" (input)="setPlacementNumber('gpu_layers', $any($event.target).value)" title="Set a layer count, or leave blank to use runtime defaults"></label>@if (modelBlockCount(model); as blockCount) { <button class="text-button" type="button" (click)="useModelLayerCount(model)" [title]="'Set the field to the ' + blockCount + ' blocks reported in this model’s GGUF metadata; this does not estimate device memory'">Use GGUF metadata · {{ blockCount }} layers</button> }</div>
                    }
                    @if (supports('device_selection')) {
                      <label title="Choose a device identifier discovered by the runtime">Device
                        <select [value]="placement().device || ''" (change)="setPlacementText('device', $any($event.target).value)" title="Runtime default delegates device selection to the backend">
                          <option value="">Runtime default</option>
                          @for (device of matchingDevices(); track device.runtime_id || device.id) { <option [value]="device.id" [title]="'Native device ID passed to the runtime: ' + device.id">{{ device.name }} · {{ device.id }}</option> }
                        </select>
                      </label>
                    }
                    @if (supports('tensor_split')) {
                      <label title="Per-device tensor split ratios in the format accepted by the selected runtime">Tensor split<input [value]="placement().tensor_split || ''" (input)="setPlacementText('tensor_split', $any($event.target).value)" placeholder="1,1" title="Enter the runtime’s device split ratios"></label>
                    }
                    @if (supports('split_mode')) {
                      <label title="How the runtime distributes model tensors across devices">Split mode<input [value]="placement().split_mode || ''" (input)="setPlacementText('split_mode', $any($event.target).value)" placeholder="layer" title="Use a value supported by the selected runtime"></label>
                    }
                    @if (supports('main_gpu')) {
                      <label title="Runtime device index used as the main GPU">Main GPU<input type="number" min="0" [value]="placement().main_gpu ?? ''" (input)="setPlacementNumber('main_gpu', $any($event.target).value)" title="Enter an index reported by the runtime"></label>
                    }
                    @if (!hasPlacementControls()) { <div class="empty inline">The selected runtime does not advertise manual placement controls.</div> }
                  </div>
                } @else {
                  <div class="form-grid settings-grid">
                    @for (field of numberFields; track field.key) {
                      @if (supports(field.key)) { <label [title]="fieldHelp(field.key)">{{ field.label }}<input type="number" min="1" [value]="loadOptions()[field.key] ?? ''" (input)="setLoadNumber(field.key, $any($event.target).value)" [title]="fieldHelp(field.key)" [placeholder]="fieldHelp(field.key)"></label> }
                    }
                    @for (field of stringFields; track field.key) {
                      @if (supports(field.key)) { <label [title]="fieldHelp(field.key)">{{ field.label }}<input [value]="loadOptions()[field.key] ?? ''" (input)="setLoadText(field.key, $any($event.target).value)" [title]="fieldHelp(field.key)" [placeholder]="fieldHelp(field.key)"></label> }
                    }
                    @for (field of boolFields; track field.key) {
                      @if (supports(field.key)) { <label class="check" [title]="fieldHelp(field.key)"><input type="checkbox" [checked]="loadOptions()[field.key] === true" (change)="setLoadBool(field.key, $any($event.target).checked)" [title]="fieldHelp(field.key)">{{ field.label }}</label> }
                    }
                  </div>
                }

                @if (profileError()) { <div class="inline-error" role="alert">{{ profileError() }}</div> }
                @if (runtimeStatus()) { <details class="status"><summary title="Show the raw status response returned by the runtime API">Runtime details</summary><pre>{{ runtimeStatus() }}</pre></details> }
                <details class="metadata"><summary title="Show fields read from this model’s GGUF header">Model metadata</summary><dl>@for (entry of metadataEntries(model); track entry[0]) { <dt [title]="entry[0]">{{ entry[0] }}</dt><dd [title]="entry[0] + ': ' + display(entry[1])">{{ display(entry[1]) }}</dd> }</dl></details>
              </div>
            }
          </article>
        }
      </section>
      </section>
    }
  `,
  styles: [`
    :host{display:block}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.page-head h1{margin:4px 0;font-size:30px}.page-head p{margin:4px 0;color:var(--muted,#98a0ad);max-width:760px}.eyebrow{font-size:10px;letter-spacing:.14em;font-weight:800;color:var(--muted,#98a0ad)}
    .surface,.model-card{background:var(--surface,#171a20);border:1px solid var(--border,#2b3039);border-radius:12px}.source-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;margin-bottom:14px}.source-bar>div{display:grid;gap:3px}.source-bar small,.preset-heading small{color:var(--muted,#98a0ad)}.source-bar form{display:flex;gap:8px;min-width:min(560px,60%)}input,select{box-sizing:border-box;width:100%;background:var(--bg,#101216);border:1px solid var(--border,#363c47);border-radius:7px;padding:9px 10px;color:inherit;font:inherit}.primary,.secondary,.danger,.text-button{border:1px solid var(--border,#363c47);border-radius:7px;padding:9px 12px;color:inherit;background:var(--surface,#171a20);font:inherit;font-weight:650;cursor:pointer}.primary{background:var(--accent,#806cff);border-color:transparent;color:white}.danger{color:#ff9ca5}.text-button{border:0;background:transparent;color:var(--accent,#9b8cff);padding:4px 0}.primary:disabled,.secondary:disabled,.danger:disabled{opacity:.5;cursor:wait}.notice{padding:10px 13px;border-radius:8px;margin-bottom:12px}.notice.error,.inline-error{background:#3b2025;color:#ffb7bd}.notice.success{background:#1d382c;color:#9be0b5}
    .model-library{display:grid;gap:8px}.model-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;color:var(--muted,#98a0ad);font-size:11px}.model-toolbar>span{margin-right:auto}.model-toolbar label{display:flex;align-items:center;gap:7px}.model-toolbar select{width:auto;min-width:145px}.model-grid{display:grid;gap:10px}.model-card{overflow:hidden}.model-card.loaded{border-color:color-mix(in srgb,#68d391 50%,var(--border,#2b3039))}.model-summary{display:flex;align-items:center;gap:12px;width:100%;padding:15px 16px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.model-card.open .model-summary{background:color-mix(in srgb,var(--accent,#806cff) 7%,transparent)}.model-icon{font-size:22px;color:var(--accent,#9b8cff)}.model-main{display:grid;gap:4px;min-width:0;flex:1}.model-title{font-size:15px;font-weight:750}.model-path{font-size:11px;color:var(--muted,#98a0ad);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tags{display:flex;flex-wrap:wrap;gap:6px}.tags span{font-size:10px;padding:3px 7px;border-radius:999px;background:var(--bg,#101216);color:#bbc2ce}.tags .loaded-tag{color:#9be0b5}.tags .capability-role{color:#d6c7ff;background:#211d31}.tags .capability-tag.input{color:#b9d5ff;background:#18283a}.tags .capability-tag.output{color:#99e5bd;background:#173126}.chevron{font-size:18px;color:var(--muted,#98a0ad)}
    .model-config{border-top:1px solid var(--border,#2b3039);padding:18px;display:grid;gap:16px}.config-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.config-head h2{margin:4px 0;font-size:19px}.runtime-state{font-size:11px;padding:6px 9px;border-radius:999px;background:var(--bg,#101216);color:var(--muted,#98a0ad)}.runtime-state.active{color:#9be0b5;background:#173126}.quick-actions,.preset-actions{display:flex;flex-wrap:wrap;gap:8px}.preset-box{padding:13px;border-radius:9px;border:1px solid var(--border,#303744);background:color-mix(in srgb,var(--bg,#101216) 65%,transparent)}.preset-heading{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:12px}.preset-heading>div{display:grid;gap:3px}.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.form-grid.compact{align-items:end}.form-grid label{display:grid;gap:6px;font-size:11px;color:#c2c8d2}.settings-grid{min-height:72px}.check{display:flex!important;align-items:center;gap:8px;min-height:38px}.check input{width:auto}.capability-note{margin:0;color:var(--muted,#98a0ad);font-size:11px}.tabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#303744)}.tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted,#98a0ad);padding:9px 11px;font:inherit;cursor:pointer}.tabs button.active{color:inherit;border-color:var(--accent,#806cff)}.status,.metadata{font-size:11px}.status pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:var(--bg,#101216);border-radius:7px}.metadata dl{display:grid;grid-template-columns:minmax(150px,.6fr) minmax(0,1fr);gap:5px 12px}.metadata dt{color:var(--muted,#98a0ad);overflow-wrap:anywhere}.metadata dd{margin:0;overflow-wrap:anywhere}.empty{padding:36px;text-align:center;display:grid;gap:7px;color:var(--muted,#98a0ad)}.empty.inline{grid-column:1/-1;padding:18px}.inline-error{padding:9px 11px;border-radius:7px;font-size:12px}
    .tags .model-state.present{color:#c7d2e4}.tags .model-state.runnable{color:#a8d8ff;background:#183047}.tags .model-state.verified{color:#9be0b5;background:#173126}.tags .model-state.failed{color:#ffabb2;background:#3b2025}.model-evidence{display:grid;gap:5px;padding:10px 12px;border:1px solid var(--border,#303744);border-radius:8px;background:color-mix(in srgb,var(--bg,#101216) 65%,transparent);font-size:11px}.model-evidence>b{font-size:12px}.model-evidence p,.model-evidence small{margin:0;color:var(--muted,#98a0ad);overflow-wrap:anywhere}.manifest-capabilities{display:grid;gap:5px}.manifest-capabilities article{display:grid;gap:3px;padding:7px 8px;border-radius:5px;background:var(--surface,#171a20)}.manifest-capabilities code{color:#d6c7ff}.manifest-capabilities span,.manifest-capabilities small{color:var(--muted,#98a0ad);overflow-wrap:anywhere}
    @media(max-width:760px){.page-head,.source-bar,.preset-heading,.config-head{flex-direction:column}.source-bar form{min-width:0;width:100%}.quick-actions>*{flex:1}.form-grid{grid-template-columns:1fr}.model-toolbar{flex-wrap:wrap}.model-toolbar>span{width:100%}.model-toolbar label{flex:1}.model-toolbar select{min-width:0;width:100%}}
  `],
})
export class ModelStudioPage implements OnInit {
  readonly modelEvidence = signal<Record<string, ModelCapabilityEvidence>>({});
  readonly loadErrorModelId = signal('');
  readonly verificationBusy = signal(false);
  readonly verificationError = signal('');
  readonly sources = signal<ModelSource[]>([]);
  readonly models = signal<ModelRecord[]>([]);
  readonly sortKey = signal<ModelSortKey>('name');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly rescanning = signal(false);
  readonly pathInput = signal('');
  readonly error = signal('');
  readonly notice = signal('');

  readonly selectedModelId = signal('');
  readonly backends = signal<RuntimeBackend[]>([]);
  readonly installations = signal<RuntimeInstallation[]>([]);
  readonly devices = signal<RuntimeDevice[]>([]);
  readonly backendName = signal('');
  readonly runtimeId = signal('');
  readonly placement = signal<RuntimePlacement>({});
  readonly loadOptions = signal<RuntimeLoadOptions>({});
  readonly tab = signal<SettingsTab>('placement');
  readonly runtimeBusy = signal(false);
  readonly runtimeStatus = signal('');
  readonly loadedModelPath = signal('');

  readonly profiles = signal<ModelProfile[]>([]);
  readonly selectedProfileId = signal('');
  readonly profileName = signal('');
  readonly profileBusy = signal(false);
  readonly profileError = signal('');
  private readonly requestedModelId: string;
  private readonly requestedProfileId: string;
  private restoredQuerySelection = false;
  private evidenceRequestId = 0;
  private detailRequestId = 0;

  readonly numberFields: { key: NumberLoadKey; label: string }[] = [
    { key: 'context_size', label: 'Context size' }, { key: 'threads', label: 'CPU threads' },
    { key: 'batch_size', label: 'Batch size' }, { key: 'physical_batch_size', label: 'Physical batch size' },
    { key: 'max_concurrent', label: 'Max concurrent sequences' }, { key: 'threads_batch', label: 'Batch threads' },
  ];
  readonly stringFields: { key: StringLoadKey; label: string }[] = [
    { key: 'numa', label: 'NUMA policy' }, { key: 'kv_cache_type_k', label: 'KV cache K' }, { key: 'kv_cache_type_v', label: 'KV cache V' },
  ];
  readonly boolFields: { key: BoolLoadKey; label: string }[] = [
    { key: 'continuous_batching', label: 'Continuous batching' }, { key: 'flash_attention', label: 'Flash attention' },
    { key: 'unified_kv_cache', label: 'Unified KV cache' }, { key: 'offload_kv_cache', label: 'Offload KV cache' },
    { key: 'mmap', label: 'Memory map model' }, { key: 'keep_model_in_memory', label: 'Lock model in memory' },
    { key: 'fit', label: 'Fit automatically to available memory' },
  ];

  constructor(
    private readonly library: ModelSourcesService,
    private readonly runtime: RuntimeService,
    private readonly capabilityApi: CapabilityService,
    private readonly profileApi: ModelProfilesService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly injector: Injector,
    readonly providers: ProviderConnectionsService,
  ) {
    this.requestedModelId = route.snapshot.queryParamMap.get('model_id') || '';
    this.requestedProfileId = route.snapshot.queryParamMap.get('profile_id') || '';
  }

  ngOnInit(): void { void this.refreshAll(); }
  logicalModelCount(): number { return this.sources().reduce((sum, source) => sum + source.model_count, 0); }
  physicalFileCount(): number { return this.sources().reduce((sum, source) => sum + source.file_count, 0); }

  visibleModels(): ModelRecord[] { return [...this.models()].sort((a, b) => this.compareModels(a, b)); }
  setSortKey(value: string): void {
    if (!['name', 'size', 'architecture', 'quantization', 'context'].includes(value)) return;
    const key = value as ModelSortKey;
    this.sortKey.set(key);
    this.sortDirection.set(key === 'context' ? 'desc' : 'asc');
  }
  toggleSortDirection(): void { this.sortDirection.update(value => value === 'asc' ? 'desc' : 'asc'); }
  private compareModels(a: ModelRecord, b: ModelRecord): number {
    const left = this.sortValue(a); const right = this.sortValue(b);
    if (left == null || right == null) {
      if (left == null && right != null) return 1;
      if (left != null && right == null) return -1;
    } else {
      const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
      if (order) return order * (this.sortDirection() === 'asc' ? 1 : -1);
    }
    return this.modelName(a).localeCompare(this.modelName(b), undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
  }
  private sortValue(model: ModelRecord): string | number | null {
    switch (this.sortKey()) {
      case 'name': return this.modelName(model);
      case 'size': return Number.isFinite(model.size) && model.size >= 0 ? model.size : null;
      case 'architecture': return typeof model.metadata?.['general.architecture'] === 'string' ? model.metadata['general.architecture'] as string : null;
      case 'quantization': return this.modelQuantization(model) || null;
      case 'context': return this.modelContextLength(model);
    }
  }

  async refreshAll(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [sources, models, snapshot, installations] = await Promise.all([
        this.library.list(), this.library.models(), this.runtime.snapshot(), this.runtime.installations().catch(() => []),
      ]);
      this.sources.set(sources); this.models.set(models); this.backends.set(snapshot.runtime.backends);
      this.devices.set(snapshot.runtime.devices); this.installations.set(installations);
      void this.loadModelEvidence(models.map(model => model.id));
      this.captureStatus(snapshot.runtime.status);
      this.restoreQuerySelection();
    } catch (error) { this.error.set(message(error)); }
    finally { this.loading.set(false); }
  }

  private async loadModelEvidence(modelIds: string[]): Promise<void> {
    const requestId = ++this.evidenceRequestId;
    try {
      const evidence = await this.capabilityApi.getCatalogEvidence(modelIds);
      if (requestId === this.evidenceRequestId) {
        const merged = { ...evidence };
        for (const modelId of modelIds) {
          if (this.modelEvidence()[modelId]?.detailLoaded) merged[modelId] = this.modelEvidence()[modelId];
        }
        this.modelEvidence.set(merged);
      }
    } catch {
      if (requestId === this.evidenceRequestId) this.modelEvidence.set(Object.fromEntries(
        modelIds.map(id => [id, { manifest: null, routes: [], error: 'Capability and manifest evidence could not be loaded.' }]),
      ));
    }
  }

  async toggleModel(model: ModelRecord): Promise<void> {
    if (this.selectedModelId() === model.id) { this.selectedModelId.set(''); return; }
    this.selectedModelId.set(model.id); this.error.set(''); this.notice.set(''); this.runtimeStatus.set('');
    this.resetConfiguration();
    this.profiles.set([]); this.selectedProfileId.set(''); this.profileName.set(''); this.profileError.set('');
    const requestedModelId = model.id;
    void this.loadSelectedModelEvidence(requestedModelId);
    await this.loadProfiles(requestedModelId);
  }

  private async loadProfiles(requestedModelId: string): Promise<void> {
    try {
      const profiles = await this.profileApi.list(requestedModelId);
      if (this.selectedModelId() === requestedModelId) {
        this.profiles.set(profiles);
        if (this.requestedModelId === requestedModelId && this.requestedProfileId) {
          const profile = profiles.find(item => item.id === this.requestedProfileId && item.model_id === requestedModelId);
          if (profile) afterNextRender(() => {
            if (this.selectedModelId() === requestedModelId) this.applyProfile(profile.id);
          }, { injector: this.injector });
        }
      }
    } catch (error) {
      if (this.selectedModelId() === requestedModelId) this.profileError.set(message(error));
    }
  }

  private restoreQuerySelection(): void {
    if (this.restoredQuerySelection || !this.requestedModelId) return;
    const model = this.models().find(item => item.id === this.requestedModelId);
    if (!model) return;
    this.restoredQuerySelection = true;
    this.selectedModelId.set(model.id);
    this.resetConfiguration();
    this.profiles.set([]); this.profileError.set('');
    void this.loadSelectedModelEvidence(model.id);
    void this.loadProfiles(model.id);
  }

  private async loadSelectedModelEvidence(modelId: string): Promise<void> {
    const requestId = ++this.detailRequestId;
    this.verificationError.set('');
    try {
      const evidence = await this.capabilityApi.getModelEvidence(modelId);
      if (requestId !== this.detailRequestId || this.selectedModelId() !== modelId) return;
      this.modelEvidence.update(current => ({ ...current, [modelId]: evidence }));
    } catch {
      if (requestId !== this.detailRequestId || this.selectedModelId() !== modelId) return;
      this.modelEvidence.update(current => ({ ...current, [modelId]: {
        manifest: null, routes: current[modelId]?.routes ?? [], error: 'Model manifest details could not be loaded.', detailLoaded: true,
      } }));
    }
  }

  openRuntime(model: ModelRecord): void {
    void this.router.navigate(['/runtime'], { queryParams: {
      model_id: model.id,
      profile_id: this.selectedProfileId() || null,
    } });
  }

  useInChat(model: ModelRecord): void {
    if (!this.isLoaded(model)) return;
    void this.router.navigate(['/chat'], { queryParams: {
      model_id: model.id,
      profile_id: this.selectedProfileId() || null,
    } });
  }

  capabilities(): RuntimeCapabilities | null {
    const runtime = this.installations().find(item => item.id === this.runtimeId());
    if (runtime) return runtime.capabilities;
    const backend = this.backends().find(item => item.name === this.backendName());
    if (backend) return backend.capabilities;
    return this.backends().find(item => item.available)?.capabilities ?? null;
  }
  supports(key: string): boolean { return (this.capabilities() as unknown as Record<string, unknown> | null)?.[key] === true; }
  hasPlacementControls(): boolean { return ['gpu_layers','device_selection','tensor_split','split_mode','main_gpu'].some(key => this.supports(key)); }
  matchingInstallations(): RuntimeInstallation[] { return this.installations().filter(item => !this.backendName() || item.backend === this.backendName() || item.kind === this.backendName()); }
  matchingDevices(): RuntimeDevice[] { return this.devices().filter(item => !this.backendName() || item.backend === this.backendName()); }

  changeBackend(name: string): void { this.backendName.set(name); this.runtimeId.set(''); this.placement.set({}); this.loadOptions.set({}); }
  changeRuntime(id: string): void {
    this.runtimeId.set(id);
    const selected = this.installations().find(item => item.id === id);
    if (selected?.backend) this.backendName.set(selected.backend);
    this.placement.set({}); this.loadOptions.set({});
  }

  setPlacementNumber(key: 'gpu_layers' | 'main_gpu', raw: string): void {
    const next = { ...this.placement() };
    if (!raw.trim()) delete next[key]; else next[key] = Number(raw);
    this.placement.set(next);
  }
  setPlacementText(key: 'device' | 'tensor_split' | 'split_mode', raw: string): void {
    const next = { ...this.placement() };
    if (!raw.trim()) delete next[key]; else next[key] = raw.trim();
    this.placement.set(next);
  }
  setLoadNumber(key: NumberLoadKey, raw: string): void {
    const next = { ...this.loadOptions() };
    if (!raw.trim()) delete next[key]; else next[key] = Number(raw);
    this.loadOptions.set(next);
  }
  setLoadText(key: StringLoadKey, raw: string): void {
    const next = { ...this.loadOptions() };
    if (!raw.trim()) delete next[key]; else next[key] = raw.trim();
    this.loadOptions.set(next);
  }
  setLoadBool(key: BoolLoadKey, value: boolean): void { this.loadOptions.set({ ...this.loadOptions(), [key]: value }); }
  fieldHelp(key: string): string {
    const help: Record<string, string> = {
      context_size: 'Maximum context tokens requested for this model; blank uses the runtime default.',
      threads: 'CPU worker threads used for generation; blank uses the runtime default.',
      batch_size: 'Logical token batch size used during prompt processing.',
      physical_batch_size: 'Physical micro-batch size used to process a logical batch.',
      max_concurrent: 'Maximum parallel sequences or requests supported by the runtime.',
      threads_batch: 'CPU threads used for prompt-batch processing.',
      numa: 'NUMA memory-placement policy passed through to the runtime.',
      kv_cache_type_k: 'Data type used for the key portion of the KV cache.',
      kv_cache_type_v: 'Data type used for the value portion of the KV cache.',
      continuous_batching: 'Allow the runtime to combine active requests into batches.',
      flash_attention: 'Enable the runtime’s Flash Attention implementation when supported.',
      unified_kv_cache: 'Use a shared KV cache for concurrent sequences when supported.',
      offload_kv_cache: 'Allow runtime-supported KV cache placement on accelerator devices.',
      mmap: 'Memory-map model weights instead of reading them fully into memory.',
      keep_model_in_memory: 'Keep the model resident in memory after loading.',
      fit: 'Ask the runtime to fit model placement to its available memory information.',
    };
    return help[key] || 'Runtime option exposed by the selected backend; blank or unchecked uses its default.';
  }

  configurationValid(): boolean {
    for (const value of Object.values(this.placement())) if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return false;
    for (const value of Object.values(this.loadOptions())) if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) return false;
    return true;
  }

  resetConfiguration(): void {
    this.selectedProfileId.set(''); this.profileName.set(''); this.profileError.set('');
    this.backendName.set(''); this.runtimeId.set(''); this.placement.set({}); this.loadOptions.set({});
  }

  applyProfile(id: string): void {
    this.selectedProfileId.set(id); this.profileError.set('');
    if (!id) { this.resetConfiguration(); return; }
    const profile = this.profiles().find(item => item.id === id);
    if (!profile) return;
    this.profileName.set(profile.name); this.backendName.set(profile.backend_name || ''); this.runtimeId.set(profile.runtime_id || '');
    this.placement.set(structuredClone(profile.placement || {})); this.loadOptions.set(structuredClone(profile.load || {}));
  }

  async saveProfile(model: ModelRecord): Promise<void> {
    if (!this.profileName().trim()) return;
    this.profileBusy.set(true); this.profileError.set('');
    const payload = {
      model_id: model.id, name: this.profileName().trim(), backend_name: this.backendName() || null,
      runtime_id: this.runtimeId() || null, placement: this.placement(), load: this.loadOptions(), generation: {},
    };
    try {
      let saved: ModelProfile;
      if (this.selectedProfileId()) saved = await this.profileApi.update(this.selectedProfileId(), payload);
      else saved = await this.profileApi.create(payload);
      this.profiles.set(await this.profileApi.list(model.id)); this.selectedProfileId.set(saved.id); this.notice.set('Configuration preset saved.');
    } catch (error) { this.profileError.set(message(error)); }
    finally { this.profileBusy.set(false); }
  }

  async deleteProfile(): Promise<void> {
    const id = this.selectedProfileId(); if (!id) return;
    this.profileBusy.set(true); this.profileError.set('');
    try { await this.profileApi.remove(id); this.profiles.set(this.profiles().filter(item => item.id !== id)); this.resetConfiguration(); this.notice.set('Configuration preset deleted.'); }
    catch (error) { this.profileError.set(message(error)); }
    finally { this.profileBusy.set(false); }
  }

  async loadModel(model: ModelRecord): Promise<void> {
    this.runtimeBusy.set(true); this.loadErrorModelId.set(''); this.error.set(''); this.notice.set(`Loading ${this.modelName(model)}…`);
    try {
      const result = await this.runtime.load({
        model_id: model.id,
        backend: this.backendName() || undefined,
        runtime_id: this.runtimeId() || undefined,
        placement: this.placement(),
        load: this.loadOptions(),
      });
      this.captureStatus(result); this.runtimeStatus.set(JSON.stringify(result, null, 2)); this.notice.set(`${this.modelName(model)} loaded in memory.`);
    } catch (error) { this.notice.set(''); this.loadErrorModelId.set(model.id); this.error.set(message(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  async unloadModel(): Promise<void> {
    this.runtimeBusy.set(true); this.error.set('');
    try { const result = await this.runtime.unload(); this.captureStatus(result); this.runtimeStatus.set(JSON.stringify(result, null, 2)); this.notice.set('Model unloaded from memory.'); }
    catch (error) { this.error.set(message(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  async refreshRuntimeStatus(): Promise<void> {
    this.runtimeBusy.set(true); this.error.set('');
    try { const result = await this.runtime.status(); this.captureStatus(result); this.runtimeStatus.set(JSON.stringify(result, null, 2)); }
    catch (error) { this.error.set(message(error)); }
    finally { this.runtimeBusy.set(false); }
  }

  private captureStatus(value: unknown): void {
    const root = value && typeof value === 'object' ? value as Record<string, any> : {};
    const data = root['data'] && typeof root['data'] === 'object' ? root['data'] : root;
    const status = data['status'] && typeof data['status'] === 'object' ? data['status'] : data;
    const modelPath = typeof status?.model_path === 'string' ? status.model_path : status?.model;
    this.loadedModelPath.set(typeof modelPath === 'string' && status.loaded !== false ? modelPath : '');
  }
  isLoaded(model: ModelRecord): boolean { return !!this.loadedModelPath() && normalize(model.path) === normalize(this.loadedModelPath()); }

  async rescan(): Promise<void> {
    this.rescanning.set(true); this.busy.set(true); this.error.set('');
    try { this.models.set(await this.library.rescan()); this.sources.set(await this.library.list()); this.notice.set(`Scan complete. ${this.models().length} models found.`); }
    catch (error) { this.error.set(message(error)); }
    finally { this.rescanning.set(false); this.busy.set(false); }
  }

  async addSource(event: Event): Promise<void> {
    event.preventDefault(); const path = this.pathInput().trim(); if (!path) return;
    this.busy.set(true); this.error.set('');
    try { await this.library.add(path); this.pathInput.set(''); await this.rescan(); this.notice.set('Model folder added and scanned.'); }
    catch (error) { this.error.set(message(error)); }
    finally { this.busy.set(false); }
  }

  modelName(model: ModelRecord): string { return String(model.metadata?.['general.name'] || model.path.split(/[\\/]/).pop() || model.id); }
  modelCapabilities(model: ModelRecord): ModelCapabilitySummary { return describeModelCapabilities(model); }
  manifestKinds(items?: { kind: string }[]): string { return items?.map(item => item.kind).join(', ') || 'Not reported'; }
  isRunnable(model: ModelRecord): boolean {
    return (this.modelEvidence()[model.id]?.routes || []).some(item =>
      (item.status === 'supported' || item.status === 'ready')
      && item.routes?.some(route => route.model_id === model.id));
  }
  isVerified(model: ModelRecord): boolean {
    const evidence = this.modelEvidence()[model.id]?.manifest?.provenance;
    return evidence?.source === 'verified_run' && evidence.status === 'verified' && !!evidence.verified_at;
  }
  runnableEvidenceTitle(model: ModelRecord): string {
    const capabilities = (this.modelEvidence()[model.id]?.routes || [])
      .filter(item => (item.status === 'supported' || item.status === 'ready')
        && item.routes?.some(route => route.model_id === model.id))
      .map(item => item.id);
    return `Runnable: local runtime compatibility is reported for ${capabilities.join(', ')}. Inference is not verified by this badge.`;
  }
  verifiedEvidenceTitle(model: ModelRecord): string {
    const manifest = this.modelEvidence()[model.id]?.manifest;
    return `Verified: typed local runtime verification recorded${manifest?.provenance?.verified_at ? ` at ${manifest.provenance.verified_at}` : ''}.`;
  }
  async verifyModel(model: ModelRecord): Promise<void> {
    const evidence = this.modelEvidence()[model.id];
    const manifestId = evidence?.manifest?.id;
    if (!manifestId || !evidence.verificationAvailable || this.verificationBusy()) return;
    this.verificationBusy.set(true);
    this.verificationError.set('');
    try {
      const result = await this.capabilityApi.verifyModelManifest(manifestId);
      if (result?.verification?.success !== true) throw new Error('The local runtime verification did not succeed.');
      this.notice.set('Model capability verification completed on the configured local runtime.');
      this.modelEvidence.update(current => ({
        ...current,
        [model.id]: { ...(current[model.id] || evidence), detailLoaded: false },
      }));
      await this.loadSelectedModelEvidence(model.id);
      this.profiles.set(await this.profileApi.list(model.id));
    } catch (error) {
      this.verificationError.set(message(error));
    } finally {
      this.verificationBusy.set(false);
    }
  }
  modelContextLength(model: ModelRecord): number | null {
    const architecture = model.metadata?.['general.architecture'];
    const value = (typeof architecture === 'string' ? model.metadata?.[`${architecture}.context_length`] : null) ?? model.metadata?.['llama.context_length'];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }
  modelBlockCount(model: ModelRecord): number | null {
    const architecture = model.metadata?.['general.architecture'];
    const value = typeof architecture === 'string' ? model.metadata?.[`${architecture}.block_count`] : null;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }
  useModelLayerCount(model: ModelRecord): void {
    const count = this.modelBlockCount(model);
    if (count != null) this.setPlacementNumber('gpu_layers', String(count));
  }
  modelQuantization(model: ModelRecord): string {
    const fileType = model.metadata?.['general.file_type'];
    if (typeof fileType === 'number' && Number.isInteger(fileType)) return modelFileTypes[fileType] || `Type ${fileType}`;
    const filename = model.path.split(/[\\/]/).pop() || '';
    const hint = filename.match(/(?:^|[-_.])(IQ\d_[A-Z0-9_]+|Q\d(?:_K(?:_[SML])?|_[01])|F16|F32|BF16)(?=$|[-_.])/i)?.[1];
    return hint ? `${hint.toUpperCase()} (filename)` : '';
  }
  metadataEntries(model: ModelRecord): [string, unknown][] { return Object.entries(model.metadata || {}).sort(([a],[b]) => a.localeCompare(b)); }
  display(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }
  size(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
    if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
    if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }
}

function describeModelCapabilities(model: ModelRecord): ModelCapabilitySummary {
  const metadata = model.metadata || {};
  const inputs = modalityList(metadata['ai_dream.input_modalities'] ?? metadata['input_modalities'] ?? metadata['general.input_modalities']);
  const outputs = modalityList(metadata['ai_dream.output_modalities'] ?? metadata['output_modalities'] ?? metadata['general.output_modalities']);
  const role = textValue(metadata['ai_dream.model_type'] ?? metadata['model_type']);
  if (!inputs.length && !outputs.length && !role) {
    return { role: 'Unknown', inputs: [], outputs: [], source: 'capabilities are not declared or verified for this model' };
  }
  return {
    role: role || 'Unknown',
    inputs,
    outputs,
    source: inputs.length && outputs.length && role
      ? 'declared model metadata'
      : 'partial declared model metadata; unspecified fields remain unknown',
  };
}
function modalityList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;+]/) : [];
  return [...new Set(values.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).map(item => item[0].toUpperCase() + item.slice(1).toLowerCase()))];
}
function textValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function normalize(path: string): string { return path.replace(/\\/g, '/').replace(/\/$/, ''); }
function message(error: unknown): string { return error instanceof Error ? error.message : 'The local model request failed.'; }

const modelFileTypes: Record<number, string> = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1',
  10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M',
  16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS', 21: 'IQ3_XXS',
  22: 'IQ1_S', 23: 'IQ4_NL', 24: 'IQ3_S', 25: 'IQ2_S', 26: 'IQ4_XS', 27: 'I8',
  28: 'I16', 29: 'I32', 30: 'I64', 31: 'F64', 32: 'IQ1_M', 33: 'BF16',
  34: 'Q4_0_4_4', 35: 'Q4_0_4_8', 36: 'Q4_0_8_8',
};
