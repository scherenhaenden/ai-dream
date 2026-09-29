import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../core/api.service';

interface HardwareGpu {
  index: number;
  vendor: string;
  name: string;
  memory_total_bytes: number | null;
  memory_free_bytes: number | null;
  backends: string[];
  pci_address: string | null;
  virtual: boolean;
  pci_vendor_id: number | null;
  pci_device_id: number | null;
}

interface HardwareSnapshot {
  cpu: { name: string; logical_cores: number; physical_cores: number | null };
  ram: { total_bytes: number | null; available_bytes: number | null };
  os: { system: string; release: string; version: string; architecture: string; distribution: string | null };
  gpus: HardwareGpu[];
}

@Component({
  standalone: true,
  imports: [JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="hardware-page">
      <header class="page-head">
        <div>
          <div class="eyebrow">SYSTEM / DEVICE INVENTORY</div>
          <h1>Hardware Topology</h1>
          <p>Detected host resources and accelerator devices reported by the local service.</p>
        </div>
        <div class="head-actions"><span class="page-badge"><i></i>LOCAL API</span><button class="secondary-button" (click)="load()" [disabled]="loading()">{{ loading() ? 'Refreshing…' : 'Refresh inventory' }}</button></div>
      </header>

      @if (error()) {
        <div class="hardware-notice error" role="alert">
          <div><b>Hardware data could not be loaded</b><p>{{ error() }}</p></div>
          <button class="secondary-button" (click)="load()">Try again</button>
        </div>
      } @else if (loading() && !hardware()) {
        <section class="surface hardware-empty" role="status">
          <span class="hardware-mark">H</span><h2>Checking this device</h2><p>Reading hardware information from the local AI Dream service.</p>
        </section>
      } @else if (hardware(); as hw) {
        <div class="hardware-toolbar">
          <span class="data-note"><i></i>Detected by the local service</span>
          <div class="hardware-actions">
            <button class="secondary-button" (click)="load()" [disabled]="loading()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button>
            <button class="secondary-button" (click)="showJson.set(!showJson())" [attr.aria-expanded]="showJson()">
              {{ showJson() ? 'Hide JSON' : 'Show JSON' }}
            </button>
          </div>
        </div>

        <section class="hardware-grid" aria-label="Hardware summary">
          <article class="surface hardware-card cpu-card">
            <div class="card-kicker"><span class="card-mark">CPU</span><span>PROCESSOR</span></div>
            <h2>{{ hw.cpu.name || 'Name unavailable' }}</h2>
            <p class="card-detail">
              @if (hw.cpu.physical_cores !== null) { {{ hw.cpu.physical_cores }} physical · }
              {{ hw.cpu.logical_cores }} logical cores
            </p>
            <div class="card-foot">Host processor</div>
          </article>

          <article class="surface hardware-card">
            <div class="card-kicker"><span class="card-mark">RAM</span><span>MEMORY</span></div>
            <h2>{{ formatBytes(hw.ram.total_bytes) }}</h2>
            <p class="card-detail">{{ formatBytes(hw.ram.available_bytes) }} available</p>
            @if (ramPercent(hw.ram.total_bytes, hw.ram.available_bytes); as percent) {
              @if (percent !== null) { <div class="meter" role="img" [attr.aria-label]="percent + '% of RAM in use'"><span [style.width.%]="percent"></span></div> }
            }
            <div class="card-foot">System memory</div>
          </article>

          <article class="surface hardware-card">
            <div class="card-kicker"><span class="card-mark">OS</span><span>OPERATING SYSTEM</span></div>
            <h2>{{ hw.os.distribution || hw.os.system || 'Name unavailable' }}</h2>
            <p class="card-detail">{{ hw.os.release }} · {{ hw.os.architecture }}</p>
            <div class="card-foot">{{ hw.os.version || 'Version unavailable' }}</div>
          </article>
        </section>

        <div class="hardware-workspace">
          <section class="fabric-panel surface" aria-labelledby="fabric-heading">
            <div class="fabric-heading"><div><div class="eyebrow">DEVICE INVENTORY</div><h2 id="fabric-heading">Physical interconnect fabric</h2></div><span class="device-count">{{ hw.gpus.length }} accelerator{{ hw.gpus.length === 1 ? '' : 's' }}</span></div>
            <div class="fabric-flow">
              <article class="fabric-node host-node"><span class="node-icon">CPU</span><div><small>HOST PROCESSOR</small><b>{{ hw.cpu.name || 'Name unavailable' }}</b><span>{{ hw.cpu.logical_cores }} logical cores@if (hw.cpu.physical_cores !== null) { · {{ hw.cpu.physical_cores }} physical }</span></div></article>
              <div class="fabric-devices">@for (gpu of hw.gpus; track gpu.index) {<article class="fabric-node device-node"><span class="node-icon">GPU {{ gpu.index }}</span><div><small>{{ gpu.vendor }} ACCELERATOR</small><b>{{ gpu.name || 'Name unavailable' }}</b><span>@if (gpu.pci_address) { PCI {{ gpu.pci_address }} } @else { PCI address unavailable }</span></div></article>}@if (!hw.gpus.length) {<article class="fabric-node device-node empty-node"><span class="node-icon">GPU</span><div><small>ACCELERATORS</small><b>No accelerator detected</b><span>The local service reported no graphics devices.</span></div></article>}</div>
            </div>
            <div class="fabric-footnote"><b>Topology details unavailable</b><span>The hardware endpoint does not report PCIe link width, NUMA affinity, peer-to-peer routes, or bandwidth. No interconnect edges are inferred.</span></div>
          </section>

          <aside class="diagnostic-panel surface" aria-labelledby="diagnostic-heading">
            <div class="fabric-heading"><div><div class="eyebrow">HARDWARE TOOLS</div><h2 id="diagnostic-heading">Diagnostic suite</h2></div><span class="device-count">READ ONLY</span></div>
            <div class="diagnostic-empty"><span class="node-icon">i</span><div><b>Diagnostics are not exposed</b><p>PCIe benchmarks, VRAM integrity tests, and driver reset are not available through the local service API.</p></div></div>
            <div class="diagnostic-facts"><div><span>CPU</span><b>{{ hw.cpu.name || 'Unavailable' }}</b></div><div><span>Accelerators</span><b>{{ hw.gpus.length }} detected</b></div><div><span>Memory</span><b>{{ formatBytes(hw.ram.total_bytes) }}</b></div></div>
          </aside>
        </div>

        <section class="gpu-section" aria-labelledby="gpu-heading">
          <div class="section-heading">
            <div><div class="eyebrow">ACCELERATORS</div><h2 id="gpu-heading">Graphics devices</h2></div>
            <span class="device-count">{{ hw.gpus.length }} detected</span>
          </div>

          @if (hw.gpus.length) {
            <div class="gpu-grid">
              @for (gpu of hw.gpus; track gpu.index) {
                <article class="surface hardware-card gpu-card">
                  <div class="gpu-title-row"><span class="card-mark">GPU {{ gpu.index }}</span><span class="vendor-chip">{{ gpu.vendor }}</span></div>
                  <h3>{{ gpu.name || 'Name unavailable' }}</h3>
                  @if (gpu.memory_total_bytes !== null) {
                    <div class="gpu-memory">
                      <div><span>VRAM</span><b>{{ formatBytes(gpu.memory_free_bytes) }} free <span class="memory-total">/ {{ formatBytes(gpu.memory_total_bytes) }}</span></b></div>
                      @if (gpuMemoryPercent(gpu.memory_total_bytes, gpu.memory_free_bytes); as percent) {
                        @if (percent !== null) { <div class="meter" role="img" [attr.aria-label]="percent + '% of VRAM in use'"><span [style.width.%]="percent"></span></div> }
                      }
                    </div>
                  }
                  <div class="gpu-meta">
                    @if (gpu.backends.length) { <div><span>Runtime backends</span><b>{{ gpu.backends.join(', ') }}</b></div> }
                    @if (gpu.pci_address) { <div><span>PCI address</span><b>{{ gpu.pci_address }}</b></div> }
                    @if (gpu.virtual) { <div><span>Device type</span><b>Virtual</b></div> }
                    @if (gpu.pci_vendor_id !== null || gpu.pci_device_id !== null) {
                      <div><span>PCI IDs</span><b>{{ hex(gpu.pci_vendor_id) }} · {{ hex(gpu.pci_device_id) }}</b></div>
                    }
                  </div>
                </article>
              }
            </div>
          } @else {
            <div class="surface no-devices"><span class="card-mark">GPU</span><div><b>No accelerator detected</b><p>The local service did not report any graphics devices.</p></div></div>
          }
        </section>

        @if (showJson()) {
          <section class="surface json-panel" aria-label="Raw hardware response">
            <div class="json-heading"><div><b>Raw response</b><p>Data returned by GET /api/hardware.</p></div><button class="secondary-button" (click)="showJson.set(false)">Hide JSON</button></div>
            <pre>{{ hw | json }}</pre>
          </section>
        }
      } @else {
        <section class="surface hardware-empty"><span class="hardware-mark">H</span><h2>No hardware data</h2><p>The local service did not return a hardware snapshot.</p><button class="secondary-button" (click)="load()">Load hardware</button></section>
      }
      <p class="hardware-footnote">Only values reported by the local service are shown. Missing measurements remain unavailable.</p>
    </main>
  `,
  styles: [`
    :host{display:block;min-width:0}.hardware-page{max-width:1050px;margin:0 auto;padding:2px 0 20px;color:var(--text,#dee2f1)}
    .page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:0 auto 23px}.eyebrow{font:9px ui-monospace,monospace;letter-spacing:1.2px;color:#7e8ba5;margin-bottom:8px}.page-head h1{margin:0;font-size:23px;font-weight:550;letter-spacing:-.5px}.page-head p{margin:7px 0 0;color:#929aaa;font-size:12px;line-height:1.55}.page-badge{display:flex;align-items:center;gap:7px;flex:none;padding:6px 9px;border:1px solid #343c4a;border-radius:6px;color:#9da8bb;font:9px ui-monospace,monospace}.page-badge i,.data-note i{width:7px;height:7px;border-radius:50%;background:#4edea3;display:inline-block}
    .surface{background:linear-gradient(145deg,#171c26,#141923);border:1px solid #2b3240;border-radius:11px;box-shadow:0 10px 28px #00000015}.hardware-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.data-note{display:flex;align-items:center;gap:8px;color:#8e98aa;font-size:10px}.hardware-actions{display:flex;gap:8px}.secondary-button{border:1px solid #3c4657;background:#222a38;color:#c7d6f4;border-radius:6px;padding:8px 11px;cursor:pointer;font-size:10px}.secondary-button:hover{background:#2b3648}.secondary-button:disabled{opacity:.55;cursor:wait}
    .hardware-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.hardware-card{min-width:0;padding:17px}.card-kicker,.gpu-title-row{display:flex;align-items:center;gap:9px;color:#7f8da4;font:9px ui-monospace,monospace;letter-spacing:.5px}.card-mark{display:inline-flex;align-items:center;justify-content:center;min-height:23px;padding:0 7px;border:1px solid #35445e;border-radius:5px;background:#202a3b;color:#b8ceff;font:9px ui-monospace,monospace;white-space:nowrap}.hardware-card h2{margin:14px 0 5px;font-size:15px;line-height:1.4;font-weight:550;overflow-wrap:anywhere}.card-detail{min-height:16px;margin:0;color:#929aaa;font-size:10px;line-height:1.5;overflow-wrap:anywhere}.card-foot{margin-top:16px;padding-top:10px;border-top:1px solid #2b3240;color:#778295;font-size:9px}.meter{height:5px;margin-top:12px;overflow:hidden;border-radius:5px;background:#2b3240}.meter span{display:block;height:100%;border-radius:inherit;background:#78a9ff}.gpu-section{margin-top:25px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.section-heading .eyebrow{margin-bottom:5px}.section-heading h2{margin:0;font-size:15px;font-weight:550}.device-count{color:#8993a4;font:10px ui-monospace,monospace}.gpu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.gpu-title-row{justify-content:space-between}.vendor-chip{padding:4px 7px;border:1px solid #344254;border-radius:5px;color:#aebbd0;background:#1b2431;text-transform:capitalize}.gpu-card h3{margin:13px 0 14px;font-size:14px;line-height:1.4;font-weight:550;overflow-wrap:anywhere}.gpu-memory{padding:10px 0;border-top:1px solid #2b3240}.gpu-memory>div:first-child,.gpu-meta>div{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;color:#8792a4;font-size:10px}.gpu-memory b,.gpu-meta b{color:#c8d0df;font-weight:500;text-align:right;overflow-wrap:anywhere}.memory-total{color:#8792a4;font-weight:400}.gpu-meta{display:grid;gap:8px;margin-top:10px}.no-devices{display:flex;align-items:center;gap:12px;padding:17px}.no-devices b{font-size:11px;font-weight:550}.no-devices p{margin:4px 0 0;color:#8993a4;font-size:10px}.json-panel{margin-top:15px;padding:15px}.json-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}.json-heading b{font-size:11px}.json-heading p{margin:4px 0 0;color:#8993a4;font-size:10px}.json-panel pre{max-height:320px;overflow:auto;margin:12px 0 0;padding:12px;border:1px solid #2b3240;border-radius:7px;background:#0d121b;color:#c0cce0;font:10px/1.55 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.hardware-empty{min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:25px;text-align:center}.hardware-mark{width:43px;height:43px;display:grid;place-items:center;border:1px solid #374257;border-radius:13px;background:linear-gradient(140deg,#222d40,#1a2130);color:#a8c4ff;font-weight:650;margin-bottom:12px}.hardware-empty h2{margin:0;font-size:14px;font-weight:550}.hardware-empty p{margin:8px 0 0;color:#929aaa;font-size:11px;line-height:1.6}.hardware-empty .secondary-button{margin-top:14px}.hardware-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border:1px solid #68423f;border-radius:9px;background:#281a1c}.hardware-notice b{font-size:11px;color:#f1c3bc}.hardware-notice p{margin:5px 0 0;color:#c39d98;font-size:10px;overflow-wrap:anywhere}.hardware-footnote{margin:13px 0 0;color:#727d8e;font-size:10px;line-height:1.5}
    .page-head{padding:16px;background:#171c26;border:1px solid #2b3240;border-radius:6px;margin-bottom:14px}.head-actions{display:flex;align-items:center;gap:8px}.surface{background:#171c26;border-radius:6px;box-shadow:none}.hardware-grid,.gpu-grid{gap:8px}.hardware-card{padding:14px}.hardware-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(245px,.32fr);gap:8px;margin-top:8px;align-items:start}.fabric-panel,.diagnostic-panel{min-width:0;padding:14px}.fabric-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:10px;border-bottom:1px solid #2b3240}.fabric-heading .eyebrow{margin-bottom:5px}.fabric-heading h2{margin:0;font-size:14px;font-weight:550}.fabric-flow{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);align-items:start;gap:8px;padding:12px 0}.fabric-node{display:flex;align-items:center;gap:10px;min-width:0;padding:10px;background:#10151e;border:1px solid #303a4b;border-radius:4px}.node-icon{display:grid;place-items:center;flex:none;min-width:34px;height:34px;padding:0 5px;border:1px solid #3c506d;border-radius:3px;background:#1b2738;color:#a9c5ff;font:9px ui-monospace,monospace}.fabric-node div{display:grid;gap:4px;min-width:0}.fabric-node small{color:#8492a8;font:8px ui-monospace,monospace}.fabric-node b{color:#dce3f0;font-size:11px;font-weight:550;overflow-wrap:anywhere}.fabric-node span:not(.node-icon){color:#909bad;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.fabric-devices{display:grid;gap:7px}.empty-node{border-style:dashed}.fabric-footnote{display:grid;gap:4px;margin:0;padding:9px 10px;border-top:1px solid #2b3240;background:#10151e;color:#778295;font-size:9px;line-height:1.5}.fabric-footnote b{color:#bec8d8;font-weight:550}.diagnostic-panel .fabric-heading{margin-bottom:9px}.diagnostic-empty{display:flex;align-items:flex-start;gap:9px;padding:10px 0 12px}.diagnostic-empty .node-icon{min-width:24px;width:24px;height:24px}.diagnostic-empty b{font-size:10px;font-weight:550;color:#c9d2e1}.diagnostic-empty p{margin:5px 0 0;color:#8993a4;font-size:9px;line-height:1.5}.diagnostic-facts{display:grid;gap:0;border-top:1px solid #2b3240}.diagnostic-facts div{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #2b3240;font-size:9px}.diagnostic-facts span{color:#8993a4}.diagnostic-facts b{color:#c6cfde;text-align:right;font-weight:500;overflow-wrap:anywhere}
    @media(max-width:900px){.hardware-workspace{grid-template-columns:1fr}.diagnostic-panel{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}.diagnostic-panel .fabric-heading{grid-column:1/-1}.diagnostic-facts{align-self:stretch}}
    @media(max-width:760px){.hardware-page{padding-top:0}.hardware-grid{grid-template-columns:1fr 1fr}.fabric-flow{grid-template-columns:1fr}.page-head h1{font-size:21px}}
    @media(max-width:520px){.page-head{flex-direction:column}.hardware-toolbar{align-items:flex-start;flex-direction:column}.hardware-actions{width:100%}.hardware-actions button{flex:1}.hardware-grid{grid-template-columns:1fr}.gpu-grid{grid-template-columns:1fr}.hardware-card{padding:14px}}
  `]
})
export class HardwarePage implements OnInit {
  readonly hardware = signal<HardwareSnapshot | null>(null);
  readonly error = signal('');
  readonly loading = signal(false);
  readonly showJson = signal(false);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.get<{ data?: { hardware?: HardwareSnapshot } }>('/api/hardware').subscribe({
      next: response => {
        this.hardware.set(response?.data?.hardware ?? null);
        this.loading.set(false);
      },
      error: error => {
        this.error.set(error?.message || 'The local service could not return hardware information.');
        this.loading.set(false);
      }
    });
  }

  formatBytes(value: number | null): string {
    if (value === null || !Number.isFinite(value) || value < 0) return 'Unavailable';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (value === 0) return '0 B';
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / (1024 ** index)).toFixed(index >= 2 ? 1 : 0)} ${units[index]}`;
  }

  ramPercent(total: number | null, available: number | null): number | null {
    return this.percent(total, available);
  }

  gpuMemoryPercent(total: number | null, free: number | null): number | null {
    return this.percent(total, free);
  }

  hex(value: number | null): string { return value === null ? 'Unavailable' : `0x${value.toString(16).padStart(4, '0')}`; }

  private percent(total: number | null, free: number | null): number | null {
    if (total === null || free === null || total <= 0 || free < 0) return null;
    return Math.round(Math.min(100, Math.max(0, ((total - free) / total) * 100)));
  }
}
