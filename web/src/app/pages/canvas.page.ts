import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ArtifactService } from '../core/artifact.service';
import type { ArtifactLifetime } from '../core/artifact.types';
import { CanvasWorkspaceService, type CanvasTab } from '../core/canvas-workspace.service';
import { parseJsonTableData, renderSafeMarkdown } from '../core/canvas-renderers';

@Component({
  selector: 'ai-canvas-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="canvas-page">
      <header class="canvas-heading"><div><span class="eyebrow">WORKSPACE / OUTPUTS</span><h1>Canvas</h1><p>Generated outputs stay in their own tabs while new results arrive.</p></div><span class="tab-count">{{ workspace.tabs().length }} tabs</span></header>
      @if (workspace.tabs().length) {
        <nav class="canvas-tabs" role="tablist" aria-label="Open Canvas outputs">
          @for (tab of workspace.tabs(); track tab.id) {
            <div class="canvas-tab" [class.active]="workspace.activeTabId() === tab.id">
              <button type="button" role="tab" [id]="'canvas-tab-' + tab.id" [attr.aria-controls]="'canvas-panel-' + tab.id"
                [attr.aria-selected]="workspace.activeTabId() === tab.id" [attr.tabindex]="workspace.activeTabId() === tab.id ? 0 : -1"
                [title]="tab.title" (click)="workspace.activate(tab.id)" (keydown)="onTabKeydown(tab, $event)">
                <span>{{ kindLabel(tab) }}</span><b>{{ tab.title }}</b>
              </button>
              <button type="button" class="close-tab" [attr.aria-label]="'Close ' + tab.title" (click)="workspace.close(tab.id)">×</button>
            </div>
          }
        </nav>
      }
      @if (workspace.activeTab(); as tab) {
        <section class="canvas-view" role="tabpanel" [id]="'canvas-panel-' + tab.id" [attr.aria-labelledby]="'canvas-tab-' + tab.id" tabindex="0">
          <header class="view-heading"><div><span class="kind-chip">{{ kindLabel(tab) }}</span><h2>{{ tab.title }}</h2><small>From {{ tab.source === 'run' ? 'Run' : 'Chat' }} · {{ tab.sourceId }}</small>
            @if (tab.artifact; as artifact) { <small class="artifact-meta">{{ artifact.media_type }} · {{ artifactSize(artifact.size_bytes) }} · {{ lifetimeLabel(artifact.lifetime) }}</small> }
          </div></header>
          @if (loadError()) { <div class="view-error" role="alert"><span>{{ loadError() }}</span><button type="button" (click)="retry(tab)">Retry</button></div> }
          @else if (loading()) { <p class="view-loading" role="status">Loading output…</p> }
          @else if (tab.kind === 'image') {
            @if (previewUrl(tab)) { <img class="image-preview" [src]="previewUrl(tab)" [alt]="tab.title"> }
            @else { <p class="view-error">No image data is available for this tab.</p> }
            @if (previewUrl(tab)) { <div class="view-actions"><a [href]="previewUrl(tab)" target="_blank" rel="noopener noreferrer">Open image</a><a [href]="previewUrl(tab)" [download]="tab.title">Save image</a></div> }
          }
          @else if (tab.kind === 'audio') {
            @if (previewUrl(tab)) { <audio class="audio-preview" controls preload="metadata" [src]="previewUrl(tab)">Audio preview is not supported by this browser.</audio> }
            @else { <p class="view-error">No audio data is available for this tab.</p> }
            @if (previewUrl(tab)) { <div class="view-actions"><a [href]="previewUrl(tab)" [download]="tab.title">Download audio</a></div> }
          }
          @else if (tab.kind === 'html') {
            @if (previewUrl(tab)) { <iframe class="html-preview" [src]="trustedUrl(previewUrl(tab)!)" [title]="'HTML preview of ' + tab.title" sandbox=""></iframe> }
            @else { <iframe class="html-preview" [srcdoc]="content()" [title]="'HTML preview of ' + tab.title" sandbox=""></iframe> }
            <details class="source-panel"><summary>HTML source</summary><pre>{{ content() }}</pre></details>
          }
          @else if (tab.kind === 'pdf') {
            @if (previewUrl(tab)) { <iframe class="pdf-preview" [src]="trustedUrl(previewUrl(tab)!)" [title]="'PDF preview of ' + tab.title"></iframe>
              <div class="view-actions"><a [href]="previewUrl(tab)" target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a><a [href]="previewUrl(tab)" [download]="tab.title">Download PDF</a></div> }
            @else { <p class="view-error">No PDF data is available for this tab.</p> }
          }
          @else if (tab.kind === 'markdown') {
            <article class="markdown-preview" [innerHTML]="renderMarkdown(content())"></article>
            <details class="source-panel"><summary>Markdown source</summary><pre>{{ content() }}</pre></details>
          }
          @else if (tab.kind === 'json') {
            @if (tableMode()) {
              @if (tableData(); as table) {
                <div class="table-toolbar"><b>Showing {{ table.rows.length }} of {{ table.totalRows }} rows · {{ table.columns.length }} columns</b><button type="button" (click)="tableMode.set(false)">View JSON</button></div>
                <div class="table-scroll" role="region" aria-label="Structured data table" tabindex="0"><table><thead><tr>@for (column of table.columns; track column) { <th scope="col">{{ column }}</th> }</tr></thead><tbody>@for (row of table.rows; track $index) { <tr>@for (column of table.columns; track column) { <td>{{ formatCell(row[column]) }}</td> }</tr> }</tbody></table></div>
              } @else { <pre class="text-preview json-preview">{{ formattedContent(tab) }}</pre> }
            } @else {
              <pre class="text-preview json-preview">{{ formattedContent(tab) }}</pre>
              @if (tableData()) { <button type="button" class="table-open" (click)="tableMode.set(true)">View as table</button> }
            }
          }
          @else if (tab.kind === 'code') { <textarea class="text-preview code-preview code-editor" aria-label="Editable code output" spellcheck="false" [value]="content()" (input)="editCode(tab, $event)"></textarea> }
          @else if (tab.artifact && previewUrl(tab)) {
            @if (content()) { <pre class="text-preview document-preview">{{ content() }}</pre> }
            <div class="view-actions"><a [href]="previewUrl(tab)" target="_blank" rel="noopener noreferrer">Open {{ tab.title }}</a><a [href]="previewUrl(tab)" [download]="tab.title">Download {{ tab.title }}</a></div>
          }
          @else { <pre class="text-preview">{{ content() }}</pre> }
        </section>
      } @else {
        <section class="canvas-empty"><span aria-hidden="true">▤</span><h2>No outputs open</h2><p>Use <b>Open in Canvas</b> from Chat or Runs. New results are added as background tabs and leave your current view selected.</p></section>
      }
    </main>
  `,
  styles: [`
    :host{display:block;color:var(--text,#e4e9f2)}.canvas-page{max-width:1280px;margin:0 auto;padding:20px;display:grid;gap:12px}.canvas-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid #2b3240}.eyebrow{color:#8793a8;font:9px ui-monospace,monospace;letter-spacing:.06em}.canvas-heading h1{margin:4px 0;font-size:23px}.canvas-heading p{margin:0;color:#929aaa;font-size:11px}.tab-count{color:#95a3b8;font:9px ui-monospace,monospace}.canvas-tabs{display:flex;gap:4px;overflow:auto;padding-bottom:4px;border-bottom:1px solid #303744}.canvas-tab{display:flex;align-items:center;min-width:0;border:1px solid #303744;border-radius:5px 5px 0 0;background:#141a24}.canvas-tab.active{border-color:#7396c9;background:#202a38}.canvas-tab>button:first-child{display:grid;gap:3px;min-width:100px;max-width:230px;padding:8px 10px;border:0;background:transparent;color:#d5deec;text-align:left;cursor:pointer}.canvas-tab span{color:#9eabc0;font:8px ui-monospace,monospace;text-transform:uppercase}.canvas-tab b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.close-tab{align-self:stretch;padding:0 8px;border:0;background:transparent;color:#9ba7b9;cursor:pointer}.close-tab:hover{color:#ffb4ab}.canvas-view{min-height:60vh;padding:14px;border:1px solid #2e3848;border-radius:5px;background:#111722;overflow:hidden}.view-heading{display:flex;justify-content:space-between;gap:12px;padding-bottom:11px;border-bottom:1px solid #283140}.view-heading>div{display:grid;gap:5px;min-width:0}.view-heading h2{margin:0;overflow-wrap:anywhere;font-size:14px}.view-heading small{color:#8996aa;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.kind-chip{width:max-content;padding:3px 5px;border-radius:3px;background:#263449;color:#b9d1f0;font:8px ui-monospace,monospace;text-transform:uppercase}.markdown-preview{max-width:900px;margin:18px auto;color:#d3dbe8;font-size:13px;line-height:1.65;overflow-wrap:anywhere}.markdown-preview h1,.markdown-preview h2,.markdown-preview h3,.markdown-preview h4,.markdown-preview h5,.markdown-preview h6{color:#edf2fb;line-height:1.3}.markdown-preview p{margin:8px 0}.markdown-preview ul,.markdown-preview ol{padding-left:22px}.markdown-preview pre{overflow:auto;padding:12px;border:1px solid #2b374a;border-radius:4px;background:#0a1018;color:#d4e1f2;font:10px/1.55 ui-monospace,monospace}.markdown-preview code{padding:1px 3px;border-radius:2px;background:#222c3b;color:#d6e4fb;font:0.92em ui-monospace,monospace}.markdown-preview a{color:#a9c9fb;text-decoration:underline}.markdown-preview blockquote{margin:8px 0;padding:2px 12px;border-left:2px solid #617caa;color:#aab9d0}.markdown-preview table{width:100%;border-collapse:collapse;font-size:10px}.markdown-preview th,.markdown-preview td{padding:6px 8px;border:1px solid #344154;text-align:left;vertical-align:top}.table-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0;color:#b7c5d9;font:9px ui-monospace,monospace}.table-toolbar button,.table-open{padding:6px 8px;border:1px solid #3b4d67;border-radius:4px;background:#182233;color:#c7dafa;font-size:9px;cursor:pointer}.table-scroll{max-height:70vh;overflow:auto;border:1px solid #303d50;border-radius:4px}.table-scroll table{width:100%;border-collapse:collapse;font-size:10px;white-space:pre-wrap}.table-scroll th,.table-scroll td{min-width:90px;max-width:340px;padding:7px 9px;border:1px solid #2b3748;text-align:left;vertical-align:top;overflow-wrap:anywhere}.table-scroll th{position:sticky;top:0;background:#1a2534;color:#d6e2f3}.table-scroll td{color:#c1ccdc}.text-preview{max-height:72vh;overflow:auto;margin:15px 0;padding:14px;border:1px solid #273244;border-radius:4px;background:#0b1018;color:#d0d9e8;font:11px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.json-preview{color:#c7dcff}.code-preview{color:#d3e3d6}.code-editor{display:block;width:100%;min-height:60vh;resize:vertical;box-sizing:border-box;white-space:pre;tab-size:2}.source-panel{margin-top:12px;color:#aab7ca;font-size:10px}.source-panel summary{cursor:pointer}.source-panel pre{max-height:60vh;overflow:auto;padding:12px;background:#0b1018;color:#c7d2e2;font:10px/1.55 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.image-preview{display:block;max-width:100%;max-height:72vh;margin:18px auto;object-fit:contain}.audio-preview{display:block;width:min(720px,100%);margin:30px auto}.html-preview,.pdf-preview{display:block;width:100%;height:min(68vh,760px);margin-top:14px;border:1px solid #364153;border-radius:4px;background:#fff}.view-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.view-actions a,.view-error button{padding:8px 10px;border:1px solid #3b4d67;border-radius:4px;background:#182233;color:#c7dafa;font-size:10px;text-decoration:none;cursor:pointer}.view-error{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:14px 0;padding:10px;border:1px solid #583d44;border-radius:4px;background:#261b20;color:#ffb4ab;font-size:10px}.view-loading{padding:20px;color:#9eabc0;font-size:11px}.canvas-empty{display:grid;place-items:center;align-content:center;min-height:50vh;padding:24px;text-align:center;border:1px dashed #39465a;border-radius:5px;background:#121923}.canvas-empty>span{font-size:28px;color:#99b9e4}.canvas-empty h2{margin:10px 0 4px;font-size:14px}.canvas-empty p{max-width:440px;color:#9ba7b8;font-size:11px;line-height:1.6}.canvas-empty b{color:#c9dcf9}.canvas-page button:focus-visible,.canvas-page a:focus-visible,.canvas-page summary:focus-visible,.canvas-page textarea:focus-visible{outline:2px solid #adc6ff;outline-offset:2px}@media(max-width:600px){.canvas-page{padding:13px 10px}.canvas-view{padding:10px}.canvas-tab>button:first-child{min-width:75px;max-width:145px}}
  `],
})
export class CanvasPage implements OnDestroy {
  readonly workspace = inject(CanvasWorkspaceService);
  private readonly artifactService = inject(ArtifactService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly content = signal('');
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly tableMode = signal(false);
  private readonly previewUrls = signal<Record<string, string>>({});
  private loadKey = '';

  constructor() {
    effect(() => {
      const tab = this.workspace.activeTab();
      const key = tab ? `${tab.id}:${tab.updatedAt}` : '';
      if (key === this.loadKey) return;
      this.loadKey = key;
      this.tableMode.set(false);
      this.loadError.set('');
      if (!tab) { this.content.set(''); this.loading.set(false); return; }
      if (tab.artifact) void this.loadArtifact(tab, key);
      else { this.content.set(tab.content ?? ''); this.loading.set(false); }
    });
  }

  ngOnDestroy(): void {
    for (const url of Object.values(this.previewUrls())) URL.revokeObjectURL(url);
  }

  kindLabel(tab: CanvasTab): string { return tab.kind; }
  artifactSize(bytes: number): string { return this.artifactService.formatSize(bytes); }
  lifetimeLabel(value: ArtifactLifetime): string {
    return value === 'ephemeral' ? 'Temporary' : value === 'session' ? 'This session'
      : value === 'persistent' ? 'Persistent' : 'Retention unknown';
  }
  onTabKeydown(tab: CanvasTab, event: KeyboardEvent): void {
    const tabs = this.workspace.tabs();
    const current = tabs.findIndex(item => item.id === tab.id);
    if (current < 0 || tabs.length < 2) return;
    const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    this.workspace.activate(tabs[next].id);
    document.getElementById(`canvas-tab-${tabs[next].id}`)?.focus();
  }
  previewUrl(tab: CanvasTab): string | null { return this.previewUrls()[tab.id] ?? null; }
  trustedUrl(url: string) { return this.sanitizer.bypassSecurityTrustResourceUrl(url); }

  formattedContent(tab: CanvasTab): string {
    const text = this.content();
    if (!text) return '';
    try { return JSON.stringify(JSON.parse(text), null, 2); }
    catch { return text; }
  }

  readonly tableData = computed(() => this.workspace.activeTab()?.kind === 'json'
    ? parseJsonTableData(this.content()) : null);

  formatCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const formatted = typeof value === 'string' ? value
      : typeof value === 'number' || typeof value === 'boolean' ? String(value)
      : JSON.stringify(value);
    return formatted.length > 2000 ? `${formatted.slice(0, 1997)}…` : formatted;
  }

  editCode(tab: CanvasTab, event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) this.workspace.updateText(tab.id, event.target.value);
  }

  renderMarkdown(value: string): string { return renderSafeMarkdown(value); }

  retry(tab: CanvasTab): void {
    this.loadError.set('');
    const key = `${tab.id}:${tab.updatedAt}:retry:${Date.now()}`;
    this.loadKey = '';
    this.loadKey = key;
    void this.loadArtifact(tab, key);
  }

  private async loadArtifact(tab: CanvasTab, key: string): Promise<void> {
    if (!tab.artifact) return;
    this.loading.set(true);
    try {
      const url = await this.artifactService.createPreviewUrl(tab.artifact);
      if (!this.isCurrent(tab, key)) { URL.revokeObjectURL(url); return; }
      this.previewUrls.update(current => {
        const previous = current[tab.id];
        if (previous) URL.revokeObjectURL(previous);
        return { ...current, [tab.id]: url };
      });
      if (['markdown', 'json', 'html'].includes(tab.kind)
          || (tab.kind === 'document' && !!tab.artifact?.media_type.toLowerCase().startsWith('text/'))) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not read artifact content (${response.status}).`);
        const text = await response.text();
        if (this.isCurrent(tab, key)) this.content.set(text);
      }
    } catch (error) {
      if (this.isCurrent(tab, key)) this.loadError.set(error instanceof Error ? error.message : 'Could not load artifact content.');
    } finally {
      if (this.isCurrent(tab, key)) this.loading.set(false);
    }
  }

  private isCurrent(tab: CanvasTab, key: string): boolean {
    return this.workspace.activeTab()?.id === tab.id && this.loadKey === key;
  }
}
