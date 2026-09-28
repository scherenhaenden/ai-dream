import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../core/api.service';

interface HardwareData {
  cpu?: { name?: string; logical_cores?: number; physical_cores?: number; };
  ram?: { total_bytes?: number; available_bytes?: number; };
  os?: { system?: string; release?: string; version?: string; architecture?: string; distribution?: string; };
  gpus?: Array<{
    index?: number; vendor?: string; name?: string; memory_total_bytes?: number; memory_free_bytes?: number; backends?: string[];
    pci_address?: string; virtual?: boolean; pci_vendor_id?: string; pci_device_id?: string;
  }>;
}

@Component({
  selector: 'app-hardware',
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

    @if (loadError()) {
      <p class="error-line">{{ loadError() }}</p>
    } @else if (!payload()) {
      <section class="surface empty-surface">
        <div class="empty-illustration">▤</div>
        <h2>Loading hardware...</h2>
      </section>
    } @else {
      <div class="hardware-grid">
        @if (payload()?.cpu; as cpu) {
          <section class="surface hw-card">
            <div class="card-title">
              ▤
              <h2>CPU</h2>
            </div>
            <div class="card-content">
              <div class="data-row"><span class="label">Name</span><span class="value">{{ cpu.name || 'Unknown' }}</span></div>
              <div class="data-row"><span class="label">Cores</span><span class="value">{{ cpu.physical_cores || '?' }} physical / {{ cpu.logical_cores || '?' }} logical</span></div>
            </div>
          </section>
        }

        @if (payload()?.ram; as ram) {
          <section class="surface hw-card">
            <div class="card-title">
              ▤
              <h2>System RAM</h2>
            </div>
            <div class="card-content">
              <div class="data-row"><span class="label">Total</span><span class="value">{{ formatBytes(ram.total_bytes) }}</span></div>
              <div class="data-row"><span class="label">Available</span><span class="value">{{ formatBytes(ram.available_bytes) }}</span></div>
            </div>
          </section>
        }

        @if (payload()?.os; as os) {
          <section class="surface hw-card">
            <div class="card-title">
              ⌨
              <h2>OS</h2>
            </div>
            <div class="card-content">
              <div class="data-row"><span class="label">System</span><span class="value">{{ os.system || 'Unknown' }} {{ os.release || '' }}</span></div>
              <div class="data-row"><span class="label">Distribution</span><span class="value">{{ os.distribution || 'Unknown' }}</span></div>
              <div class="data-row"><span class="label">Architecture</span><span class="value">{{ os.architecture || 'Unknown' }}</span></div>
            </div>
          </section>
        }
      </div>

      @if (payload()?.gpus?.length) {
        <h2 class="section-heading">GPUs</h2>
        <div class="hardware-grid">
          @for (gpu of payload()?.gpus; track gpu.index) {
            <section class="surface hw-card">
              <div class="card-title">
                ▤
                <h2>GPU {{ gpu.index }}</h2>
              </div>
              <div class="card-content">
                <div class="data-row"><span class="label">Name</span><span class="value">{{ gpu.vendor || '' }} {{ gpu.name || 'Unknown GPU' }}</span></div>
                <div class="data-row"><span class="label">Memory Total</span><span class="value">{{ formatBytes(gpu.memory_total_bytes) }}</span></div>
                <div class="data-row"><span class="label">Memory Free</span><span class="value">{{ formatBytes(gpu.memory_free_bytes) }}</span></div>
                <div class="data-row"><span class="label">PCI Address</span><span class="value">{{ gpu.pci_address || 'N/A' }}</span></div>
                <div class="data-row"><span class="label">Backends</span><span class="value">{{ gpu.backends?.join(', ') || 'None' }}</span></div>
              </div>
            </section>
          }
        </div>
      }

      <div class="json-toggle-container">
        <button class="secondary-button" (click)="showJson.set(!showJson())">
          {{ showJson() ? 'Hide JSON' : 'Show JSON' }}
        </button>
      </div>

      @if (showJson()) {
        <pre class="data-payload">{{ fullPayload() | json }}</pre>
      }
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
    .hw-card {
      padding: 20px;
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      border-bottom: 1px solid #2e3541;
      padding-bottom: 10px;
    }
    .card-title h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
      color: #dee2f1;
    }
    .icon {
      color: #a0caff;
    }
    .data-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .label {
      color: #8c909f;
      font-family: 'JetBrains Mono', monospace;
    }
    .value {
      color: #dee2f1;
      font-weight: 500;
      text-align: right;
    }
    .section-heading {
      font-size: 16px;
      font-weight: 600;
      color: #dee2f1;
      margin: 24px 0 16px 0;
      max-width: 1050px;
    }
    .json-toggle-container {
      margin-top: 24px;
      max-width: 1050px;
    }
  `]
})
export class HardwarePage implements OnInit {
  readonly payload = signal<HardwareData | null>(null);
  readonly fullPayload = signal<any | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly showJson = signal(false);

  constructor(readonly api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loadError.set(null);
    this.api.get<any>('/api/hardware').subscribe({
      next: (response: any) => {
        const data = response && typeof response === 'object' && 'data' in response ? response.data : response;
        this.fullPayload.set(data);
        this.payload.set(data?.hardware || null);
      },
      error: (error) => this.loadError.set(error?.message || 'Local endpoint did not return data')
    });
  }

  formatBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null) return 'Unknown';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
