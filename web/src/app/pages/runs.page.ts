import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RunService } from '../core/run.service';
import { ArtifactService } from '../core/artifact.service';
import { CanvasWorkspaceService } from '../core/canvas-workspace.service';
import type { ArtifactEnvelope } from '../core/artifact.types';
import type { RunEvent, RunSnapshot } from '../core/run.types';

@Component({
  selector: 'ai-runs-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="runs-page">
      <header class="page-head"><div><div class="eyebrow">ORCHESTRATION</div><h1>Runs</h1><p>Inspect local workflow progress, node events and produced artifact references.</p></div>
        <button type="button" class="secondary" (click)="refresh()" [disabled]="service.runsLoading()">{{ service.runsLoading() ? 'Refreshing…' : '↻ Refresh' }}</button>
      </header>

      <form class="open-form" (submit)="openById($event)">
        <label for="run-id">Inspect a run ID</label><div><input id="run-id" name="run-id" autocomplete="off" spellcheck="false" [value]="runIdInput()" (input)="runIdInput.set($any($event.target).value)" placeholder="32-character run ID"><button type="submit" [disabled]="!runIdInput().trim()">Open run</button></div>
        @if (formError()) { <small class="form-error" role="alert">{{ formError() }}</small> }
      </form>

      @if (!runId() && service.runsError()) {
        <section class="notice error" role="alert"><div><b>Run orchestration unavailable</b><p>{{ service.runsError() }}</p></div><button type="button" (click)="refresh()">Retry</button></section>
      }
      @if (!runId() && service.runsLoading()) { <p class="muted" role="status">Loading recent runs…</p> }
      @if (!runId() && !service.runsLoading() && !service.runsError() && !service.runs().length) {
        <section class="notice"><b>No runs are currently reported.</b><p>Run IDs become available after a workflow is started through the local orchestration API.</p></section>
      }
      @if (!runId() && service.runs().length) {
        <section class="recent" aria-labelledby="recent-runs-title"><header><h2 id="recent-runs-title">Recent runs</h2><span>{{ service.runs().length }} retained</span></header>
          <ul>@for (item of service.runs(); track item.id) { <li><button type="button" class="run-row" (click)="open(item.id)"><span class="run-row-main"><b>{{ item.skill_id }}</b><code>{{ item.id }}</code></span><span class="state-badge" [class]="'state-badge ' + item.state">{{ stateLabel(item.state) }}</span></button></li> }</ul>
        </section>
      }

      @if (runId() && service.error()) { <section class="notice error" role="alert"><span>{{ service.error() }}</span><button type="button" (click)="reconnect()">Retry connection</button></section> }
      @if (runId() && service.run(); as run) {
        <section class="run-summary" aria-labelledby="run-title">
          <header><div><div class="eyebrow">{{ run.skill_id }} · {{ run.skill_version }}</div><h2 id="run-title">Run details</h2><code>{{ run.id }}</code></div><span class="state-badge large" [class]="'state-badge large ' + run.state">{{ stateLabel(run.state) }}</span></header>
          <dl class="run-facts"><div><dt>Created</dt><dd>{{ timestamp(run.created_at) }}</dd></div><div><dt>Started</dt><dd>{{ timestamp(run.started_at) }}</dd></div><div><dt>Completed</dt><dd>{{ timestamp(run.completed_at) }}</dd></div><div><dt>Current nodes</dt><dd>{{ run.current_nodes?.length ? run.current_nodes.join(', ') : 'None reported' }}</dd></div><div><dt>Events received</dt><dd>{{ lastSequence() }}</dd></div><div><dt>Event stream</dt><dd class="stream-state" [class]="'stream-state ' + service.streamState()">{{ streamLabel() }}</dd></div></dl>
          @if (run.error; as runError) { <section class="run-error" role="alert"><b>{{ runError['kind'] || 'Run error' }}</b><p>{{ runError['message'] || 'No error detail reported.' }}</p></section> }
          @if (planNodes(run).length) {
            <section class="resolved-plan" aria-label="Resolved execution plan"><header><div><h3>Resolved plan</h3><p>Selected components recorded when this run was created.</p></div><span>{{ planNodes(run).length }} steps</span></header>
              <ol>@for (node of planNodes(run); track node['node_id'] ?? $index) { <li><span class="step-index">{{ $index + 1 }}</span><div class="step-content"><b>{{ text(node['node_id']) || text(node['capability_id']) || 'Workflow step' }}</b><span>{{ text(node['capability_id']) || 'Capability not reported' }}</span>
                @if (selectedRoute(node); as route) { <code>{{ text(route['model_id']) || text(route['id']) || 'Selected route' }}@if (text(route['profile_id'])) { · {{ text(route['profile_id']) }} }@if (text(route['runtime_id'])) { · {{ text(route['runtime_id']) }} }</code> }
                @if (node['why']; as why) { @if (isArray(why) && why.length) { <details><summary>Why this route</summary><pre>{{ json(why) }}</pre></details> } }
                @if (node['alternatives']; as alternatives) { @if (isArray(alternatives) && alternatives.length) { <details><summary>{{ alternatives.length }} alternatives</summary><pre>{{ json(alternatives) }}</pre></details> } }
              </div></li> }</ol>
            </section>
          } @else if (run.plan) { <section class="plan-unavailable"><b>Plan details were not included</b><p>This run record contains a plan without resolved route nodes.</p><details><summary>Inspect recorded plan data</summary><pre>{{ json(run.plan) }}</pre></details></section> }
          @if (run.outputs?.length) { <section class="run-outputs"><h3>Run outputs</h3>
            @if (citations().length) { <section class="run-citations" aria-label="Document citations"><h4>Document sources</h4><p>Passages returned by document retrieval, with exact character offsets in each source file.</p>
              <ol>@for (citation of citations(); track citation['id'] ?? $index) { <li><header><b>{{ text(citation['id']) || 'Source' }} · {{ text(citation['document_name']) || 'Selected document' }}</b><code>Characters {{ citation['start_char'] }}–{{ citation['end_char'] }}</code></header><blockquote>{{ text(citation['quote']) || 'No quoted passage was returned.' }}</blockquote>@if (citationTerms(citation).length) { <small class="citation-relevance">Matched terms: {{ citationTerms(citation).join(' · ') }} · lexical score {{ citationScoreLabel(citation) }} (heuristic)</small> }</li> }</ol>
            </section> }
            @if (outputContent().values.length) { <div class="run-value-list" aria-label="Text and structured outputs">
              @for (output of outputContent().values; track output.id) { <article class="run-value"><header><b>{{ output.name }}</b><span>{{ output.kind }}</span></header>
                @if (output.kind === 'text') { <pre>{{ output.value }}</pre> }
                @else { <pre>{{ json(output.value) }}</pre> }
                @if (run.skill_id === 'voice.transcribe' && run.state === 'succeeded' && output.kind === 'text') { <button type="button" class="review-transcript-button" (click)="reviewTranscript(output, run)">Review/edit this transcript in Voice respond</button><small class="transcript-handoff-hint">This opens an editable draft. Nothing is sent or run until you review it and choose Run skill.</small> }
                <button type="button" class="canvas-open-button" (click)="openValueInCanvas(output)">Open in Canvas</button>
              </article> }
            </div> }
            @if (transcriptHandoffError()) { <p class="transcript-handoff-error" role="alert">{{ transcriptHandoffError() }}</p> }
            @if (outputContent().artifacts.length) { <div class="artifact-list" aria-label="Run output artifacts">
              @for (artifact of outputContent().artifacts; track artifact.id) { <article class="artifact-card" [class.selected]="selectedArtifact()?.id === artifact.id">
                <span class="artifact-kind">{{ artifact.kind }}</span><b>{{ artifact.name }}</b><small>{{ artifact.media_type }} · {{ artifactService.formatSize(artifact.size_bytes) }}</small>
                <div class="artifact-card-actions"><button type="button" class="canvas-open-button" (click)="selectArtifact(artifact)">Preview here</button><button type="button" class="canvas-open-button" (click)="openArtifactInCanvas(artifact)">Open in Canvas</button></div>
              </article> }
            </div>
              @if (selectedArtifact(); as artifact) { <div class="artifact-canvas" aria-label="Artifact workspace preview">
                <header><div><b>{{ artifact.name }}</b><span>{{ artifact.kind }} · {{ artifact.media_type }}</span></div><button type="button" class="secondary" (click)="closeArtifact()">Close preview</button></header>
                @if (previewUrls()[artifact.id]; as url) {
                  @if (artifact.kind === 'image') { <img class="artifact-image" [src]="url" [alt]="artifact.name"> }
                  @else if (artifact.kind === 'audio') { <audio controls preload="metadata" [src]="url">Audio preview is not supported by this browser.</audio> }
                  @else if (isHtmlDocument(artifact)) {
                    <iframe class="artifact-document-preview" [src]="trustedPreviewUrl(url)" [title]="'Preview of ' + artifact.name" sandbox=""></iframe>
                    <div class="artifact-actions"><a class="artifact-download" [href]="url" [download]="artifact.name">Download {{ artifact.name }}</a></div>
                  }
                  @else if (isPdfDocument(artifact)) { <div class="artifact-actions"><a class="artifact-download" [href]="url" target="_blank" rel="noopener noreferrer">Open PDF preview</a><a class="artifact-download" [href]="url" [download]="artifact.name">Download PDF</a></div> }
                  @else { <a class="artifact-download" [href]="url" [download]="artifact.name">Download {{ artifact.name }}</a> }
                } @else if (previewErrors()[artifact.id]; as error) { <div class="preview-error" role="alert"><p>{{ error }}</p><button type="button" class="secondary" (click)="retryArtifact(artifact)">Retry preview</button></div> }
                @else { <p class="muted" role="status">Loading artifact preview…</p> }
              </div> }
            } @else if (!outputContent().values.length) { <p class="muted">Outputs are recorded, but this run did not publish a displayable text value or artifact envelope.</p> }
          </section> }
          <div class="actions"><button type="button" class="secondary" (click)="refreshRun()">Refresh status</button>
            @if (service.streamState() === 'error' || service.streamState() === 'closed') { <button type="button" class="secondary" (click)="reconnect()">Reconnect events</button> }
            @if (run.state === 'queued' || run.state === 'running') { <button type="button" class="danger" (click)="cancelRun()" [disabled]="cancelling()">{{ cancelling() ? 'Cancelling…' : 'Cancel run' }}</button> }
          </div>
        </section>
        <section class="timeline" aria-labelledby="timeline-title"><header><div><h2 id="timeline-title">Run events</h2><p>Reconnect resumes after the latest received sequence.</p></div><span>{{ service.events().length }} shown</span></header>
          @if (!service.events().length) { <p class="muted">No retained events are available for this run.</p> }
          <ol>@for (event of service.events(); track event.sequence) {
            <li [class.artifact-event]="event.type.startsWith('artifact.')"><div class="event-marker" aria-hidden="true"></div><article>
              <header><b>{{ eventLabel(event.type) }}</b><span>#{{ event.sequence }} · {{ timestamp(event.timestamp) }}</span></header><p>{{ eventDescription(event) }}</p>
              @if (event.type.startsWith('artifact.')) { <details><summary>Artifact event data</summary><pre>{{ json(event.data) }}</pre></details> }
              @else if (event.type.startsWith('node.')) { <details><summary>Node event data</summary><pre>{{ json(event.data) }}</pre></details> }
              @else if (event.type === 'plan.resolved') { <details><summary>Resolved plan</summary><pre>{{ json(event.data['plan'] ?? event.data) }}</pre></details> }
            </article></li>
          }</ol>
        </section>
      }
      @if (runId() && !service.run() && !service.error()) { <p class="muted" role="status">Loading run record…</p> }
    </main>
  `,
  styles: [`
    .run-value-list{display:grid;gap:7px;margin:9px 0}.run-value{min-width:0;padding:9px;border:1px solid #303a49;border-radius:4px;background:#111721}.run-value>header{display:flex;justify-content:space-between;gap:8px;color:#d5deec;font-size:10px}.run-value>header span{color:#98a9c0;font:8px ui-monospace,monospace;text-transform:uppercase}.run-value pre{max-height:280px;overflow:auto;margin:7px 0 0;padding:8px;border-radius:3px;background:#0b1018;color:#c4d1e2;font:10px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.preview-error p{margin:0 0 7px}.artifact-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:7px;margin-top:9px}.artifact-card{display:grid;gap:4px;min-width:0;padding:9px;border:1px solid #344257;border-radius:5px;background:#171f2a;color:#dce4ef}.artifact-card.selected{border-color:#91b8ee;background:#202d3e}.artifact-card b{font-size:10px;overflow-wrap:anywhere}.artifact-card small,.artifact-kind{color:#98a9c0;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.artifact-kind{text-transform:uppercase}.artifact-card-actions{display:flex;gap:5px;flex-wrap:wrap}.canvas-open-button,.review-transcript-button{width:max-content;max-width:100%;padding:5px 7px;border:1px solid #3b4d67;border-radius:3px;background:#182233;color:#c7dafa;font:8px ui-monospace,monospace;cursor:pointer}.review-transcript-button{border-color:#3d684f;background:#203229;color:#9de2b9}.transcript-handoff-hint{display:block;margin:3px 0 7px;color:#94a2b7;font-size:8px}.transcript-handoff-error{color:#ffb4ab;font-size:9px}.artifact-canvas{margin-top:10px;padding:10px;border:1px solid #3b4a60;border-radius:5px;background:#0e141d}.artifact-canvas>header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.artifact-canvas>header>div{display:grid;gap:4px;min-width:0}.artifact-canvas>header b{font-size:10px;overflow-wrap:anywhere}.artifact-canvas>header span{color:#98a9c0;font:8px ui-monospace,monospace}.artifact-image{display:block;max-width:100%;max-height:65vh;margin:auto;object-fit:contain}.artifact-canvas audio{width:100%}.artifact-download{display:inline-block;padding:8px 10px;border:1px solid #40516a;border-radius:4px;color:#c8dafa;font-size:10px}.preview-error{padding:8px;color:#ffb4ab;font-size:10px}
    .artifact-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.artifact-document-preview{display:block;width:100%;height:min(68vh,720px);border:1px solid #303b4b;border-radius:4px;background:#fff}.artifact-canvas a:focus-visible,.artifact-card:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}
    .run-citations{margin-top:10px;padding:9px;border:1px solid #35435a;border-radius:4px;background:#172131}.run-citations h4{margin:0;color:#d5deec;font-size:10px}.run-citations>p{margin:4px 0;color:#929fb2;font-size:9px}.run-citations ol{display:grid;gap:7px;margin:8px 0 0;padding:0;list-style:none}.run-citations li{padding:8px;border-radius:4px;background:#111923}.run-citations li header{display:flex;justify-content:space-between;gap:8px}.run-citations li b,.run-citations li code{font:9px ui-monospace,monospace;overflow-wrap:anywhere}.run-citations li b{color:#cbd8ec}.run-citations li code{color:#a6b3c7}.run-citations blockquote{margin:7px 0 0;padding-left:8px;border-left:2px solid #7694bd;color:#bac6d7;font-size:10px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.citation-relevance{display:block;margin-top:6px;color:#93a8c6;font:8px/1.45 ui-monospace,monospace;overflow-wrap:anywhere}
    :host{display:block;color:var(--text,#e4e9f2)}.runs-page{max-width:1180px;margin:auto;padding:20px;display:grid;gap:12px}.page-head{display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:1px solid #2b3240;padding-bottom:12px}.eyebrow{color:#8793a8;font:9px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase}.page-head h1{margin:4px 0;font-size:24px;font-weight:550}.page-head p{margin:4px 0 0;color:#929aaa;font-size:11px}.secondary,.danger,.open-form button,.notice button{border:1px solid #364050;border-radius:4px;background:#171c26;color:#c8d0de;padding:7px 10px;font:10px ui-monospace,monospace;cursor:pointer}.danger{border-color:#694044;background:#302125;color:#ffb4ab}.secondary:disabled,.danger:disabled{opacity:.55;cursor:wait}.open-form{display:grid;gap:6px;padding:12px;border:1px solid #2d3542;border-radius:5px;background:#171c26}.open-form>label{color:#aab5c6;font-size:10px}.open-form>div{display:flex;gap:7px}.open-form input{min-width:0;flex:1;padding:8px 9px;border:1px solid #343e4e;border-radius:4px;background:#10151e;color:#dce3ef;font:11px ui-monospace,monospace}.form-error{color:#ffb4ab}.notice{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border:1px solid #303744;border-radius:5px;background:#171c26}.notice b{font-size:11px}.notice p{margin:4px 0 0;color:#9ca6b6;font-size:10px}.notice.error{border-color:#53323a;background:#2b2025;color:#ffb4ab}.notice.error p{color:#d8b8bd}.recent,.run-summary,.timeline{border:1px solid #2b3340;border-radius:5px;background:#171c26}.recent>header,.timeline>header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid #2b3340}.recent h2,.timeline h2{margin:0;font-size:13px;font-weight:550}.recent>header>span,.timeline>header>span{color:#8994a7;font:9px ui-monospace,monospace}.recent ul{list-style:none;margin:0;padding:0}.recent li+li{border-top:1px solid #2b3340}.run-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 12px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.run-row:hover{background:#1d2532}.run-row-main{display:grid;gap:4px;min-width:0}.run-row-main b{font-size:10px}.run-row-main code{color:#99a6ba;font:8px ui-monospace,monospace;overflow-wrap:anywhere}.state-badge{flex:none;padding:4px 6px;border-radius:3px;background:#292e37;color:#bec7d4;font:8px ui-monospace,monospace;text-transform:uppercase}.state-badge.queued{color:#d6c083}.state-badge.running{background:#1e2d40;color:#a9c8f5}.state-badge.succeeded{background:#1c302d;color:#82dbac}.state-badge.failed{background:#342326;color:#ffb4ab}.state-badge.cancelled{color:#b9c2d0}.run-summary{padding:12px}.run-summary>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.run-summary h2{margin:4px 0;font-size:15px}.run-summary>header code{color:#9da9bb;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.state-badge.large{padding:6px 8px}.run-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:12px 0}.run-facts>div{min-width:0;padding:8px;border-radius:4px;background:#111721}.run-facts dt{color:#8793a8;font:8px ui-monospace,monospace;text-transform:uppercase}.run-facts dd{margin:5px 0 0;color:#c4ccda;font-size:9px;overflow-wrap:anywhere}.stream-state.live{color:#82dbac}.stream-state.reconnecting,.stream-state.connecting{color:#e6c27c}.stream-state.error{color:#ffb4ab}.run-error{padding:8px;border-left:2px solid #c46e6c;background:#291f22}.run-error b{font-size:10px;color:#ffb4ab}.run-error p{margin:4px 0;color:#d7bfc2;font-size:10px}.resolved-plan,.plan-unavailable,.run-outputs{margin:11px 0;padding:10px;border:1px solid #2d3a4d;border-radius:4px;background:#121923}.resolved-plan>header{display:flex;justify-content:space-between;gap:8px;align-items:center}.resolved-plan h3,.run-outputs h3{margin:0;color:#d5deec;font-size:11px}.resolved-plan>header p,.run-outputs>p,.plan-unavailable p{margin:4px 0 0;color:#929fb2;font-size:9px;line-height:1.45}.resolved-plan>header>span{color:#9eabc0;font:8px ui-monospace,monospace}.resolved-plan ol{display:grid;gap:6px;list-style:none;margin:9px 0 0;padding:0}.resolved-plan li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:7px;padding:8px;border:1px solid #293444;border-radius:4px;background:#171f2a}.step-index{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#29384c;color:#bfd2f1;font:8px ui-monospace,monospace}.step-content{display:grid;gap:4px;min-width:0}.step-content>b{color:#dbe3ef;font-size:10px}.step-content>span{color:#aab7ca;font:9px ui-monospace,monospace}.step-content>code{color:#9dc5a9;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.resolved-plan details,.plan-unavailable details{margin-top:4px}.resolved-plan summary,.plan-unavailable summary{color:#9aabc3;font-size:9px;cursor:pointer}.resolved-plan pre,.plan-unavailable pre,.run-outputs pre{max-height:220px;overflow:auto;padding:8px;border-radius:4px;background:#0d121a;color:#bac8dd;font:9px/1.45 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.plan-unavailable>b{color:#e3c18b;font-size:10px}.run-outputs>p{margin-bottom:0}.actions{display:flex;gap:7px;flex-wrap:wrap}.timeline>header p{margin:4px 0 0;color:#8f9bad;font-size:9px}.timeline ol{list-style:none;margin:0;padding:2px 12px 10px}.timeline li{position:relative;display:grid;grid-template-columns:12px minmax(0,1fr);gap:9px;padding:10px 0}.timeline li+li{border-top:1px solid #2a303b}.event-marker{width:7px;height:7px;margin-top:4px;border-radius:50%;background:#9cb3d8}.artifact-event .event-marker{background:#d3a46c}.timeline article{min-width:0}.timeline article>header{display:flex;justify-content:space-between;gap:8px}.timeline article>header b{color:#d5deec;font:10px ui-monospace,monospace;overflow-wrap:anywhere}.timeline article>header span{color:#8390a3;font:8px ui-monospace,monospace}.timeline article>p{margin:5px 0;color:#aab5c5;font-size:9px;overflow-wrap:anywhere}.timeline details{margin-top:5px}.timeline summary{width:max-content;max-width:100%;color:#9aabc3;font-size:9px;cursor:pointer}.timeline pre{max-height:260px;overflow:auto;padding:8px;border-radius:4px;background:#10151e;color:#bac8dd;font:9px/1.45 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.muted{padding:10px;color:#9aa5b7;font-size:10px}.runs-page button:focus-visible,.runs-page input:focus-visible,.timeline summary:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}@media(max-width:600px){.runs-page{padding:14px 11px}.page-head{align-items:flex-start}.run-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.timeline>header{align-items:flex-start}.run-summary>header{flex-direction:column}}
  `],
})
export class RunsPage implements OnInit, OnDestroy {
  readonly service = inject(RunService);
  readonly artifactService = inject(ArtifactService);
  private readonly canvasWorkspace = inject(CanvasWorkspaceService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private routeSub?: Subscription;
  readonly runId = signal('');
  readonly runIdInput = signal('');
  readonly formError = signal('');
  readonly transcriptHandoffError = signal('');
  readonly cancelling = signal(false);
  readonly selectedArtifact = signal<ArtifactEnvelope | null>(null);
  readonly previewUrls = signal<Record<string, string>>({});
  readonly previewErrors = signal<Record<string, string>>({});
  readonly outputContent = computed(() => collectRunOutputs(this.service.run()?.outputs ?? []));
  readonly lastSequence = () => this.service.events().at(-1)?.sequence ?? 0;

  constructor() {
    effect(() => {
      const run = this.service.run();
      if (!run) return;
      const outputs = this.outputContent();
      untracked(() => {
        for (const artifact of outputs.artifacts) this.canvasWorkspace.registerArtifact(artifact);
        for (const output of outputs.values) {
          const kind = output.kind === 'text' ? 'markdown' : 'json';
          const content = output.kind === 'text' ? output.value : JSON.stringify(output.value, null, 2) ?? 'null';
          this.canvasWorkspace.registerText(`run:${run.id}:${output.id}`, output.name, kind,
            content, 'run', run.id);
        }
      });
    });
  }

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe(params => {
      const id = params.get('id') || '';
      this.runId.set(id);
      this.runIdInput.set(id);
      this.selectedArtifact.set(null);
      this.previewErrors.set({});
      for (const url of Object.values(this.previewUrls())) URL.revokeObjectURL(url);
      this.previewUrls.set({});
      if (id) void this.service.open(id);
      else { this.service.disconnect(); void this.service.listRuns(); }
    });
  }
  ngOnDestroy(): void { this.routeSub?.unsubscribe(); this.service.disconnect(); for (const url of Object.values(this.previewUrls())) URL.revokeObjectURL(url); }

  openById(event: Event): void {
    event.preventDefault();
    const id = this.runIdInput().trim();
    if (!/^[a-f0-9]{32}$/.test(id)) { this.formError.set('Enter a 32-character hexadecimal run ID.'); return; }
    this.formError.set('');
    void this.router.navigate(['/runs', id]);
  }
  open(id: string): void { this.runIdInput.set(id); void this.router.navigate(['/runs', id]); }
  refresh(): void { void (this.runId() ? this.refreshRun() : this.service.listRuns()); }
  async refreshRun(): Promise<void> { try { await this.service.refresh(); } catch (error) { this.service.error.set(error instanceof Error ? error.message : 'Could not refresh run status.'); } }
  reconnect(): void { const id = this.runId(); if (id) void this.service.open(id); }
  async cancelRun(): Promise<void> {
    this.cancelling.set(true);
    try { await this.service.cancel(); }
    catch { /* RunService exposes the API error in its state. */ }
    finally { this.cancelling.set(false); }
  }
  stateLabel(state: string): string { return state === 'succeeded' ? 'Completed' : state === 'failed' ? 'Failed' : state === 'cancelled' ? 'Cancelled' : state === 'running' ? 'Running' : state === 'queued' ? 'Queued' : state; }
  streamLabel(): string { return ({ idle: 'Idle', connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', closed: 'Closed', error: 'Unavailable' } as const)[this.service.streamState()]; }
  timestamp(value: RunSnapshot['created_at']): string {
    if (value === null || value === undefined || value === '') return 'Not reported';
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  eventDescription(event: RunEvent): string {
    const data = event.data;
    const node = typeof data['node_id'] === 'string' ? data['node_id'] : typeof data['node'] === 'string' ? data['node'] : '';
    const artifact = typeof data['artifact_id'] === 'string' ? data['artifact_id'] : '';
    return node ? `Node: ${node}` : artifact ? `Artifact: ${artifact}` : event.type.startsWith('run.') ? 'Run lifecycle event' : 'Workflow event';
  }
  eventLabel(type: string): string { return type.replace(/[._]/g, ' ').replace(/\b\w/g, value => value.toUpperCase()); }
  planNodes(run: RunSnapshot): Record<string, unknown>[] {
    const nodes = run.plan?.['nodes'];
    return Array.isArray(nodes) ? nodes.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
  }
  selectedRoute(node: Record<string, unknown>): Record<string, unknown> | null {
    const selected = node['selected'];
    return selected && typeof selected === 'object' && !Array.isArray(selected) ? selected as Record<string, unknown> : null;
  }
  text(value: unknown): string { return typeof value === 'string' ? value : ''; }
  isArray(value: unknown): value is unknown[] { return Array.isArray(value); }
  json(value: unknown): string { return JSON.stringify(value, null, 2) ?? 'No event data.'; }
  citations(): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    for (const output of this.outputContent().values) {
      if (output.kind !== 'json' || !Array.isArray(output.value)) continue;
      for (const item of output.value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const citation = item as Record<string, unknown>;
        if (typeof citation['id'] === 'string' && typeof citation['document_name'] === 'string'
          && Number.isInteger(citation['start_char']) && Number.isInteger(citation['end_char'])
          && typeof citation['quote'] === 'string') result.push(citation);
      }
    }
    return result;
  }
  citationTerms(citation: Record<string, unknown>): string[] {
    return Array.isArray(citation['matched_terms'])
      ? citation['matched_terms'].filter((term): term is string => typeof term === 'string' && term.length > 0).slice(0, 24)
      : [];
  }
  citationScoreLabel(citation: Record<string, unknown>): string {
    const score = citation['lexical_score'];
    return typeof score === 'number' && Number.isFinite(score) && score >= 0 ? score.toFixed(3) : 'not reported';
  }

  isHtmlDocument(artifact: ArtifactEnvelope): boolean {
    return artifact.kind === 'document' && ['text/html', 'application/xhtml+xml'].includes(artifact.media_type.toLowerCase());
  }

  isPdfDocument(artifact: ArtifactEnvelope): boolean {
    return artifact.kind === 'document' && artifact.media_type.toLowerCase() === 'application/pdf';
  }

  trustedPreviewUrl(url: string) { return this.sanitizer.bypassSecurityTrustResourceUrl(url); }

  selectArtifact(artifact: ArtifactEnvelope): void {
    this.selectedArtifact.set(artifact);
    if (this.previewUrls()[artifact.id] || this.previewErrors()[artifact.id]) return;
    const runId = this.runId();
    void this.artifactService.createPreviewUrl(artifact).then(url => {
      if (this.runId() !== runId) { URL.revokeObjectURL(url); return; }
      this.previewUrls.update(current => ({ ...current, [artifact.id]: url }));
    }).catch(error => {
      this.previewErrors.update(current => ({ ...current, [artifact.id]: error instanceof Error ? error.message : 'Could not load artifact content.' }));
    });
  }

  closeArtifact(): void { this.selectedArtifact.set(null); }

  openArtifactInCanvas(artifact: ArtifactEnvelope): void {
    this.canvasWorkspace.openArtifact(artifact);
    void this.router.navigate(['/canvas']);
  }

  openValueInCanvas(output: RunTextValue): void {
    const runId = this.runId();
    if (!runId) return;
    const kind = output.kind === 'text' ? 'markdown' : 'json';
    const content = output.kind === 'text' ? output.value : JSON.stringify(output.value, null, 2) ?? 'null';
    this.canvasWorkspace.openText(`run:${runId}:${output.id}`, output.name, kind, content, 'run', runId);
    void this.router.navigate(['/canvas']);
  }

  reviewTranscript(output: RunTextValue, run: RunSnapshot): void {
    if (run.skill_id !== 'voice.transcribe' || run.state !== 'succeeded' || output.kind !== 'text') return;
    const transcript = output.value;
    if (!transcript.trim()) { this.transcriptHandoffError.set('This transcription is empty and cannot be reviewed.'); return; }
    if (transcript.length > 16_000) { this.transcriptHandoffError.set('This transcription exceeds the 16,000-character review limit.'); return; }
    this.transcriptHandoffError.set('');
    void this.router.navigate(['/skills'], { state: { voiceTranscriptHandoff: { runId: run.id, transcript } } });
  }

  retryArtifact(artifact: ArtifactEnvelope): void {
    this.previewErrors.update(current => { const next = { ...current }; delete next[artifact.id]; return next; });
    void this.selectArtifact(artifact);
  }

}

type RunTextValue = { id: string; name: string; kind: 'text'; value: string } | { id: string; name: string; kind: 'json'; value: unknown };

function collectRunOutputs(outputs: unknown[]): { artifacts: ArtifactEnvelope[]; values: RunTextValue[] } {
  const artifacts = new Map<string, ArtifactEnvelope>();
  const values: RunTextValue[] = [];
  const visited = new WeakSet<object>();
  const visit = (value: unknown, path: string, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 6 || visited.has(value as object)) return;
    visited.add(value as object);
    if (Array.isArray(value)) { for (const [index, child] of value.slice(0, 100).entries()) visit(child, `${path}[${index + 1}]`, depth + 1); return; }
    const item = value as Record<string, unknown>;
    if (isArtifactEnvelope(item)) { artifacts.set(item.id, item); return; }
    const kind = item['kind'];
    if (kind === 'text' && typeof item['text'] === 'string') {
      values.push({ id: `${path}:text`, name: path || 'Text output', kind: 'text', value: item['text'] });
      return;
    }
    if (kind === 'json' && 'value' in item) {
      values.push({ id: `${path}:json`, name: path || 'Structured output', kind: 'json', value: item['value'] });
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (['artifact', 'artifacts', 'outputs', 'value'].includes(key) || (key !== 'kind' && key !== 'media_type' && key !== 'metadata')) {
        visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };
  for (const [index, output] of outputs.slice(0, 100).entries()) visit(output, `Output ${index + 1}`, 0);
  return { artifacts: [...artifacts.values()], values };
}

function isArtifactEnvelope(value: Record<string, unknown>): value is Record<string, unknown> & ArtifactEnvelope {
  const owner = value['owner'];
  return typeof value['id'] === 'string' && /^art_[A-Za-z0-9_-]{1,75}$/.test(value['id'])
    && ['text', 'chat_messages', 'json', 'image', 'audio', 'video', 'document', 'embedding_batch', 'rerank_candidates', 'file_reference', 'screen_frame', 'tool_result', 'model_reference'].includes(String(value['kind']))
    && typeof value['media_type'] === 'string' && typeof value['name'] === 'string'
    && typeof value['size_bytes'] === 'number' && !!owner && typeof owner === 'object'
    && ['run', 'session', 'user'].includes(String((owner as Record<string, unknown>)['type']))
    && typeof (owner as Record<string, unknown>)['id'] === 'string';
}
