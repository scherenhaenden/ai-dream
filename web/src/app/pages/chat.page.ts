import { ChangeDetectionStrategy, Component, ElementRef, OnInit, effect, signal, viewChild, ViewEncapsulation } from '@angular/core';
import { ApiService } from '../core/api.service';

type Model = { id: string; path?: string; format?: string };
type ChatSummary = { id: string; title?: string; created_at?: string; updated_at?: string };
type TranscriptMessage = { role: string; content: string; created_at?: string; key: string };
type ChatEvent = { text?: string; chat_id?: string; incident_id?: string; assistant?: string | { role?: string; content?: string }; response?: string | { content?: string }; message?: string; error?: string };
type RuntimeStatus = { loaded?: boolean; backend?: string; runtime_id?: string; model?: string; placement?: unknown[] };
type CodeArtifact = { language: string; content: string; messageKey: string };
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
            <option value="" [selected]="!selectedModelId()">{{ modelsLoading() ? 'Loading models…' : models().length ? 'Select a model' : 'No local models' }}</option>@for (model of models(); track model.id) {<option [value]="model.id" [selected]="model.id === selectedModelId()">{{ modelLabel(model) }}{{ activeLoadedModel()?.id === model.id ? ' · LOADED' : '' }}</option>}
          </select></label>
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
          <div class="active-thread-bar"><div><span class="eyebrow">CURRENT THREAD</span><b>{{ activeChatTitle() }}</b></div><div class="thread-actions"><button class="chat-action-button canvas-toggle" (click)="toggleCanvas()" [attr.aria-expanded]="canvasOpen()" title="Show or hide the code canvas">{{ canvasOpen() ? 'Hide Canvas' : 'Canvas' }}@if (latestCodeArtifact()) { · Code}</button>@if (selectedChatId()) {<button class="chat-action-button" (click)="renameChat()" [disabled]="busy()" title="Rename conversation">Rename</button><button class="chat-action-button chat-delete-button" (click)="deleteChat()" [disabled]="busy()" title="Delete conversation">Delete</button>}<button class="chat-action-button" (click)="exportTranscript()" [disabled]="messages().length === 0 || streaming()" title="Export Markdown">Export</button></div></div>
          <section class="transcript" #transcript aria-label="Conversation messages" [attr.aria-busy]="transcriptLoading() || streaming()">
        @if (transcriptLoading()) { <div class="transcript-loading" role="status">Loading conversation…</div> }
        @if (messages().length === 0 && !streaming() && !turnError()) {
          <div class="chat-empty"><div class="empty-illustration">◫</div><h2>{{ selectedChatId() ? 'Start this conversation' : 'Your local chat workspace' }}</h2><p>{{ selectedChatId() ? 'Choose a model below and send a message.' : 'Create a conversation to chat with a model installed on this device.' }}</p></div>
        }
        @for (message of messages(); track message.key) {
          <article class="message-row" [class.user-message]="message.role === 'user'" [class.assistant-message]="message.role !== 'user'">
            <div class="message-avatar" [class.user-avatar]="message.role === 'user'">{{ message.role === 'user' ? 'ED' : 'A' }}</div>
            <div class="message-body"><div class="message-author">{{ message.role === 'user' ? 'You' : 'AI Dream' }} @if (message.created_at) {<time>{{ formatTime(message.created_at) }}</time>} @if (message.role !== 'user') {<button class="message-copy" (click)="copyMessage(message)" [attr.aria-label]="copiedKey() === message.key ? 'Copied response' : 'Copy response'">{{ copiedKey() === message.key ? 'Copied' : 'Copy' }}</button>}</div><div class="message-content">{{ messageDisplayContent(message) }}</div></div>
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
          <label class="sr-only" for="chat-prompt">Message</label>
          <textarea id="chat-prompt" rows="2" placeholder="Message your local model…" [value]="prompt()" (input)="prompt.set($any($event.target).value)" (keydown)="onComposerKey($event)" [disabled]="!canCompose()" [attr.aria-describedby]="'composer-hint'"></textarea>
          <div class="composer-bottom"><div class="composer-options"><span id="composer-hint">Local inference · generation settings are saved per thread</span></div>
          @if (busy()) { <button class="cancel-button" (click)="cancel()" [attr.aria-label]="sending() ? 'Cancel request' : 'Stop generation'">{{ sending() ? 'Cancel' : 'Stop' }} <span>■</span></button> }
          @else { <button class="send-button" (click)="send()" [disabled]="!canSend()" [attr.aria-label]="sending() ? 'Sending message' : 'Send message'">{{ sending() ? 'Sending…' : 'Send' }} <span>↗</span></button> }
          </div>
        </div>
        <p class="composer-footnote">Responses can be incorrect. Attachments are not available in this web chat yet.</p>
          </footer>
        </section>
        @if (canvasOpen()) {<aside class="code-canvas" aria-label="Canvas and code view">
          <div class="canvas-tabs"><span class="canvas-tab active">&lt;/&gt; Canvas / Code View</span><span class="canvas-indicator" [class.present]="latestCodeArtifact()"></span></div>
          @if (latestCodeArtifact(); as artifact) {
            <div class="canvas-filebar"><div><span class="file-symbol">▤</span><b>{{ artifact.language || 'Code artifact' }}</b><span class="artifact-source">from assistant response</span></div><span>{{ artifact.content.split('\n').length }} lines</span></div>
            <div class="code-scroll"><div class="code-source"><ol aria-hidden="true">@for (line of artifact.content.split('\n'); track $index) { <li>{{ $index + 1 }}</li> }</ol><pre><code>{{ artifact.content }}</code></pre></div></div>
            <footer class="canvas-footer"><span>READ ONLY</span><span>Extracted from {{ activeChatTitle() }}</span></footer>
          } @else {
            <div class="canvas-empty"><span class="canvas-empty-icon">&lt;/&gt;</span><b>No code artifact in this thread</b><p>Code blocks in assistant responses will appear here.</p></div>
            <footer class="canvas-footer"><span>CANVAS</span><span>Waiting for a code block</span></footer>
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
            <label class="generation-control"><span>Top P <b>{{ generationSettings().top_p == null ? 'SERVER DEFAULT' : generationSettings().top_p.toFixed(2) }}</b><button type="button" (click)="resetGeneration('top_p')" [disabled]="!canEditGeneration()" title="Omit Top P and use the runtime default">Default</button></span><input type="range" min="0" max="1" step="0.01" [value]="generationSettings().top_p ?? 0.95" [disabled]="!canEditGeneration()" (change)="setGeneration('top_p', $event)" aria-label="Top P"></label>
            <div class="generation-pair"><label class="generation-control"><span>Top K</span><input type="number" min="1" max="2048" step="1" placeholder="Server default" [value]="generationSettings().top_k ?? ''" [disabled]="!canEditGeneration()" (change)="setGeneration('top_k', $event)" aria-label="Top K"></label><label class="generation-control"><span>Min P <b>{{ generationSettings().min_p == null ? 'SERVER DEFAULT' : generationSettings().min_p.toFixed(2) }}</b><button type="button" (click)="resetGeneration('min_p')" [disabled]="!canEditGeneration()" title="Omit Min P and use the runtime default">Default</button></span><input type="range" min="0" max="1" step="0.01" [value]="generationSettings().min_p ?? 0" [disabled]="!canEditGeneration()" (change)="setGeneration('min_p', $event)" aria-label="Min P"></label></div>
            <div class="generation-pair"><label class="generation-control"><span>Repeat penalty <b>{{ generationSettings().repeat_penalty == null ? 'SERVER DEFAULT' : generationSettings().repeat_penalty.toFixed(2) }}</b><button type="button" (click)="resetGeneration('repeat_penalty')" [disabled]="!canEditGeneration()" title="Omit repeat penalty and use the runtime default">Default</button></span><input type="range" min="0" max="2" step="0.01" [value]="generationSettings().repeat_penalty ?? 1" [disabled]="!canEditGeneration()" (change)="setGeneration('repeat_penalty', $event)" aria-label="Repeat penalty"></label><label class="generation-control"><span>Max tokens</span><input type="number" min="0" max="1000000" step="1" placeholder="Auto" [value]="generationSettings().max_tokens ?? ''" [disabled]="!canEditGeneration()" (change)="setGeneration('max_tokens', $event)" aria-label="Maximum output tokens"></label></div>
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
    .generation-control>span button{padding:0;border:0;background:none;color:#a0caff;font:inherit;text-decoration:underline;cursor:pointer}
    .generation-control>span button:disabled{opacity:.5;cursor:wait}
    .knowledge-control label{display:flex;align-items:center;gap:7px;margin-top:9px;color:#c2c6d6;font-size:11px;cursor:pointer}
    .knowledge-control input{accent-color:#adc6ff}
    .knowledge-control input:disabled{cursor:wait}
    .knowledge-control small{display:block;margin:6px 0 0 21px;color:#8491a6;font:9px ui-monospace,monospace}
  `]
})
export class ChatPage implements OnInit {
  readonly chats = signal<ChatSummary[]>([]);
  readonly models = signal<Model[]>([]);
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
  private generationLoadVersion = 0;
  private aborter: AbortController | null = null;
  private streamCompleted = false;
  private serverDiagnosticReceived = false;
  private canvasManuallySet = false;
  private lastCanvasArtifactKey = '';
  private readonly scrollAnchor = viewChild<ElementRef<HTMLElement>>('scrollAnchor');

  constructor(readonly api: ApiService) { effect(() => { const artifact = this.latestCodeArtifact(); this.streaming(); this.messages(); if (artifact && artifact.messageKey !== this.lastCanvasArtifactKey) { this.lastCanvasArtifactKey = artifact.messageKey; if (!this.canvasManuallySet) this.canvasOpen.set(true); } this.scrollAnchor()?.nativeElement.scrollIntoView({ block: 'end' }); }); }

  toggleCanvas(): void { this.canvasManuallySet = true; this.canvasOpen.update(open => !open); }

  messageDisplayContent(message: TranscriptMessage): string {
    const artifact = this.latestCodeArtifact();
    if (!artifact || artifact.messageKey !== message.key) return message.content;
    const codeFence = /(^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;
    return message.content.replace(codeFence, (_block, prefix: string, _fence: string, language: string) => `${prefix}[${(language || 'Code').trim() || 'Code'} block is shown in Canvas]`);
  }

  ngOnInit(): void { void this.initialize(); }

  async initialize(): Promise<void> {
    this.apiError.set('');
    await this.api.check();
    if (!this.api.connected()) { this.apiError.set(this.api.error() || 'The local API did not respond.'); return; }
    this.loadModels();
    this.loadChats();
    this.loadRuntimeStatus();
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
        this.selectLoadedModelWhenUntouched();
        if (!this.selectedModelId() && this.models().length) this.selectedModelId.set(this.models()[0].id);
        this.modelsLoading.set(false);
      },
      error: (error) => { this.modelsLoading.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not load local models.'); }
    });
  }

  selectModel(modelId: string): void {
    this.modelSelectionTouched = true;
    this.selectedModelId.set(modelId);
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
    this.canvasManuallySet = false;
    this.lastCanvasArtifactKey = '';
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
        this.messages.set(chat.messages.map((message: any, index: number) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: typeof message.content === 'string' ? message.content : '', created_at: message.created_at, key: `${id}:${index}:${message.created_at || ''}` })));
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
        this.canvasManuallySet = false;
        this.lastCanvasArtifactKey = '';
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
  canSend(): boolean { return this.canCompose() && !!this.selectedModelId() && !!this.prompt().trim() && !this.modelsLoading(); }

  onComposerKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.send(); }
  }

  async send(): Promise<void> {
    const draft = this.prompt();
    const text = draft.trim();
    const chatId = this.selectedChatId();
    const modelId = this.selectedModelId();
    if (!text || !chatId || !modelId || this.busy()) return;
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
        this.messages.set(chat.messages.map((message: any, index: number) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: typeof message.content === 'string' ? message.content : '', created_at: message.created_at, key: `${chatId}:${index}:${message.created_at || ''}` })));
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

  cancel(): void { this.aborter?.abort(); }
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
async function responseMessage(response: Response): Promise<string> {
  try { const body = await response.json(); return body?.error || body?.message || `Local API returned HTTP ${response.status}`; }
  catch { return `Local API returned HTTP ${response.status}`; }
}
