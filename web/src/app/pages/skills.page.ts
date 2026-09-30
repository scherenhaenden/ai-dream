import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ArtifactService, MAX_ARTIFACT_UPLOAD_BYTES } from '../core/artifact.service';
import type { ArtifactEnvelope, UploadArtifactKind } from '../core/artifact.types';
import { SkillService } from '../core/skill.service';
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
        <button type="button" class="refresh" (click)="load()" [disabled]="loading()">{{ loading() ? 'Loading…' : '↻ Refresh' }}</button>
      </header>
      @if (error()) {
        <section class="state error" role="alert"><div><b>Skills could not be loaded</b><p>{{ error() }}</p></div><button type="button" (click)="load()" [disabled]="loading()">Retry</button></section>
      }
      @if (loading() && !skills().length) { <p class="state-message" role="status">Loading skills from the local API…</p> }
      @if (!loading() && !error() && !skills().length) {
        <section class="state empty"><b>No skills reported</b><p>The API returned an empty skill catalog. This page does not supply sample skills.</p></section>
      }
      @if (skills().length) {
        <section aria-label="Skill catalog" class="catalog">
          <div class="toolbar">
            <label class="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search skills" placeholder="Search name, category, input, or output" [value]="query()" (input)="query.set($any($event.target).value)"></label>
            <label class="filter-label">Readiness
              <select aria-label="Filter skills by readiness" [value]="readinessFilter()" (change)="readinessFilter.set($any($event.target).value)">
                <option value="all">All</option><option value="ready">Ready</option><option value="not_ready">Not ready</option><option value="unknown">Unknown</option>
              </select>
            </label>
            <span class="result-count" aria-live="polite" aria-atomic="true">{{ visibleSkills().length }} of {{ skills().length }} shown</span>
          </div>
          @if (!visibleSkills().length) {
            <section class="state empty"><b>No matching skills</b><p>Try another search or readiness filter.</p><button type="button" (click)="clearFilters()">Clear filters</button></section>
          }
          @for (group of skillGroups(); track group.category) {
          <section class="skill-group" [attr.aria-label]="group.category + ' skills'"><h2 class="group-heading">{{ group.category }}<span>{{ group.skills.length }}</span></h2>
          <div class="skill-grid">
            @for (skill of group.skills; track skill.id) {
              <article class="skill-card">
                <header class="card-head"><div><h2>{{ skill.name }}</h2><code>{{ skill.id }}@if (skill.version) { · {{ skill.version }} }</code></div>
                  <span class="readiness" [class]="'readiness ' + skill.status">{{ readinessLabel(skill.status) }}</span></header>
                <p class="description">{{ skill.description }}</p>
                <div class="io">
                  <section aria-label="Accepted inputs"><h3>Inputs</h3><div class="chips">@for (input of skill.inputs; track input.name) { <span class="chip" [title]="portTitle(input, 'input')">{{ input.name }} · {{ input.artifact }}@if (input.required === false) { <small>optional</small> }</span> } @empty { <span class="missing">Not reported</span> }</div></section>
                  <section aria-label="Outputs"><h3>Outputs</h3><div class="chips">@for (output of skill.outputs; track output.name) { <span class="chip" [title]="portTitle(output, 'output')">{{ output.name }} · {{ output.artifact }}</span> } @empty { <span class="missing">Not reported</span> }</div></section>
                </div>
                @if (skill.status === 'not_ready') {
                  <section class="reason" aria-label="Why this skill is not ready"><b>Why it is not ready</b>
                    @if (notReadyReasons(skill).length) { <ul>@for (reason of notReadyReasons(skill); track $index) { <li>{{ reason }}</li> }</ul> }
                    @else { <p>The API marks this skill as not ready but did not provide a reason.</p> }
                    @if (skill.alternatives?.length) { <div class="alternatives"><b>What you can do instead</b><ul>@for (alternative of skill.alternatives; track $index) { <li>{{ alternative }}</li> }</ul><button type="button" (click)="openAlternative(skill)">{{ alternativeActionLabel(skill) }}</button></div> }
                  </section>
                }
                @if (skill.status === 'unknown') {
                  <section class="reason unknown-reason"><b>Readiness is unknown</b><p>The local API has not confirmed a usable route for this skill. Planning may explain the missing capability; no model is inferred by this page.</p></section>
                }
                <section class="skill-actions" aria-label="Run skill">
                  <button type="button" class="prepare" (click)="toggleComposer(skill.id)" [attr.aria-expanded]="activeSkillId() === skill.id">{{ activeSkillId() === skill.id ? 'Close run setup' : 'Plan or run' }}</button>
                  @if (activeSkillId() === skill.id) {
                    <div class="composer">
                      <p class="composer-intro">Enter the inputs below. Plan preview checks the current local route; it does not load a model or start inference.</p>
                      <section class="permission-preview" aria-label="Permissions used by this skill before running"><header><b>Permissions for this run</b><span>Declared by this skill · review before running</span></header>
                        @if (permissionLoading()[skill.id]) { <p role="status">Loading the skill's permission declaration…</p> }
                        @if (permissionErrors()[skill.id]) { <p class="permission-error" role="alert">{{ permissionErrors()[skill.id] }}</p> }
                        @if (permissionsFor(skill.id).length) { <ul>@for (permission of permissionsFor(skill.id); track permission.key) { <li><span>{{ permissionLabel(permission.key) }}</span><code>{{ permission.value }}</code></li> }</ul> }
                      </section>
                      <aside class="planner-status" aria-label="Assisted planner availability"><b>AI-assisted draft unavailable</b><p>No planner model or draft endpoint is configured. The preview is deterministic route resolution; it does not invent skills or recommendations.</p></aside>
                      @for (input of skill.inputs; track input.name) {
                        @if (input.artifact === 'text' || input.artifact === 'json') {
                          <label class="input-field"><span>{{ input.name }} · {{ input.artifact }}{{ input.required === true ? ' · required' : ' · optional' }}</span>
                            <textarea rows="3" [attr.aria-label]="input.name + ' input'" [placeholder]="input.artifact === 'json' ? 'Enter a JSON value' : 'Enter text'" [value]="draft(skill.id, input.name)" (input)="setDraft(skill.id, input.name, $any($event.target).value)"></textarea>
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
                      <div class="composer-actions"><button type="button" class="prepare" (click)="preview(skill)" [disabled]="planning() || running() || uploadInProgress()">{{ planning() ? 'Planning…' : 'Preview plan' }}</button>
                        <button type="button" class="execute" (click)="execute(skill)" [disabled]="!canRun() || running()">{{ running() ? 'Starting…' : 'Run skill' }}</button></div>
                      @if (plan(); as preview) {
                        <section class="plan-preview" aria-label="Plan preview"><header><b>Plan preview</b><span>{{ planReady() ? 'Route available' : 'Needs attention' }}</span></header>
                          <p>Review the selected route before starting. The plan is based on current local capability evidence.</p>
                          <pre>{{ prettyPlan(preview) }}</pre>
                          @if (!planReady()) { <p class="plan-limit">This plan reports unresolved routes or requirements. Resolve them before running.</p> }
                        </section>
                      }
                    </div>
                  }
                </section>
                <footer class="card-foot"><span>Preferred route</span><code>{{ skill.preferred_route_id || 'Not reported' }}</code></footer>
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
    .permission-preview{padding:8px 9px;border:1px solid #3b4555;border-radius:4px;background:#171f2b}.permission-preview>header{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}.permission-preview>header b{color:#cbd8ec;font:9px ui-monospace,monospace}.permission-preview>header span,.permission-preview>p{color:#9aa9be;font-size:8px}.permission-preview ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px 10px;list-style:none;padding:0;margin:7px 0 0}.permission-preview li{display:flex;justify-content:space-between;gap:8px;padding:4px 6px;border-radius:3px;background:#101721}.permission-preview li span{color:#b4bfd0;font-size:8px}.permission-preview li code{color:#d3dfef;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.permission-preview .permission-error{color:#ffb4ab}
    .planner-status{padding:8px 9px;border:1px solid #3e4552;border-radius:4px;background:#1b2029}.planner-status>b{color:#e2c58f;font:9px ui-monospace,monospace}.planner-status>p{margin:4px 0 0;color:#aeb7c6;font-size:9px;line-height:1.45}
    :host{display:block;color:var(--text,#e4e9f2)}.skills-page{max-width:1240px;margin:auto;padding:20px;display:grid;gap:14px}.page-head{display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:1px solid #2b3240;padding-bottom:12px}.eyebrow{font:9px ui-monospace,monospace;letter-spacing:1px;color:#8793a8}h1{margin:4px 0;font-size:24px;font-weight:550}.page-head p{margin:5px 0 0;color:#929aaa;font-size:11px;line-height:1.5}.refresh,.state button,.empty button,.prepare,.execute,.upload-success button{border:1px solid #343d4b;border-radius:4px;background:#171c26;color:#c6cede;padding:7px 10px;font:10px ui-monospace,monospace;cursor:pointer}.refresh:disabled,.state button:disabled,.prepare:disabled,.execute:disabled,.upload-success button:disabled{opacity:.55;cursor:wait}.state{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px;border:1px solid #303744;border-radius:5px;background:#171c26}.state b{font-size:12px}.state p{margin:5px 0 0;color:#9ca6b6;font-size:10px;line-height:1.5}.error{border-color:#53323a;background:#2b2025;color:#ffb4ab}.error p{color:#d9b5bb}.empty{display:block}.empty button{margin-top:9px}.state-message{color:#a5b1c3;font-size:11px}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.search{display:flex;align-items:center;gap:7px;flex:1 1 280px;min-width:0;min-height:34px;padding:0 9px;border:1px solid #303744;border-radius:4px;background:#111721;color:#9aa5b7}.search:focus-within{border-color:#819ac2}.search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:11px}.filter-label{display:flex;align-items:center;gap:7px;color:#aab4c4;font-size:10px}.filter-label select{height:34px;padding:5px 8px;border:1px solid #303744;border-radius:4px;background:#111721;color:#dce3ef;font:10px ui-monospace,monospace}.result-count{color:#8994a7;font:9px ui-monospace,monospace}.skill-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,370px),1fr));gap:10px}.skill-card{min-width:0;padding:13px;border:1px solid #2c3441;border-radius:5px;background:#171c26}.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:9px;padding-bottom:9px;border-bottom:1px solid #2a303b}.card-head h2{margin:5px 0;font-size:14px;font-weight:550}.card-head code,.card-foot code{color:#aebbd0;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.readiness{flex:none;padding:4px 6px;border-radius:3px;background:#252a34;color:#c0c7d3;font:8px ui-monospace,monospace;text-transform:uppercase}.readiness.ready{background:#1c302d;color:#82dbac}.readiness.not_ready{background:#342326;color:#ffb4ab}.readiness.unknown{background:#282d37;color:#bac4d3}.description{min-height:2.8em;margin:10px 0;color:#c4ccda;font-size:10px;line-height:1.45;overflow-wrap:anywhere}.io{display:grid;grid-template-columns:1fr 1fr;gap:10px}.io section{min-width:0}.io h3{margin:0 0 5px;color:#8793a8;font:8px ui-monospace,monospace;text-transform:uppercase}.chips{display:flex;align-items:flex-start;flex-wrap:wrap;gap:4px}.chip{max-width:100%;padding:4px 5px;border:1px solid #303b4e;border-radius:3px;background:#141923;color:#c1d0e8;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.chip small{display:block;margin-top:2px;color:#939fb2}.missing{color:#8994a7;font-size:9px}.reason{margin-top:10px;padding:8px 9px;border-left:2px solid #d39b62;background:#211f1b}.reason b{color:#e4c699;font-size:9px}.reason p,.reason li{color:#c4b9a8;font-size:9px;line-height:1.45}.reason p{margin:5px 0 0}.reason ul{margin:5px 0 0;padding-left:17px}.unknown-reason{border-color:#6c819e;background:#1c232d}.unknown-reason b{color:#b7c9e4}.unknown-reason p{color:#a9b5c6}.card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid #2a303b}.card-foot span{color:#8793a8;font:8px ui-monospace,monospace;text-transform:uppercase}.card-foot code{overflow-wrap:anywhere;text-align:right}.skill-actions{margin-top:11px}.composer{display:grid;gap:8px;margin-top:9px;padding:10px;border:1px solid #313c4d;border-radius:4px;background:#121821}.composer-intro,.plan-preview>p{margin:0;color:#aeb9ca;font-size:9px;line-height:1.5}.input-field{display:grid;gap:4px;color:#bbc7d9;font-size:9px}.input-field textarea{box-sizing:border-box;width:100%;min-height:62px;padding:7px;border:1px solid #374252;border-radius:4px;background:#0e131b;color:#e1e8f1;font:10px/1.45 ui-monospace,monospace;resize:vertical}.upload-field{display:grid;gap:5px;padding:8px;border:1px solid #303947;border-radius:4px;background:#10151e}.upload-label{display:grid;gap:5px;color:#c3cede;font-size:9px}.upload-label input,.upload-label select{max-width:100%;padding:6px;border:1px solid #374252;border-radius:4px;background:#0e131b;color:#cdd7e6;font-size:9px}.upload-help,.upload-progress{color:#8f9bac;font-size:8px;line-height:1.4}.upload-progress{color:#d6bf7d}.upload-error{color:#ffb4ab;font-size:9px;line-height:1.4;overflow-wrap:anywhere}.upload-success{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#91d6a9;font-size:9px;overflow-wrap:anywhere}.upload-success button{flex:none;padding:4px 6px}.unsupported-input{display:grid;gap:3px;padding:7px;border-left:2px solid #a67c4b;background:#211f1b;color:#dfc18e;font-size:9px}.unsupported-input span{color:#bcb3a5;line-height:1.45}.composer-actions{display:flex;gap:7px;flex-wrap:wrap}.execute{border-color:#3d684f;background:#203229;color:#9de2b9}.composer-error{margin:0;color:#ffb4ab;font-size:9px}.plan-preview{display:grid;gap:6px;padding:8px;border:1px solid #344154;border-radius:4px;background:#0f151f}.plan-preview>header{display:flex;justify-content:space-between;gap:8px;color:#cfdaea;font-size:9px}.plan-preview>header span{color:#85d4a7;font:8px ui-monospace,monospace}.plan-preview pre{max-height:240px;overflow:auto;margin:0;padding:8px;border-radius:3px;background:#090d13;color:#c2d0e4;font:9px/1.45 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.plan-preview .plan-limit{color:#e4c699}.skills-page button:focus-visible,.skills-page input:focus-visible,.skills-page textarea:focus-visible,.skills-page select:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}@media(max-width:560px){.skills-page{padding:14px 11px}.page-head{align-items:flex-start}.toolbar{align-items:stretch;flex-direction:column}.filter-label{justify-content:space-between}.filter-label select{flex:1}.skill-grid{grid-template-columns:1fr}.io{grid-template-columns:1fr}}
    .search input{font:inherit;font-size:11px}.skill-group{display:grid;gap:8px;margin-top:14px}.group-heading{display:flex;justify-content:space-between;align-items:center;margin:0;padding:4px 1px;color:#cbd4e3;font-size:12px;font-weight:550}.group-heading span{color:#8994a7;font:9px ui-monospace,monospace}.alternatives{margin-top:8px;padding-top:7px;border-top:1px solid #45382d}.alternatives button{margin-top:6px;border:1px solid #574a3e;border-radius:4px;background:#2b241f;color:#ead6bd;padding:6px 8px;font-size:9px;cursor:pointer}
  `],
})
export class SkillsPage implements OnInit {
  private readonly service = inject(SkillService);
  private readonly router = inject(Router);
  private readonly artifactService = inject(ArtifactService);
  readonly skills = signal<SkillCatalogItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly query = signal('');
  readonly readinessFilter = signal<SkillReadiness | 'all'>('all');
  readonly activeSkillId = signal('');
  readonly drafts = signal<Record<string, string>>({});
  readonly plan = signal<Record<string, unknown> | null>(null);
  readonly planning = signal(false);
  readonly running = signal(false);
  readonly composerError = signal('');
  readonly uploadByInput = signal<Record<string, ArtifactEnvelope>>({});
  readonly sessionArtifacts = signal<ArtifactEnvelope[]>([]);
  readonly sessionArtifactError = signal('');
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
    return !(Array.isArray(failures) && failures.length) && status !== 'not_ready' && status !== 'failed';
  });
  readonly canRun = computed(() => !!this.plan() && this.planReady() && !this.planning() && !this.running() && !this.uploadInProgress());
  readonly visibleSkills = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    return this.skills().filter((skill) => {
      if (this.readinessFilter() !== 'all' && skill.status !== this.readinessFilter()) return false;
      if (!query) return true;
      return [skill.id, skill.name, skill.description, skill.category ?? '',
        ...skill.inputs.map((port) => `${port.name} ${port.artifact}`),
        ...skill.outputs.map((port) => `${port.name} ${port.artifact}`),
      ].join(' ').toLocaleLowerCase().includes(query);
    });
  });
  readonly skillGroups = computed(() => {
    const groups = new Map<string, SkillCatalogItem[]>();
    for (const skill of this.visibleSkills()) {
      const category = skill.category?.trim() || 'Category not reported';
      groups.set(category, [...(groups.get(category) ?? []), skill]);
    }
    return [...groups].sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      .map(([category, skills]) => ({ category, skills }));
  });

  ngOnInit(): void { void this.load(); }
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
    this.loading.set(false);
  }
  clearFilters(): void { this.query.set(''); this.readinessFilter.set('all'); }
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
  permissionLabel(key: SkillPermissionKey): string {
    return ({ filesystem_read: 'File reading', filesystem_write: 'File writing', network: 'Network access', shell: 'Shell commands',
      browser_control: 'Browser control', computer_control: 'Computer control', desktop_control: 'Desktop control',
      microphone: 'Microphone', camera: 'Camera', clipboard: 'Clipboard' } as const)[key];
  }
  draft(skillId: string, port: string): string { return this.drafts()[`${skillId}:${port}`] ?? ''; }
  setDraft(skillId: string, port: string, value: string): void {
    this.drafts.update(drafts => ({ ...drafts, [`${skillId}:${port}`]: value }));
    this.plan.set(null);
    this.composerError.set('');
  }
  private typedInputs(skill: SkillCatalogItem): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const port of skill.inputs) {
      const attachment = this.uploadedArtifact(skill.id, port.name);
      if (attachment) { inputs[port.name] = { ...attachment }; continue; }
      const raw = this.draft(skill.id, port.name).trim();
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
    try { this.plan.set(await this.service.plan(skill.id, this.typedInputs(skill))); }
    catch (error) { this.composerError.set(error instanceof Error ? error.message : 'Could not create a plan preview.'); }
    finally { this.planning.set(false); }
  }
  async execute(skill: SkillCatalogItem): Promise<void> {
    if (!this.canRun()) return;
    this.running.set(true); this.composerError.set('');
    try {
      const run = await this.service.run(skill.id, this.typedInputs(skill));
      await this.router.navigate(['/runs', run.id]);
    } catch (error) { this.composerError.set(error instanceof Error ? error.message : 'Could not start this run.'); }
    finally { this.running.set(false); }
  }
  prettyPlan(value: unknown): string { return JSON.stringify(value, null, 2) ?? 'No plan details were returned.'; }
  portTitle(port: SkillPort, direction: 'input' | 'output'): string {
    return `${port.required === false ? 'Optional' : direction === 'input' ? 'Required' : 'Produced'} ${port.artifact} ${direction}: ${port.name}`;
  }
}
