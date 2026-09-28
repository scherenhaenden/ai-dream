import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { JsonPipe } from '@angular/common';

@Component({
  standalone: true,
  imports: [JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div>
        <div class="eyebrow">SYSTEM</div>
        <h1>Hardware</h1>
        <p>Inspect processors, memory, and accelerator devices available to local runtimes.</p>
      </div>
      <span class="page-badge"><i></i>{{ api.connected() ? 'LOCAL API' : 'LOCAL ONLY' }}</span>
    </div>

    @if (loading()) {
      <p role="status" class="surface loading-surface">Loading hardware data…</p>
    } @else if (loadError()) {
      <section class="surface empty-surface">
        <p class="error-line" role="alert">{{ loadError() }}</p>
        <button class="secondary-button" (click)="load()">Retry</button>
      </section>
    } @else if (hardware()) {
      <div class="hardware-grid">
        <!-- CPU Card -->
        <section class="surface hardware-card">
          <div class="card-header">
            <div class="icon">💻</div>
            <div>
              <h2>Processor (CPU)</h2>
              <p class="subtitle">{{ hardware()?.cpu?.vendor || 'Unknown Vendor' }}</p>
            </div>
          </div>
          <div class="card-body">
            <div class="stat-row">
              <span class="stat-label">Model</span>
              <span class="stat-value">{{ hardware()?.cpu?.model || 'Unknown Model' }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Logical Cores</span>
              <span class="stat-value">{{ hardware()?.cpu?.cores || '?' }}</span>
            </div>
          </div>
        </section>

        <!-- Memory Card -->
        <section class="surface hardware-card">
          <div class="card-header">
            <div class="icon">💾</div>
            <div>
              <h2>System Memory (RAM)</h2>
              <p class="subtitle">Host volatile storage</p>
            </div>
          </div>
          <div class="card-body">
            <div class="stat-row">
              <span class="stat-label">Total Capacity</span>
              <span class="stat-value">{{ hardware()?.memory?.total_gb || '?' }} GB</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Available Free</span>
              <span class="stat-value">{{ hardware()?.memory?.free_gb || '?' }} GB</span>
            </div>
          </div>
        </section>

        <!-- Devices Card(s) -->
        @for (device of (hardware()?.devices || []); track device.id) {
          <section class="surface hardware-card">
            <div class="card-header">
              <div class="icon">⚡</div>
              <div>
                <h2>Compute Device ({{ device.id }})</h2>
                <p class="subtitle">{{ device.name || 'Unknown Device' }}</p>
              </div>
            </div>
            <div class="card-body">
              <div class="stat-row">
                <span class="stat-label">VRAM</span>
                <span class="stat-value">{{ device.memory || '?' }} GB</span>
              </div>
            </div>
          </section>
        }
      </div>

      <div class="json-toggle-container">
        <button class="secondary-button" (click)="showJson.set(!showJson())">
          {{ showJson() ? 'Hide raw JSON' : 'Show raw JSON payload' }}
        </button>
      </div>

      @if (showJson()) {
        <section class="surface json-surface">
          <pre class="data-payload">{{ hardware() | json }}</pre>
        </section>
      }
    } @else {
      <section class="surface empty-surface">
        <h2>Waiting for the local backend</h2>
        <p>Connect the AI Dream local API to load real system data here.</p>
        <button class="secondary-button" (click)="load()">Load from local API <span>↻</span></button>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .hardware-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
      max-width: 1050px;
    }
    .hardware-card {
      padding: 20px;
      border: 1px solid #2e3541;
      border-radius: 12px;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #2e3541;
    }
    .card-header .icon {
      font-size: 24px;
      background: #1a2230;
      padding: 10px;
      border-radius: 8px;
    }
    .card-header h2 {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }
    .card-header .subtitle {
      color: #929aaa;
      font-size: 12px;
      margin: 4px 0 0;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 13px;
    }
    .stat-row:last-child {
      margin-bottom: 0;
    }
    .stat-label {
      color: #8892a2;
    }
    .stat-value {
      color: #e0e2ec;
      font-weight: 500;
      font-family: ui-monospace, monospace;
    }
    .json-toggle-container {
      margin-bottom: 16px;
      max-width: 1050px;
    }
    .json-surface {
      padding: 20px;
      border-radius: 12px;
      background: #10151e;
      border: 1px solid #2e3541;
      max-width: 1050px;
    }
    .data-payload {
      margin: 0;
      color: #aab4c5;
      font: 11px ui-monospace, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `]
})
export class HardwarePage implements OnInit {
  readonly hardware = signal<any | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly showJson = signal(false);

  constructor(readonly api: ApiService) {}

  ngOnInit() {
    if (this.api.connected()) {
      this.load();
    }
  }

  load() {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get<any>('/api/hardware').subscribe({
      next: (response) => {
        this.hardware.set(response?.data || response || {});
        this.loading.set(false);
      },
      error: (error) => {
        this.loadError.set(error?.message || 'Local endpoint did not return data');
        this.loading.set(false);
      }
    });
  }
}
