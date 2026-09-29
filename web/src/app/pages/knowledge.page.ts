import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';

type KnowledgeDocument = { id: string; name: string; media_type: string; size_bytes: number; char_count: number; truncated: boolean; created_at: string };
type KnowledgeResult = { id: string; name: string; snippet: string; created_at: string };
type KnowledgeResponse<T> = { data: T };

@Component({
  selector: 'ai-knowledge-page', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="knowledge">
      <header class="heading"><div><div class="eyebrow">LIBRARY / LOCAL SEARCH</div><h1>Knowledge</h1><p>Private, local full-text indexing. SQLite FTS5 lexical matching; no embeddings or semantic RAG.</p></div>
        <button title="Refresh the real document list from the local API" (click)="load()" [disabled]="loading()">↻ <span>Refresh</span></button></header>
      <section class="status"><div><b>LOCAL FULL-TEXT INDEX</b><span class="state" [class.offline]="!api.connected()">{{ api.connected() ? 'API connected' : 'API unavailable' }}</span></div>
        <span class="meta">{{ summary() }}</span></section>
      @if (error()) { <div class="error" role="alert"><span>{{ error() }}</span><button title="Dismiss this message" (click)="error.set('')">×</button></div> }
      <section class="search"><label for="query">Search indexed text</label><div class="search-row"><input id="query" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.enter)="search()" maxlength="256" placeholder="Enter words to match" title="Searches up to 16 words using local SQLite FTS5 full-text matching"/><button (click)="search()" [disabled]="searching()" title="Search the local full-text index">{{ searching() ? 'Searching…' : 'Search' }}</button></div>
        @if (searched()) { <div class="results-head">{{ results().length }} result{{ results().length === 1 ? '' : 's' }} for <code>{{ searched() }}</code></div>
          @for (result of results(); track result.id) { <article class="result"><div><b>{{ result.name }}</b><time>{{ result.created_at | date:'medium' }}</time></div><p [innerText]="result.snippet"></p></article> }
          @if (!results().length) { <p class="empty">No full-text matches. Search uses lexical terms and does not infer related concepts.</p> }
        }
      </section>
      <section class="documents"><header><div><h2>Indexed documents</h2><span>{{ documents().length }} / {{ maxDocuments() }} documents · {{ indexedChars() }} / {{ maxChars() }} characters</span></div>
        <label class="upload" title="Add a TXT, Markdown, or text-based PDF document within the displayed limits">＋ Add document<input type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" (change)="addFile($event)" [disabled]="uploading() || !api.connected()" title="Select a local TXT, Markdown, or text-based PDF file; maximum 5 MiB" /></label></header>
        <p class="limits">TXT · Markdown · text PDF only. Maximum 5 MiB per file, 40,000 extracted characters per document, 80,000 total indexed characters, and 100 documents. Scanned PDFs are not OCR-processed.</p>
        @if (loading()) { <p class="empty">Loading local index…</p> }
        @if (!loading() && !documents().length) { <p class="empty">No documents indexed. Add a local text document to begin.</p> }
        @for (document of documents(); track document.id) { <article class="doc"><div class="file"><span class="file-icon">TXT</span><div><b>{{ document.name }}</b><small>{{ document.media_type }} · {{ document.char_count }} characters · {{ document.size_bytes }} bytes{{ document.truncated ? ' · truncated at document limit' : '' }}</small></div></div>
          <time>{{ document.created_at | date:'medium' }}</time><button class="remove" title="Permanently remove this document and its full-text index entry" (click)="remove(document)" [disabled]="removing() === document.id">{{ removing() === document.id ? 'Removing…' : 'Remove' }}</button></article> }
      </section>
    </main>`,
  styles: [`
    :host{display:block;color:var(--text,#e1e5f0)}.knowledge{max-width:1250px;margin:auto;padding:20px;display:grid;gap:14px}.heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.eyebrow{font:10px ui-monospace,monospace;color:#8993a7}.heading h1{font-size:21px;margin:4px 0}.heading p{font-size:12px;color:#9ba4b6;margin:0}.heading button,.search-row button,.upload{background:#27303d;border:1px solid #3a4657;color:#e1e5f0;border-radius:4px;padding:8px 11px;font:12px ui-monospace,monospace;cursor:pointer}.status{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px 14px;background:#171d27;border:1px solid #2b3442}.status>div{display:flex;gap:14px;align-items:center}.status b,.meta,.state{font:10px ui-monospace,monospace}.status b{color:#bdc8dc}.state{color:#4edea3}.state.offline{color:#ffb4ab}.meta{color:#8e99ab}.search,.documents{border-top:1px solid #303846;padding-top:13px}.search>label{display:block;font-size:12px;font-weight:600;margin-bottom:8px}.search-row{display:flex;gap:8px}.search-row input{flex:1;min-width:0;padding:9px 10px;background:#10151d;border:1px solid #303a49;border-radius:3px;color:#e2e8f3;font:12px ui-monospace,monospace}.search-row button:disabled,.upload input:disabled,.remove:disabled{opacity:.55}.results-head{font:10px ui-monospace,monospace;color:#aeb8c9;margin:10px 0}.results-head code{color:#d5e1f6}.result,.doc{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid #262e3b}.result>div{display:flex;flex-direction:column;gap:4px}.result b,.doc b{font-size:12px;overflow-wrap:anywhere}.result time,.doc time,.doc small{font:10px ui-monospace,monospace;color:#8994a7}.result p{font-size:11px;color:#b4bdcd;line-height:1.5;white-space:pre-wrap;margin:0;max-width:700px}.documents>header{display:flex;justify-content:space-between;align-items:center;gap:12px}.documents h2{font-size:14px;margin:0 0 4px}.documents header span,.limits{font-size:10px;color:#8e99ab}.limits{line-height:1.5;margin:8px 0 12px}.upload{position:relative;overflow:hidden;white-space:nowrap}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}.doc .file{display:flex;align-items:center;gap:9px;min-width:0;flex:1}.file>div{display:flex;flex-direction:column;gap:4px;min-width:0}.file-icon{display:grid;place-items:center;width:32px;height:34px;flex:none;background:#202a35;color:#a9c5d0;font:9px ui-monospace,monospace}.remove{border:1px solid #48353b;background:#251b21;color:#ffb4ab;border-radius:3px;padding:6px 8px;font-size:10px;cursor:pointer}.empty{font-size:11px;color:#8e99ab;padding:12px 0}.error{display:flex;justify-content:space-between;gap:10px;padding:9px 11px;background:#2b2025;border:1px solid #53323a;color:#ffb4ab;font-size:11px}.error button{border:0;background:none;color:inherit;cursor:pointer}@media(max-width:640px){.knowledge{padding:14px 11px}.heading{align-items:flex-start}.heading button span{display:none}.status,.documents>header{align-items:flex-start;flex-direction:column}.status{gap:8px}.doc{flex-wrap:wrap}.doc time{margin-left:41px}.doc .remove{margin-left:auto}.upload{align-self:flex-start}}
  `]
})
export class KnowledgePage implements OnInit {
  readonly api = inject(ApiService);
  readonly documents = signal<KnowledgeDocument[]>([]);
  readonly results = signal<KnowledgeResult[]>([]);
  readonly loading = signal(false);
  readonly searching = signal(false);
  readonly uploading = signal(false);
  readonly removing = signal('');
  readonly error = signal('');
  readonly query = signal('');
  readonly searched = signal('');
  readonly indexedChars = signal(0);
  readonly maxChars = signal(80000);
  readonly maxDocuments = signal(100);
  readonly summary = computed(() => `${this.documents().length} documents · ${this.indexedChars()} indexed characters`);

  ngOnInit() { void this.load(); }
  async load() {
    this.loading.set(true); this.error.set('');
    try {
      const response = await firstValueFrom(this.api.get<KnowledgeResponse<{documents: KnowledgeDocument[]; indexed_chars: number; max_indexed_chars: number; max_documents: number}>>('/api/knowledge/documents'));
      this.documents.set(response.data.documents || []); this.indexedChars.set(response.data.indexed_chars || 0);
      this.maxChars.set(response.data.max_indexed_chars || 80000); this.maxDocuments.set(response.data.max_documents || 100);
    } catch (error) { this.error.set(this.message(error, 'Could not load local index')); }
    finally { this.loading.set(false); }
  }
  async search() {
    const query = this.query().trim();
    if (!query) { this.error.set('Enter words to search.'); return; }
    this.searching.set(true); this.error.set(''); this.searched.set('');
    try {
      const response = await firstValueFrom(this.api.get<KnowledgeResponse<{results: KnowledgeResult[]}>>(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=10`));
      this.results.set(response.data.results || []); this.searched.set(query);
    } catch (error) { this.error.set(this.message(error, 'Could not search local index')); }
    finally { this.searching.set(false); }
  }
  async addFile(event: Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { this.error.set('File exceeds the 5 MiB limit.'); return; }
    const name = file.name.split(/[\\/]/).pop() || '';
    this.uploading.set(true); this.error.set('');
    try {
      let body: {name: string; content: string} | {name: string; content_base64: string};
      if (/\.pdf$/i.test(name)) body = {name, content_base64: this.toBase64(await file.arrayBuffer())};
      else if (/\.(txt|md|markdown)$/i.test(name)) body = {name, content: await file.text()};
      else throw new Error('Use a TXT, Markdown, or PDF file.');
      await firstValueFrom(this.api.post('/api/knowledge/documents', body)); await this.load();
    } catch (error) { this.error.set(this.message(error, 'Could not add document')); }
    finally { this.uploading.set(false); }
  }
  async remove(document: KnowledgeDocument) {
    this.removing.set(document.id); this.error.set('');
    try { await firstValueFrom(this.api.delete(`/api/knowledge/documents/${encodeURIComponent(document.id)}`)); await this.load(); }
    catch (error) { this.error.set(this.message(error, 'Could not remove document')); }
    finally { this.removing.set(''); }
  }
  private toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer); let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  private message(error: unknown, fallback: string): string {
    const candidate = error as {error?: {error?: string}; message?: string};
    return candidate?.error?.error || candidate?.message || fallback;
  }
}
