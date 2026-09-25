import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { HubFile, HubModel, HubService } from '../core/hub.service';

@Component({
  standalone: true, imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head"><div><div class="eyebrow">LIBRARY</div><h1>Model Hub</h1><p>Find GGUF models on Hugging Face and download them to your local library.</p></div><span class="page-badge"><i [class.online]="api.connected()"></i>{{ api.connected() ? 'LOCAL API' : 'API OFFLINE' }}</span></div>
    <section class="hub-search surface"><form (submit)="submit($event)"><label class="sr-only" for="hub-query">Search Hugging Face models</label><span class="hub-search-icon">⌕</span><input id="hub-query" type="search" placeholder="Search models on Hugging Face…" [value]="query()" (input)="query.set($any($event.target).value)" [disabled]="!api.connected() || searching()"><button class="primary-button" [disabled]="!api.connected() || searching() || !query().trim()">{{ searching() ? 'Searching…' : 'Search' }}</button></form><div class="hub-search-foot"><span>GGUF repositories</span><span>Downloads are stored by the local AI Dream service</span></div></section>
    @if (error()) { <div class="hub-error" role="alert"><b>Request failed</b><span>{{ error() }}</span><button class="secondary-button" (click)="retry()">Retry</button></div> }
    @if (!api.connected()) { <section class="surface hub-empty"><div class="empty-illustration">⌕</div><h2>Local backend unavailable</h2><p>Connect to AI Dream’s local service to search Hugging Face repositories.</p></section> }
    @else if (!searched() && !searching()) { <section class="surface hub-empty"><div class="empty-illustration">⌕</div><h2>Search the model hub</h2><p>Search by model name or author. Results and files come directly from Hugging Face.</p></section> }
    @else if (searching()) { <div class="hub-loading" aria-live="polite">Querying Hugging Face…</div> }
    @else if (results().length === 0 && !error()) { <section class="surface hub-empty"><div class="empty-illustration">⌕</div><h2>No repositories found</h2><p>Try another model name or author.</p></section> }
    @else { <div class="hub-layout"><section class="hub-results" aria-label="Search results">@for (model of results(); track model.repo_id) { <button class="hub-model surface" [class.selected]="selected()?.repo_id === model.repo_id" (click)="select(model)"><span class="hub-model-icon">⬡</span><span class="hub-model-copy"><b>{{ model.repo_id }}</b><small>{{ model.pipeline_tag || 'Hugging Face repository' }}</small></span><span class="hub-model-stats">{{ model.downloads != null ? compact(model.downloads) + ' ↓' : '' }}</span><span class="hub-chevron">›</span></button> }</section>
    <section class="hub-files surface">@if (!selected()) { <div class="hub-file-empty"><span>Choose a repository</span><small>GGUF files will appear here.</small></div> } @else { <div class="hub-files-head"><div><div class="eyebrow">REPOSITORY</div><h2>{{ selected()?.repo_id }}</h2></div><button class="secondary-button" (click)="loadFiles(selected()!)" [disabled]="loadingFiles()">↻</button></div>@if (loadingFiles()) { <div class="hub-loading">Loading repository files…</div> } @else if (fileError()) { <p class="error-line">{{ fileError() }}</p> } @else if (files().length === 0) { <div class="hub-file-empty"><span>No GGUF files found</span><small>This repository has no downloadable GGUF files.</small></div> } @else { <div class="hub-file-list">@for (file of files(); track file.file_name) { <div class="hub-file"><span class="hub-file-icon">▤</span><div class="hub-file-copy"><b>{{ file.file_name }}</b><small>{{ file.quantization || 'GGUF' }}<span> · </span>{{ file.size_label || size(file.size_bytes) }}</small></div><button class="primary-button" [disabled]="starting()" (click)="download(file)">{{ startingFile() === file.file_name ? 'Starting…' : 'Download' }} <span>↓</span></button></div> }</div> } } </section></div> }
    <div class="page-note"><span>ⓘ</span><span>Large model downloads can take time and disk space. Active transfers are visible in <a routerLink="/downloads">Downloads</a>.</span></div>
  `
})
export class HubPage {
  readonly query = signal(''); readonly searching = signal(false); readonly searched = signal(false); readonly results = signal<HubModel[]>([]); readonly selected = signal<HubModel|null>(null); readonly files = signal<HubFile[]>([]); readonly loadingFiles = signal(false); readonly error = signal<string|null>(null); readonly fileError = signal<string|null>(null); readonly starting = signal(false); readonly startingFile = signal<string|null>(null);
  constructor(readonly api: ApiService, private hub: HubService) {}
  submit(event: Event) { event.preventDefault(); void this.search(); }
  retry() { void this.search(); }
  async search() { if (!this.query().trim()) return; this.searching.set(true); this.searched.set(true); this.error.set(null); this.results.set([]); this.selected.set(null); this.files.set([]); try { this.results.set(await this.hub.search(this.query().trim())); } catch (e) { this.error.set(message(e)); } finally { this.searching.set(false); } }
  select(model: HubModel) { this.selected.set(model); this.files.set([]); void this.loadFiles(model); }
  async loadFiles(model: HubModel) { this.loadingFiles.set(true); this.fileError.set(null); try { this.files.set(await this.hub.files(model.repo_id)); } catch (e) { this.fileError.set(message(e)); } finally { this.loadingFiles.set(false); } }
  async download(file: HubFile) { this.starting.set(true); this.startingFile.set(file.file_name); try { await this.hub.start(this.selected()!.repo_id, file.file_name); } catch (e) { this.error.set(message(e)); } finally { this.starting.set(false); this.startingFile.set(null); } }
  compact(n: number) { return Intl.NumberFormat(undefined,{notation:'compact'}).format(n); }
  size(n?: number) { return n == null ? 'Size unavailable' : n >= 1e9 ? `${(n/1e9).toFixed(1)} GB` : `${(n/1e6).toFixed(0)} MB`; }
}
function message(error: unknown) { return error instanceof Error ? error.message : 'The local API request failed'; }
