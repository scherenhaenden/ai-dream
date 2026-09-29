from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {relative_path}, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(relative_path: str, marker: str, addition: str) -> None:
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")
    if marker in text:
        raise RuntimeError(f"Marker already present in {relative_path}: {marker}")
    path.write_text(text.rstrip() + "\n\n" + addition.strip() + "\n", encoding="utf-8")


# --- Chat canvas: keep every fenced block addressable, editable and previewable. ---
replace_once(
    "web/src/app/pages/chat.page.ts",
    "import { ApiService } from '../core/api.service';",
    "import { ApiService } from '../core/api.service';\nimport { DomSanitizer, SafeHtml } from '@angular/platform-browser';",
)

replace_once(
    "web/src/app/pages/chat.page.ts",
    "type CodeArtifact = { language: string; content: string; messageKey: string };",
    "type CodeArtifact = { id: string; language: string; content: string; messageKey: string; blockIndex: number };\n"
    "type MessagePart = { key: string; kind: 'text'; content: string } | { key: string; kind: 'code'; artifact: CodeArtifact };\n"
    "type CanvasMode = 'code' | 'preview';",
)

replace_once(
    "web/src/app/pages/chat.page.ts",
    '<div class="message-content">{{ messageDisplayContent(message) }}</div>',
    '''<div class="message-content">
              @if (message.role === 'user') {
                <span class="message-text-part">{{ message.content }}</span>
              } @else {
                @for (part of messageParts(message); track part.key) {
                  @if (part.kind === 'text') {
                    <span class="message-text-part">{{ part.content }}</span>
                  } @else {
                    <button type="button" class="message-code-artifact" [class.selected]="selectedArtifactId() === part.artifact.id" (click)="openArtifact(part.artifact)" [attr.aria-label]="'Open ' + artifactLabel(part.artifact) + ' in Canvas'">
                      <span class="message-code-icon">&lt;/&gt;</span>
                      <span class="message-code-copy"><b>{{ artifactLabel(part.artifact) }}</b><small>{{ part.artifact.content.split('\\n').length }} lines · open in Canvas</small></span>
                      <span class="message-code-open">↗</span>
                    </button>
                  }
                } @empty {
                  <span class="message-text-part">{{ message.content }}</span>
                }
              }
            </div>''',
)

old_canvas = '''        @if (canvasOpen()) {<aside class="code-canvas" aria-label="Canvas and code view">
          <div class="canvas-tabs"><span class="canvas-tab active">&lt;/&gt; Canvas / Code View</span><span class="canvas-indicator" [class.present]="latestCodeArtifact()"></span></div>
          @if (latestCodeArtifact(); as artifact) {
            <div class="canvas-filebar"><div><span class="file-symbol">▤</span><b>{{ artifact.language || 'Code artifact' }}</b><span class="artifact-source">from assistant response</span></div><span>{{ artifact.content.split('\\n').length }} lines</span></div>
            <div class="code-scroll"><div class="code-source"><ol aria-hidden="true">@for (line of artifact.content.split('\\n'); track $index) { <li>{{ $index + 1 }}</li> }</ol><pre><code>{{ artifact.content }}</code></pre></div></div>
            <footer class="canvas-footer"><span>READ ONLY</span><span>Extracted from {{ activeChatTitle() }}</span></footer>
          } @else {
            <div class="canvas-empty"><span class="canvas-empty-icon">&lt;/&gt;</span><b>No code artifact in this thread</b><p>Code blocks in assistant responses will appear here.</p></div>
            <footer class="canvas-footer"><span>CANVAS</span><span>Waiting for a code block</span></footer>
          }
        </aside>}'''

new_canvas = '''        @if (canvasOpen()) {<aside class="code-canvas" aria-label="Canvas and code view">
          <div class="canvas-tabs">
            <button type="button" class="canvas-tab" [class.active]="canvasMode() === 'code'" (click)="canvasMode.set('code')">&lt;/&gt; Code</button>
            @if (selectedCodeArtifact(); as selectedArtifact) {
              @if (isHtmlArtifact(selectedArtifact)) { <button type="button" class="canvas-tab" [class.active]="canvasMode() === 'preview'" (click)="canvasMode.set('preview')">▣ Preview</button> }
            }
            <span class="canvas-indicator" [class.present]="selectedCodeArtifact()"></span>
          </div>
          @if (selectedCodeArtifact(); as artifact) {
            <div class="canvas-filebar">
              <div><span class="file-symbol">▤</span><b>{{ artifactLabel(artifact) }}</b><span class="artifact-source">assistant code block</span></div>
              <div class="canvas-file-actions">
                @if (allCodeArtifacts().length > 1) {
                  <select aria-label="Select code block" [value]="artifact.id" (change)="selectArtifactById($any($event.target).value)">
                    @for (item of allCodeArtifacts(); track item.id) { <option [value]="item.id">{{ artifactLabel(item) }}</option> }
                  </select>
                }
                <button type="button" class="canvas-mini-button" (click)="resetCanvasDraft()" [disabled]="canvasDraft() === artifact.content">Reset</button>
              </div>
            </div>
            @if (canvasMode() === 'preview' && isHtmlArtifact(artifact)) {
              <div class="canvas-preview-wrap"><iframe class="canvas-preview" title="Sandboxed HTML preview" [srcdoc]="htmlPreviewDocument()" sandbox referrerpolicy="no-referrer"></iframe></div>
            } @else {
              <textarea class="canvas-editor" aria-label="Editable code canvas" [value]="canvasDraft()" (input)="setCanvasDraft($any($event.target).value)" spellcheck="false"></textarea>
            }
            <footer class="canvas-footer"><span>{{ canvasDraft() === artifact.content ? 'SOURCE' : 'EDITED DRAFT' }}</span><span>{{ isHtmlArtifact(artifact) ? 'Sandboxed preview · network blocked' : 'Canvas edits do not change the saved chat' }}</span></footer>
          } @else {
            <div class="canvas-empty"><span class="canvas-empty-icon">&lt;/&gt;</span><b>No code artifact in this thread</b><p>Code blocks stay attached to the response that produced them. Click one in chat to open it here.</p></div>
            <footer class="canvas-footer"><span>CANVAS</span><span>Waiting for a code block</span></footer>
          }
        </aside>}'''
replace_once("web/src/app/pages/chat.page.ts", old_canvas, new_canvas)

old_state = '''  readonly copiedKey = signal('');
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
      const matches = [...this.streamText().matchAll(/(^|\\n)(`{3,}|~{3,})([^\\n]*)\\n([\\s\\S]*?)(?:\\n\\2(?=\\n|$)|$)/g)];
      if (matches.length) {
        const match = matches[matches.length - 1];
        return { language: (match[3] || '').trim(), content: match[4].replace(/\\n$/, ''), messageKey: 'streaming' };
      }
    }
    for (let index = this.messages().length - 1; index >= 0; index--) {
      const message = this.messages()[index];
      if (message.role !== 'assistant') continue;
      const matches = [...message.content.matchAll(/(^|\\n)(`{3,}|~{3,})([^\\n]*)\\n([\\s\\S]*?)\\n\\2(?=\\n|$)/g)];
      if (matches.length) {
        const match = matches[matches.length - 1];
        return { language: (match[3] || '').trim(), content: match[4].replace(/\\n$/, ''), messageKey: message.key };
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
    const codeFence = /(^|\\n)(`{3,}|~{3,})([^\\n]*)\\n([\\s\\S]*?)\\n\\2(?=\\n|$)/g;
    return message.content.replace(codeFence, (_block, prefix: string, _fence: string, language: string) => `${prefix}[${(language || 'Code').trim() || 'Code'} block is shown in Canvas]`);
  }'''

new_state = '''  readonly copiedKey = signal('');
  readonly canvasOpen = signal(false);
  readonly canvasMode = signal<CanvasMode>('code');
  readonly selectedArtifactId = signal('');
  readonly canvasDraft = signal('');
  readonly threadFilter = signal('');
  visibleChats = () => this.chats().filter(chat => (chat.title || 'New chat').toLowerCase().includes(this.threadFilter().toLowerCase()));
  activeChatTitle = () => this.chats().find(chat => chat.id === this.selectedChatId())?.title || (this.selectedChatId() ? 'New chat' : 'No conversation selected');
  diagnosticsHref = () => `/logs?view=diagnostics&incident=${encodeURIComponent(this.lastIncidentId())}`;
  selectedModel = () => this.models().find(model => model.id === this.selectedModelId()) ?? null;
  canEditGeneration = () => this.api.connected() && !!this.selectedChatId() && !this.busy() && !this.savingGeneration() && !this.generationLoading();
  canEditKnowledge = () => this.api.connected() && !!this.selectedChatId() && !this.busy() && !this.savingKnowledge() && !this.generationLoading();
  allCodeArtifacts = (): CodeArtifact[] => this.messages().flatMap(message => message.role === 'assistant' ? extractCodeArtifacts(message.content, message.key) : []);
  latestCodeArtifact = (): CodeArtifact | null => this.allCodeArtifacts().at(-1) ?? null;
  selectedCodeArtifact = (): CodeArtifact | null => {
    const artifacts = this.allCodeArtifacts();
    return artifacts.find(artifact => artifact.id === this.selectedArtifactId()) ?? artifacts.at(-1) ?? null;
  };
  private selectionVersion = 0;
  private modelSelectionTouched = false;
  private generationLoadVersion = 0;
  private aborter: AbortController | null = null;
  private streamCompleted = false;
  private serverDiagnosticReceived = false;
  private canvasSourceId = '';
  private readonly canvasDrafts = new Map<string, string>();
  private readonly scrollAnchor = viewChild<ElementRef<HTMLElement>>('scrollAnchor');

  constructor(readonly api: ApiService, private readonly sanitizer: DomSanitizer) {
    effect(() => {
      const artifacts = this.allCodeArtifacts();
      const selected = artifacts.find(artifact => artifact.id === this.selectedArtifactId()) ?? artifacts.at(-1) ?? null;
      if (selected && this.selectedArtifactId() !== selected.id) this.selectedArtifactId.set(selected.id);
      if (selected && this.canvasSourceId !== selected.id) {
        this.canvasSourceId = selected.id;
        this.canvasDraft.set(this.canvasDrafts.get(selected.id) ?? selected.content);
        if (!this.isHtmlArtifact(selected) && this.canvasMode() === 'preview') this.canvasMode.set('code');
      } else if (!selected && this.canvasSourceId) {
        this.canvasSourceId = '';
        this.selectedArtifactId.set('');
        this.canvasDraft.set('');
        this.canvasMode.set('code');
      }
      this.streaming();
      this.scrollAnchor()?.nativeElement.scrollIntoView({ block: 'end' });
    });
  }

  toggleCanvas(): void {
    if (!this.canvasOpen()) {
      const artifact = this.selectedCodeArtifact();
      if (artifact) this.selectArtifact(artifact);
    }
    this.canvasOpen.update(open => !open);
  }

  messageParts(message: TranscriptMessage): MessagePart[] { return splitMessageParts(message); }
  artifactLabel(artifact: CodeArtifact): string { return `${artifact.language || 'code'} · block ${artifact.blockIndex + 1}`; }
  openArtifact(artifact: CodeArtifact): void { this.selectArtifact(artifact); this.canvasOpen.set(true); }
  selectArtifactById(id: string): void {
    const artifact = this.allCodeArtifacts().find(item => item.id === id);
    if (artifact) this.selectArtifact(artifact);
  }
  setCanvasDraft(value: string): void {
    this.canvasDraft.set(value);
    const id = this.selectedArtifactId();
    if (id) this.canvasDrafts.set(id, value);
  }
  resetCanvasDraft(): void {
    const artifact = this.selectedCodeArtifact();
    if (!artifact) return;
    this.canvasDrafts.delete(artifact.id);
    this.canvasDraft.set(artifact.content);
  }
  isHtmlArtifact(artifact: CodeArtifact): boolean {
    const language = artifact.language.trim().toLowerCase();
    return language === 'html' || language === 'htm' || language === 'xhtml' || /^\\s*<!doctype html/i.test(artifact.content) || /<html(?:\\s|>)/i.test(artifact.content);
  }
  htmlPreviewDocument(): SafeHtml {
    const artifact = this.selectedCodeArtifact();
    return this.sanitizer.bypassSecurityTrustHtml(artifact && this.isHtmlArtifact(artifact) ? sandboxHtml(this.canvasDraft()) : '');
  }
  private selectArtifact(artifact: CodeArtifact): void {
    this.selectedArtifactId.set(artifact.id);
    this.canvasSourceId = artifact.id;
    this.canvasDraft.set(this.canvasDrafts.get(artifact.id) ?? artifact.content);
    this.canvasMode.set('code');
  }'''
replace_once("web/src/app/pages/chat.page.ts", old_state, new_state)

replace_once(
    "web/src/app/pages/chat.page.ts",
    "    this.canvasManuallySet = false;\n    this.lastCanvasArtifactKey = '';\n    this.canvasOpen.set(false);",
    "    this.canvasOpen.set(false);\n    this.selectedArtifactId.set('');\n    this.canvasDraft.set('');\n    this.canvasMode.set('code');\n    this.canvasSourceId = '';\n    this.canvasDrafts.clear();",
)
replace_once(
    "web/src/app/pages/chat.page.ts",
    "        this.canvasManuallySet = false;\n        this.lastCanvasArtifactKey = '';\n        this.canvasOpen.set(false);",
    "        this.canvasOpen.set(false);\n        this.selectedArtifactId.set('');\n        this.canvasDraft.set('');\n        this.canvasMode.set('code');\n        this.canvasSourceId = '';\n        this.canvasDrafts.clear();",
)

chat_helpers = r'''
function extractCodeArtifacts(content: string, messageKey: string): CodeArtifact[] {
  const artifacts: CodeArtifact[] = [];
  const fence = /(?:^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    const language = (match[2] || '').trim().split(/\s+/)[0] || 'code';
    const blockIndex = artifacts.length;
    artifacts.push({ id: `${messageKey}::code-${blockIndex}`, language, content: match[3].replace(/\n$/, ''), messageKey, blockIndex });
  }
  return artifacts;
}

function splitMessageParts(message: TranscriptMessage): MessagePart[] {
  if (message.role !== 'assistant') return [{ key: `${message.key}:text`, kind: 'text', content: message.content }];
  const parts: MessagePart[] = [];
  const fence = /(?:^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1(?=\n|$)/g;
  let cursor = 0;
  let blockIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(message.content)) !== null) {
    const before = message.content.slice(cursor, match.index);
    if (before) parts.push({ key: `${message.key}:text-${blockIndex}`, kind: 'text', content: before });
    const language = (match[2] || '').trim().split(/\s+/)[0] || 'code';
    const artifact: CodeArtifact = { id: `${message.key}::code-${blockIndex}`, language, content: match[3].replace(/\n$/, ''), messageKey: message.key, blockIndex };
    parts.push({ key: artifact.id, kind: 'code', artifact });
    blockIndex += 1;
    cursor = match.index + match[0].length;
  }
  const after = message.content.slice(cursor);
  if (after) parts.push({ key: `${message.key}:text-${blockIndex}`, kind: 'text', content: after });
  return parts.length ? parts : [{ key: `${message.key}:text`, kind: 'text', content: message.content }];
}

function sandboxHtml(source: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">`;
  const referrer = '<meta name="referrer" content="no-referrer">';
  const trimmed = source.trim();
  if (/<html(?:\s|>)/i.test(trimmed)) {
    if (/<head(?:\s|>)/i.test(trimmed)) return trimmed.replace(/<head([^>]*)>/i, `<head$1>${policy}${referrer}`);
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${policy}${referrer}</head>`);
  }
  return `<!doctype html><html><head>${policy}${referrer}<meta charset="utf-8"><style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif}</style></head><body>${source}</body></html>`;
}
'''
replace_once(
    "web/src/app/pages/chat.page.ts",
    "\nfunction unwrap(response: any): any { return response && typeof response === 'object' && 'data' in response ? response.data : response; }",
    "\n" + chat_helpers.strip() + "\n\nfunction unwrap(response: any): any { return response && typeof response === 'object' && 'data' in response ? response.data : response; }",
)

append_once(
    "web/src/styles.css",
    "/* Interactive multi-artifact Canvas */",
    r'''
/* Interactive multi-artifact Canvas */
.message-text-part{white-space:pre-wrap}.message-code-artifact{width:min(100%,560px);display:flex;align-items:center;gap:9px;margin:7px 0;padding:8px 9px;border:1px solid #344055;border-radius:5px;background:#111721;color:#cdd8ea;text-align:left;cursor:pointer}.message-code-artifact:hover,.message-code-artifact.selected{border-color:#6f91c8;background:#182235}.message-code-icon{width:28px;height:28px;display:grid;place-items:center;flex:none;border:1px solid #344055;background:#0e131d;color:#adc6ff;font:9px ui-monospace,monospace}.message-code-copy{min-width:0;flex:1;display:grid;gap:3px}.message-code-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10px ui-monospace,monospace}.message-code-copy small{color:#7f8da3;font:8px ui-monospace,monospace}.message-code-open{color:#7fa8eb;font-size:12px}.canvas-tabs button.canvas-tab{height:100%;display:flex;align-items:center;padding:0 8px;border:0;border-bottom:2px solid transparent;background:transparent;color:#8793a6;font:10px ui-monospace,monospace;cursor:pointer}.canvas-tabs button.canvas-tab.active{border-bottom-color:#adc6ff;color:#adc6ff}.canvas-tabs .canvas-indicator{margin-left:auto}.canvas-file-actions{display:flex!important;align-items:center;justify-content:flex-end;gap:6px;flex:1}.canvas-file-actions select{width:auto;max-width:180px;height:25px;padding:0 22px 0 7px;border:1px solid #303744;border-radius:3px;background:#0e131d;color:#b9c6da;font:8px ui-monospace,monospace}.canvas-mini-button{height:25px;padding:0 7px;border:1px solid #3b4658;border-radius:3px;background:#171c26;color:#aebbd0;font:8px ui-monospace,monospace;cursor:pointer}.canvas-mini-button:disabled{opacity:.4;cursor:default}.canvas-editor{flex:1;min-height:0;width:100%;resize:none;border:0;outline:0;padding:12px;background:#090e18;color:#cbd5e1;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;white-space:pre}.canvas-preview-wrap{flex:1;min-height:0;padding:10px;background:#0e131d}.canvas-preview{display:block;width:100%;height:100%;min-height:240px;border:1px solid #303744;border-radius:4px;background:white}.canvas-filebar>div:first-child{max-width:45%}@media(max-width:1120px){.canvas-filebar>div:first-child{max-width:38%}}@media(max-width:620px){.canvas-filebar{align-items:flex-start;flex-direction:column}.canvas-filebar>div:first-child{max-width:100%}.canvas-file-actions{width:100%;justify-content:space-between}.canvas-file-actions select{max-width:none;flex:1}}
''',
)

# --- Model cards: expose role/input/output modality in the compact summary. ---
replace_once(
    "web/src/app/pages/model-studio.page.ts",
    "type ModelSortKey = 'name' | 'size' | 'architecture' | 'quantization' | 'context';",
    "type ModelSortKey = 'name' | 'size' | 'architecture' | 'quantization' | 'context';\n"
    "type ModelCapabilitySummary = { role: string; inputs: string[]; outputs: string[]; source: string };",
)

old_tags = '''                <span class="tags">
                  <span [title]="'Format reported by the local catalog: ' + (model.format || 'GGUF')">{{ (model.format || 'GGUF').toUpperCase() }}</span>
                  <span [title]="'File size reported by the local catalog: ' + size(model.size)">{{ size(model.size) }}</span>
                  @if (model.metadata['general.architecture']; as architecture) { <span [title]="'Architecture read from GGUF metadata: ' + architecture">{{ architecture }}</span> }
                  @if (modelQuantization(model); as quantization) { <span [title]="'Quantization read from GGUF metadata or inferred from filename: ' + quantization">{{ quantization }}</span> }
                  @if (modelContextLength(model); as contextLength) { <span [title]="'Context length read from available GGUF metadata: ' + contextLength">{{ contextLength }} ctx</span> }
                  @if (isLoaded(model)) { <span class="loaded-tag" title="Loaded state inferred from the active runtime model path">● LOADED</span> }
                </span>'''
new_tags = '''                @let capabilities = modelCapabilities(model);
                <span class="tags">
                  <span [title]="'Format reported by the local catalog: ' + (model.format || 'GGUF')">{{ (model.format || 'GGUF').toUpperCase() }}</span>
                  <span [title]="'File size reported by the local catalog: ' + size(model.size)">{{ size(model.size) }}</span>
                  @if (model.metadata['general.architecture']; as architecture) { <span [title]="'Architecture read from GGUF metadata: ' + architecture">{{ architecture }}</span> }
                  @if (modelQuantization(model); as quantization) { <span [title]="'Quantization read from GGUF metadata or inferred from filename: ' + quantization">{{ quantization }}</span> }
                  @if (modelContextLength(model); as contextLength) { <span [title]="'Context length read from available GGUF metadata: ' + contextLength">{{ contextLength }} ctx</span> }
                  <span class="capability-role" [title]="'Model role · ' + capabilities.source">ROLE {{ capabilities.role }}</span>
                  @for (input of capabilities.inputs; track input) { <span class="capability-tag input" [title]="'Accepted input type · ' + capabilities.source">IN {{ input }}</span> }
                  @for (output of capabilities.outputs; track output) { <span class="capability-tag output" [title]="'Produced output type · ' + capabilities.source">OUT {{ output }}</span> }
                  @if (isLoaded(model)) { <span class="loaded-tag" title="Loaded state inferred from the active runtime model path">● LOADED</span> }
                </span>'''
replace_once("web/src/app/pages/model-studio.page.ts", old_tags, new_tags)

replace_once(
    "web/src/app/pages/model-studio.page.ts",
    ".tags .loaded-tag{color:#9be0b5}.chevron",
    ".tags .loaded-tag{color:#9be0b5}.tags .capability-role{color:#d6c7ff;background:#211d31}.tags .capability-tag.input{color:#b9d5ff;background:#18283a}.tags .capability-tag.output{color:#99e5bd;background:#173126}.chevron",
)

replace_once(
    "web/src/app/pages/model-studio.page.ts",
    "  modelName(model: ModelRecord): string { return String(model.metadata?.['general.name'] || model.path.split(/[\\\\/]/).pop() || model.id); }",
    "  modelName(model: ModelRecord): string { return String(model.metadata?.['general.name'] || model.path.split(/[\\\\/]/).pop() || model.id); }\n"
    "  modelCapabilities(model: ModelRecord): ModelCapabilitySummary { return describeModelCapabilities(model); }",
)

model_helpers = r'''
function describeModelCapabilities(model: ModelRecord): ModelCapabilitySummary {
  const metadata = model.metadata || {};
  const explicitInputs = modalityList(metadata['ai_dream.input_modalities'] ?? metadata['input_modalities'] ?? metadata['general.input_modalities']);
  const explicitOutputs = modalityList(metadata['ai_dream.output_modalities'] ?? metadata['output_modalities'] ?? metadata['general.output_modalities']);
  const explicitRole = textValue(metadata['ai_dream.model_type'] ?? metadata['model_type']);
  if (explicitInputs.length || explicitOutputs.length || explicitRole) {
    return { role: explicitRole || 'Model', inputs: explicitInputs.length ? explicitInputs : ['Text'], outputs: explicitOutputs.length ? explicitOutputs : ['Text'], source: 'declared model metadata' };
  }

  const architecture = textValue(metadata['general.architecture']).toLowerCase();
  const tags = Array.isArray(metadata['general.tags']) ? metadata['general.tags'].filter(value => typeof value === 'string').join(' ') : '';
  const evidence = [metadata['general.name'], metadata['general.basename'], metadata['general.description'], tags, model.path.split(/[\\/]/).pop()]
    .filter(value => typeof value === 'string').join(' ').toLowerCase();

  if (typeof metadata['mmproj_path'] === 'string' && metadata['mmproj_path']) {
    return { role: 'Vision-language', inputs: ['Text', 'Image'], outputs: ['Text'], source: 'GGUF model with paired vision projector' };
  }
  if (/(?:rerank|reranker|cross[-_ ]?encoder)/.test(evidence)) {
    return { role: 'Reranker', inputs: ['Text pair'], outputs: ['Score'], source: 'inferred from local model name/path' };
  }
  if (/(?:diariz|speaker[-_ ]?diar)/.test(evidence)) {
    return { role: 'Diarization', inputs: ['Audio'], outputs: ['Segments'], source: 'inferred from local model name/path' };
  }
  if (/(?:whisper|\basr\b|speech[-_ ]?to[-_ ]?text|transcrib)/.test(evidence)) {
    return { role: 'Speech recognition', inputs: ['Audio'], outputs: ['Text'], source: 'inferred from local model name/path' };
  }
  if (/(?:\btts\b|text[-_ ]?to[-_ ]?speech|speech[-_ ]?synth)/.test(evidence)) {
    return { role: 'Text-to-speech', inputs: ['Text'], outputs: ['Audio'], source: 'inferred from local model name/path' };
  }
  if (/(?:embedding|embed(?:der|ding)?|nomic[-_ ]?embed|\be5(?:[-_. ]|$)|gte[-_. ]|bge[-_ ]?m3)/.test(evidence) || (architecture.includes('bert') && /embed/.test(evidence))) {
    return { role: 'Embedding', inputs: ['Text'], outputs: ['Embedding'], source: 'inferred from local model name/path and GGUF architecture' };
  }
  if (/(?:image[-_ ]?generation|text[-_ ]?to[-_ ]?image|stable[-_ ]?diffusion|\bsdxl\b|\bflux(?:[-_. ]|$)|qwen[-_ ]?image)/.test(evidence)) {
    return { role: 'Image generation', inputs: ['Text'], outputs: ['Image'], source: 'inferred from local model name/path' };
  }
  if (/(?:coder|coding|code[-_ ]?model)/.test(evidence)) {
    return { role: 'Code', inputs: ['Text'], outputs: ['Text'], source: 'inferred from local model name/path' };
  }
  if (/(?:reasoning|thinking|\br1(?:[-_. ]|$))/i.test(evidence)) {
    return { role: 'Reasoning', inputs: ['Text'], outputs: ['Text'], source: 'inferred from local model name/path' };
  }
  return { role: 'Chat / text', inputs: ['Text'], outputs: ['Text'], source: architecture ? `GGUF ${architecture} architecture; task not explicitly declared` : 'task not explicitly declared in local GGUF metadata' };
}

function modalityList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;+]/) : [];
  return [...new Set(values.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).map(item => item[0].toUpperCase() + item.slice(1).toLowerCase()))];
}
function textValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
'''
replace_once(
    "web/src/app/pages/model-studio.page.ts",
    "\nfunction normalize(path: string): string { return path.replace(/\\\\/g, '/').replace(/\\/$/, ''); }",
    "\n" + model_helpers.strip() + "\n\nfunction normalize(path: string): string { return path.replace(/\\\\/g, '/').replace(/\\/$/, ''); }",
)

# --- Update smoke fixtures/assertions to lock in the requested behavior. ---
replace_once(
    "web/scripts/check-chat-agent-ui.mjs",
    "{ role: 'assistant', content: 'Mock answer\\n\\n```html\\n<html><body>Hello</body></html>\\n```' }];",
    "{ role: 'assistant', content: 'Mock answer\\n\\n```html\\n<html><body><h1 id=\"preview-title\">Hello</h1></body></html>\\n```\\n\\n```js\\nconsole.log(\"second block\");\\n```' }];",
)
replace_once(
    "web/scripts/check-chat-agent-ui.mjs",
    "body: 'event: delta\\ndata: {\"text\":\"Mock answer\\\\n\\\\n```html\\\\n<html><body>Hello</body></html>\\\\n```\"}\\n\\nevent: complete\\ndata: {\"assistant\":\"Mock answer\\\\n\\\\n```html\\\\n<html><body>Hello</body></html>\\\\n```\"}\\n\\n'",
    "body: 'event: delta\\ndata: {\"text\":\"Mock answer\\\\n\\\\n```html\\\\n<html><body><h1 id=\\\"preview-title\\\">Hello</h1></body></html>\\\\n```\\\\n\\\\n```js\\\\nconsole.log(\\\"second block\\\");\\\\n```\"}\\n\\nevent: complete\\ndata: {\"assistant\":\"Mock answer\\\\n\\\\n```html\\\\n<html><body><h1 id=\\\"preview-title\\\">Hello</h1></body></html>\\\\n```\\\\n\\\\n```js\\\\nconsole.log(\\\"second block\\\");\\\\n```\"}\\n\\n'",
)
old_chat_assertions = '''    await expect(page.getByText('Mock answer')).toBeVisible();
    await expect(page.locator('.code-canvas')).toBeVisible();
    await expect(page.locator('.code-scroll code')).toContainText('<html><body>Hello</body></html>');
    await expect(page.locator('.message-content').filter({ hasText: '[html block is shown in Canvas]' })).toBeVisible();
    await page.getByRole('button', { name: 'Hide Canvas' }).click();
    await expect(page.locator('.code-canvas')).toHaveCount(0);
    await page.getByRole('button', { name: 'Canvas · Code' }).click();
    await expect(page.locator('.code-canvas')).toBeVisible();'''
new_chat_assertions = '''    await expect(page.getByText('Mock answer')).toBeVisible();
    await expect(page.locator('.code-canvas')).toHaveCount(0);
    await expect(page.locator('.message-code-artifact')).toHaveCount(2);
    await page.getByRole('button', { name: 'Open html · block 1 in Canvas' }).click();
    await expect(page.locator('.code-canvas')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Editable code canvas' })).toContainText('<h1 id="preview-title">Hello</h1>');
    await page.getByRole('button', { name: '▣ Preview' }).click();
    await expect(page.locator('.canvas-preview').contentFrame().locator('#preview-title')).toHaveText('Hello');
    await page.getByRole('button', { name: '</> Code' }).click();
    await page.getByRole('textbox', { name: 'Editable code canvas' }).fill('<!doctype html><html><body><h1 id="preview-title">Edited</h1></body></html>');
    await page.getByRole('button', { name: '▣ Preview' }).click();
    await expect(page.locator('.canvas-preview').contentFrame().locator('#preview-title')).toHaveText('Edited');
    await page.getByRole('button', { name: 'Open js · block 2 in Canvas' }).click();
    await expect(page.getByRole('textbox', { name: 'Editable code canvas' })).toContainText('console.log("second block")');
    await page.getByRole('button', { name: 'Hide Canvas' }).click();
    await expect(page.locator('.code-canvas')).toHaveCount(0);
    await page.getByRole('button', { name: 'Canvas · Code' }).click();
    await expect(page.getByRole('textbox', { name: 'Editable code canvas' })).toContainText('console.log("second block")');'''
replace_once("web/scripts/check-chat-agent-ui.mjs", old_chat_assertions, new_chat_assertions)

replace_once(
    "web/scripts/check-model-studio-ui.mjs",
    "const model = (id, name, modelPath) => ({\n  id, path: modelPath, name, format: 'gguf', size: 1_000_000_000, metadata: { 'general.name': name },\n});",
    "const model = (id, name, modelPath, metadata = {}) => ({\n  id, path: modelPath, name, format: 'gguf', size: 1_000_000_000, metadata: { 'general.name': name, ...metadata },\n});",
)
replace_once(
    "web/scripts/check-model-studio-ui.mjs",
    "      model('alpha', 'Alpha model', alphaPath), model('beta', 'Beta model', betaPath),",
    "      model('alpha', 'Alpha model', alphaPath, { mmproj_path: '/models/mmproj-alpha.gguf' }),\n      model('beta', 'Beta model', betaPath, { 'general.basename': 'bge-m3-embedding' }),",
)
replace_once(
    "web/scripts/check-model-studio-ui.mjs",
    "    await expect(alphaCard.locator('.loaded-tag')).toHaveText('● LOADED');",
    "    await expect(alphaCard.locator('.loaded-tag')).toHaveText('● LOADED');\n    await expect(alphaCard.locator('.capability-role')).toHaveText('ROLE Vision-language');\n    await expect(alphaCard.locator('.capability-tag.input')).toContainText(['IN Text', 'IN Image']);\n    await expect(alphaCard.locator('.capability-tag.output')).toHaveText('OUT Text');",
)
replace_once(
    "web/scripts/check-model-studio-ui.mjs",
    "    const presetSelect = betaCard.getByLabel('Saved preset');",
    "    await expect(betaCard.locator('.capability-role')).toHaveText('ROLE Embedding');\n    await expect(betaCard.locator('.capability-tag.output')).toHaveText('OUT Embedding');\n    const presetSelect = betaCard.getByLabel('Saved preset');",
)

print("Canvas/model modality patch applied successfully")
