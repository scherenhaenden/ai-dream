import { ChangeDetectionStrategy, Component, ElementRef, OnInit, effect, signal, viewChild, ViewEncapsulation } from '@angular/core';
import { ApiService } from '../core/api.service';

type AgentAudit = { name: string; status: string; result_snippet: string; duration_ms: number; argument_names: string[] };
type Message = { role: string; content: string; created_at?: string };

@Component({
  selector: 'ai-agent-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="chat-workspace">
      <header class="chat-toolbar">
        <div class="chat-heading"><span class="chat-heading-icon">⚙</span><div><h1>Agent</h1><p>Ask AI Dream to inspect local hardware and runtime</p></div></div>
        <div class="chat-controls">
          <label class="sr-only" for="chat-session">Conversation</label>
          <select id="chat-session" [value]="chatId()" [disabled]="busy() || chats().length === 0" (change)="selectChat($any($event.target).value)">
            @if (chats().length === 0) { <option value="">No conversations</option> }
            @for (chat of chats(); track chat.id) { <option [value]="chat.id">{{ chat.title || 'New chat' }}</option> }
          </select>
          <button class="chat-new-button" (click)="createChat()" [disabled]="busy() || !api.connected()" title="Start a new agent session">＋ <span>New agent</span></button>
        </div>
      </header>

      @if (!api.connected()) {
        <div class="chat-notice error-notice" role="alert"><span>!</span><div><b>Local API unavailable</b><p>Start the AI Dream service or check its address in Settings, then retry.</p></div><button (click)="reload()" [disabled]="busy()">Retry</button></div>
      } @else if (error()) {
        <div class="chat-notice error-notice" role="alert"><span>!</span><div><b>Error</b><p>{{ error() }}</p></div><button (click)="error.set('')">Dismiss</button></div>
      }

      <section class="transcript" #transcript aria-label="Agent messages" [attr.aria-busy]="busy()">
        @if (messages().length === 0 && !busy() && !error()) {
          <div class="chat-empty"><div class="empty-illustration">⚙</div><h2>Your local agent workspace</h2><p>Ask AI Dream to inspect local hardware, installed models, and runtime status. The agent is limited to 4 tools per turn and 45 seconds.</p></div>
        }
        @for (message of messages(); track $index) {
          <article class="message-row" [class.user-message]="message.role === 'user'" [class.assistant-message]="message.role !== 'user'">
            <div class="message-avatar" [class.user-avatar]="message.role === 'user'">{{ message.role === 'user' ? 'ED' : 'A' }}</div>
            <div class="message-body"><div class="message-author">{{ message.role === 'user' ? 'You' : 'AI Dream Agent' }}</div><div class="message-content">{{ message.content }}</div></div>
          </article>
        }

        @if (busy()) {
          <article class="message-row assistant-message" aria-label="Agent response in progress"><div class="message-avatar">A</div><div class="message-body"><div class="message-author">AI Dream Agent <span class="stream-indicator">{{ status() || 'Agent is working…' }}</span></div><div class="message-content"><span class="stream-cursor" aria-hidden="true"></span></div></div></article>
        }

        @if (audit().length) {
          <section class="audit"><header><b>Tool audit</b><span>{{ stopReason() }}</span></header>@for (item of audit(); track $index) { <div class="audit-row"><strong>{{ item.name }}</strong><span>{{ item.status }} · {{ item.duration_ms }} ms</span><p>{{ item.result_snippet }}</p></div> }</section>
        }
        <div #scrollAnchor></div>
      </section>

      <div class="sr-only" aria-live="polite">{{ busy() ? (status() || 'Agent is working.') : '' }}</div>
      <footer class="composer-area">
        @if (models().length === 0) {
          <div class="model-warning" role="status">No local models are available. Add a model in the Models screen before sending.</div>
        }
        <div class="composer surface">
          <label class="sr-only" for="chat-prompt">Message</label>
          <textarea id="chat-prompt" rows="2" placeholder="Ask about this device, your models, or runtime…" [value]="prompt()" (input)="prompt.set($any($event.target).value)" (keydown)="onKey($event)" [disabled]="busy() || !api.connected() || !chatId()"></textarea>
          <div class="composer-bottom"><div class="composer-options"><label class="sr-only" for="agent-model">Model</label><select id="agent-model" [value]="modelId()" (change)="modelId.set($any($event.target).value)" [disabled]="busy() || models().length === 0">
            <option value="">{{ models().length ? 'Select a model' : 'No local models' }}</option>@for (model of models(); track model.id) {<option [value]="model.id">{{ model.name || model.id }}</option>}
          </select><span id="composer-hint">Read-only tools · No shell or file system writes</span></div>
          @if (busy()) { <button class="cancel-button" (click)="cancel()">Stop <span>■</span></button> }
          @else { <button class="send-button" (click)="run()" [disabled]="!api.connected() || !chatId() || !modelId() || !prompt().trim()">Run agent <span>↗</span></button> }
          </div>
        </div>
        <p class="composer-footnote">Responses can be incorrect. The bounded audit is saved with the conversation.</p>
      </footer>
    </section>
  `,
  styles: [`
    ai-agent-page{display:block;height:100%}
    .audit{max-width:850px;margin:14px auto;padding:12px;border:1px solid #3a3c43;border-radius:9px}.audit header{display:flex;justify-content:space-between;color:#bec3cf}.audit header span{font-size:12px;color:#a0a3aa}.audit-row{padding:9px 0;border-top:1px solid #33353b;margin-top:8px}.audit-row strong{font-size:12px}.audit-row span{float:right;color:#a4a6ae;font-size:11px}.audit-row p{font-size:12px;color:#b8bac1;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;line-height:1.5}
  `]
})
export class AgentPage implements OnInit {
  readonly chats = signal<any[]>([]); readonly models = signal<any[]>([]); readonly messages = signal<Message[]>([]);
  readonly chatId = signal(''); readonly modelId = signal(''); readonly prompt = signal(''); readonly busy = signal(false);
  readonly status = signal(''); readonly error = signal(''); readonly answer = signal(''); readonly audit = signal<AgentAudit[]>([]); readonly stopReason = signal('');
  private aborter: AbortController | null = null;
  private readonly scrollAnchor = viewChild<ElementRef<HTMLElement>>('scrollAnchor');

  constructor(readonly api: ApiService) {
    effect(() => { this.messages(); this.audit(); this.busy(); this.status(); this.scrollAnchor()?.nativeElement.scrollIntoView({ block: 'end' }); });
  }

  ngOnInit() { void this.initialize(); }
  async initialize() { await this.api.check(); if (!this.api.connected()) { this.error.set(this.api.error() || 'Local API is unavailable.'); return; } this.reload(); }

  reload() {
    this.api.get<any>('/api/models').subscribe({ next: r => { this.models.set(r?.data?.models || []); if (!this.modelId() && this.models().length) this.modelId.set(this.models()[0].id); }, error: e => this.error.set(e?.error?.error || 'Could not load models.') });
    this.api.get<any>('/api/chats').subscribe({ next: r => { this.chats.set(r?.data?.chats || []); if (!this.chatId() && this.chats().length) this.selectChat(this.chats()[0].id); }, error: e => this.error.set(e?.error?.error || 'Could not load conversations.') });
  }

  createChat() {
    if (this.busy()) return;
    this.api.post<any>('/api/chats', { title: 'Agent session' }).subscribe({
      next: r => { const chat = r?.data?.chat; if (chat?.id) { this.chats.update(items => [chat, ...items]); this.selectChat(chat.id); } },
      error: e => this.error.set(e?.error?.error || 'Could not create a conversation.')
    });
  }

  selectChat(id: string) {
    if (this.busy()) return;
    this.chatId.set(id); this.messages.set([]); this.audit.set([]); this.stopReason.set('');
    if (!id) return;
    this.api.get<any>(`/api/chats/${encodeURIComponent(id)}`).subscribe({
      next: r => { const chat = r?.data?.chat; if (chat?.id === id && this.chatId() === id) { this.messages.set(chat.messages || []); const latest = chat.agent_audits?.at(-1); this.audit.set(latest?.tools || []); this.stopReason.set(latest ? `${latest.stop_reason || 'completed'} · ${latest.tool_call_count || 0} tool calls` : ''); } },
      error: e => this.error.set(e?.error?.error || 'Could not load conversation.')
    });
  }

  onKey(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void this.run(); } }

  async run() {
    const text = this.prompt().trim(), chatId = this.chatId(), modelId = this.modelId();
    if (!text || !chatId || !modelId || this.busy()) return;
    const old = this.messages();
    this.prompt.set(''); this.error.set(''); this.answer.set(''); this.audit.set([]); this.stopReason.set('');
    this.messages.update(items => [...items, { role: 'user', content: text }]);
    this.busy.set(true); this.status.set('Starting bounded read-only agent…'); this.aborter = new AbortController();

    try {
      const res = await fetch(`${this.api.baseUrl()}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ chat_id: chatId, model_id: modelId, prompt: text }), signal: this.aborter.signal });
      if (!res.ok) throw new Error(await res.text());
      if (!res.body) throw new Error('Agent stream unavailable.');
      await this.readEvents(res.body);
      if (!this.answer()) throw new Error('Agent ended without a response.');
      this.messages.update(items => [...items, { role: 'assistant', content: this.answer() }]);
    } catch (e) {
      const canceled = e instanceof DOMException && e.name === 'AbortError';
      if (!canceled) this.error.set(e instanceof Error ? e.message : 'Agent request failed.');
      if (this.chatId() === chatId) this.messages.set(old);
      if (canceled) this.status.set('Agent stopped. Incomplete turn discarded.');
    } finally {
      this.busy.set(false); this.aborter = null;
      if (this.status() !== 'Agent stopped. Incomplete turn discarded.') this.status.set('');
    }
  }

  cancel() { this.aborter?.abort(); }

  private async readEvents(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader(), decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          await this.handleFrame(frame);
        }
        if (done) break;
      }
      if (buffer.trim()) await this.handleFrame(buffer);
    } finally { reader.releaseLock(); }
  }

  private async handleFrame(frame: string) {
    let name = 'message'; const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join('\n'));
    if (name === 'status') { this.status.set(payload.message || 'Agent is working…'); return; }
    if (name === 'error' || payload.error) throw new Error(payload.error || 'Agent failed.');
    if (name === 'complete') {
      this.answer.set(typeof payload.assistant === 'string' ? payload.assistant : '');
      this.audit.set(payload.agent?.tools || []);
      this.stopReason.set(`${payload.agent?.stop_reason || 'completed'} · ${payload.agent?.tool_call_count || 0} tool calls`);
    }
  }
}
