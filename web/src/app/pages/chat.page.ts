import { ChangeDetectionStrategy, Component, ElementRef, OnInit, effect, inject, signal, untracked, viewChild, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { firstValueFrom } from 'rxjs';
import { ArtifactService, MAX_ARTIFACT_UPLOAD_BYTES } from '../core/artifact.service';
import type { ArtifactEnvelope, UploadArtifactKind } from '../core/artifact.types';
import { SkillService } from '../core/skill.service';
import type { SkillCatalogItem } from '../core/skill.types';
import { CanvasWorkspaceService } from '../core/canvas-workspace.service';
import { SelectionModeService } from '../core/selection-mode.service';
import { ProviderConnectionsService } from '../core/provider-connections.service';

type Model = { id: string; path?: string; format?: string };
type ChatSummary = { id: string; title?: string; created_at?: string; updated_at?: string };
type TranscriptMessage = { role: string; content: string; created_at?: string; run_id?: string; key: string };
type ChatProfile = { id: string; name: string; model_id: string };
type ChatAttachment = { artifact: ArtifactEnvelope; suggestedSkillIds: string[] };
type ChatEvent = { text?: string; chat_id?: string; incident_id?: string; assistant?: string | { role?: string; content?: string }; response?: string | { content?: string }; message?: string; error?: string };
type RuntimeStatus = { loaded?: boolean; backend?: string; runtime_id?: string; model?: string; placement?: unknown[] };
type CodeArtifact = { language: string; content: string; messageKey: string };
type MessageCanvasArtifact = { id: string; label: string; kind: 'code' | 'html' | 'json' | 'markdown'; content: string };
type ChatGeneration = { temperature: number; top_p: number | null; top_k: number | null; min_p: number | null; repeat_penalty: number | null; max_tokens: number | null };

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="chat-workspace">
      <header class="chat-toolbar">
        <div class="chat-heading"><span class="chat-heading-icon">◫</span><div><h1>Chat workspace</h1><p>Local inference · {{ chats().length }} conversations · {{ models().length }} models</p></div></div>
        <div class="chat-controls">
          <label class="model-picker"><span>{{ activeLoadedModel() ? 'LOADED MODEL' : 'MODEL' }}</span><select id="chat-model" [value]="selectedModelId()" (change)="selectModel($any($event.target).value)" [disabled]="modelsLoading() || models().length === 0 || busy()">
            <option value="" [selected]="!selectedModelId()">{{ modelsLoading() ? 'Loading models…' : models().length ? 'Select a local model' : 'No local models' }}</option>@for (model of models(); track model.id) {<option [value]="model.id" [selected]="model.id === selectedModelId()">{{ modelLabel(model) }}{{ activeLoadedModel()?.id === model.id ? ' · LOADED' : '' }}</option>}@if (providerConnections.discoveredModels().length) {<optgroup label="Remote models · discovery only">@for (model of providerConnections.discoveredModels(); track model.id) {<option [value]="model.id" disabled>{{ model.name }} · unavailable for chat</option>}</optgroup>}
          </select></label>
          @if (selectedModelId()) {<label class="model-picker profile-picker"><span>PROFILE</span><select [value]="selectedProfileId()" (change)="selectedProfileId.set($any($event.target).value)" [disabled]="busy() || profilesLoading()"><option value="">Automatic profile</option>@for (profile of profiles(); track profile.id) {<option [value]="profile.id" [selected]="profile.id === selectedProfileId()">{{ profile.name }}</option>}</select></label>}
          <button class="chat-new-button" (click)="createChat()" [disabled]="busy() || !api.connected()" title="Start a new conversation">＋ <span>New thread</span></button>
        </div>
      </header>

      @if (!api.connected()) {
        <div class="chat-notice error-notice" role="alert"><span>!</span><div><b>Local API unavailable</b><p>Start the AI Dream service or check its address in Settings, then retry.</p></div><button (click)="retry()" [disabled]="busy()">Retry</button></div>
      } @else if (apiError()) {
        <div class="chat-notice error-notice" role="alert"><span>!</span><div><b>Could not load chat data</b><p>{{ apiError() }}</p></div><button (click)="reload()" [disabled]="busy()">Retry</button></div>
      }

      <div class="chat-grid" [class.canvas-open]="canvasOpen()">
        <aside class="thread-rail" aria-label="Conversations">
          <div class="rail-title"><span>THREAD LEDGER</span><b>{{ chats().length }}</b></div>
          <label class="thread-search"><span>⌕</span><input aria-label="Filter conversations" placeholder="Filter chats…" [value]="threadFilter()" (input)="threadFilter.set($any($event.target).value)"></label>
          <div class="thread-list">
            @for (chat of visibleChats(); track chat.id) {
              <button class="thread-item" [class.selected]="selectedChatId() === chat.id" [disabled]="busy()" (click)="selectChat(chat.id)">
                <span class="thread-dot" [class.active]="selectedChatId() === chat.id"></span><span class="thread-copy"><b>{{ chat.title || 'New chat' }}</b><small>{{ chat.updated_at ? formatTime(chat.updated_at) : 'Saved locally' }}</small></span>
              </button>
            } @empty { <p class="thread-empty">{{ chatsLoading() ? 'Loading…' : 'No matching conversations' }}</p> }
          </div>
          <div class="rail-footer"><span class="online-dot" [class.offline]="!api.connected()"></span><span>{{ api.connected() ? 'LOCAL API ONLINE' : 'API OFFLINE' }}</span></div>
        </aside>
        <section class="chat-center">
          <div class="active-thread-bar"><div><span class="eyebrow">CURRENT THREAD</span><b>{{ activeChatTitle() }}</b></div><div class="thread-actions"><button class="chat-action-button canvas-toggle" (click)="toggleCanvas()" [attr.aria-expanded]="canvasOpen()" title="Show or hide the inline code preview">{{ canvasOpen() ? 'Hide code preview' : 'Code preview' }}@if (latestCodeArtifact()) { · Available}</button>@if (selectedChatId()) {<button class="chat-action-button" (click)="renameChat()" [disabled]="busy()" title="Rename conversation">Rename</button><button class="chat-action-button chat-delete-button" (click)="deleteChat()" [disabled]="busy()" title="Delete conversation">Delete</button>}<button class="chat-action-button" (click)="exportTranscript()" [disabled]="messages().length === 0 || streaming()" title="Export Markdown">Export</button></div></div>
          <section class="transcript" #transcript aria-label="Conversation messages" [attr.aria-busy]="transcriptLoading() || streaming()">
        @if (transcriptLoading()) { <div class="transcript-loading" role="status">Loading conversation…</div> }
        @if (messages().length === 0 && !streaming() && !turnError()) {
          <div class="chat-empty"><div class="empty-illustration">◫</div><h2>{{ selectedChatId() ? 'Start this conversation' : 'Your local chat workspace' }}</h2><p>{{ selectedChatId() ? 'Choose a model below and send a message.' : 'Create a conversation to chat with a model installed on this device.' }}</p></div>
        }
        @for (message of messages(); track message.key) {
          <article class="message-row" [class.user-message]="message.role === 'user'" [class.assistant-message]="message.role !== 'user'">
            <div class="message-avatar" [class.user-avatar]="message.role === 'user'">{{ message.role === 'user' ? 'ED' : 'A' }}</div>
            <div class="message-body"><div class="message-author">{{ message.role === 'user' ? 'You' : 'AI Dream' }} @if (message.created_at) {<time>{{ formatTime(message.created_at) }}</time>} @if (message.role !== 'user' && message.run_id) {<span class="message-run-link" title="Associated orchestration run">Run · {{ message.run_id.slice(0, 8) }}</span>} @if (message.role !== 'user') {<button class="message-copy" (click)="copyMessage(message)" [attr.aria-label]="copiedKey() === message.key ? 'Copied response' : 'Copy response'">{{ copiedKey() === message.key ? 'Copied' : 'Copy' }}</button>}</div><div class="message-content">{{ messageDisplayContent(message) }}</div>
              @if (message.role !== 'user') { <div class="message-canvas-actions"><button type="button" (click)="openMessageInCanvas(message)">Open response in Canvas</button>@for (artifact of messageCanvasArtifacts(message); track artifact.id) {<button type="button" (click)="openCodeInCanvas(artifact)">Open {{ artifact.label }} in Canvas</button>}</div> }
            </div>
          </article>
        }
        @if (streaming()) {
          <article class="message-row assistant-message" aria-label="Assistant response in progress"><div class="message-avatar">A</div><div class="message-body"><div class="message-author">AI Dream <span class="stream-indicator">Generating</span></div><div class="message-content">{{ streamText() }}<span class="stream-cursor" aria-hidden="true"></span></div></div></article>
        }
        @if (turnError()) { <div class="turn-error" role="alert"><span>{{ turnError() }}</span>@if(lastIncidentId()){<small>Incident {{lastIncidentId()}} · @if(diagnosticSaved()){<a [href]="diagnosticsHref()">Open diagnostics</a>}@else{<span>Could not save local diagnostic</span>}</small>}@if (prompt().trim() && api.connected()) {<button (click)="send()" [disabled]="busy() || !selectedModelId()">Retry message</button>}</div> }
        <div #scrollAnchor></div>
          </section>

      <div class="sr-only" aria-live="polite">{{ sending() ? 'Sending message.' : streaming() ? 'The model is responding.' : turnError() }}</div>
          <footer class="composer-area">
        @if (models().length === 0 && !modelsLoading()) {
          <div class="model-warning" role="status">No local models are available. Add a model in the Models screen before sending.</div>
        }
        <div class="composer surface">
          <div class="orchestration-strip" aria-label="Chat execution plan">
            <div class="orchestration-strip-heading"><span class="eyebrow">EXECUTION</span><div class="execution-mode" role="group" aria-label="Chat execution path"><button [class.active]="chatExecutionMode() === 'orchestrated'" [attr.aria-pressed]="chatExecutionMode() === 'orchestrated'" (click)="setChatExecutionMode('orchestrated')" [disabled]="busy()">Plan + run</button><button [class.active]="chatExecutionMode() === 'legacy'" [attr.aria-pressed]="chatExecutionMode() === 'legacy'" (click)="setChatExecutionMode('legacy')" [disabled]="busy()">Direct chat</button></div></div>
            @if (chatExecutionMode() === 'orchestrated') {
              <div class="plan-notice selection-mode-note" role="status">Global mode: <b>{{ selectionModeService.mode() }}</b>@if (selectionModeService.mode() === 'guided') { · Send resolves a plan for review; it runs only after confirmation. }@else if (selectionModeService.mode() === 'manual') { · Selected model and profile are hard pins; incompatible routes fail without substitution. }@else { · AI Dream resolves and runs the local route automatically. }</div>
              <div class="orchestration-route">@if (orchestrationPlan()) {<span class="route-ready">PLAN READY</span><span>{{ orchestrationRouteLabel() }}</span>} @else if (planningChat()) {<span>Resolving a local route…</span>} @else {<span>Preview route for {{ selectedModel()?.id || 'the selected model' }}</span>}</div>
              @if (orchestrationError()) {<div class="orchestration-error" role="status">{{ orchestrationError() }}</div>}
              @if (planNotice()) {<div class="plan-notice" role="status">{{ planNotice() }}</div>}
              @if (orchestrationPlan()) {<button class="plan-preview-button inspector-toggle" (click)="togglePlanInspector()" [attr.aria-expanded]="planInspectorOpen()">{{ planInspectorOpen() ? 'Close plan' : 'Inspect plan' }}</button>}
              @if (chatRunId()) {<div class="orchestration-route"><span class="run-state">{{ chatRunState() }}</span><span>Run {{ chatRunId().slice(0, 8) }}</span></div>}
              @if (streaming() && chatRunId()) {<div class="orchestration-route run-progress" role="status" aria-live="polite"><span>Active steps</span><span>{{ chatRunCurrentNodes().length ? chatRunCurrentNodes().join(', ') : 'Current step not reported by API' }}</span></div>}
              <button class="plan-preview-button" (click)="previewChatPlan()" [disabled]="!prompt().trim() || !selectedModelId() || planningChat() || busy()">{{ planningChat() ? 'Resolving…' : 'Preview plan' }}</button>
              @if (selectionModeService.mode() === 'guided' && orchestrationPlan()) {<button class="plan-preview-button guided-confirm" (click)="confirmGuidedPlan()" [disabled]="!guidedPlanCurrent() || busy()">Confirm plan and run</button>}
              @if (planInspectorOpen() && orchestrationPlan(); as plan) {
                <section class="chat-plan-inspector" aria-label="Resolved chat plan">
                  <header><div><b>Plan inspector</b><small>Resolved locally · no inference started</small></div><span>{{ plan.mode || 'automatic' }} · Up to {{ plan.resource_budget?.max_parallel_routes ?? 'unknown' }} parallel routes</span></header>
                  @for (node of orchestrationNodes(); track node.node_id) {
                    <article class="plan-node">
                      <div class="plan-node-heading"><b>{{ node.node_id }}</b><span>RESOLVED</span></div>
                      <dl><div><dt>Capability</dt><dd>{{ node.capability_id || 'Not reported by plan' }}</dd></div><div><dt>Component / model</dt><dd>{{ planNodeComponent(node) }}</dd></div><div><dt>Route</dt><dd>{{ planNodeRoute(node) }}</dd></div><div><dt>Profile</dt><dd>{{ planNodeProfile(node) }}</dd></div><div><dt>Runtime</dt><dd>{{ planNodeRuntime(node) }}</dd></div><div><dt>Inputs / outputs</dt><dd>{{ planNodeIo(node, plan) }}</dd></div><div><dt>Status</dt><dd>{{ planNodeStatus(node) }}</dd></div><div><dt>Timing</dt><dd>{{ planNodeTiming(node) }}</dd></div><div><dt>Resources</dt><dd>{{ planNodeResources(node) }}</dd></div></dl>
                      @if (selectedRouteWhy(node); as why) {<p class="route-why"><b>Selection reason:</b> {{ why.reasons?.join(', ') || 'No reason details reported' }}@if (why.ranking?.length) { · ranking: {{ why.ranking.join(' → ') }}}</p>} @else {<p class="route-why"><b>Selection reason:</b> Not reported by plan.</p>}
                      @if (node.alternatives?.length) {<div class="plan-alternatives"><span>ALTERNATIVES · SELECT TO PIN FOR THIS TURN</span>@for (route of node.alternatives; track route.id) {<div><button type="button" (click)="replacePlanRoute(route)" [disabled]="busy()">Use {{ route.model_id }} · {{ route.runtime_id }}{{ route.profile_id ? ' · ' + profileNameFor(route.profile_id) : '' }}</button><small>{{ alternativeReason(node, route.id) }}</small></div>}</div>}
                      @else {<small class="no-alternatives">No compatible alternatives reported.</small>}
                    </article>
                  }
                </section>
              }
            }
          </div>
          <div class="chat-attachments">
            <label class="attachment-picker" for="chat-attachments">＋ Attach files</label>
            <input id="chat-attachments" class="sr-only" type="file" multiple [accept]="attachmentAccept" (change)="selectChatAttachments($event)" [disabled]="busy() || uploadingAttachments()" aria-label="Select image, audio, or document attachments">
            <span class="attachment-help">Images, audio, PDF, TXT, Markdown or CSV · up to 32 MiB each</span>
            @if (uploadingAttachments()) {<span class="attachment-uploading" role="status">Uploading selected files…</span>}
            @for (item of chatAttachments(); track item.artifact.id) {
              <div class="chat-attachment-card">
                <div class="attachment-file"><span class="attachment-kind">{{ item.artifact.kind }}</span><b>{{ item.artifact.name }}</b><small>{{ formatBytes(item.artifact.size_bytes) }}</small></div>
                <div class="attachment-suggestions"><span class="eyebrow">SUGGESTED SKILLS</span>
                  @for (skill of suggestedSkills(item); track skill.id) {<div class="skill-suggestion"><span><b>{{ skill.name }}</b><small [class.suggestion-ready]="skill.status === 'ready'" [class.suggestion-unknown]="skill.status === 'unknown'">{{ skill.status === 'ready' ? 'READY' : skill.status === 'unknown' ? 'READINESS UNKNOWN' : 'NOT READY' }}</small></span><p>{{ skill.status === 'ready' ? skill.description : (skill.not_ready_reasons?.[0] || skill.alternatives?.[0] || 'This skill needs a compatible local capability route.') }}</p>@if (supportsAttachmentSkill(item, skill)) {<button type="button" class="attachment-route-button" (click)="openAttachmentSkill(item, skill)">Use this {{ item.artifact.kind }} in skill</button>} @else {<small class="attachment-route-limit">No declared {{ item.artifact.kind }} input; attachment is not converted.</small>}</div>}
                  @if (!suggestedSkills(item).length) {<span class="attachment-help">No matching skill is registered. Browse <a href="/skills">Skills</a>.</span>}
                  @else {<a class="browse-skills" href="/skills">Open Skills catalog</a><small class="attachment-reupload-note">Choose “Use this {{ item.artifact.kind }} in skill” to pass this session upload directly.</small>}
                </div>
                <button type="button" class="remove-attachment" (click)="removeChatAttachment(item)" [disabled]="busy() || uploadingAttachments()" [attr.aria-label]="'Remove ' + item.artifact.name">Remove</button>
              </div>
            }
            @if (attachmentError()) {<span class="attachment-error" role="alert">{{ attachmentError() }}</span>}
            @if (chatAttachments().length) {<span class="attachment-help">Attachments are staged for the suggested skills; sending a chat message remains text-only.</span>}
          </div>
          <label class="sr-only" for="chat-prompt">Message</label>
          <textarea id="chat-prompt" rows="2" placeholder="Message your local model…" [value]="prompt()" (input)="prompt.set($any($event.target).value)" (keydown)="onComposerKey($event)" [disabled]="!canCompose()" [attr.aria-describedby]="'composer-hint'"></textarea>
          <div class="composer-bottom"><div class="composer-options"><span id="composer-hint">Local inference · generation settings are saved per thread</span></div>
          @if (busy()) { <button class="cancel-button" (click)="cancel()" [attr.aria-label]="sending() ? 'Cancel request' : 'Stop generation'">{{ sending() ? 'Cancel' : 'Stop' }} <span>■</span></button> }
          @else { <button class="send-button" (click)="send()" [disabled]="!canSend()" [attr.aria-label]="sending() ? 'Sending message' : 'Send message'">{{ sending() ? 'Sending…' : 'Send' }} <span>↗</span></button> }
          </div>
        </div>
        <p class="composer-footnote">Responses can be incorrect. Selected files are offered to matching skills; chat turns remain text-only.</p>
          </footer>
        </section>
        @if (canvasOpen()) {<aside class="code-canvas" aria-label="Inline code preview">
          <div class="canvas-tabs"><span class="canvas-tab active">&lt;/&gt; Inline code preview</span><span class="canvas-indicator" [class.present]="latestCodeArtifact()"></span></div>
          @if (latestCodeArtifact(); as artifact) {
            <div class="canvas-filebar"><div><span class="file-symbol">▤</span><b>{{ artifact.language || 'Code artifact' }}</b><span class="artifact-source">from assistant response</span></div><span>{{ artifact.content.split('\n').length }} lines</span></div>
            <div class="code-scroll"><div class="code-source"><ol aria-hidden="true">@for (line of artifact.content.split('\n'); track $index) { <li>{{ $index + 1 }}</li> }</ol><pre><code>{{ artifact.content }}</code></pre></div></div>
            <footer class="canvas-footer"><span>READ ONLY</span><span>Extracted from {{ activeChatTitle() }}</span></footer>
          } @else {
            <div class="canvas-empty"><span class="canvas-empty-icon">&lt;/&gt;</span><b>No code artifact in this thread</b><p>Assistant code blocks can be opened as stable Canvas tabs from the response.</p></div>
            <footer class="canvas-footer"><span>PREVIEW</span><span>Waiting for a code block</span></footer>
          }
        </aside>}
        <aside class="chat-inspector" aria-label="Runtime inspector">
          <div class="inspector-tabs"><span class="active">RUNTIME INSPECTOR</span><a class="inspector-tab-link" href="/logs?view=diagnostics">DIAGNOSTICS</a></div>
          <section class="inspector-section"><div class="inspector-heading"><span>SESSION STATUS</span><i [class.offline]="!api.connected()"></i></div><div class="inspector-status"><b>{{ api.connected() ? 'Connected' : 'Unavailable' }}</b><small>{{ api.baseUrl() }}</small></div></section>
          <section class="inspector-section"><div class="inspector-heading"><span>RUNTIME</span><span class="inspector-count">{{ runtimeStatus()?.loaded ? 'LOADED' : 'IDLE' }}</span></div>
            @if (runtimeStatus()?.loaded) {<div class="model-detail"><b>{{ runtimeStatus()?.model || 'Model loaded' }}</b><small>{{ runtimeStatus()?.backend || 'Backend unavailable' }} · {{ runtimeStatus()?.runtime_id || 'Runtime' }}</small>@if (runtimeStatus()?.placement?.length) {<code>{{ runtimeStatus()?.placement?.length }} placement entries</code>}</div>} @else {<p class="inspector-empty">No model loaded in the local runtime</p>}
          </section>
          <section class="inspector-section"><div class="inspector-heading"><span>SELECTED MODEL</span><span class="inspector-count">{{ models().length }} AVAILABLE</span></div>
            @if (selectedModel()) {<div class="model-detail"><b>{{ modelLabel(selectedModel()!) }}</b><small>{{ selectedModel()!.format || 'Local model' }}</small><code>{{ selectedModel()!.id }}</code></div>} @else {<p class="inspector-empty">No local model selected</p>}
          </section>
          <section class="inspector-section generation-section"><div class="inspector-heading"><span>SAMPLING & GENERATION</span><span>{{ generationLoading() ? 'LOADING' : savingGeneration() ? 'SAVING' : selectedChatId() ? 'PER THREAD' : 'NO THREAD' }}</span></div>
            <label class="generation-control"><span>Temperature <b>{{ generationSettings().temperature.toFixed(2) }}</b></span><input type="range" min="0" max="2" step="0.01" [value]="generationSettings().temperature" [disabled]="!canEditGeneration()" (change)="setGeneration('temperature', $event)" aria-label="Temperature"></label>
            <label class="generation-control"><span>Top P <b>{{ generationSettings().top_p?.toFixed(2) ?? 'SERVER DEFAULT' }}</b><button type="button" (click)="resetGeneration('top_p')" [disabled]="!canEditGeneration()" title="Omit Top P and use the runtime default">Default</button></span><input type="range" min="0" max="1" step="0.01" [value]="generationSettings().top_p ?? 0.95" [disabled]="!canEditGeneration()" (change)="setGeneration('top_p', $event)" aria-label="Top P"></label>
            <div class="generation-pair"><label class="generation-control"><span>Top K</span><input type="number" min="1" max="2048" step="1" placeholder="Server default" [value]="generationSettings().top_k ?? ''" [disabled]="!canEditGeneration()" (change)="setGeneration('top_k', $event)" aria-label="Top K"></label><label class="generation-control"><span>Min P <b>{{ generationSettings().min_p?.toFixed(2) ?? 'SERVER DEFAULT' }}</b><button type="button" (click)="resetGeneration('min_p')" [disabled]="!canEditGeneration()" title="Omit Min P and use the runtime default">Default</button></span><input type="range" min="0" max="1" step="0.01" [value]="generationSettings().min_p ?? 0" [disabled]="!canEditGeneration()" (change)="setGeneration('min_p', $event)" aria-label="Min P"></label></div>
            <div class="generation-pair"><label class="generation-control"><span>Repeat penalty <b>{{ generationSettings().repeat_penalty?.toFixed(2) ?? 'SERVER DEFAULT' }}</b><button type="button" (click)="resetGeneration('repeat_penalty')" [disabled]="!canEditGeneration()" title="Omit repeat penalty and use the runtime default">Default</button></span><input type="range" min="0" max="2" step="0.01" [value]="generationSettings().repeat_penalty ?? 1" [disabled]="!canEditGeneration()" (change)="setGeneration('repeat_penalty', $event)" aria-label="Repeat penalty"></label><label class="generation-control"><span>Max tokens</span><input type="number" min="0" max="1000000" step="1" placeholder="Auto" [value]="generationSettings().max_tokens ?? ''" [disabled]="!canEditGeneration()" (change)="setGeneration('max_tokens', $event)" aria-label="Maximum output tokens"></label></div>
            @if (generationError()) {<p class="generation-error" role="alert">{{ generationError() }}</p>}
          </section>
          <section class="inspector-section knowledge-control" aria-label="Local knowledge retrieval">
            <div class="inspector-heading"><span>LOCAL KNOWLEDGE</span><span>{{ savingKnowledge() ? 'SAVING' : knowledgeEnabled() ? 'ON' : 'OFF' }}</span></div>
            <label title="Search indexed local documents with lexical full-text search and add bounded passages to this chat. No embeddings or cloud requests are used.">
              <input type="checkbox" [checked]="knowledgeEnabled()" [disabled]="!canEditKnowledge()" (change)="setKnowledgeEnabled($event)" aria-label="Use local Knowledge in this chat">
              <span>Use local Knowledge</span>
            </label>
            <small>Local full-text retrieval · no embeddings</small>
            @if (knowledgeError()) {<p class="generation-error" role="alert">{{ knowledgeError() }}</p>}
          </section>
          <section class="inspector-section"><div class="inspector-heading"><span>THREAD</span></div><dl class="session-facts"><div><dt>Messages</dt><dd>{{ messages().length }}</dd></div><div><dt>Storage</dt><dd>On device</dd></div><div><dt>Generation</dt><dd>{{ streaming() ? 'Streaming' : 'Ready' }}</dd></div></dl></section>
          <div class="inspector-note">No cloud egress<br><span>Conversation data stays local.</span></div>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .chat-attachments { display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:5px 8px;border-bottom:1px solid #303744; }
    .attachment-picker { display:inline-flex;align-items:center;border:1px solid #3b485c;border-radius:4px;background:#171f2b;color:#c1d2ee;padding:5px 8px;font:9px ui-monospace,monospace;cursor:pointer; }
    .attachment-help { color:#8794a8;font-size:9px; }
    .attachment-uploading { color:#d6bf7d;font-size:9px; }
    .chat-attachment-card { display:grid;grid-template-columns:minmax(125px,.7fr) minmax(200px,1.5fr) auto;align-items:center;gap:10px;width:100%;padding:8px;border:1px solid #354153;border-radius:4px;background:#101722; }
    .attachment-file { display:grid;grid-template-columns:auto 1fr;align-items:center;gap:2px 6px;min-width:0; }
    .attachment-file b { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d0d8e5;font-size:9px; }
    .attachment-kind { grid-row:span 2;color:#a6bee9;font:8px ui-monospace,monospace;text-transform:uppercase; }
    .attachment-file small { color:#8490a1;font-size:8px; }
    .attachment-suggestions { display:grid;gap:4px; }
    .skill-suggestion { display:grid;grid-template-columns:minmax(105px,.55fr) 1fr;gap:7px;padding-top:4px;border-top:1px solid #2b3441; }
    .skill-suggestion>span { display:grid;gap:2px;color:#cbd6e8;font-size:9px; }
    .skill-suggestion small { color:#ffb4ab;font:7px ui-monospace,monospace; }
    .skill-suggestion small.suggestion-ready { color:#87d5a7; }
    .skill-suggestion small.suggestion-unknown { color:#e4c699; }
    .skill-suggestion p { margin:0;color:#96a2b3;font-size:8px;line-height:1.35; }
    .browse-skills { color:#9db7e8;font-size:8px;text-decoration:none; }
    .attachment-reupload-note { color:#8490a2;font-size:8px; }
    .attachment-route-button { justify-self:start;border:1px solid #365341;border-radius:3px;background:#17251e;color:#a8e0bb;padding:4px 6px;font:8px ui-monospace,monospace;cursor:pointer; }
    .attachment-route-limit { color:#d3b47e;font-size:8px; }
    .browse-skills:hover { text-decoration:underline; }
    .remove-attachment { border:1px solid #614342;border-radius:3px;background:#2a2022;color:#e2b3ac;padding:4px 6px;font-size:8px;cursor:pointer; }
    .remove-attachment:disabled { opacity:.5;cursor:not-allowed; }
    .attachment-error { width:100%;color:#ffaaa2;font-size:9px; }
    .profile-picker select { min-width:150px;max-width:220px; }
    .orchestration-strip { display:grid;grid-template-columns:minmax(130px,auto) 1fr auto;align-items:center;gap:9px;padding:8px 10px;margin:0 0 8px;border-bottom:1px solid #303744;background:#111823;color:#9aa8bc;font-size:10px; }
    .orchestration-strip-heading { display:flex;align-items:center;gap:10px; }
    .execution-mode { display:flex;gap:3px;padding:2px;border:1px solid #343e4f;border-radius:5px;background:#10151e; }
    .execution-mode button,.plan-preview-button { border:1px solid transparent;border-radius:4px;background:transparent;color:#92a0b5;padding:4px 7px;font:9px ui-monospace,monospace;cursor:pointer; }
    .execution-mode button.active { border-color:#455b7d;background:#202d40;color:#d3e2ff; }
    .execution-mode button:disabled,.plan-preview-button:disabled { opacity:.5;cursor:not-allowed; }
    .orchestration-route { display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere;font:9px ui-monospace,monospace;color:#c0cada; }
    .route-ready { flex:none;color:#83d8b0; }
    .run-state { color:#a9c5ff;text-transform:uppercase; }
    .orchestration-error { grid-column:2 / 4;color:#ffaaa2;font-size:10px; }
    .plan-notice { grid-column:1 / -1;color:#d4bf91;font-size:9px; }
    .plan-preview-button { justify-self:end;border-color:#3d4e68;background:#1c293b;color:#cbdcff; }
    .chat-plan-inspector { grid-column:1 / -1;display:grid;gap:7px;max-height:260px;overflow:auto;padding:8px;border:1px solid #35445a;border-radius:4px;background:#0d131d; }
    .chat-plan-inspector>header { display:flex;justify-content:space-between;align-items:center;gap:9px;padding-bottom:6px;border-bottom:1px solid #2a3443; }
    .chat-plan-inspector>header div { display:grid;gap:3px; }.chat-plan-inspector>header b { color:#d5dfee;font-size:10px; }.chat-plan-inspector>header small,.chat-plan-inspector>header span { color:#8e9bb0;font:8px ui-monospace,monospace; }
    .plan-node { display:grid;gap:6px;padding:7px;border:1px solid #2e3949;border-radius:3px;background:#111924; }
    .plan-node-heading { display:flex;justify-content:space-between;color:#cbd6e8;font:9px ui-monospace,monospace; }.plan-node-heading span { color:#88d6aa;font-size:7px; }
    .plan-node dl { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin:0; }
    .plan-node dl>div { display:grid;grid-template-columns:62px minmax(0,1fr);gap:5px;min-width:0; }.plan-node dt { color:#8290a4;font:8px ui-monospace,monospace;text-transform:uppercase; }.plan-node dd { margin:0;color:#bdc9dc;font:8px ui-monospace,monospace;overflow-wrap:anywhere; }
    .route-why { margin:0;color:#b5c4dc;font-size:8px;line-height:1.45; }.route-why b { color:#e1d0ad; }
    .plan-alternatives { display:grid;gap:4px;padding-top:5px;border-top:1px solid #2a3443; }.plan-alternatives>span,.no-alternatives { color:#8492a7;font:7px ui-monospace,monospace; }
    .plan-alternatives>div { display:flex;align-items:center;gap:7px;flex-wrap:wrap; }.plan-alternatives button { border:1px solid #394a63;border-radius:3px;background:#192435;color:#bed0ef;padding:4px 6px;font:8px ui-monospace,monospace;cursor:pointer; }.plan-alternatives button:disabled { opacity:.5;cursor:not-allowed; }.plan-alternatives small { color:#8f9cb0;font-size:8px; }
    .message-run-link { border:1px solid #34435a;border-radius:3px;padding:2px 5px;color:#9db7e8;font:8px ui-monospace,monospace; }
    .message-canvas-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.message-canvas-actions button{padding:4px 7px;border:1px solid #394a63;border-radius:3px;background:#182334;color:#bdd1f1;font:8px ui-monospace,monospace;cursor:pointer}.message-canvas-actions button:hover{border-color:#8caddd;color:#e0ebfc}
    @media(max-width:700px) { .orchestration-strip { grid-template-columns:1fr auto; }.orchestration-route { grid-column:1 / 3;grid-row:2; }.orchestration-error,.plan-notice { grid-column:1 / 3; }.chat-attachment-card { grid-template-columns:1fr auto; }.attachment-suggestions { grid-column:1 / 3;grid-row:2; }.remove-attachment { grid-column:2;grid-row:1; }.plan-node dl { grid-template-columns:1fr; } }
    .generation-control>span button{padding:0;border:0;background:none;color:#a0caff;font:inherit;text-decoration:underline;cursor:pointer}
    .generation-control>span button:disabled{opacity:.5;cursor:wait}
    .knowledge-control label{display:flex;align-items:center;gap:7px;margin-top:9px;color:#c2c6d6;font-size:11px;cursor:pointer}
    .knowledge-control input{accent-color:#adc6ff}
    .knowledge-control input:disabled{cursor:wait}
    .knowledge-control small{display:block;margin:6px 0 0 21px;color:#8491a6;font:9px ui-monospace,monospace}
  `]
})
export class ChatPage implements OnInit {
  readonly selectionModeService = inject(SelectionModeService);
  readonly providerConnections = inject(ProviderConnectionsService);
  private readonly artifactService = inject(ArtifactService);
  private readonly canvasWorkspace = inject(CanvasWorkspaceService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly skillService = inject(SkillService);
  readonly chats = signal<ChatSummary[]>([]);
  readonly models = signal<Model[]>([]);
  readonly profiles = signal<ChatProfile[]>([]);
  readonly selectedProfileId = signal('');
  readonly profilesLoading = signal(false);
  readonly chatExecutionMode = signal<'orchestrated'|'legacy'>('orchestrated');
  readonly orchestrationPlan = signal<any>(null);
  readonly approvedGuidedPlanKey = signal('');
  readonly selectedPlanOverride = signal<{ capabilityId: string; modelId: string; profileId?: string } | null>(null);
  readonly selectedPlanOverrideKey = signal('');
  readonly planInspectorOpen = signal(false);
  readonly orchestrationError = signal('');
  readonly planNotice = signal('');
  readonly planningChat = signal(false);
  readonly chatRunId = signal('');
  readonly chatRunState = signal('');
  readonly chatRunCurrentNodes = signal<string[]>([]);
  readonly chatAttachments = signal<ChatAttachment[]>([]);
  readonly skills = signal<SkillCatalogItem[]>([]);
  readonly uploadingAttachments = signal(false);
  readonly attachmentError = signal('');
  readonly attachmentAccept = '.png,.jpg,.jpeg,.webp,.wav,.mp3,.ogg,.oga,.webm,.flac,.m4a,.pdf,.txt,.md,.markdown,.csv';
  readonly maxAttachmentBytes = MAX_ARTIFACT_UPLOAD_BYTES;
  readonly runtimeStatus = signal<RuntimeStatus | null>(null);
  readonly generationSettings = signal<ChatGeneration>({ temperature: 0.7, top_p: null, top_k: null, min_p: null, repeat_penalty: null, max_tokens: null });
  readonly generationLoading = signal(false);
  readonly savingGeneration = signal(false);
  readonly generationError = signal('');
  readonly knowledgeEnabled = signal(false);
  readonly savingKnowledge = signal(false);
  readonly knowledgeError = signal('');
  readonly messages = signal<TranscriptMessage[]>([]);
  readonly selectedChatId = signal('');
  readonly selectedModelId = signal('');
  readonly prompt = signal('');
  readonly streamText = signal('');
  readonly streaming = signal(false);
  readonly sending = signal(false);
  readonly chatsLoading = signal(false);
  readonly transcriptLoading = signal(false);
  readonly creatingChat = signal(false);
  readonly mutatingChat = signal(false);
  readonly modelsLoading = signal(false);
  readonly turnError = signal('');
  readonly lastIncidentId = signal('');
  readonly diagnosticSaved = signal(false);
  readonly apiError = signal('');
  readonly copiedKey = signal('');
  readonly canvasOpen = signal(false);
  readonly threadFilter = signal('');
  visibleChats = () => this.chats().filter(chat => (chat.title || 'New chat').toLowerCase().includes(this.threadFilter().toLowerCase()));
  activeChatTitle = () => this.chats().find(chat => chat.id === this.selectedChatId())?.title || (this.selectedChatId() ? 'New chat' : 'No conversation selected');
  diagnosticsHref = () => `/logs?view=diagnostics&incident=${encodeURIComponent(this.lastIncidentId())}`;
  selectedModel = () => this.models().find(model => model.id === this.selectedModelId()) ?? null;
  canEditGeneration = () => this.api.connected() && !!this.selectedChatId() && !this.busy() && !this.savingGeneration() && !this.generationLoading();
  canEditKnowledge = () => this.api.connected() && !!this.selectedChatId() && !this.busy() && !this.savingKnowledge() && !this.generationLoading();
  latestCodeArtifact = (): CodeArtifact | null => {
    if (this.streamText()) {
      const matches = [...this.streamText().matchAll(/(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:\n\2(?=\n|$)|$)/g)];
      if (matches.length) {
        const match = matches[matches.length - 1];
        return { language: (match[3] || '').trim(), content: match[4].replace(/\n$/, ''), messageKey: 'streaming' };
      }
    }
    for (let index = this.messages().length - 1; index >= 0; index--) {
      const message = this.messages()[index];
      if (message.role !== 'assistant') continue;
      const matches = [...message.content.matchAll(/(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g)];
      if (matches.length) {
        const match = matches[matches.length - 1];
        return { language: (match[3] || '').trim(), content: match[4].replace(/\n$/, ''), messageKey: message.key };
      }
    }
    return null;
  };
  private selectionVersion = 0;
  private modelSelectionTouched = false;
  private requestedModelId = '';
  private requestedProfileId = '';
  private generationLoadVersion = 0;
  private aborter: AbortController | null = null;
  private streamCompleted = false;
  private serverDiagnosticReceived = false;
  private readonly scrollAnchor = viewChild<ElementRef<HTMLElement>>('scrollAnchor');

  constructor(readonly api: ApiService) {
    this.requestedModelId = this.route.snapshot.queryParamMap.get('model_id') || '';
    this.requestedProfileId = this.route.snapshot.queryParamMap.get('profile_id') || '';
    effect(() => { this.streaming(); this.messages(); this.scrollAnchor()?.nativeElement.scrollIntoView({ block: 'end' }); });
    effect(() => {
      const messages = this.messages();
      const chatId = this.selectedChatId() || 'draft';
      untracked(() => {
        for (const message of messages) {
          if (message.role !== 'assistant') continue;
          const markdownId = `chat:${message.key}:markdown`;
          this.canvasWorkspace.registerText(markdownId, 'Assistant response.md', 'markdown', message.content, 'chat', chatId);
          for (const artifact of this.messageCanvasArtifacts(message)) {
            this.canvasWorkspace.registerText(artifact.id, artifact.label, artifact.kind,
              artifact.content, 'chat', chatId);
          }
        }
      });
    });
  }

  messageCanvasArtifacts(message: TranscriptMessage): MessageCanvasArtifact[] {
    if (message.role === 'user') return [];
    const pattern = /(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;
    const artifacts: MessageCanvasArtifact[] = [];
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = pattern.exec(message.content)) !== null) {
      const language = (match[3] || '').trim().toLowerCase();
      const kind: MessageCanvasArtifact['kind'] = ['html', 'htm'].includes(language) ? 'html'
        : ['json', 'jsonc'].includes(language) ? 'json'
        : ['md', 'markdown'].includes(language) ? 'markdown' : 'code';
      artifacts.push({ id: `chat:${message.key}:code:${index}`, label: language || 'Code', kind,
        content: match[4].replace(/\n$/, '') });
      index++;
    }
    return artifacts;
  }

  openMessageInCanvas(message: TranscriptMessage): void {
    const chatId = this.selectedChatId() || 'draft';
    this.canvasWorkspace.openText(`chat:${message.key}:markdown`, 'Assistant response.md', 'markdown',
      message.content, 'chat', chatId);
    void this.router.navigate(['/canvas']);
  }

  openCodeInCanvas(artifact: MessageCanvasArtifact): void {
    const chatId = this.selectedChatId() || 'draft';
    this.canvasWorkspace.openText(artifact.id, artifact.label, artifact.kind, artifact.content, 'chat', chatId);
    void this.router.navigate(['/canvas']);
  }

  toggleCanvas(): void { this.canvasOpen.update(open => !open); }

  messageDisplayContent(message: TranscriptMessage): string {
    const artifact = this.latestCodeArtifact();
    if (!artifact || artifact.messageKey !== message.key) return message.content;
    const codeFence = /(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;
    return message.content.replace(codeFence, (_block, prefix: string, _fence: string, language: string) => `${prefix}[${(language || 'Code').trim() || 'Code'} block is available to open in Canvas]`);
  }

  ngOnInit(): void { void this.initialize(); }

  async initialize(): Promise<void> {
    this.apiError.set('');
    await this.api.check();
    if (!this.api.connected()) { this.apiError.set(this.api.error() || 'The local API did not respond.'); return; }
    this.loadModels();
    this.loadChats(this.route.snapshot.queryParamMap.get('chat_id') || undefined);
    this.loadRuntimeStatus();
    void this.loadSkills();
  }

  private async loadSkills(): Promise<void> {
    try { this.skills.set(await this.skillService.list()); }
    catch { this.skills.set([]); }
  }

  async selectChatAttachments(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    if (files.length + this.chatAttachments().length > 4) {
      this.attachmentError.set('A chat draft can stage up to four attachments. Remove one before adding more.');
      return;
    }
    this.attachmentError.set('');
    this.uploadingAttachments.set(true);
    try {
      for (const file of files) {
        const kind = attachmentKind(file);
        if (!kind) throw new Error(`Unsupported attachment format: ${file.name}`);
        if (file.size > this.maxAttachmentBytes) throw new Error(`${file.name} exceeds the 32 MiB upload limit.`);
        const artifact = await this.artifactService.upload(file, kind);
        this.chatAttachments.update(items => [...items, { artifact, suggestedSkillIds: suggestedSkillIds(kind) }]);
      }
    } catch (error) {
      this.attachmentError.set(error instanceof Error ? error.message : 'Could not upload the selected attachment.');
    } finally { this.uploadingAttachments.set(false); }
  }

  suggestedSkills(item: ChatAttachment): SkillCatalogItem[] {
    const byId = new Map(this.skills().map(skill => [skill.id, skill]));
    return item.suggestedSkillIds.map(id => byId.get(id)).filter((skill): skill is SkillCatalogItem => !!skill);
  }

  supportsAttachmentSkill(item: ChatAttachment, skill: SkillCatalogItem): boolean {
    return skill.inputs.some(input => input.artifact === item.artifact.kind);
  }

  openAttachmentSkill(item: ChatAttachment, skill: SkillCatalogItem): void {
    if (!this.supportsAttachmentSkill(item, skill)) return;
    void this.router.navigate(['/skills'], { queryParams: { skill: skill.id, artifact: item.artifact.id } });
  }

  async removeChatAttachment(item: ChatAttachment): Promise<void> {
    this.attachmentError.set('');
    try {
      await this.artifactService.delete(item.artifact.id);
      this.chatAttachments.update(items => items.filter(candidate => candidate.artifact.id !== item.artifact.id));
    } catch (error) {
      this.attachmentError.set(error instanceof Error ? error.message : 'Could not remove the staged attachment.');
    }
  }

  formatBytes(value: number): string {
    if (!Number.isFinite(value) || value < 0) return 'size unknown';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }

  retry(): void { void this.initialize(); }
  reload(): void { this.apiError.set(''); this.loadModels(); this.loadChats(); this.loadRuntimeStatus(); }

  loadRuntimeStatus(): void {
    this.api.get<unknown>('/api/runtime/status').subscribe({
      next: response => {
        const data = unwrap(response) as any;
        const status = data?.status ?? data;
        this.runtimeStatus.set(status && typeof status === 'object' ? status as RuntimeStatus : null);
        this.selectLoadedModelWhenUntouched();
      },
      error: () => this.runtimeStatus.set(null)
    });
  }

  loadModels(): void {
    this.modelsLoading.set(true);
    this.api.get<unknown>('/api/models').subscribe({
      next: (response) => {
        const data = unwrap(response) as any;
        const models = Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
        this.models.set(models.filter((model: any) => typeof model?.id === 'string' && model.id.length > 0));
        if (this.requestedModelId && this.models().some(model => model.id === this.requestedModelId)) {
          this.modelSelectionTouched = true;
          this.selectedModelId.set(this.requestedModelId);
        } else {
          this.selectLoadedModelWhenUntouched();
        }
        if (!this.selectedModelId() && this.models().length) this.selectedModelId.set(this.models()[0].id);
        if (this.selectedModelId()) this.loadProfiles(this.selectedModelId());
        this.modelsLoading.set(false);
      },
      error: (error) => { this.modelsLoading.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not load local models.'); }
    });
  }

  selectModel(modelId: string): void {
    this.modelSelectionTouched = true;
    this.selectedPlanOverride.set(null);
    this.selectedPlanOverrideKey.set('');
    this.selectedModelId.set(modelId);
    this.selectedProfileId.set('');
    this.orchestrationPlan.set(null);
    this.approvedGuidedPlanKey.set('');
    this.planInspectorOpen.set(false);
    this.planNotice.set('');
    this.loadProfiles(modelId);
  }

  replacePlanRoute(route: any): void {
    if (!route || typeof route.model_id !== 'string' || !route.model_id || this.busy()) return;
    this.modelSelectionTouched = true;
    this.selectedModelId.set(route.model_id);
    this.profiles.set([]);
    this.selectedProfileId.set(typeof route.profile_id === 'string' ? route.profile_id : '');
    this.selectedPlanOverride.set(typeof route.capability_id === 'string'
      ? { capabilityId: route.capability_id, modelId: route.model_id,
          ...(typeof route.profile_id === 'string' ? { profileId: route.profile_id } : {}) }
      : null);
    this.loadProfiles(route.model_id);
    this.selectedPlanOverrideKey.set(this.guidedPlanKey());
    this.orchestrationPlan.set(null);
    this.approvedGuidedPlanKey.set('');
    this.planInspectorOpen.set(false);
    this.orchestrationError.set('');
    this.planNotice.set('Alternative selected for this turn. The next plan will pin this model and profile.');
  }

  setChatExecutionMode(mode: 'orchestrated'|'legacy'): void {
    this.chatExecutionMode.set(mode);
    this.selectedPlanOverride.set(null);
    this.selectedPlanOverrideKey.set('');
    this.orchestrationError.set('');
    this.planNotice.set('');
    this.orchestrationPlan.set(null);
    this.approvedGuidedPlanKey.set('');
    this.planInspectorOpen.set(false);
  }

  private guidedPlanKey(text = this.prompt().trim()): string {
    return JSON.stringify([this.selectionModeService.mode(), text, this.selectedModelId(), this.selectedProfileId(), this.selectedChatId()]);
  }

  guidedPlanCurrent(): boolean {
    return /^[a-f0-9]{24}$/.test(this.orchestrationPlan()?.plan_id || '') && !!this.approvedGuidedPlanKey()
      && this.approvedGuidedPlanKey() === this.guidedPlanKey();
  }

  private loadProfiles(modelId: string): void {
    this.profilesLoading.set(true);
    this.api.get<unknown>(`/api/model-profiles?model_id=${encodeURIComponent(modelId)}`).subscribe({
      next: value => {
        const data = unwrap(value) as any;
        const profiles = Array.isArray(data?.profiles) ? data.profiles.filter((p: any) => p?.model_id === modelId && typeof p.id === 'string') : [];
        this.profiles.set(profiles);
        if (modelId === this.requestedModelId && this.requestedProfileId && profiles.some((profile: ChatProfile) => profile.id === this.requestedProfileId)) {
          this.selectedProfileId.set(this.requestedProfileId);
        }
        this.profilesLoading.set(false);
      },
      error: () => { this.profiles.set([]); this.profilesLoading.set(false); }
    });
  }

  orchestrationRouteLabel(): string {
    const plan = this.orchestrationPlan();
    const selected = plan?.nodes?.find((node: any) => node?.capability_id === 'text.chat')?.selected;
    if (!selected) return 'Plan resolved';
    const profile = this.profiles().find(item => item.id === selected.profile_id);
    return `${selected.model_id}${profile ? ` · ${profile.name}` : ''} · ${selected.runtime_id}`;
  }

  togglePlanInspector(): void { this.planInspectorOpen.update(open => !open); }

  orchestrationNodes(): any[] {
    const nodes = this.orchestrationPlan()?.nodes;
    return Array.isArray(nodes) ? nodes.filter((node: any) => !!node && typeof node === 'object') : [];
  }

  selectedRouteWhy(node: any): any | null {
    const rows = Array.isArray(node?.why) ? node.why : [];
    return rows.find((row: any) => row?.route_id === node?.selected?.id && row?.selected === true) ?? null;
  }

  planNodeComponent(node: any): string {
    const selected = node?.selected;
    if (typeof selected?.component_id === 'string' && selected.component_id) return selected.component_id;
    if (typeof selected?.component?.id === 'string' && selected.component.id) return selected.component.id;
    return typeof selected?.model_id === 'string' && selected.model_id ? selected.model_id : 'Not reported by plan';
  }

  planNodeRoute(node: any): string {
    const id = node?.selected?.id;
    return typeof id === 'string' && id ? id : 'Not reported by plan';
  }

  planNodeProfile(node: any): string {
    const id = node?.selected?.profile_id;
    return typeof id === 'string' && id ? this.profileNameFor(id) : 'Not reported by plan';
  }

  planNodeRuntime(node: any): string {
    const id = node?.selected?.runtime_id;
    return typeof id === 'string' && id ? id : 'Not reported by plan';
  }

  planNodeIo(node: any, plan: any): string {
    const nodeInputs = this.planTypeEvidence(node?.input_types);
    const workflowInputs = this.planTypeEvidence(plan?.input_kinds);
    const inputs = nodeInputs || (workflowInputs ? `Workflow inputs: ${workflowInputs}` : 'Inputs not reported by plan');
    const outputs = this.planTypeEvidence(node?.output_types) || 'Outputs not reported by plan';
    return `${inputs} · ${outputs}`;
  }

  planNodeStatus(node: any): string {
    const reported = typeof node?.status === 'string' ? node.status : typeof node?.state === 'string' ? node.state : '';
    if (reported) return reported;
    return this.chatRunState() ? `Run ${this.chatRunState()} · node status not reported` : 'Plan resolved · run not started';
  }

  planNodeTiming(node: any): string {
    const value = node?.timing ?? node?.duration_ms ?? node?.elapsed_ms;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return `${value} ms (reported)`;
    if (value && typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
    return 'Not reported by plan';
  }

  planNodeResources(node: any): string {
    const selected = node?.selected;
    const evidence: string[] = [];
    if (typeof selected?.estimated_vram_bytes === 'number' && Number.isFinite(selected.estimated_vram_bytes) && selected.estimated_vram_bytes >= 0) {
      evidence.push(`Estimated VRAM ${this.formatResourceBytes(selected.estimated_vram_bytes)}`);
    }
    if (typeof selected?.available_vram_bytes === 'number' && Number.isFinite(selected.available_vram_bytes) && selected.available_vram_bytes >= 0) {
      evidence.push(`Available at planning ${this.formatResourceBytes(selected.available_vram_bytes)}`);
    }
    if (typeof selected?.estimated_ram_bytes === 'number' && Number.isFinite(selected.estimated_ram_bytes) && selected.estimated_ram_bytes >= 0) {
      evidence.push(`Estimated RAM ${this.formatResourceBytes(selected.estimated_ram_bytes)}`);
    }
    if (typeof selected?.available_ram_bytes === 'number' && Number.isFinite(selected.available_ram_bytes) && selected.available_ram_bytes >= 0) {
      evidence.push(`Available RAM at planning ${this.formatResourceBytes(selected.available_ram_bytes)}`);
    }
    return evidence.join(' · ') || 'No estimate or observation reported';
  }

  private planTypeEvidence(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => this.planTypeEvidence(item)).filter(Boolean).join(', ');
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    if (typeof record['kind'] === 'string') {
      const mediaTypes = Array.isArray(record['media_types'])
        ? record['media_types'].filter((item): item is string => typeof item === 'string')
        : [];
      return `${record['kind']}${mediaTypes.length ? ` (${mediaTypes.join(', ')})` : ''}`;
    }
    return Object.entries(record).map(([name, type]) => {
      const evidence = this.planTypeEvidence(type);
      return evidence ? `${name}: ${evidence}` : '';
    }).filter(Boolean).join(', ');
  }

  private formatResourceBytes(value: number): string {
    const gib = value / (1024 ** 3);
    return `${gib.toFixed(2)} GiB`;
  }

  alternativeReason(node: any, routeId: string): string {
    const rows = Array.isArray(node?.why) ? node.why : [];
    const row = rows.find((item: any) => item?.route_id === routeId);
    if (!row) return 'No route explanation reported.';
    if (row.eligible) return row.reasons?.join(', ') || 'Compatible alternative.';
    return row.reasons?.join(', ') || 'Not eligible for this plan.';
  }

  profileNameFor(profileId?: string | null): string {
    if (!profileId) return 'Automatic profile';
    return this.profiles().find(profile => profile.id === profileId)?.name || profileId;
  }

  activeLoadedModel(): Model | null {
    const status = this.runtimeStatus();
    const loadedPath = status?.loaded ? status.model : '';
    return typeof loadedPath === 'string'
      ? this.models().find(model => this.sameModelPath(model.path, loadedPath)) ?? null
      : null;
  }

  private selectLoadedModelWhenUntouched(): void {
    if (this.modelSelectionTouched) return;
    const loaded = this.activeLoadedModel();
    if (loaded) this.selectedModelId.set(loaded.id);
  }

  private sameModelPath(left?: string, right?: string): boolean {
    if (!left || !right) return false;
    const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '');
    return normalize(left) === normalize(right);
  }

  loadChats(preferredId?: string): void {
    this.chatsLoading.set(true);
    this.api.get<unknown>('/api/chats').subscribe({
      next: (response) => {
        const data = unwrap(response) as any;
        const chats = Array.isArray(data) ? data : Array.isArray(data?.chats) ? data.chats : [];
        this.chats.set(chats.filter((chat: any) => typeof chat?.id === 'string'));
        this.chatsLoading.set(false);
        const nextId = preferredId && chats.some((chat: any) => chat.id === preferredId) ? preferredId : this.selectedChatId() && chats.some((chat: any) => chat.id === this.selectedChatId()) ? this.selectedChatId() : chats[0]?.id || '';
        if (nextId !== this.selectedChatId()) this.selectChat(nextId);
        else if (nextId && this.messages().length === 0) this.selectChat(nextId);
      },
      error: (error) => { this.chatsLoading.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not load conversations.'); }
    });
  }

  selectChat(id: string): void {
    const version = ++this.selectionVersion;
    this.orchestrationPlan.set(null);
    this.approvedGuidedPlanKey.set('');
    this.selectedPlanOverride.set(null);
    this.selectedPlanOverrideKey.set('');
    this.canvasOpen.set(false);
    this.generationLoadVersion++;
    this.selectedChatId.set(id);
    this.messages.set([]);
    this.knowledgeEnabled.set(false);
    this.knowledgeError.set('');
    this.generationSettings.set({ temperature: 0.7, top_p: null, top_k: null, min_p: null, repeat_penalty: null, max_tokens: null });
    this.generationLoading.set(!!id);
    this.generationError.set('');
    this.turnError.set('');
    this.transcriptLoading.set(!!id);
    if (!id) return;
    this.api.get<unknown>(`/api/chats/${encodeURIComponent(id)}`).subscribe({
      next: (response) => {
        if (version !== this.selectionVersion) return;
        this.transcriptLoading.set(false);
        const data = unwrap(response) as any;
        const chat = data?.chat || data;
        if (!chat || chat.id !== id || !Array.isArray(chat.messages)) { this.generationLoading.set(false); this.apiError.set('The conversation response has an unexpected shape.'); return; }
        this.messages.set(chat.messages.map((message: any, index: number) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: typeof message.content === 'string' ? message.content : '', created_at: message.created_at, run_id: typeof message.run_id === 'string' ? message.run_id : undefined, key: `${id}:${index}:${message.created_at || ''}` })));
        this.loadChatGeneration(id);
        this.apiError.set('');
      },
      error: (error) => { if (version !== this.selectionVersion) return; this.transcriptLoading.set(false); this.generationLoading.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not load this conversation.'); }
    });
  }

  private loadChatGeneration(id: string): void {
    const version = ++this.generationLoadVersion;
    this.generationLoading.set(true);
    this.api.get<unknown>(`/api/chats/${encodeURIComponent(id)}/settings`).subscribe({
      next: response => {
        if (version !== this.generationLoadVersion || this.selectedChatId() !== id) return;
        const data = unwrap(response) as any;
        const generation = data?.settings?.generation;
        this.knowledgeEnabled.set(data?.settings?.knowledge?.enabled === true);
        if (generation && typeof generation === 'object') this.generationSettings.set({
          temperature: finiteNumber(generation.temperature, 0.7), top_p: finiteNumberOrNull(generation.top_p),
          top_k: integerNumberOrNull(generation.top_k), min_p: finiteNumberOrNull(generation.min_p),
          repeat_penalty: finiteNumberOrNull(generation.repeat_penalty), max_tokens: integerNumberOrNull(generation.max_tokens)
        });
        this.generationError.set('');
        this.generationLoading.set(false);
      },
      error: error => {
        if (version !== this.generationLoadVersion || this.selectedChatId() !== id) return;
        this.generationLoading.set(false);
        this.generationError.set(error?.error?.error || error?.message || 'Could not load generation settings.');
      }
    });
  }

  setGeneration(key: keyof ChatGeneration, event: Event): void {
    if (!this.canEditGeneration()) return;
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim();
    const parsed = raw === '' ? null : Number(raw);
    const value = (key === 'max_tokens' && parsed === 0) ? null : parsed;
    if (value !== null && !Number.isFinite(value)) { this.generationError.set('Enter a valid number.'); return; }
    this.persistGeneration(key, value);
  }

  resetGeneration(key: 'top_p' | 'top_k' | 'min_p' | 'repeat_penalty' | 'max_tokens'): void {
    if (!this.canEditGeneration()) return;
    this.persistGeneration(key, null);
  }

  private persistGeneration(key: keyof ChatGeneration, value: number | null): void {
    const chatId = this.selectedChatId();
    const next = { ...this.generationSettings(), [key]: value } as ChatGeneration;
    this.generationSettings.set(next);
    this.generationError.set('');
    this.savingGeneration.set(true);
    this.api.patch<unknown>(`/api/chats/${encodeURIComponent(chatId)}/settings`, { generation: { [key]: value } }).subscribe({
      next: () => this.savingGeneration.set(false),
      error: error => {
        this.savingGeneration.set(false);
        if (this.selectedChatId() !== chatId) return;
        this.generationError.set(error?.error?.error || error?.message || 'Could not save generation settings.');
        this.loadChatGeneration(chatId);
      }
    });
  }

  setKnowledgeEnabled(event: Event): void {
    if (!this.canEditKnowledge()) return;
    const checkbox = event.target as HTMLInputElement;
    const chatId = this.selectedChatId();
    const previous = this.knowledgeEnabled();
    const enabled = checkbox.checked;
    this.knowledgeEnabled.set(enabled);
    this.knowledgeError.set('');
    this.savingKnowledge.set(true);
    this.api.patch<unknown>(`/api/chats/${encodeURIComponent(chatId)}/settings`, { knowledge: { enabled } }).subscribe({
      next: () => this.savingKnowledge.set(false),
      error: error => {
        this.savingKnowledge.set(false);
        if (this.selectedChatId() !== chatId) return;
        this.knowledgeEnabled.set(previous);
        this.knowledgeError.set(error?.error?.error || error?.message || 'Could not save Knowledge settings.');
      }
    });
  }

  createChat(): void {
    if (this.creatingChat()) return;
    this.creatingChat.set(true);
    this.apiError.set('');
    this.api.post<unknown>('/api/chats', { title: 'New chat' }).subscribe({
      next: (response) => {
        this.creatingChat.set(false);
        const data = unwrap(response) as any;
        const chat = data?.chat || data;
        if (!chat?.id) { this.apiError.set('The server created a conversation but returned no chat ID.'); return; }
        this.selectedChatId.set(chat.id);
        this.messages.set([]);
        this.canvasOpen.set(false);
        this.loadChats(chat.id);
      },
      error: (error) => { this.creatingChat.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not create a conversation.'); }
    });
  }

  renameChat(): void {
    const id = this.selectedChatId();
    const current = this.chats().find(chat => chat.id === id);
    if (!id || this.busy()) return;
    const answer = window.prompt('Enter a name for this conversation:', current?.title || 'New chat');
    if (answer === null) return;
    const title = answer.trim();
    if (!title || title.length > 120) {
      this.apiError.set('Conversation names must contain 1 to 120 characters.');
      return;
    }
    this.mutatingChat.set(true);
    this.apiError.set('');
    this.api.patch<unknown>(`/api/chats/${encodeURIComponent(id)}`, { title }).subscribe({
      next: (response) => {
        this.mutatingChat.set(false);
        const data = unwrap(response) as any;
        const chat = data?.chat || data;
        if (typeof chat?.title !== 'string') { this.apiError.set('The conversation was renamed but the server returned no title.'); return; }
        this.chats.update(chats => chats.map(item => item.id === id ? { ...item, title: chat.title } : item));
      },
      error: (error) => { this.mutatingChat.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not rename this conversation.'); }
    });
  }

  deleteChat(): void {
    const id = this.selectedChatId();
    const current = this.chats().find(chat => chat.id === id);
    if (!id || this.busy()) return;
    if (!window.confirm(`Delete “${current?.title || 'New chat'}”? The saved conversation will be removed. Local files referenced as attachments will not be deleted.`)) return;
    const remaining = this.chats().filter(chat => chat.id !== id);
    this.mutatingChat.set(true);
    this.apiError.set('');
    this.api.delete<unknown>(`/api/chats/${encodeURIComponent(id)}`).subscribe({
      next: () => {
        this.mutatingChat.set(false);
        this.messages.set([]);
        this.selectedChatId.set('');
        this.loadChats(remaining[0]?.id);
      },
      error: (error) => { this.mutatingChat.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not delete this conversation.'); }
    });
  }

  busy(): boolean { return this.streaming() || this.sending() || this.creatingChat() || this.mutatingChat(); }
  canCompose(): boolean { return this.api.connected() && !!this.selectedChatId() && !this.busy(); }
  canSend(): boolean { return this.canCompose() && !!this.selectedModelId() && !!this.prompt().trim() && !this.modelsLoading() && !this.planningChat(); }

  onComposerKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.send(); }
  }

  async send(): Promise<void> {
    const draft = this.prompt();
    const text = draft.trim();
    const chatId = this.selectedChatId();
    const modelId = this.selectedModelId();
    if (!text || !chatId || !modelId || this.busy()) return;
    if (this.chatExecutionMode() === 'orchestrated') {
      const mode = this.selectionModeService.mode();
      if (mode === 'guided') await this.previewChatPlan();
      else await this.sendOrchestrated(text, chatId, modelId);
      return;
    }
    const previousMessages = this.messages();
    const incidentId = crypto.randomUUID().replaceAll('-', '');
    this.lastIncidentId.set('');
    this.diagnosticSaved.set(false);
    this.serverDiagnosticReceived = false;
    this.prompt.set('');
    this.turnError.set('');
    this.streamText.set('');
    this.sending.set(true);
    const temporaryUser: TranscriptMessage = { role: 'user', content: text, key: `pending-user-${Date.now()}` };
    this.messages.update(messages => [...messages, temporaryUser]);
    this.aborter = new AbortController();
    this.streamCompleted = false;
    try {
      const response = await fetch(`${this.api.baseUrl()}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ chat_id: chatId, model_id: modelId, prompt: text }), signal: this.aborter.signal
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      if (!response.body) throw new Error('The local service did not open a streaming response.');
      this.sending.set(false);
      this.streaming.set(true);
      await this.readStream(response.body);
      if (!this.streamCompleted) throw new Error('The local service ended the stream before completing the response.');
      this.streaming.set(false);
      this.aborter = null;
      await this.refreshTranscript(chatId, temporaryUser);
      this.loadRuntimeStatus();
    } catch (error) {
      const canceled = error instanceof DOMException && error.name === 'AbortError';
      this.sending.set(false);
      this.streaming.set(false);
      if (!canceled) this.aborter?.abort();
      this.aborter = null;
      this.prompt.set(draft);
      this.messages.set(previousMessages);
      if (canceled) {
        this.turnError.set('Generation stopped. The server discarded this incomplete turn; your prompt has been restored.');
      } else {
        this.turnError.set(error instanceof Error ? error.message : 'The local model request failed. Your prompt has been restored.');
        if (!this.serverDiagnosticReceived) await this.saveClientDiagnostic(incidentId, error);
      }
      this.streamText.set('');
    }
  }

  private selectionForMode(mode = this.selectionModeService.mode(), modelId = this.selectedModelId(), text = this.prompt().trim()): Record<string, unknown> {
    const selection: Record<string, unknown> = mode === 'manual'
      ? { mode: 'manual', pinned_model_id: modelId }
      : { mode };
    if (mode === 'manual' && this.selectedProfileId()) selection['pinned_profile_id'] = this.selectedProfileId();
    const override = this.selectedPlanOverride();
    if (mode !== 'manual' && override && this.selectedPlanOverrideKey() === this.guidedPlanKey(text)) {
      selection['capability_pins'] = { [override.capabilityId]: {
        model_id: override.modelId,
        ...(override.profileId ? { profile_id: override.profileId } : {}),
      } };
    }
    return selection;
  }

  private async resolveChatPlan(text: string, mode = this.selectionModeService.mode(), modelId = this.selectedModelId()): Promise<any> {
    const selection = this.selectionForMode(mode, modelId, text);
    const request = { inputs: { prompt: { kind: 'text', text } }, selection };
    const response = await firstValueFrom(this.api.post<unknown>('/api/skills/chat.general/plan', request));
    const data = unwrap(response) as any;
    if (!data?.plan || !Array.isArray(data.plan.nodes)) throw new Error('The local API returned an invalid chat plan.');
    if (mode === 'manual') {
      const node = data.plan.nodes.find((item: any) => item?.capability_id === 'text.chat');
      if (!node?.selected || node.selected.model_id !== modelId
        || (this.selectedProfileId() && node.selected.profile_id !== this.selectedProfileId())) {
        throw new Error('The selected model or profile is not compatible with this chat route. Manual mode will not substitute another route.');
      }
    }
    return data.plan;
  }

  async previewChatPlan(): Promise<void> {
    if (this.planningChat() || !this.prompt().trim() || !this.selectedModelId()) return;
    this.planningChat.set(true);
    this.orchestrationError.set('');
    this.planNotice.set('');
    this.orchestrationPlan.set(null);
    try {
      const text = this.prompt().trim();
      const mode = this.selectionModeService.mode();
      const plan = await this.resolveChatPlan(text, mode);
      this.orchestrationPlan.set(plan);
      this.approvedGuidedPlanKey.set(mode === 'guided' ? this.guidedPlanKey(text) : '');
      if (mode === 'guided') this.planInspectorOpen.set(true);
    }
    catch (error) { this.orchestrationError.set(error instanceof Error ? error.message : 'Could not resolve a local chat route.'); }
    finally { this.planningChat.set(false); }
  }

  async confirmGuidedPlan(): Promise<void> {
    if (this.selectionModeService.mode() !== 'guided' || !this.guidedPlanCurrent()) {
      this.planNotice.set('The reviewed plan is out of date. Resolve the current prompt and selections again before running.');
      this.orchestrationPlan.set(null);
      this.approvedGuidedPlanKey.set('');
      return;
    }
    const chatId = this.selectedChatId();
    if (!chatId) return;
    await this.runResolvedChatPlan(this.prompt().trim(), chatId, this.orchestrationPlan(), 'guided');
  }

  private async sendOrchestrated(text: string, chatId: string, modelId: string): Promise<void> {
    const previousMessages = this.messages();
    const draft = this.prompt();
    const temporaryUser: TranscriptMessage = { role: 'user', content: text, key: `pending-user-${Date.now()}` };
    this.prompt.set('');
    this.turnError.set('');
    this.orchestrationError.set('');
    this.chatRunId.set('');
    this.chatRunCurrentNodes.set([]);
    this.chatRunState.set('Planning');
    this.sending.set(true);
    this.planningChat.set(true);
    this.messages.update(messages => [...messages, temporaryUser]);
    try {
      const mode = this.selectionModeService.mode();
      const plan = await this.resolveChatPlan(text, mode, modelId);
      this.orchestrationPlan.set(plan);
      this.planNotice.set('');
      this.planningChat.set(false);
      const selection = this.selectionForMode(mode, modelId, text);
      const response = await firstValueFrom(this.api.post<unknown>('/api/skills/chat.general/run', { chat_id: chatId, inputs: { prompt: { kind: 'text', text } }, selection }));
      const data = unwrap(response) as any;
      const run = data?.run;
      if (!run || typeof run.id !== 'string') throw new Error('The local API did not create a chat run.');
      this.chatRunId.set(run.id);
      this.chatRunState.set(run.state || 'queued');
      this.chatRunCurrentNodes.set(this.currentRunNodes(run.current_nodes));
      this.sending.set(false);
      this.streaming.set(true);
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        const snapshotResponse = await firstValueFrom(this.api.get<unknown>(`/api/runs/${encodeURIComponent(run.id)}`));
        const snapshot = (unwrap(snapshotResponse) as any)?.run;
        if (!snapshot || snapshot.id !== run.id) throw new Error('The local API returned an invalid run status.');
        this.chatRunState.set(snapshot.state);
        this.chatRunCurrentNodes.set(this.currentRunNodes(snapshot.current_nodes));
        if (snapshot.state === 'succeeded') {
          this.streaming.set(false);
          this.aborter = null;
          await this.refreshTranscript(chatId, temporaryUser);
          this.loadRuntimeStatus();
          return;
        }
        if (snapshot.state === 'failed' || snapshot.state === 'cancelled') {
          throw new Error(snapshot.error?.message || `Chat run ${snapshot.state}.`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('The chat run is still active; open Runs to inspect its current state.');
    } catch (error) {
      this.sending.set(false);
      this.streaming.set(false);
      this.planningChat.set(false);
      this.prompt.set(draft);
      this.messages.set(previousMessages);
      const message = error instanceof Error ? error.message : 'The orchestration run failed.';
      this.orchestrationError.set(message);
      this.turnError.set(message);
    }
  }

  private async runResolvedChatPlan(text: string, chatId: string, plan: any, mode: 'guided'): Promise<void> {
    const previousMessages = this.messages();
    const draft = this.prompt();
    const temporaryUser: TranscriptMessage = { role: 'user', content: text, key: `pending-user-${Date.now()}` };
    this.prompt.set('');
    this.turnError.set('');
    this.orchestrationError.set('');
    this.chatRunId.set('');
    this.chatRunCurrentNodes.set([]);
    this.chatRunState.set('Planning');
    this.sending.set(true);
    this.messages.update(messages => [...messages, temporaryUser]);
    try {
      const response = await firstValueFrom(this.api.post<unknown>('/api/skills/chat.general/run', {
        chat_id: chatId, inputs: { prompt: { kind: 'text', text } },
        selection: this.selectionForResolvedPlan(plan, mode, text), expected_plan_id: plan?.plan_id,
      }));
      const run = (unwrap(response) as any)?.run;
      if (!run || typeof run.id !== 'string') throw new Error('The local API did not create a chat run.');
      this.chatRunId.set(run.id);
      this.chatRunState.set(run.state || 'queued');
      this.chatRunCurrentNodes.set(this.currentRunNodes(run.current_nodes));
      this.sending.set(false);
      this.streaming.set(true);
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        const snapshot = (unwrap(await firstValueFrom(this.api.get<unknown>(`/api/runs/${encodeURIComponent(run.id)}`))) as any)?.run;
        if (!snapshot || snapshot.id !== run.id) throw new Error('The local API returned an invalid run status.');
        this.chatRunState.set(snapshot.state);
        this.chatRunCurrentNodes.set(this.currentRunNodes(snapshot.current_nodes));
        if (snapshot.state === 'succeeded') {
          this.streaming.set(false);
          await this.refreshTranscript(chatId, temporaryUser);
          this.loadRuntimeStatus();
          return;
        }
        if (snapshot.state === 'failed' || snapshot.state === 'cancelled') throw new Error(snapshot.error?.message || `Chat run ${snapshot.state}.`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('The chat run is still active; open Runs to inspect its current state.');
    } catch (error) {
      this.sending.set(false);
      this.streaming.set(false);
      this.prompt.set(draft);
      this.messages.set(previousMessages);
      const message = error instanceof Error ? error.message : 'The orchestration run failed.';
      this.orchestrationError.set(message);
      this.turnError.set(message);
    }
  }

  private currentRunNodes(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((node): node is string => typeof node === 'string' && node.trim().length > 0) : [];
  }

  private selectionForResolvedPlan(plan: any, mode: 'guided', text: string): Record<string, unknown> {
    const selection = this.selectionForMode(mode, this.selectedModelId(), text);
    const pins = { ...((selection['capability_pins'] as Record<string, Record<string, string>> | undefined) ?? {}) };
    for (const node of Array.isArray(plan?.nodes) ? plan.nodes : []) {
      if (typeof node?.capability_id !== 'string' || typeof node?.selected?.model_id !== 'string') continue;
      pins[node.capability_id] = {
        model_id: node.selected.model_id,
        ...(typeof node.selected.profile_id === 'string' ? { profile_id: node.selected.profile_id } : {}),
      };
    }
    selection['capability_pins'] = pins;
    return selection;
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary: number;
        while (true) {
          const separator = /\r?\n\r?\n/.exec(buffer);
          if (!separator || separator.index === undefined) break;
          boundary = separator.index;
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + separator[0].length);
          await this.handleEvent(frame);
          if (this.streamCompleted) { await reader.cancel(); return; }
        }
        if (done) break;
      }
      if (buffer.trim()) await this.handleEvent(buffer);
    } finally { reader.releaseLock(); }
  }

  private async handleEvent(frame: string): Promise<void> {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    let event: ChatEvent;
    try { event = JSON.parse(dataLines.join('\n')) as ChatEvent; }
    catch { throw new Error('The local service sent an invalid chat event.'); }
    if (eventName === 'delta') { if (typeof event.text === 'string') this.streamText.update(text => text + event.text); return; }
    if (eventName === 'error' || event.error) {
      if (event.incident_id) {
        this.lastIncidentId.set(event.incident_id);
        this.serverDiagnosticReceived = true;
        this.diagnosticSaved.set(true);
      }
      throw new Error(event.error || event.message || 'The model returned an error.');
    }
    if (eventName === 'complete') {
      this.streamCompleted = true;
      const value = event.assistant ?? event.response;
      const assistant = typeof value === 'string' ? value : value?.content;
      if (typeof assistant === 'string' && !this.streamText()) this.streamText.set(assistant);
    }
  }

  private async saveClientDiagnostic(incidentId: string, error: unknown): Promise<void> {
    this.lastIncidentId.set(incidentId);
    const detail = error instanceof Error ? error.message : 'The browser could not complete the local chat request.';
    try {
      const response = await fetch(`${this.api.baseUrl()}/api/diagnostics`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incidentId, operation: 'chat.client',
          error_type: error instanceof Error ? error.constructor.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) || 'Error' : 'Error',
          detail: detail.slice(0, 500) })
      });
      this.diagnosticSaved.set(response.ok);
    } catch { this.diagnosticSaved.set(false); }
  }

  private async refreshTranscript(chatId: string, fallbackUser: TranscriptMessage): Promise<void> {
    try {
      const response = await fetch(`${this.api.baseUrl()}/api/chats/${encodeURIComponent(chatId)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Transcript refresh failed');
      const data = unwrap(await response.json()) as any;
      const chat = data?.chat || data;
      if (Array.isArray(chat?.messages)) {
        this.messages.set(chat.messages.map((message: any, index: number) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: typeof message.content === 'string' ? message.content : '', created_at: message.created_at, run_id: typeof message.run_id === 'string' ? message.run_id : undefined, key: `${chatId}:${index}:${message.created_at || ''}` })));
      } else {
        this.messages.update(messages => [...messages.filter(item => item.key !== fallbackUser.key), { ...fallbackUser, key: `${chatId}:user:${Date.now()}` }, { role: 'assistant', content: this.streamText(), key: `${chatId}:assistant:${Date.now()}` }]);
      }
      this.turnError.set('');
      this.streamText.set('');
      this.loadChats(chatId);
    } catch {
      // The completion event is authoritative if the follow-up transcript request races the server.
      this.messages.update(messages => [...messages.filter(item => item.key !== fallbackUser.key), { ...fallbackUser, key: `${chatId}:user:${Date.now()}` }, { role: 'assistant', content: this.streamText(), key: `${chatId}:assistant:${Date.now()}` }]);
      this.streamText.set('');
    }
  }

  cancel(): void {
    const runId = this.chatRunId();
    if (runId) { this.chatRunState.set('cancelling'); this.api.post<unknown>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {}).subscribe({ error: () => this.orchestrationError.set('Could not cancel the active orchestration run.') }); }
    else this.aborter?.abort();
  }
  async copyMessage(message: TranscriptMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.content);
      this.copiedKey.set(message.key);
      window.setTimeout(() => { if (this.copiedKey() === message.key) this.copiedKey.set(''); }, 1800);
    } catch { this.turnError.set('Clipboard access is unavailable. Select and copy the response text manually.'); }
  }

  exportTranscript(): void {
    const chat = this.chats().find(item => item.id === this.selectedChatId());
    const title = chat?.title?.trim() || 'AI Dream conversation';
    const body = [`# ${title}`, '', ...this.messages().flatMap(message => [`## ${message.role === 'user' ? 'You' : 'AI Dream'}`, '', message.content, ''])].join('\n');
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  modelLabel(model: Model): string { return model.path?.split(/[\\/]/).pop() || model.id; }
  formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
}

function unwrap(response: any): any { return response && typeof response === 'object' && 'data' in response ? response.data : response; }
function finiteNumber(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function finiteNumberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function integerNumberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isInteger(value) ? value : null; }
function safeFilename(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'conversation'; }
function attachmentKind(file: File): UploadArtifactKind | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'image';
  if (['wav', 'mp3', 'ogg', 'oga', 'webm', 'flac', 'm4a'].includes(extension)) return 'audio';
  if (['pdf', 'txt', 'md', 'markdown', 'csv'].includes(extension)) return 'document';
  return null;
}
function suggestedSkillIds(kind: UploadArtifactKind): string[] {
  if (kind === 'image') return ['image.describe', 'image.edit-from-instruction'];
  if (kind === 'audio') return ['voice.transcribe', 'voice.conversation'];
  return ['document.summarize', 'document.answer-with-rag', 'document.extract-text'];
}
async function responseMessage(response: Response): Promise<string> {
  try { const body = await response.json(); return body?.error || body?.message || `Local API returned HTTP ${response.status}`; }
  catch { return `Local API returned HTTP ${response.status}`; }
}
