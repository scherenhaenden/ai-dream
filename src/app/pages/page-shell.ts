import { ChangeDetectionStrategy, Component, Input, OnInit, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'page-shell', standalone: true, imports: [JsonPipe], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head"><div><div class="eyebrow">{{ section }}</div><h1>{{ title }}</h1><p>{{ description }}</p></div><span class="page-badge"><i></i>{{ api.connected() ? 'LOCAL API' : 'LOCAL ONLY' }}</span></div>
    <section class="surface empty-surface"><div class="empty-illustration">{{ symbol }}</div><h2>{{ payload() !== null ? 'Local data received' : api.connected() ? 'Ready for local data' : 'Waiting for the local backend' }}</h2><p>{{ payload() !== null ? 'This response came directly from your local AI Dream service.' : api.connected() ? connectedText : 'Connect the AI Dream local API to load real system data here. Nothing is simulated.' }}</p><div class="endpoint"><span class="endpoint-dot"></span><code>{{ endpoint }}</code><span class="endpoint-status">{{ payload() !== null ? 'Data received' : api.connected() ? 'Connected' : 'Not reachable' }}</span></div>@if (payload() !== null) {<pre class="data-payload">{{ payload() | json }}</pre>} @if (loadError()) {<p class="error-line">{{ loadError() }}</p>} @if (!api.connected()) {<button class="secondary-button" (click)="api.check()">Retry connection <span>↻</span></button>} @else if (dataPath && payload() === null) {<button class="secondary-button" (click)="load()">Load from local API <span>↻</span></button>}</section>
    <div class="page-note"><span>ⓘ</span><span>This screen displays only information received from your local service. No sample models, device stats, or download progress are fabricated.</span></div>
  `
})
export class PageShell implements OnInit {
  @Input({ required: true }) title = '';
  @Input() section = 'WORKSPACE';
  @Input() description = '';
  @Input() endpoint = 'GET /api/health';
  @Input() dataPath = '';
  readonly payload = signal<unknown | null>(null);
  readonly loadError = signal<string | null>(null);
  @Input() symbol = '◫';
  @Input() connectedText = 'The API is reachable. This feature will populate when its endpoint is implemented.';
  constructor(readonly api: ApiService) {}
  ngOnInit() { if (this.dataPath && this.api.connected()) this.load(); }
  load() { this.loadError.set(null); this.api.get<unknown>(this.dataPath).subscribe({ next: (response: any) => this.payload.set(response && typeof response === 'object' && 'data' in response ? response.data : response), error: (error) => this.loadError.set(error?.message || 'Local endpoint did not return data') }); }
}
