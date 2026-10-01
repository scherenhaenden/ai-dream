import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ArtifactService, MAX_ARTIFACT_UPLOAD_BYTES } from '../core/artifact.service';
import type { ArtifactEnvelope, UploadArtifactKind } from '../core/artifact.types';
import { SkillService } from '../core/skill.service';
import type { ImageCapabilityId, ImageRouteChoice } from '../core/skill.service';
import type { SkillCatalogItem, SkillReadiness, SkillPort, SkillPermissionKey, SkillPermissionRow } from '../core/skill.types';

@Component({
  selector: 'ai-skills-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="skills-page">
      <header class="page-head">
        <div><div class="eyebrow">TASK CATALOG</div><h1>Skills</h1>
          <p>Choose a workflow by goal. Readiness and preferred routes come from the local API.</p></div>
        <button type="button" class="refresh" (click)="refreshAll()" [disabled]="loading() || plannerSettingsLoading()">{{ loading() || plannerSettingsLoading() ? 'Loading…' : '↻ Refresh' }}</button>
      </header>
      <section class="planner-toggle" aria-label="Assisted planner settings">
        <label><input type="checkbox" aria-label="Enable assisted planner globally" [checked]="plannerEnabled()" [disabled]="plannerSettingsLoading() || plannerSaving()" (change)="setPlannerEnabled($any($event.target).checked)"><b>Assisted plan drafts</b></label>
        <p>Off by default. When enabled, a draft is generated only after you request it and uses the model already loaded in Chat or Runtime. It never loads a model.</p>
        @if (plannerSettingsLoading()) { <span role="status">Checking opt-in and loaded model…</span> }
        @else if (plannerEnabled() && runtimeStatusKnown()) { <span [class.blocked]="!runtimeLoaded()">{{ runtimeLoaded() ? 'Loaded model: ' + (runtimeModel() || 'reported') : 'Blocked: no model is loaded' }}</span> }
        @else if (plannerEnabled()) { <span class="blocked" role="status">Blocked: loaded-model status is unknown; refresh the local API status.</span> }
        @if (plannerSettingsError()) { <span class="planner-error" role="alert">{{ plannerSettingsError() }}</span> }
      </section>
      @if (error()) {
        <section class="state error" role="alert"><div><b>Skills could not be loaded</b><p>{{ error() }}</p></div><button type="button" (click)="load()" [disabled]="loading()">Retry</button></section>
      }
      @if (attachmentHandoffNotice()) { <p class="state-message" role="status">{{ attachmentHandoffNotice() }}</p> }
      @if (loading() && !skills().length) { <p class="state-message" role="status">Loading skills from the local API…</p> }
      @if (!loading() && !error() && !skills().length) {
        <section class="state empty"><b>No skills reported</b><p>The API returned an empty skill catalog. This page does not supply sample skills.</p></section>
      }
      @if (skills().length) {
        <section aria-label="Skill catalog" class="catalog">
          <div class="toolbar">
            <label class="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Find a skill by goal or name" placeholder="e.g. create a PDF report" [value]="query()" (input)="query.set($any($event.target).value)"></label>
            <label class="filter-label">Readiness
              <select aria-label="Filter skills by readiness" [value]="readinessFilter()" (change)="readinessFilter.set($any($event.target).value)">
                <option value="all">All</option><option value="ready">Ready</option><option value="not_ready">Not ready</option><option value="unknown">Unknown</option>
              </select>
            </label>
            <span class="result-count" aria-live="polite" aria-atomic="true">{{ visibleSkills().length }} of {{ skills().length }} shown</span>
          </div>
          <p class="discovery-note">Goal matches use only skill names and API-reported descriptions, categories, inputs and outputs. They do not infer capabilities.</p>
          @if (!visibleSkills().length) {
            <section class="state empty"><b>No matching skills</b><p>Try another search or readiness filter.</p><button type="button" (click)="clearFilters()">Clear filters</button></section>
          }
          @for (group of skillGroups(); track group.goal) {
          <section class="skill-group" [attr.aria-label]="group.goal + ' skills'"><h2 class="group-heading">{{ group.goal }}<span>{{ group.skills.length }}</span></h2>
          <div class="skill-grid">
            @for (skill of group.skills; track skill.id) {
              <article class="skill-card">
                <header class="card-head"><div><h2>{{ skill.name }}</h2><code>{{ skill.id }}@if (skill.version) { · {{ skill.version }} }</code></div>
                  <span class="readiness" [class]="'readiness ' + skill.status">{{ readinessLabel(skill.status) }}</span></header>
                <p class="category-label">Category · {{ originalCategory(skill) }}</p>
                <p class="description">{{ skill.description }}</p>
                <div class="io">
                  <section aria-label="Accepted inputs"><h3>Inputs</h3><div class="chips">@for (input of skill.inputs; track input.name) { <span class="chip" [title]="portTitle(input, 'input')">{{ input.name }} · {{ input.artifact }}@if (input.required === false) { <small>optional</small> }</span> } @empty { <span class="missing">Not reported</span> }</div></section>
                  <section aria-label="Outputs"><h3>Outputs</h3><div class="chips">@for (output of skill.outputs; track output.name) { <span class="chip" [title]="portTitle(output, 'output')">{{ output.name }} · {{ output.artifact }}</span> } @empty { <span class="missing">Not reported</span> }</div></section>
                </div>
                @if (skill.status === 'not_ready') {
                  <section class="reason" aria-label="Why this skill is not ready"><b>Why it is not ready</b>
                    @if (notReadyReasons(skill).length) { <ul>@for (reason of notReadyReasons(skill); track $index) { <li>{{ reason }}</li> }</ul> }
                    @else { <p>The API marks this skill as not ready but did not provide a reason.</p> }
                  </section>
                }
                @if (skill.status === 'unknown') {
                  <section class="reason unknown-reason"><b>Readiness is unknown</b><p>The local API has not confirmed a usable route for this skill. Planning may explain the missing capability; no model is inferred by this page.</p></section>
                }
                @if (skill.alternatives?.length) {
                  <section class="reason alternatives" aria-label="Available alternatives"><b>Available alternatives</b>
                    <ul>@for (alternative of skill.alternatives; track $index) { <li>{{ alternative }}</li> }</ul>
                    <button type="button" (click)="openAlternative(skill)">{{ alternativeActionLabel(skill) }}</button>
                  </section>
                }
                <section class="skill-actions" aria-label="Run skill">
                  <button type="button" class="prepare" (click)="toggleComposer(skill.id)" [attr.aria-expanded]="activeSkillId() === skill.id">{{ activeSkillId() === skill.id ? 'Close run setup' : 'Plan or run' }}</button>
                  @if (activeSkillId() === skill.id) {
                    <div class="composer">
                      <p class="composer-intro">Enter the inputs below. Plan preview checks the current local route; it does not load a model or start inference.</p>
                      <section class="permission-preview" aria-label="Permissions used by this skill before running"><header><b>Permissions for this run</b><span>Declared by this skill · review before running</span></header>
                        @if (permissionLoading()[skill.id]) { <p role="status">Loading the skill's permission declaration…</p> }
                        @if (permissionErrors()[skill.id]) { <p class="permission-error" role="alert">{{ permissionErrors()[skill.id] }}</p><button type="button" class="prepare" (click)="loadSkillPermissions(skill.id)" [disabled]="permissionLoading()[skill.id]">Retry permission check</button> }
                        @if (permissionsFor(skill.id).length) { <ul>@for (permission of permissionsFor(skill.id); track permission.key) { <li><span>{{ permissionLabel(permission.key) }}</span><code>{{ permission.value }}</code></li> }</ul> }
                        @if (!permissionLoading()[skill.id] && !permissionErrors()[skill.id] && !permissionsFor(skill.id).length) { <p role="status">Run actions unlock after the local API confirms this skill’s permission declaration.</p> }
                      </section>
                      @if (imageCapabilityForSkill(skill); as capability) {
                        <section class="image-route-choice" aria-label="Image model selection">
                          <label [for]="'image-model-' + skill.id">{{ capability === 'image.generate' ? 'Image generator' : 'Image editor' }} for this plan
                            <select [id]="'image-model-' + skill.id" [disabled]="imageRoutesLoading() || imagePinSaving() || (!imageRoutes()[capability].length && !unavailableImagePins()[capability])" (change)="changeImagePin(capability, $any($event.target).value)">
                              <option value="" [selected]="!imagePins()[capability] && !unavailableImagePins()[capability]">Automatic compatible route</option>
                              @if (unavailableImagePins()[capability]) { <option [value]="staleImagePinValue" [selected]="!imagePins()[capability] && !!unavailableImagePins()[capability]">Saved pin unavailable: {{ unavailableImagePins()[capability] }}</option> }
                              @for (route of imageRoutes()[capability]; track route.id) { <option [value]="route.model_id">{{ route.model_id }} · {{ route.runtime_id || 'runtime unknown' }}@if (route.estimated_vram_bytes) { · ~{{ formatSize(route.estimated_vram_bytes) }} VRAM } @else { · VRAM estimate unknown }</option> }
                            </select>
                          </label>
                          <p>This saved pin is separate for {{ capability }} and is applied as a hard constraint to this skill's plan and run. Choose automatic to clear it.</p>
                          @if (imagePinSaving()) { <small role="status">Saving image model pin…</small> }
                          @if (imageRoutesLoading()) { <small role="status">Checking local image routes…</small> }
                          @else if (imageRouteError()) { <small role="alert">{{ imageRouteError() }}</small> }
                          @else if (!imageRoutes()[capability].length && unavailableImagePins()[capability]) { <small role="alert">The saved pin is stale. Choose Automatic compatible route to clear it; no compatible local image route is currently reported.</small> }
                          @else if (!imageRoutes()[capability].length) { <small>No compatible local image route is reported; no models are inferred.</small> }
                        </section>
                      }
                      <section class="assisted-draft" aria-label="Generate an assisted plan draft" [hidden]="!plannerEnabled()">
                          <label>Goal for the already-loaded model<textarea rows="2" [attr.aria-label]="'Goal for ' + skill.name + ' assisted draft'" [value]="plannerGoal(skill.id)" (input)="setPlannerGoal(skill.id, $any($event.target).value)" placeholder="Describe what you want this workflow to accomplish"></textarea></label>
                          @if (runtimeStatusKnown() && !runtimeLoaded()) { <p class="planner-blocked" role="status">Blocked: load a local model in Chat or Runtime before requesting a draft.</p> }
                          <p>This action sends the goal and installed skill contract to the currently loaded local model. Its strict JSON draft is validated against the installed workflow; review both draft and resolved plan before running.</p>
                          <button type="button" class="prepare" (click)="generateAssistedDraft(skill)" [disabled]="planning() || running() || uploadInProgress() || !runtimeLoaded()">{{ planning() ? 'Generating and validating…' : 'Generate assisted draft' }}</button>
                      </section>
                      <aside class="planner-status" aria-label="Assisted planner disabled" [hidden]="plannerEnabled()"><b>Assisted draft is off</b><p>Enable the global opt-in above to request a draft. Deterministic route preview remains available without model inference.</p></aside>
                      @for (input of skill.inputs; track input.name) {
                        @if (input.name === 'voice' && (skill.id === 'voice.respond' || skill.id === 'voice.conversation')) {
                          <label class="input-field">Flite voice
                            <select aria-label="Flite voice" [value]="draft(skill.id, input.name) || 'auto'" [disabled]="fliteVoicesLoading()" (change)="setDraft(skill.id, input.name, $any($event.target).value)">
                              <option value="auto">Automatic default</option>
                              @for (voice of fliteVoices(); track voice) { <option [value]="voice">{{ voice }}</option> }
                            </select>
                          </label>
                          @if (fliteVoicesLoading()) { <small role="status">Checking API-reported local Flite voices…</small> }
                          @else if (fliteVoicesError()) { <small role="alert">{{ fliteVoicesError() }} Selection remains optional; the provider default may be used.</small> }
                          @else if (!fliteVoices().length) { <small>No selectable Flite voices were reported. The local TTS provider default will be used when available.</small> }
                          @else { <small>Choose an installed local Flite voice for this run. No speech is synthesized until you run the reviewed plan.</small> }
                        } @else if (input.artifact === 'text' || input.artifact === 'json') {
                          <label class="input-field"><span>{{ input.name }} · {{ input.artifact }}{{ input.required === true ? ' · required' : ' · optional' }}</span>
                            <textarea [rows]="skill.id === 'voice.respond' && input.name === 'transcript' ? 8 : 3" [attr.aria-label]="input.name + ' input'" [placeholder]="input.artifact === 'json' ? 'Enter a JSON value' : 'Enter text'" [value]="draft(skill.id, input.name)" (input)="setDraft(skill.id, input.name, $any($event.target).value)"></textarea>
                          </label>
                        } @else if (supportsUpload(input.artifact)) {
                          <div class="upload-field"><label class="upload-label"><span>{{ input.name }} · {{ input.artifact }}{{ input.required === true ? ' · required' : ' · optional' }}</span>
                            <input type="file" [attr.aria-label]="'Upload ' + input.artifact + ' for ' + input.name" [accept]="acceptFor(input.artifact)" [disabled]="uploading(skill.id, input.name)" (change)="uploadInput(skill, input, $event)">
                          </label>
                            @if (uploadedArtifact(skill.id, input.name); as artifact) { <div class="upload-success" role="status"><span>{{ artifact.name }} · {{ formatSize(artifact.size_bytes) }} · {{ artifact.media_type }}</span><button type="button" (click)="removeUpload(skill.id, input.name)" [disabled]="uploading(skill.id, input.name)">Delete upload</button></div> }
                            @if (availableSessionArtifacts(input.artifact, skill.id, input.name).length) { <label class="upload-label">Use a previous session upload
                              <select [value]="uploadedArtifact(skill.id, input.name)?.id ?? ''" (change)="attachSessionArtifact(skill.id, input.name, $event)">
                                <option value="">No previous upload selected</option>
                                @for (artifact of availableSessionArtifacts(input.artifact, skill.id, input.name); track artifact.id) { <option [value]="artifact.id">{{ artifact.name }} · {{ formatSize(artifact.size_bytes) }}</option> }
                              </select>
                            </label> }
                            @if (sessionArtifactError()) { <small class="upload-error" role="alert">{{ sessionArtifactError() }}</small> }
                            <small class="upload-help">Allowed: {{ acceptedFormats(input.artifact) }} · Max {{ formatSize(maxUploadBytes) }}.</small>
                            @if (uploading(skill.id, input.name)) { <small class="upload-progress" role="status">Uploading artifact…</small> }
                            @if (uploadError(skill.id, input.name)) { <small class="upload-error" role="alert">{{ uploadError(skill.id, input.name) }}</small> }
                          </div>
                        } @else {
                          <div class="unsupported-input"><b>{{ input.name }} · {{ input.artifact }}</b><span>{{ input.required === true ? 'Required input' : 'Optional input' }}. No supported upload format is configured for this artifact kind.</span></div>
                        }
                      }
                      @if (!skill.inputs.length) { <p class="unsupported-input">This skill declares no inputs. Planning will use its declared workflow only.</p> }
                      @if (composerError()) { <p class="composer-error" role="alert">{{ composerError() }}</p> }
                      <div class="composer-actions"><button type="button" class="prepare" (click)="preview(skill)" [disabled]="planning() || running() || uploadInProgress() || !permissionsReady(skill.id)">{{ planning() ? 'Planning…' : 'Preview plan' }}</button>
                        <button type="button" class="execute" (click)="execute(skill)" [disabled]="!canRun() || skill.status !== 'ready' || running() || !permissionsReady(skill.id)">{{ running() ? 'Starting…' : 'Run skill' }}</button></div>
                      @if (plan(); as preview) {
                        <section class="plan-preview" aria-label="Plan preview"><header><b>Plan preview</b><span>{{ planReady() ? 'Route available' : 'Needs attention' }}</span></header>
                          <p>Review the selected route before starting. The plan is based on current local capability evidence.</p>
                          @if (selectedImageResources(); as resources) { <p class="image-resource-note">Image model estimate: {{ formatSize(resources.estimated) }} VRAM@if (resources.available !== null) { · {{ formatSize(resources.available) }} observed free at planning time } @else { · available VRAM not reported }. Scheduler headroom still applies when the run starts.</p> }
                          @if (assistedDraftDetails(); as assisted) {
                            <div class="assisted-plan-review">
                              <section class="draft-review" aria-label="Generated assisted draft"><b>Validated assisted draft</b><span>Generated with {{ assisted.model.id }}@if (assisted.model.runtime_id) { · {{ assisted.model.runtime_id }} }</span><pre>{{ prettyPlan(assisted.draft) }}</pre><label><input type="checkbox" [checked]="draftReviewed()" (change)="draftReviewed.set($any($event.target).checked)"> I reviewed the validated draft and resolved plan</label></section>
                              <section class="resolved-review" aria-label="Deterministically resolved plan"><h3>Deterministically resolved plan</h3><p>Routes and requirements were checked against the current local evidence.</p><pre>{{ prettyPlan(preview) }}</pre></section>
                            </div>
                          } @else { <pre>{{ prettyPlan(preview) }}</pre> }
                          @if (!planReady()) { <p class="plan-limit">This plan reports unresolved routes or requirements. Resolve them before running.</p> }
                        </section>
                      }
                    </div>
                  }
                </section>
                <footer class="card-foot"><span>Preferred route</span><code>{{ preferredRouteLabel(skill) }}</code></footer>
              </article>
            }
          </div>
          </section>
          }
        </section>
      }
    </main>
  `,
  styles: [`
    .permission-preview{padding:8px 9px;border:1px solid #3b4555;border-radius:4px;background:#171f2b}.permission-preview>header{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}.permission-preview>header b{color:#cbd8ec;font:9px ui-monospace,monospace}.permission-preview>header span,.permission-preview>p{color:#9aa9be;font-size:8px}.permission-preview ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px 10px;list-style:none;padding:0;margin:7px 0 0}.permission-preview li{display:flex;justify-content:space-between;gap:8px;padding:4px 6px;border-radius:3px;background:#101721}.permission-preview li span{color:#b4bfd0;font-size:8px}.permission-preview li code{color:#d3dfef;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.permission-preview .permission-error{color:#ffb4ab}.image-route-choice{display:grid;gap:5px;padding:8px 9px;border:1px solid #3a4555;border-radius:4px;background:#171f2b}.image-route-choice label{display:grid;gap:5px;color:#d0d9e8;font-size:9px}.image-route-choice select{width:100%;padding:7px;border:1px solid #374252;border-radius:4px;background:#0e131b;color:#dce4ef;font-size:9px}.image-route-choice p,.image-route-choice small,.image-resource-note{margin:0;color:#aab6c8;font-size:8px;line-height:1.5}.image-route-choice small[role=alert]{color:#ffb4ab}
    .planner-status{padding:8px 9px;border:1px solid #3e4552;border-radius:4px;background:#1b2029}.planner-status>b{color:#e2c58f;font:9px ui-monospace,monospace}.planner-status>p{margin:4px 0 0;color:#aeb7c6;font-size:9px;line-height:1.45}.planner-toggle,.assisted-draft,.draft-review{display:grid;gap:7px;padding:10px 11px;border:1px solid #334155;border-radius:5px;background:#161e2a}.planner-toggle{grid-template-columns:1fr auto;align-items:center}.planner-toggle label,.assisted-draft label,.draft-review label{display:grid;gap:6px;color:#d3deee;font-size:10px}.planner-toggle label{display:flex;align-items:center;gap:8px}.planner-toggle p,.assisted-draft p,.draft-review span{margin:0;color:#9eabc0;font-size:9px;line-height:1.45}.planner-toggle>span{color:#92d8ad;font:9px ui-monospace,monospace}.planner-toggle>span.blocked,.planner-blocked,.planner-error{color:#ffb4ab!important}.planner-error{grid-column:1/-1;font-size:9px}.assisted-draft textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #344052;border-radius:4px;background:#101721;color:#e2e8f2;font:10px/1.45 inherit;resize:vertical}.draft-review{margin:8px 0;border-color:#556682}.draft-review>b{font:9px ui-monospace,monospace;color:#dce6f5}.draft-review pre{max-height:180px;overflow:auto;margin:0;padding:8px;background:#101721;color:#cbd5e8;font:9px/1.45 ui-monospace,monospace}.draft-review label{display:flex;align-items:center}.planner-toggle input,.draft-review input{accent-color:#a9c7ff}
    :host{display:block;color:var(--text,#e4e9f2)}.skills-page{max-width:1240px;margin:auto;padding:20px;display:grid;gap:14px}.page-head{display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:1px solid #2b3240;padding-bottom:12px}.eyebrow{font:9px ui-monospace,monospace;letter-spacing:1px;color:#8793a8}h1{margin:4px 0;font-size:24px;font-weight:550}.page-head p{margin:5px 0 0;color:#929aaa;font-size:11px;line-height:1.5}.refresh,.state button,.empty button,.prepare,.execute,.upload-success button{border:1px solid #343d4b;border-radius:4px;background:#171c26;color:#c6cede;padding:7px 10px;font:10px ui-monospace,monospace;cursor:pointer}.refresh:disabled,.state button:disabled,.prepare:disabled,.execute:disabled,.upload-success button:disabled{opacity:.55;cursor:wait}.state{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px;border:1px solid #303744;border-radius:5px;background:#171c26}.state b{font-size:12px}.state p{margin:5px 0 0;color:#9ca6b6;font-size:10px;line-height:1.5}.error{border-color:#53323a;background:#2b2025;color:#ffb4ab}.error p{color:#d9b5bb}.empty{display:block}.empty button{margin-top:9px}.state-message{color:#a5b1c3;font-size:11px}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.search{display:flex;align-items:center;gap:7px;flex:1 1 280px;min-width:0;min-height:34px;padding:0 9px;border:1px solid #303744;border-radius:4px;background:#111721;color:#9aa5b7}.search:focus-within{border-color:#819ac2}.search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:11px}.filter-label{display:flex;align-items:center;gap:7px;color:#aab4c4;font-size:10px}.filter-label select{height:34px;padding:5px 8px;border:1px solid #303744;border-radius:4px;background:#111721;color:#dce3ef;font:10px ui-monospace,monospace}.result-count{color:#8994a7;font:9px ui-monospace,monospace}.skill-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,370px),1fr));gap:10px}.skill-card{min-width:0;padding:13px;border:1px solid #2c3441;border-radius:5px;background:#171c26}.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:9px;padding-bottom:9px;border-bottom:1px solid #2a303b}.card-head h2{margin:5px 0;font-size:14px;font-weight:550}.card-head code,.card-foot code{color:#aebbd0;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.readiness{flex:none;padding:4px 6px;border-radius:3px;background:#252a34;color:#c0c7d3;font:8px ui-monospace,monospace;text-transform:uppercase}.readiness.ready{background:#1c302d;color:#82dbac}.readiness.not_ready{background:#342326;color:#ffb4ab}.readiness.unknown{background:#282d37;color:#bac4d3}.description{min-height:2.8em;margin:10px 0;color:#c4ccda;font-size:10px;line-height:1.45;overflow-wrap:anywhere}.io{display:grid;grid-template-columns:1fr 1fr;gap:10px}.io section{min-width:0}.io h3{margin:0 0 5px;color:#8793a8;font:8px ui-monospace,monospace;text-transform:uppercase}.chips{display:flex;align-items:flex-start;flex-wrap:wrap;gap:4px}.chip{max-width:100%;padding:4px 5px;border:1px solid #303b4e;border-radius:3px;background:#141923;color:#c1d0e8;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.chip small{display:block;margin-top:2px;color:#939fb2}.missing{color:#8994a7;font-size:9px}.reason{margin-top:10px;padding:8px 9px;border-left:2px solid #d39b62;background:#211f1b}.reason b{color:#e4c699;font-size:9px}.reason p,.reason li{color:#c4b9a8;font-size:9px;line-height:1.45}.reason p{margin:5px 0 0}.reason ul{margin:5px 0 0;padding-left:17px}.unknown-reason{border-color:#6c819e;background:#1c232d}.unknown-reason b{color:#b7c9e4}.unknown-reason p{color:#a9b5c6}.card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid #2a303b}.card-foot span{color:#8793a8;font:8px ui-monospace,monospace;text-transform:uppercase}.card-foot code{overflow-wrap:anywhere;text-align:right}.skill-actions{margin-top:11px}.composer{display:grid;gap:8px;margin-top:9px;padding:10px;border:1px solid #313c4d;border-radius:4px;background:#121821}.composer-intro,.plan-preview>p{margin:0;color:#aeb9ca;font-size:9px;line-height:1.5}.input-field{display:grid;gap:4px;color:#bbc7d9;font-size:9px}.input-field textarea{box-sizing:border-box;width:100%;min-height:62px;padding:7px;border:1px solid #374252;border-radius:4px;background:#0e131b;color:#e1e8f1;font:10px/1.45 ui-monospace,monospace;resize:vertical}.upload-field{display:grid;gap:5px;padding:8px;border:1px solid #303947;border-radius:4px;background:#10151e}.upload-label{display:grid;gap:5px;color:#c3cede;font-size:9px}.upload-label input,.upload-label select{max-width:100%;padding:6px;border:1px solid #374252;border-radius:4px;background:#0e131b;color:#cdd7e6;font-size:9px}.upload-help,.upload-progress{color:#8f9bac;font-size:8px;line-height:1.4}.upload-progress{color:#d6bf7d}.upload-error{color:#ffb4ab;font-size:9px;line-height:1.4;overflow-wrap:anywhere}.upload-success{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#91d6a9;font-size:9px;overflow-wrap:anywhere}.upload-success button{flex:none;padding:4px 6px}.unsupported-input{display:grid;gap:3px;padding:7px;border-left:2px solid #a67c4b;background:#211f1b;color:#dfc18e;font-size:9px}.unsupported-input span{color:#bcb3a5;line-height:1.45}.composer-actions{display:flex;gap:7px;flex-wrap:wrap}.execute{border-color:#3d684f;background:#203229;color:#9de2b9}.composer-error{margin:0;color:#ffb4ab;font-size:9px}.plan-preview{display:grid;gap:6px;padding:8px;border:1px solid #344154;border-radius:4px;background:#0f151f}.plan-preview>header{display:flex;justify-content:space-between;gap:8px;color:#cfdaea;font-size:9px}.plan-preview>header span{color:#85d4a7;font:8px ui-monospace,monospace}.plan-preview pre{max-height:240px;overflow:auto;margin:0;padding:8px;border-radius:3px;background:#090d13;color:#c2d0e4;font:9px/1.45 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.plan-preview .plan-limit{color:#e4c699}.skills-page button:focus-visible,.skills-page input:focus-visible,.skills-page textarea:focus-visible,.skills-page select:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}@media(max-width:560px){.skills-page{padding:14px 11px}.page-head{align-items:flex-start}.toolbar{align-items:stretch;flex-direction:column}.filter-label{justify-content:space-between}.filter-label select{flex:1}.skill-grid{grid-template-columns:1fr}.io{grid-template-columns:1fr}}
    .search input{font:inherit;font-size:11px}.skill-group{display:grid;gap:8px;margin-top:14px}.group-heading{display:flex;justify-content:space-between;align-items:center;margin:0;padding:4px 1px;color:#cbd4e3;font-size:12px;font-weight:550}.group-heading span{color:#8994a7;font:9px ui-monospace,monospace}.category-label{margin:7px 0 0;color:#8793a8;font:8px ui-monospace,monospace}.alternatives{margin-top:8px;padding-top:7px;border-top:1px solid #45382d}.alternatives button{margin-top:6px;border:1px solid #574a3e;border-radius:4px;background:#2b241f;color:#ead6bd;padding:6px 8px;font-size:9px;cursor:pointer}
    .discovery-note{margin:-4px 0 0;color:#8998ad;font-size:9px;line-height:1.45}.assisted-plan-review{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.assisted-plan-review>section{min-width:0}.draft-review,.resolved-review{margin:0}.resolved-review{display:grid;align-content:start;gap:7px;padding:10px;border:1px solid #385445;border-radius:4px;background:#14201b}.resolved-review h3{margin:0;color:#a9dfbb;font-size:10px}.resolved-review p{margin:0;color:#a8b9ad;font-size:9px;line-height:1.45}.resolved-review pre{max-height:240px;overflow:auto;margin:0;padding:8px;border-radius:3px;background:#0c1511;color:#d0e3d5;font:9px/1.45 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.draft-review label{align-items:flex-start}.draft-review input{flex:none;margin-top:1px}.draft-review:focus-within,.resolved-review:focus-within{border-color:#adc6ff}@media(max-width:700px){.assisted-plan-review{grid-template-columns:1fr}}
  `],
})
export class SkillsPage implements OnInit {
  readonly staleImagePinValue = '__saved_image_pin_unavailable__';
  private readonly service = inject(SkillService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly artifactService = inject(ArtifactService);
  readonly skills = signal<SkillCatalogItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly query = signal('');
  readonly readinessFilter = signal<SkillReadiness | 'all'>('all');
  readonly activeSkillId = signal('');
  readonly drafts = signal<Record<string, string>>({});
  readonly plan = signal<Record<string, unknown> | null>(null);
  readonly plannerEnabled = signal(false);
  readonly plannerSettingsLoading = signal(true);
  readonly plannerSaving = signal(false);
  readonly plannerSettingsError = signal('');
  readonly runtimeStatusKnown = signal(false);
  readonly runtimeLoaded = signal(false);
  readonly runtimeModel = signal('');
  readonly plannerGoals = signal<Record<string, string>>({});
  readonly assistedDraftDetails = signal<{ draft: Record<string, unknown>; model: { id: string; runtime_id?: string | null } } | null>(null);
  readonly draftReviewed = signal(false);
  readonly planning = signal(false);
  readonly running = signal(false);
  readonly composerError = signal('');
  readonly imageRoutes = signal<Record<ImageCapabilityId, ImageRouteChoice[]>>({
    'image.generate': [], 'image.edit': [],
  });
  readonly imagePins = signal<Partial<Record<ImageCapabilityId, string>>>({});
  readonly unavailableImagePins = signal<Partial<Record<ImageCapabilityId, string>>>({});
  readonly imageRoutesLoading = signal(false);
  readonly fliteVoices = signal<string[]>([]);
  readonly fliteVoicesLoading = signal(false);
  readonly fliteVoicesError = signal('');
  readonly imagePinSaving = signal(false);
  readonly imageRouteError = signal('');
  readonly uploadByInput = signal<Record<string, ArtifactEnvelope>>({});
  readonly sessionArtifacts = signal<ArtifactEnvelope[]>([]);
  readonly sessionArtifactError = signal('');
  readonly attachmentHandoffNotice = signal('');
  private transcriptHandoffConsumed = false;
  readonly skillPermissionRows = signal<Record<string, SkillPermissionRow[]>>({});
  readonly permissionLoading = signal<Record<string, boolean>>({});
  readonly permissionErrors = signal<Record<string, string>>({});
  readonly uploadBusyByInput = signal<Record<string, boolean>>({});
  readonly uploadErrorsByInput = signal<Record<string, string>>({});
  readonly uploadInProgress = computed(() => Object.values(this.uploadBusyByInput()).some(Boolean));
  readonly maxUploadBytes = MAX_ARTIFACT_UPLOAD_BYTES;
  readonly planReady = computed(() => {
    const value = this.plan();
    if (!value) return false;
    const failures = value['failures'];
    const status = value['status'];
    return typeof value['plan_id'] === 'string' && /^[a-f0-9]{24}$/.test(value['plan_id']) &&
      !(Array.isArray(failures) && failures.length) && status !== 'not_ready' && status !== 'failed';
  });
  readonly canRun = computed(() => !!this.plan() && this.planReady() &&
    (!this.assistedDraftDetails() || this.draftReviewed()) &&
    !this.planning() && !this.running() && !this.uploadInProgress());
  readonly visibleSkills = computed(() => {
    const query = this.query().trim();
    const terms = this.goalSearchTerms(query);
    return this.skills().map((skill, index) => ({ skill, index, score: this.skillGoalMatchScore(skill, query, terms) }))
      .filter(({ skill, score }) => (this.readinessFilter() === 'all' || skill.status === this.readinessFilter())
        && (!query || score > 0))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ skill }) => skill);
  });
  readonly skillGroups = computed(() => {
    const groups = new Map<string, SkillCatalogItem[]>();
    for (const skill of this.visibleSkills()) {
      const goal = this.goalGroup(skill);
      groups.set(goal, [...(groups.get(goal) ?? []), skill]);
    }
    return [...groups].sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      .map(([goal, skills]) => ({ goal, skills }));
  });

  ngOnInit(): void { void this.load(); void this.loadPlannerControls(); void this.loadImageRoutes(); void this.loadFliteVoices(); }
  async refreshAll(): Promise<void> { await Promise.all([this.load(), this.loadPlannerControls(), this.loadImageRoutes(), this.loadFliteVoices()]); }
  async loadFliteVoices(): Promise<void> {
    this.fliteVoicesLoading.set(true); this.fliteVoicesError.set('');
    try { this.fliteVoices.set(await this.service.fliteVoices()); }
    catch (error) {
      this.fliteVoices.set([]);
      this.fliteVoicesError.set(error instanceof Error ? error.message : 'Local Flite voices could not be checked.');
    } finally { this.fliteVoicesLoading.set(false); }
  }
  async loadImageRoutes(): Promise<void> {
    this.imageRoutesLoading.set(true); this.imageRouteError.set('');
    try {
      const [routes, pins] = await Promise.all([this.service.imageRoutes(), this.service.imageModelPins()]);
      this.imageRoutes.set(routes);
      const confirmed: Partial<Record<ImageCapabilityId, string>> = {};
      const unavailable: Partial<Record<ImageCapabilityId, string>> = {};
      const unavailablePins: string[] = [];
      for (const capability of ['image.generate', 'image.edit'] as const) {
        const modelId = pins[capability];
        if (!modelId) continue;
        if (routes[capability].some(route => route.model_id === modelId)) confirmed[capability] = modelId;
        else { unavailable[capability] = modelId; unavailablePins.push(`${capability}: ${modelId}`); }
      }
      this.imagePins.set(confirmed);
      this.unavailableImagePins.set(unavailable);
      if (unavailablePins.length) this.imageRouteError.set(`Saved image model pin is not in the current compatible routes (${unavailablePins.join(', ')}). Choose an available model or automatic selection.`);
    }
    catch (error) {
      this.imageRoutes.set({ 'image.generate': [], 'image.edit': [] });
      this.imageRouteError.set(error instanceof Error ? error.message : 'Image routes could not be loaded.');
    } finally { this.imageRoutesLoading.set(false); }
  }
  async loadPlannerControls(): Promise<void> {
    this.plannerSettingsLoading.set(true); this.plannerSettingsError.set('');
    const [enabled, runtime] = await Promise.allSettled([
      this.service.assistedPlannerEnabled(), this.service.loadedModelStatus(),
    ]);
    if (enabled.status === 'fulfilled') this.plannerEnabled.set(enabled.value);
    else this.plannerSettingsError.set(enabled.reason instanceof Error ? enabled.reason.message : 'Could not read assisted-planner opt-in.');
    if (runtime.status === 'fulfilled') {
      this.runtimeLoaded.set(runtime.value.loaded); this.runtimeModel.set(runtime.value.model ?? ''); this.runtimeStatusKnown.set(true);
    } else {
      this.runtimeLoaded.set(false); this.runtimeModel.set(''); this.runtimeStatusKnown.set(false);
      if (enabled.status === 'fulfilled' && enabled.value) this.plannerSettingsError.set(runtime.reason instanceof Error ? runtime.reason.message : 'Could not read loaded-model status.');
    }
    this.plannerSettingsLoading.set(false);
  }
  async setPlannerEnabled(enabled: boolean): Promise<void> {
    this.plannerSaving.set(true); this.plannerSettingsError.set('');
    try { await this.service.setAssistedPlannerEnabled(enabled); this.plannerEnabled.set(enabled); }
    catch (error) { this.plannerSettingsError.set(error instanceof Error ? error.message : 'Could not save assisted-planner opt-in.'); }
    finally { this.plannerSaving.set(false); }
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    const [skillsResult, artifactsResult] = await Promise.allSettled([
      this.service.list(), this.artifactService.listSessionArtifacts(),
    ]);
    if (skillsResult.status === 'fulfilled') this.skills.set(skillsResult.value);
    else { this.skills.set([]); this.error.set(skillsResult.reason instanceof Error ? skillsResult.reason.message : 'The local API request failed.'); }
    if (artifactsResult.status === 'fulfilled') {
      this.sessionArtifacts.set(artifactsResult.value);
      this.sessionArtifactError.set('');
    } else {
      this.sessionArtifacts.set([]);
      this.sessionArtifactError.set(artifactsResult.reason instanceof Error
        ? `Could not restore previous uploads: ${artifactsResult.reason.message}`
        : 'Could not restore previous uploads.');
    }
    this.consumeAttachmentHandoff();
    this.consumeTranscriptHandoff();
    this.loading.set(false);
  }
  private consumeTranscriptHandoff(): void {
    if (this.transcriptHandoffConsumed || typeof window === 'undefined') return;
    const state = this.router.getCurrentNavigation()?.extras.state ?? window.history.state;
    const handoff = state?.['voiceTranscriptHandoff'];
    if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return;
    this.transcriptHandoffConsumed = true;
    const cleanState = { ...(window.history.state ?? {}) };
    delete cleanState['voiceTranscriptHandoff'];
    window.history.replaceState(cleanState, '');
    const payload = handoff as Record<string, unknown>;
    const transcript = payload['transcript'];
    const runId = payload['runId'];
    if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 16_000
      || typeof runId !== 'string' || !runId.trim() || runId.length > 128) {
      this.attachmentHandoffNotice.set('The transcript handoff was invalid or too large. Nothing was sent or started.');
      return;
    }
    const skill = this.skills().find(candidate => candidate.id === 'voice.respond');
    const transcriptPorts = skill?.inputs.filter(port => port.name === 'transcript' && port.artifact === 'text') ?? [];
    if (!skill || transcriptPorts.length !== 1) {
      this.attachmentHandoffNotice.set('Voice respond is unavailable or does not accept a single text transcript. Nothing was sent or started.');
      return;
    }
    this.drafts.update(current => ({ ...current, [this.inputKey(skill.id, 'transcript')]: transcript }));
    this.activeSkillId.set(skill.id);
    this.plan.set(null);
    this.assistedDraftDetails.set(null);
    this.draftReviewed.set(false);
    this.composerError.set('');
    this.attachmentHandoffNotice.set(`Transcript from run ${runId.slice(0, 8)} is an editable draft. Review or edit it, preview the plan, then choose Run skill. Nothing was sent or started.`);
    if (!this.skillPermissionRows()[skill.id] && !this.permissionLoading()[skill.id]) void this.loadSkillPermissions(skill.id);
  }
  private consumeAttachmentHandoff(): void {
    const skillId = this.route.snapshot.queryParamMap.get('skill');
    const artifactId = this.route.snapshot.queryParamMap.get('artifact');
    if (!skillId && !artifactId) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { skill: null, artifact: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!skillId || !artifactId) { this.attachmentHandoffNotice.set('The chat attachment handoff was incomplete. Select a session upload manually.'); return; }
    const skill = this.skills().find(candidate => candidate.id === skillId);
    const artifact = this.sessionArtifacts().find(candidate => candidate.id === artifactId);
    if (!skill || !artifact) { this.attachmentHandoffNotice.set('That chat upload is no longer available in this session. Upload or select a current session artifact.'); return; }
    const ports = skill.inputs.filter(candidate => candidate.artifact === artifact.kind);
    if (ports.length !== 1) { this.attachmentHandoffNotice.set(ports.length
      ? `“${skill.name}” has multiple ${artifact.kind} inputs. Select the intended input below; the attachment was not assigned.`
      : `“${skill.name}” does not declare a ${artifact.kind} input. The attachment was not converted.`); this.activeSkillId.set(skill.id); return; }
    const port = ports[0];
    const key = this.inputKey(skill.id, port.name);
    this.uploadByInput.update(current => ({ ...current, [key]: artifact }));
    this.activeSkillId.set(skill.id);
    this.plan.set(null);
    this.composerError.set('');
    this.attachmentHandoffNotice.set(`Selected ${artifact.name} for ${skill.name} · ${port.name}. Review the route before planning or running.`);
    if (!this.skillPermissionRows()[skill.id] && !this.permissionLoading()[skill.id]) void this.loadSkillPermissions(skill.id);
  }
  clearFilters(): void { this.query.set(''); this.readinessFilter.set('all'); }
  originalCategory(skill: SkillCatalogItem): string { return skill.category?.trim() || 'Not reported'; }
  preferredRouteLabel(skill: SkillCatalogItem): string {
    const routeId = skill.preferred_route_id?.trim();
    return routeId || 'Automatic';
  }
  private goalGroup(skill: SkillCatalogItem): string {
    const category = this.normalizeSearchText(skill.category ?? '');
    if (category === 'chat') return 'Chat & Reasoning';
    if (category === 'images' || category === 'image') return 'Create & Edit Images';
    if (category === 'documents' || category === 'document') return 'Work with Documents';
    if (category === 'audio' || category === 'voice') return 'Audio & Voice';
    if (category === 'knowledge' || category === 'retrieval') return 'Find Information';
    return 'Other Goals';
  }
  readinessLabel(status: SkillReadiness): string { return status === 'not_ready' ? 'Not ready' : status === 'unknown' ? 'Unknown' : 'Ready'; }
  notReadyReasons(skill: SkillCatalogItem): string[] { return skill.not_ready_reasons ?? []; }
  alternativeActionLabel(skill: SkillCatalogItem): string {
    return (skill.alternatives ?? []).some(item => item.includes('chat.general')) ? 'Open chat' : 'Open model studio';
  }
  openAlternative(skill: SkillCatalogItem): void {
    const useChat = (skill.alternatives ?? []).some(item => item.includes('chat.general'));
    void this.router.navigate([useChat ? '/chat' : '/models']);
  }
  toggleComposer(skillId: string): void {
    this.activeSkillId.set(this.activeSkillId() === skillId ? '' : skillId);
    this.plan.set(null);
    this.assistedDraftDetails.set(null); this.draftReviewed.set(false);
    this.composerError.set('');
    if (this.activeSkillId() === skillId && !this.skillPermissionRows()[skillId] && !this.permissionLoading()[skillId]) void this.loadSkillPermissions(skillId);
  }
  async loadSkillPermissions(skillId: string): Promise<void> {
    this.permissionLoading.update(state => ({ ...state, [skillId]: true }));
    this.permissionErrors.update(state => ({ ...state, [skillId]: '' }));
    try {
      const permissions = await this.service.permissions(skillId);
      this.skillPermissionRows.update(state => ({ ...state, [skillId]: Object.entries(permissions).map(([key, value]) => ({ key: key as SkillPermissionKey, value })) }));
    } catch (error) {
      this.permissionErrors.update(state => ({ ...state, [skillId]: error instanceof Error ? error.message : 'Could not load this skill’s permission declaration.' }));
    } finally { this.permissionLoading.update(state => ({ ...state, [skillId]: false })); }
  }
  permissionsFor(skillId: string): SkillPermissionRow[] { return this.skillPermissionRows()[skillId] ?? []; }
  permissionsReady(skillId: string): boolean {
    return this.permissionsFor(skillId).length > 0 && !this.permissionLoading()[skillId] && !this.permissionErrors()[skillId];
  }
  permissionLabel(key: SkillPermissionKey): string {
    return ({ filesystem_read: 'File reading', filesystem_write: 'File writing', network: 'Network access', shell: 'Shell commands',
      browser_control: 'Browser control', computer_control: 'Computer control', desktop_control: 'Desktop control',
      microphone: 'Microphone', camera: 'Camera', clipboard: 'Clipboard' } as const)[key];
  }
  draft(skillId: string, port: string): string { return this.drafts()[`${skillId}:${port}`] ?? ''; }
  setDraft(skillId: string, port: string, value: string): void {
    this.drafts.update(drafts => ({ ...drafts, [`${skillId}:${port}`]: value }));
    this.plan.set(null);
    this.assistedDraftDetails.set(null); this.draftReviewed.set(false);
    this.composerError.set('');
  }
  private typedInputs(skill: SkillCatalogItem): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const port of skill.inputs) {
      const attachment = this.uploadedArtifact(skill.id, port.name);
      if (attachment) { inputs[port.name] = { ...attachment }; continue; }
      const raw = (port.name === 'voice' && (skill.id === 'voice.respond' || skill.id === 'voice.conversation')
        ? this.draft(skill.id, port.name) || 'auto'
        : this.draft(skill.id, port.name)).trim();
      if (!raw) continue;
      if (port.artifact === 'text') inputs[port.name] = { kind: 'text', text: raw };
      else if (port.artifact === 'json') {
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new Error(`“${port.name}” must contain valid JSON.`); }
        inputs[port.name] = { kind: 'json', value };
      } else throw new Error(`“${port.name}” requires a ${port.artifact} artifact. No upload or selection endpoint is available in this API.`);
    }
    const missing = skill.inputs.find(port => port.required === true && !inputs[port.name]);
    if (missing) throw new Error(`Required input “${missing.name}” is missing. ${missing.artifact === 'text' || missing.artifact === 'json' ? '' : `This API has no ${missing.artifact} upload or selection endpoint.`}`);
    return inputs;
  }
  private inputKey(skillId: string, portName: string): string { return `${skillId}:${portName}`; }
  uploadedArtifact(skillId: string, portName: string): ArtifactEnvelope | undefined { return this.uploadByInput()[this.inputKey(skillId, portName)]; }
  uploading(skillId: string, portName: string): boolean { return this.uploadBusyByInput()[this.inputKey(skillId, portName)] === true; }
  uploadError(skillId: string, portName: string): string { return this.uploadErrorsByInput()[this.inputKey(skillId, portName)] ?? ''; }
  supportsUpload(kind: string): kind is UploadArtifactKind { return kind === 'image' || kind === 'audio' || kind === 'document'; }
  acceptFor(kind: string): string {
    if (kind === 'image') return '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
    if (kind === 'audio') return '.wav,.mp3,.ogg,.oga,.webm,.flac,.m4a,audio/wav,audio/mpeg,audio/ogg,audio/webm,audio/flac,audio/mp4';
    if (kind === 'document') return '.pdf,.txt,.md,.markdown,.csv,application/pdf,text/plain,text/markdown,text/csv';
    return '';
  }
  acceptedFormats(kind: string): string {
    if (kind === 'image') return 'PNG, JPEG, WebP';
    if (kind === 'audio') return 'WAV, MP3, OGG, WebM, FLAC, M4A';
    if (kind === 'document') return 'PDF, TXT, Markdown, CSV';
    return 'No formats configured';
  }
  formatSize(bytes: number): string { return this.artifactService.formatSize(bytes); }
  availableSessionArtifacts(kind: string, skillId: string, portName: string): ArtifactEnvelope[] {
    const currentKey = this.inputKey(skillId, portName);
    const used = new Set(Object.entries(this.uploadByInput())
      .filter(([key]) => key !== currentKey).map(([, artifact]) => artifact.id));
    return this.sessionArtifacts().filter(artifact => artifact.kind === kind && !used.has(artifact.id));
  }
  attachSessionArtifact(skillId: string, portName: string, event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const key = this.inputKey(skillId, portName);
    const next = { ...this.uploadByInput() };
    if (!id) delete next[key];
    else {
      const artifact = this.sessionArtifacts().find(item => item.id === id);
      if (!artifact || this.availableSessionArtifacts(artifact.kind, skillId, portName).every(item => item.id !== id)) {
        this.uploadErrorsByInput.update(map => ({ ...map, [key]: 'That session upload is unavailable or already attached to another input.' }));
        return;
      }
      next[key] = artifact;
    }
    this.uploadByInput.set(next);
    this.uploadErrorsByInput.update(map => ({ ...map, [key]: '' }));
    this.plan.set(null);
    this.composerError.set('');
  }
  async uploadInput(skill: SkillCatalogItem, port: SkillPort, event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file || !this.supportsUpload(port.artifact)) return;
    const key = this.inputKey(skill.id, port.name);
    this.uploadBusyByInput.update(map => ({ ...map, [key]: true }));
    this.uploadErrorsByInput.update(map => ({ ...map, [key]: '' }));
    this.plan.set(null);
    try {
      const artifact = await this.artifactService.upload(file, port.artifact);
      this.uploadByInput.update(map => ({ ...map, [key]: artifact }));
      this.sessionArtifacts.update(items => [artifact, ...items.filter(item => item.id !== artifact.id)]);
      this.plan.set(null);
    } catch (error) {
      this.uploadErrorsByInput.update(map => ({ ...map, [key]: error instanceof Error ? error.message : 'Artifact upload failed.' }));
    } finally {
      this.uploadBusyByInput.update(map => ({ ...map, [key]: false }));
    }
  }
  async removeUpload(skillId: string, portName: string): Promise<void> {
    const key = this.inputKey(skillId, portName);
    const artifact = this.uploadByInput()[key];
    if (!artifact || this.uploading(skillId, portName)) return;
    this.uploadBusyByInput.update(map => ({ ...map, [key]: true }));
    this.uploadErrorsByInput.update(map => ({ ...map, [key]: '' }));
    this.plan.set(null);
    try {
      await this.artifactService.delete(artifact.id);
      this.uploadByInput.update(map => { const next = { ...map }; delete next[key]; return next; });
      this.sessionArtifacts.update(items => items.filter(item => item.id !== artifact.id));
      this.plan.set(null);
    } catch (error) {
      this.uploadErrorsByInput.update(map => ({ ...map, [key]: error instanceof Error ? error.message : 'Could not remove the uploaded artifact.' }));
    } finally { this.uploadBusyByInput.update(map => ({ ...map, [key]: false })); }
  }
  async preview(skill: SkillCatalogItem): Promise<void> {
    this.planning.set(true); this.composerError.set(''); this.plan.set(null);
    this.assistedDraftDetails.set(null); this.draftReviewed.set(false);
    try { this.plan.set(await this.service.plan(skill.id, this.typedInputs(skill), this.selectionFor(skill))); }
    catch (error) { this.composerError.set(error instanceof Error ? error.message : 'Could not create a plan preview.'); }
    finally { this.planning.set(false); }
  }
  plannerGoal(skillId: string): string { return this.plannerGoals()[skillId] ?? ''; }
  setPlannerGoal(skillId: string, value: string): void { this.plannerGoals.update(goals => ({ ...goals, [skillId]: value })); }
  private goalSearchTerms(value: string): string[] {
    const ignored = new Set(['a', 'an', 'and', 'for', 'i', 'in', 'make', 'my', 'of', 'please', 'the', 'to', 'want', 'with', 'do', 'me', 'un', 'una', 'el', 'la', 'los', 'las', 'de', 'del', 'para', 'por', 'que', 'quiero', 'necesito']);
    return this.normalizeSearchText(value).split(' ').filter(term => term.length > 1 && !ignored.has(term));
  }
  private skillGoalMatchScore(skill: SkillCatalogItem, query: string, terms: string[]): number {
    const id = this.normalizeSearchText(skill.id);
    const name = this.normalizeSearchText(skill.name);
    const category = this.normalizeSearchText(skill.category ?? '');
    const declared = this.normalizeSearchText([
      skill.description,
      ...skill.inputs.map(port => `${port.name} ${port.artifact}`),
      ...skill.outputs.map(port => `${port.name} ${port.artifact}`),
    ].join(' '));
    if (!query) return 0;
    if (!terms.length) return declared.concat(' ', id, ' ', name, ' ', category).includes(this.normalizeSearchText(query)) ? 1 : 0;
    return terms.reduce((score, term) => score + (id.includes(term) ? 6 : name.includes(term) ? 5 : category.includes(term) ? 3 : declared.includes(term) ? 1 : 0), 0);
  }
  private normalizeSearchText(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  async generateAssistedDraft(skill: SkillCatalogItem): Promise<void> {
    this.planning.set(true); this.composerError.set(''); this.plan.set(null);
    this.assistedDraftDetails.set(null); this.draftReviewed.set(false);
    try {
      const runtime = await this.service.loadedModelStatus();
      this.runtimeLoaded.set(runtime.loaded); this.runtimeModel.set(runtime.model ?? ''); this.runtimeStatusKnown.set(true);
      if (!runtime.loaded) throw new Error('No local model is already loaded. Load one in Chat or Runtime, then retry.');
      const result = await this.service.draft(skill.id, this.plannerGoal(skill.id).trim(), this.typedInputs(skill), this.selectionFor(skill));
      this.assistedDraftDetails.set({ draft: result.draft, model: result.model });
      this.plan.set(result.plan);
    } catch (error) { this.composerError.set(error instanceof Error ? error.message : 'Could not generate and validate an assisted draft.'); }
    finally { this.planning.set(false); }
  }
  async execute(skill: SkillCatalogItem): Promise<void> {
    if (!this.canRun()) return;
    if (skill.status !== 'ready') {
      const reasons = this.notReadyReasons(skill);
      this.composerError.set(reasons.length
        ? `This skill is not ready: ${reasons.join('; ')}`
        : 'This skill is not ready. Resolve its local requirements before running it.');
      return;
    }
    const expectedPlanId = this.plan()?.['plan_id'];
    if (typeof expectedPlanId !== 'string' || !/^[a-f0-9]{24}$/.test(expectedPlanId)) {
      this.composerError.set('The resolved plan has no valid review ID. Preview the plan again before running.');
      this.plan.set(null);
      this.assistedDraftDetails.set(null); this.draftReviewed.set(false);
      return;
    }
    this.running.set(true); this.composerError.set('');
    try {
      const run = await this.service.run(skill.id, this.typedInputs(skill), expectedPlanId, this.selectionFor(skill));
      await this.router.navigate(['/runs', run.id]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start this run.';
      if (/plan changed after review/i.test(message)) {
        this.plan.set(null);
        this.assistedDraftDetails.set(null); this.draftReviewed.set(false);
        this.composerError.set('The resolved plan changed after review. Preview the current plan again, then review it before running.');
      } else this.composerError.set(message);
    }
    finally { this.running.set(false); }
  }
  prettyPlan(value: unknown): string { return JSON.stringify(value, null, 2) ?? 'No plan details were returned.'; }
  portTitle(port: SkillPort, direction: 'input' | 'output'): string {
    return `${port.required === false ? 'Optional' : direction === 'input' ? 'Required' : 'Produced'} ${port.artifact} ${direction}: ${port.name}`;
  }
  imageCapabilityForSkill(skill: SkillCatalogItem): ImageCapabilityId | null {
    if (skill.id === 'image.generate') return 'image.generate';
    if (skill.id === 'image.edit-from-instruction') return 'image.edit';
    return null;
  }
  async setImagePin(capability: ImageCapabilityId, modelId: string): Promise<void> {
    if (modelId && !this.imageRoutes()[capability].some(route => route.model_id === modelId)) {
      this.imageRouteError.set('That image model is not in the latest local route snapshot. Refresh routes before planning.');
      return;
    }
    const previous = this.imagePins()[capability] ?? '';
    this.imagePins.update(pins => {
      const next = { ...pins };
      if (modelId) next[capability] = modelId;
      else delete next[capability];
      return next;
    });
    this.imagePinSaving.set(true); this.imageRouteError.set('');
    try { await this.service.setImageModelPin(capability, modelId || null); }
    catch (error) {
      this.imagePins.update(pins => {
        const next = { ...pins };
        if (previous) next[capability] = previous;
        else delete next[capability];
        return next;
      });
      this.imageRouteError.set(error instanceof Error ? error.message : 'Could not save the image model pin.');
      return;
    } finally { this.imagePinSaving.set(false); }
    this.unavailableImagePins.update(pins => { const next = { ...pins }; delete next[capability]; return next; });
    if (Object.keys(this.unavailableImagePins()).length === 0) this.imageRouteError.set('');
    this.plan.set(null);
  }
  changeImagePin(capability: ImageCapabilityId, value: string): void {
    if (value === this.staleImagePinValue) return;
    void this.setImagePin(capability, value);
  }
  private selectionFor(skill: SkillCatalogItem): Record<string, unknown> | undefined {
    const capability = this.imageCapabilityForSkill(skill);
    const modelId = capability ? this.imagePins()[capability] : undefined;
    return capability && modelId
      ? { capability_pins: { [capability]: { model_id: modelId } } }
      : undefined;
  }
  selectedImageResources(): { estimated: number; available: number | null } | null {
    const nodes = this.plan()?.['nodes'];
    if (!Array.isArray(nodes)) return null;
    for (const value of nodes) {
      if (!value || typeof value !== 'object') continue;
      const node = value as { capability_id?: unknown; selected?: Record<string, unknown> };
      if (node.capability_id !== 'image.generate' && node.capability_id !== 'image.edit') continue;
      const estimated = node.selected?.['estimated_vram_bytes'];
      const available = node.selected?.['available_vram_bytes'];
      if (typeof estimated !== 'number' || !Number.isFinite(estimated) || estimated <= 0) return null;
      return { estimated, available: typeof available === 'number' && Number.isFinite(available) ? available : null };
    }
    return null;
  }
}
