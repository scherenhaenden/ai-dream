import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';

type KnowledgeDocument = { id: string; name: string; media_type: string; size_bytes: number; char_count: number; truncated: boolean; created_at: string };
type KnowledgeResult = { id: string; name: string; snippet: string; created_at: string };
type KnowledgeResponse<T> = { data: T };
type IndexingProgress = { phase?: string; source_id?: string; document_id?: string; current_table?: string; table_index?: number; total_tables?: number; done?: number; total?: number; percent?: number; speed?: number; eta_seconds?: number; elapsed_seconds?: number; unit?: string };

@Component({
  selector: 'ai-knowledge-page', standalone: true, imports: [DatePipe], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="knowledge" (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">
      @if (dragging()) {
        <div class="drop-overlay">
          <div class="drop-card">
            <span class="drop-icon">📦</span>
            <h3>Suelta tu archivo aquí</h3>
            <p>.sqlite · .db · .sqlite3 (hasta 512 MiB) · Markdown · TXT · PDF</p>
          </div>
        </div>
      }
      <header class="heading"><div><div class="eyebrow">LIBRARY / LOCAL SEARCH</div><h1>Knowledge</h1><p>Private, local retrieval. Dual-path indexing: SQLite FTS5 lexical matching + semantic vector embeddings & SQLite databases.</p></div>
        <button title="Refresh the real document list from the local API" (click)="load()" [disabled]="loading()">↻ <span>Refresh</span></button></header>
      <section class="status"><div><b>LOCAL RETRIEVAL INDEX</b><span class="state" [class.offline]="!api.connected()">{{ api.connected() ? 'API connected' : 'API unavailable' }}</span></div>
        <span class="meta">{{ summary() }}</span></section>
      @if (error()) { <div class="error" role="alert"><span>{{ error() }}</span><button title="Dismiss this message" (click)="error.set('')">×</button></div> }
      <section class="search"><label for="query">Search indexed text</label><div class="search-row"><input id="query" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.enter)="search()" maxlength="256" placeholder="Enter words to match" title="Searches up to 16 words using local SQLite FTS5 full-text matching"/><button (click)="search()" [disabled]="searching()" title="Search the local full-text index">{{ searching() ? 'Searching…' : 'Search' }}</button></div>
        @if (searched()) { <div class="results-head">{{ results().length }} result{{ results().length === 1 ? '' : 's' }} for <code>{{ searched() }}</code></div>
          @for (result of results(); track result.id) { <article class="result"><div><b>{{ result.name }}</b><time>{{ result.created_at | date:'medium' }}</time></div><p [innerText]="result.snippet"></p></article> }
          @if (!results().length) { <p class="empty">No full-text matches. Search uses lexical terms and does not infer related concepts.</p> }
        }
      </section>
      <section class="documents"><header><div><h2>Indexed documents</h2><span>{{ documents().length }} / {{ maxDocuments() }} documents · {{ indexedChars() }} / {{ maxChars() }} characters</span></div>
        <label class="upload" title="Add a TXT, Markdown, text-based PDF, or SQLite database within the displayed limits">＋ Add document<input #fileInput type="file" accept=".txt,.md,.markdown,.pdf,.sqlite,.db,.sqlite3,text/plain,text/markdown,application/pdf,application/x-sqlite3" (change)="addFile($event)" [disabled]="uploading() || !api.connected()" title="Select a local TXT, Markdown, PDF, or SQLite database" /></label></header>
        <p class="limits">TXT · Markdown · text PDF · bases de datos SQLite. Máximo 100 MiB para documentos, 512 MiB para bases de datos SQLite.</p>
        <div class="drop-zone" (click)="fileInput.click()" [class.uploading]="uploading()">
          <span class="drop-zone-icon">📥</span>
          <div>
            <b>Arrastra y suelta tu base de datos SQLite (.db, .sqlite) o documento aquí</b>
            <p>O haz clic para seleccionar archivos desde tu disco. Admite SQLite con lectura dinámica de esquema.</p>
          </div>
        </div>
        @if (loading() && !indexLoaded()) { <p class="empty" role="status">Loading local index…</p> }
        @if (indexLoaded() && !documents().length) { <p class="empty">No documents indexed. Add a local text document to begin.</p> }
        @for (document of documents(); track document.id) { <article class="doc"><div class="file"><span class="file-icon">{{ fileIcon(document.name) }}</span><div><b>{{ document.name }}</b><small>{{ document.media_type }} · {{ document.char_count }} characters · {{ document.size_bytes }} bytes{{ document.truncated ? ' · truncated at document limit' : '' }}</small></div></div>
          <div class="indexing-badges">
            <span class="badge badge-normal" title="Indexado de manera normal en SQLite FTS5 (búsqueda léxica)">✓ Léxico (Normal)</span>
            @if (isSemanticIndexed(document.id)) {
              <span class="badge badge-semantic" title="Vectores semánticos generados y almacenados">✓ Semántico (Vectores)</span>
            } @else if (indexingSemantic() === document.id) {
              <div class="indexing-progress-container" role="status" aria-live="polite">
                <div class="progress-bar-track">
                  <div class="progress-bar-fill" [style.width.%]="getProgressPercent(document.id)"></div>
                </div>
                <div class="progress-details">
                  <span class="progress-spinner">⚡</span>
                  <span class="progress-stats">{{ getProgressText(document.id) }}</span>
                </div>
              </div>
            } @else {
              <button class="btn-index-semantic" (click)="indexSemantically(document)" title="Generar embeddings vectoriales para búsqueda semántica profunda">⚡ Indexar semánticamente</button>
            }
          </div>
          <time>{{ document.created_at | date:'medium' }}</time><button class="remove" title="Permanently remove this document and its full-text index entry" (click)="remove(document)" [disabled]="removing() === document.id">{{ removing() === document.id ? 'Removing…' : 'Remove' }}</button></article> }
      </section>
    </main>`,
  styles: [`
    :host{display:block;color:var(--text,#e1e5f0)}.knowledge{max-width:1250px;margin:auto;padding:20px;display:grid;gap:14px;position:relative}.heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.eyebrow{font:10px ui-monospace,monospace;color:#8993a7}.heading h1{font-size:21px;margin:4px 0}.heading p{font-size:12px;color:#9ba4b6;margin:0}.heading button,.search-row button,.upload{background:#27303d;border:1px solid #3a4657;color:#e1e5f0;border-radius:4px;padding:8px 11px;font:12px ui-monospace,monospace;cursor:pointer}.status{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px 14px;background:#171d27;border:1px solid #2b3442}.status>div{display:flex;gap:14px;align-items:center}.status b,.meta,.state{font:10px ui-monospace,monospace}.status b{color:#bdc8dc}.state{color:#4edea3}.state.offline{color:#ffb4ab}.meta{color:#8e99ab}.search,.documents{border-top:1px solid #303846;padding-top:13px}.search>label{display:block;font-size:12px;font-weight:600;margin-bottom:8px}.search-row{display:flex;gap:8px}.search-row input{flex:1;min-width:0;padding:9px 10px;background:#10151d;border:1px solid #303a49;border-radius:3px;color:#e2e8f3;font:12px ui-monospace,monospace}.search-row button:disabled,.upload input:disabled,.remove:disabled{opacity:.55}.results-head{font:10px ui-monospace,monospace;color:#aeb8c9;margin:10px 0}.results-head code{color:#d5e1f6}.result,.doc{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid #262e3b}.result>div{display:flex;flex-direction:column;gap:4px}.result b,.doc b{font-size:12px;overflow-wrap:anywhere}.result time,.doc time,.doc small{font:10px ui-monospace,monospace;color:#8994a7}.result p{font-size:11px;color:#b4bdcd;line-height:1.5;white-space:pre-wrap;margin:0;max-width:700px}.documents>header{display:flex;justify-content:space-between;align-items:center;gap:12px}.documents h2{font-size:14px;margin:0 0 4px}.documents header span,.limits{font-size:10px;color:#8e99ab}.limits{line-height:1.5;margin:8px 0 10px}.upload{position:relative;overflow:hidden;white-space:nowrap}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}.doc .file{display:flex;align-items:center;gap:9px;min-width:0;flex:1}.file>div{display:flex;flex-direction:column;gap:4px;min-width:0}.file-icon{display:grid;place-items:center;width:32px;height:34px;flex:none;background:#202a35;color:#a9c5d0;font:9px ui-monospace,monospace;border-radius:2px}.remove{border:1px solid #48353b;background:#251b21;color:#ffb4ab;border-radius:3px;padding:6px 8px;font-size:10px;cursor:pointer}.empty{font-size:11px;color:#8e99ab;padding:12px 0}.error{display:flex;justify-content:space-between;gap:10px;padding:9px 11px;background:#2b2025;border:1px solid #53323a;color:#ffb4ab;font-size:11px}.error button{border:0;background:none;color:inherit;cursor:pointer}.indexing-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.badge{font:10px ui-monospace,monospace;padding:3px 7px;border-radius:3px;display:inline-flex;align-items:center;gap:4px}.badge-normal{background:#142820;border:1px solid #1f4a38;color:#4edea3}.badge-semantic{background:#192636;border:1px solid #284462;color:#70b4ff}.btn-index-semantic{background:#1e293b;border:1px solid #3b82f6;color:#93c5fd;border-radius:3px;padding:4px 8px;font:10px ui-monospace,monospace;cursor:pointer;transition:all .15s ease}.btn-index-semantic:hover:not(:disabled){background:#2563eb;color:#fff}.btn-index-semantic:disabled{opacity:.6;cursor:wait}.indexing-progress-container{display:flex;flex-direction:column;gap:5px;min-width:240px;max-width:340px;background:#141b25;border:1px solid #2e3e55;border-radius:4px;padding:6px 10px}.progress-bar-track{width:100%;height:6px;background:#0d121a;border-radius:3px;overflow:hidden}.progress-bar-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:3px;transition:width .3s ease;box-shadow:0 0 8px rgba(96,165,250,.5)}.progress-details{display:flex;align-items:center;gap:6px;font:10px ui-monospace,monospace;color:#93c5fd}.progress-spinner{animation:pulse 1s infinite alternate}.progress-stats{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@keyframes pulse{0%{opacity:.5}100%{opacity:1}}.drop-zone{margin:10px 0 14px;padding:16px 18px;border:1px dashed #3a4b63;background:#141b24;border-radius:6px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:all .2s ease}.drop-zone:hover{border-color:#5382cc;background:#182230}.drop-zone.uploading{opacity:.6;pointer-events:none}.drop-zone-icon{font-size:26px;flex:none}.drop-zone b{display:block;font-size:12px;color:#d5e1f6;margin-bottom:2px}.drop-zone p{margin:0;font-size:11px;color:#8997ac;font-family:ui-monospace,monospace}.drop-overlay{position:fixed;inset:0;background:rgba(10,14,22,0.85);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none}.drop-card{background:#16202e;border:2px dashed #4e8cf6;border-radius:12px;padding:42px 56px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,0.6)}.drop-icon{font-size:46px;display:block;margin-bottom:12px}.drop-card h3{margin:0 0 6px;font-size:18px;color:#93c5fd}.drop-card p{margin:0;font-size:12px;color:#93a3b8;font-family:ui-monospace,monospace}@media(max-width:640px){.knowledge{padding:14px 11px}.heading{align-items:flex-start}.heading button span{display:none}.status,.documents>header{align-items:flex-start;flex-direction:column}.status{gap:8px}.doc{flex-wrap:wrap}.indexing-badges{order:3;width:100%;margin-top:4px}.doc time{margin-left:41px}.doc .remove{margin-left:auto}.upload{align-self:flex-start}.drop-zone{padding:12px 14px;gap:10px}}
  `]
})
export class KnowledgePage implements OnInit {
  readonly api = inject(ApiService);
  readonly documents = signal<KnowledgeDocument[]>([]);
  readonly results = signal<KnowledgeResult[]>([]);
  readonly loading = signal(false);
  readonly indexLoaded = signal(false);
  readonly searching = signal(false);
  readonly uploading = signal(false);
  readonly dragging = signal(false);
  readonly indexingSemantic = signal('');
  readonly indexingProgress = signal<Record<string, IndexingProgress>>({});
  readonly semanticIndexedIds = signal<Set<string>>(new Set(this.loadSemanticIndexedIds()));
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
      this.indexLoaded.set(true);
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

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.dragging()) this.dragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget === event.target) {
      this.dragging.set(false);
    }
  }

  async onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await this.processFile(files[i]);
    }
  }

  async addFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.processFile(file);
  }

  async detectSqlite(file: File, name: string): Promise<boolean> {
    if (/\.(sqlite|db|sqlite3)$/i.test(name)) return true;
    if (/sqlite/i.test(name) || /^db_/i.test(name)) return true;
    try {
      const slice = await file.slice(0, 16).arrayBuffer();
      const bytes = new Uint8Array(slice);
      const text = new TextDecoder().decode(bytes);
      return text.startsWith('SQLite format 3');
    } catch {
      return false;
    }
  }

  async processFile(file: File) {
    const name = file.name.split(/[\\/]/).pop() || '';
    const isSqlite = await this.detectSqlite(file, name);
    const maxDocBytes = 100 * 1024 * 1024;
    const maxDbBytes = 512 * 1024 * 1024;
    if (!isSqlite && file.size > maxDocBytes) { this.error.set(`El archivo "${name}" excede el límite de 100 MiB.`); return; }
    if (isSqlite && file.size > maxDbBytes) { this.error.set(`La base de datos "${name}" excede el límite de 512 MiB.`); return; }
    this.uploading.set(true); this.error.set('');
    try {
      if (isSqlite) {
        const content_base64 = this.toBase64(await file.arrayBuffer());
        await firstValueFrom(this.api.post('/api/rag/sqlite/sources', { name, content_base64 }));
        await this.load();
      } else {
        let body: {name: string; content: string} | {name: string; content_base64: string};
        if (/\.pdf$/i.test(name)) body = {name, content_base64: this.toBase64(await file.arrayBuffer())};
        else if (/\.(txt|md|markdown)$/i.test(name)) body = {name, content: await file.text()};
        else body = {name, content_base64: this.toBase64(await file.arrayBuffer())};
        await firstValueFrom(this.api.post('/api/knowledge/documents', body));
        await this.load();
      }
    } catch (error) { this.error.set(this.message(error, `No se pudo añadir "${name}"`)); }
    finally { this.uploading.set(false); }
  }

  isSemanticIndexed(id: string): boolean {
    return this.semanticIndexedIds().has(id);
  }

  getProgressPercent(id: string): number {
    const p = this.indexingProgress()[id];
    if (!p || p.percent == null) return 8;
    return Math.max(8, Math.min(100, p.percent));
  }

  getProgressText(id: string): string {
    const p = this.indexingProgress()[id];
    if (!p) return 'Iniciando indexación…';
    const unit = p.unit || 'bloques';
    const done = p.done ?? 0;
    const total = p.total ?? 0;
    const pct = p.percent ?? 0;
    const speed = p.speed ?? 0;
    const eta = p.eta_seconds ?? 0;

    let etaStr = 'calculando…';
    if (eta > 0) {
      if (eta < 60) {
        etaStr = `~${Math.round(eta)}s restantes`;
      } else {
        const mins = Math.floor(eta / 60);
        const secs = Math.round(eta % 60);
        etaStr = `~${mins}m ${secs}s restantes`;
      }
    }

    if (p.current_table) {
      return `${p.current_table}: ${done}/${total} ${unit} (${pct}%) · ${speed}/s · ${etaStr}`;
    }
    if (total > 0) {
      return `${done}/${total} ${unit} (${pct}%) · ${speed}/s · ${etaStr}`;
    }
    return `Indexando… ${pct}%`;
  }

  async indexSemantically(document: KnowledgeDocument) {
    this.indexingSemantic.set(document.id);
    this.error.set('');
    this.indexingProgress.update(prev => ({
      ...prev,
      [document.id]: { phase: 'starting', percent: 8, done: 0, total: 0, speed: 0, eta_seconds: 0 }
    }));

    let polling = true;
    const pollTimer = setInterval(async () => {
      if (!polling) return;
      try {
        const res = await firstValueFrom(this.api.get<KnowledgeResponse<IndexingProgress>>(`/api/rag/indexing/progress?target_id=${encodeURIComponent(document.id)}`));
        if (res.data) {
          this.indexingProgress.update(prev => ({ ...prev, [document.id]: res.data }));
        }
      } catch {}
    }, 350);

    try {
      await firstValueFrom(this.api.post(`/api/rag/knowledge/documents/${encodeURIComponent(document.id)}/index_semantic`, {}));
      const next = new Set(this.semanticIndexedIds());
      next.add(document.id);
      this.semanticIndexedIds.set(next);
      this.saveSemanticIndexedIds(next);
    } catch (error) {
      this.error.set(this.message(error, 'Could not generate semantic embeddings'));
    } finally {
      polling = false;
      clearInterval(pollTimer);
      this.indexingSemantic.set('');
    }
  }
  fileIcon(name: string): string {
    if (/\.(sqlite|db|sqlite3)$/i.test(name) || name.includes('_schema.md')) return 'SQL';
    if (/\.pdf$/i.test(name)) return 'PDF';
    if (/\.(md|markdown)$/i.test(name)) return 'MD';
    return 'TXT';
  }
  async remove(document: KnowledgeDocument) {
    this.removing.set(document.id); this.error.set('');
    try {
      await firstValueFrom(this.api.delete(`/api/knowledge/documents/${encodeURIComponent(document.id)}`));
      const next = new Set(this.semanticIndexedIds());
      next.delete(document.id);
      this.semanticIndexedIds.set(next);
      this.saveSemanticIndexedIds(next);
      await this.load();
    } catch (error) { this.error.set(this.message(error, 'Could not remove document')); }
    finally { this.removing.set(''); }
  }
  private loadSemanticIndexedIds(): string[] {
    try {
      const raw = localStorage.getItem('aidream.semantic_indexed_docs');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  private saveSemanticIndexedIds(ids: Set<string>): void {
    try {
      localStorage.setItem('aidream.semantic_indexed_docs', JSON.stringify([...ids]));
    } catch {}
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
