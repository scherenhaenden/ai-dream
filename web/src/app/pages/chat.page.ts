import { ChangeDetectionStrategy, Component, ElementRef, OnInit, effect, signal, viewChild } from '@angular/core';
import { ApiService } from '../core/api.service';

type Model = { id: string; path?: string; format?: string };
type ChatSummary = { id: string; title?: string; created_at?: string; updated_at?: string };
type TranscriptMessage = { role: string; content: string; created_at?: string; key: string };
type ChatEvent = { text?: string; chat_id?: string; assistant?: string | { role?: string; content?: string }; message?: string; error?: string };

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="chat-workspace">
      <header class="chat-toolbar">
        <div class="chat-heading"><span class="chat-heading-icon">◫</span><div><h1>Chat</h1><p>Conversations stay on this device</p></div></div>
        <div class="chat-controls">
          <label class="sr-only" for="chat-session">Conversation</label>
          <select id="chat-session" [value]="selectedChatId()" [disabled]="busy() || chats().length === 0" (change)="selectChat($any($event.target).value)">
            @if (chats().length === 0) { <option value="">{{ chatsLoading() ? 'Loading conversations…' : 'No conversations' }}</option> }
            @for (chat of chats(); track chat.id) { <option [value]="chat.id">{{ chat.title || 'New chat' }}</option> }
          </select>
          <button class="chat-new-button" (click)="createChat()" [disabled]="busy() || !api.connected()" title="Start a new conversation">＋ <span>New chat</span></button>
        </div>
      </header>

      @if (!api.connected()) {
        <div class="chat-notice error-notice" role="alert"><span>!</span><div><b>Local API unavailable</b><p>Start the AI Dream service or check its address in Settings, then retry.</p></div><button (click)="retry()" [disabled]="busy()">Retry</button></div>
      } @else if (apiError()) {
        <div class="chat-notice error-notice" role="alert"><span>!</span><div><b>Could not load chat data</b><p>{{ apiError() }}</p></div><button (click)="reload()" [disabled]="busy()">Retry</button></div>
      }

      <section class="transcript" #transcript aria-label="Conversation messages">
        @if (messages().length === 0 && !streaming() && !turnError()) {
          <div class="chat-empty"><div class="empty-illustration">◫</div><h2>{{ selectedChatId() ? 'Start this conversation' : 'Your local chat workspace' }}</h2><p>{{ selectedChatId() ? 'Choose a model below and send a message.' : 'Create a conversation to chat with a model installed on this device.' }}</p></div>
        }
        @for (message of messages(); track message.key) {
          <article class="message-row" [class.user-message]="message.role === 'user'" [class.assistant-message]="message.role !== 'user'">
            <div class="message-avatar" [class.user-avatar]="message.role === 'user'">{{ message.role === 'user' ? 'ED' : 'A' }}</div>
            <div class="message-body"><div class="message-author">{{ message.role === 'user' ? 'You' : 'AI Dream' }} @if (message.created_at) {<time>{{ formatTime(message.created_at) }}</time>}</div><div class="message-content">{{ message.content }}</div></div>
          </article>
        }
        @if (streaming()) {
          <article class="message-row assistant-message" aria-label="Assistant response in progress"><div class="message-avatar">A</div><div class="message-body"><div class="message-author">AI Dream <span class="stream-indicator">Generating</span></div><div class="message-content">{{ streamText() }}<span class="stream-cursor" aria-hidden="true"></span></div></div></article>
        }
        @if (turnError()) { <div class="turn-error" role="alert">{{ turnError() }}</div> }
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
          <div class="composer-bottom"><div class="composer-options"><label class="sr-only" for="chat-model">Model</label><select id="chat-model" [value]="selectedModelId()" (change)="selectedModelId.set($any($event.target).value)" [disabled]="modelsLoading() || models().length === 0 || busy()">
            <option value="">{{ modelsLoading() ? 'Loading models…' : models().length ? 'Select a model' : 'No local models' }}</option>@for (model of models(); track model.id) {<option [value]="model.id">{{ modelLabel(model) }}</option>}
          </select><span id="composer-hint">Local inference · model ID is stored with the conversation</span></div>
          @if (busy()) { <button class="cancel-button" (click)="cancel()" [attr.aria-label]="sending() ? 'Cancel request' : 'Stop generation'">{{ sending() ? 'Cancel' : 'Stop' }} <span>■</span></button> }
          @else { <button class="send-button" (click)="send()" [disabled]="!canSend()" [attr.aria-label]="sending() ? 'Sending message' : 'Send message'">{{ sending() ? 'Sending…' : 'Send' }} <span>↗</span></button> }
          </div>
        </div>
        <p class="composer-footnote">Responses can be incorrect. Attachments are not available in this web chat yet.</p>
      </footer>
    </section>
  `
})
export class ChatPage implements OnInit {
  readonly chats = signal<ChatSummary[]>([]);
  readonly models = signal<Model[]>([]);
  readonly messages = signal<TranscriptMessage[]>([]);
  readonly selectedChatId = signal('');
  readonly selectedModelId = signal('');
  readonly prompt = signal('');
  readonly streamText = signal('');
  readonly streaming = signal(false);
  readonly sending = signal(false);
  readonly chatsLoading = signal(false);
  readonly creatingChat = signal(false);
  readonly modelsLoading = signal(false);
  readonly turnError = signal('');
  readonly apiError = signal('');
  private aborter: AbortController | null = null;
  private streamCompleted = false;
  private readonly scrollAnchor = viewChild<ElementRef<HTMLElement>>('scrollAnchor');

  constructor(readonly api: ApiService) { effect(() => { this.messages(); this.streamText(); this.streaming(); this.scrollAnchor()?.nativeElement.scrollIntoView({ block: 'end' }); }); }

  ngOnInit(): void { void this.initialize(); }

  async initialize(): Promise<void> {
    this.apiError.set('');
    await this.api.check();
    if (!this.api.connected()) { this.apiError.set(this.api.error() || 'The local API did not respond.'); return; }
    this.loadModels();
    this.loadChats();
  }

  retry(): void { void this.initialize(); }
  reload(): void { this.apiError.set(''); this.loadModels(); this.loadChats(); }

  loadModels(): void {
    this.modelsLoading.set(true);
    this.api.get<unknown>('/api/models').subscribe({
      next: (response) => {
        const data = unwrap(response) as any;
        const models = Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
        this.models.set(models.filter((model: any) => typeof model?.id === 'string' && model.id.length > 0));
        if (!this.selectedModelId() && this.models().length) this.selectedModelId.set(this.models()[0].id);
        this.modelsLoading.set(false);
      },
      error: (error) => { this.modelsLoading.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not load local models.'); }
    });
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
    this.selectedChatId.set(id);
    this.messages.set([]);
    this.turnError.set('');
    if (!id) return;
    this.api.get<unknown>(`/api/chats/${encodeURIComponent(id)}`).subscribe({
      next: (response) => {
        const data = unwrap(response) as any;
        const chat = data?.chat || data;
        if (!chat || chat.id !== id || !Array.isArray(chat.messages)) { this.apiError.set('The conversation response has an unexpected shape.'); return; }
        this.messages.set(chat.messages.map((message: any, index: number) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: typeof message.content === 'string' ? message.content : '', created_at: message.created_at, key: `${id}:${index}:${message.created_at || ''}` })));
        this.apiError.set('');
      },
      error: (error) => this.apiError.set(error?.error?.error || error?.message || 'Could not load this conversation.')
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
        this.loadChats(chat.id);
      },
      error: (error) => { this.creatingChat.set(false); this.apiError.set(error?.error?.error || error?.message || 'Could not create a conversation.'); }
    });
  }

  busy(): boolean { return this.streaming() || this.sending() || this.creatingChat(); }
  canCompose(): boolean { return this.api.connected() && !!this.selectedChatId() && !this.streaming() && !this.sending(); }
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
    if (eventName === 'error' || event.error) throw new Error(event.error || event.message || 'The model returned an error.');
    if (eventName === 'complete') {
      this.streamCompleted = true;
      const assistant = typeof event.assistant === 'string' ? event.assistant : event.assistant?.content;
      if (typeof assistant === 'string' && !this.streamText()) this.streamText.set(assistant);
    }
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
  modelLabel(model: Model): string { return model.path?.split(/[\\/]/).pop() || model.id; }
  formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
}

function unwrap(response: any): any { return response && typeof response === 'object' && 'data' in response ? response.data : response; }
async function responseMessage(response: Response): Promise<string> {
  try { const body = await response.json(); return body?.error || body?.message || `Local API returned HTTP ${response.status}`; }
  catch { return `Local API returned HTTP ${response.status}`; }
}
