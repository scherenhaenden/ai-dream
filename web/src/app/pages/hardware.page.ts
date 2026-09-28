import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { JsonPipe, KeyValuePipe } from '@angular/common';

@Component({
  standalone: true,
  imports: [JsonPipe, KeyValuePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex-1 flex flex-col h-full bg-[#090e18] overflow-y-auto p-6 space-y-6 text-[#e0e2ec]">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#282f3d]">
        <div>
          <h1 class="text-xl font-bold tracking-tight flex items-center gap-2">
            <span class="material-symbols-outlined text-[#a0caff]">hub</span>
            Hardware Orchestration & PCIe Topology
          </h1>
          <p class="text-xs text-[#8991a2] mt-1 font-mono">
            Physical compute layout, NUMA node affinities, interconnect bandwidth, and heterogeneous GPU accelerators.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button (click)="toggleJson()" class="px-4 py-2 bg-[#171c26] border border-[#282f3d] hover:bg-[#1f2532] rounded-lg text-xs font-bold transition-colors">
            {{ showJson() ? 'Hide JSON' : 'Show JSON' }}
          </button>
          <button (click)="load()" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-500/20">
            Refresh
          </button>
        </div>
      </div>

      @if (loading()) {
        <p class="text-xs font-mono text-[#8991a2]">Loading hardware data...</p>
      }
      @if (error()) {
        <p class="text-xs font-mono text-red-400 p-4 bg-red-950/20 border border-red-500/30 rounded-lg">{{ error() }}</p>
      }

      @if (payload(); as hw) {
        @if (showJson()) {
          <pre class="bg-[#111722] border border-[#282f3d] p-4 rounded-xl font-mono text-[11px] overflow-auto max-h-[600px]">{{ hw | json }}</pre>
        } @else {
          <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <!-- Left Column: Host Subsystems & Connectivity -->
            <div class="xl:col-span-9 flex flex-col gap-6">

              <!-- Diagram Area -->
              <div class="relative bg-[#111722] border border-[#282f3d] p-5 rounded-xl overflow-hidden shadow-sm flex flex-col">
                <div class="flex flex-wrap items-center justify-between pb-4 gap-2 border-b border-[#282f3d]">
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-[#8991a2] text-[16px]">account_tree</span>
                    <span class="text-[14px] font-semibold">Physical Interconnect Fabric</span>
                  </div>
                </div>

                <div class="relative w-full min-h-[300px] bg-[#090e18]/50 rounded-lg p-6 flex flex-col justify-between overflow-hidden mt-4 border border-[#282f3d]">

                  <!-- Host CPU & Memory -->
                  <div class="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                    <div class="md:col-span-8 bg-[#171c26] border border-[#282f3d] p-4 rounded-lg shadow-sm flex flex-col md:flex-row gap-4 justify-between">
                      <div class="flex items-start gap-3">
                        <div class="w-10 h-10 rounded-lg bg-blue-900/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                          <span class="material-symbols-outlined text-blue-400 text-[22px]">memory</span>
                        </div>
                        <div>
                          <div class="flex items-center gap-1 font-mono text-[10px] text-blue-400">
                            <span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                            <span>HOST COMPUTE</span>
                          </div>
                          <div class="text-[15px] font-semibold">{{ hw.cpu?.name || 'Unknown CPU' }}</div>
                          <div class="font-mono text-[11px] text-[#8991a2]">
                            {{ hw.cpu?.physical_cores }} Physical Cores / {{ hw.cpu?.logical_cores }} Logical Cores
                          </div>
                        </div>
                      </div>

                      <div class="flex flex-col justify-center bg-[#111722] border border-[#282f3d] px-3 py-2 rounded-lg min-w-[200px]">
                        <div class="flex items-center justify-between font-mono text-[11px]">
                          <span class="text-[#8991a2] font-medium">Host RAM</span>
                        </div>
                        <div class="flex items-center justify-between font-mono text-[13px] mt-1 font-bold">
                          <span>{{ formatBytes(hw.ram?.total_bytes - hw.ram?.available_bytes) }} <span class="font-normal text-[10px] text-[#8991a2]">/ {{ formatBytes(hw.ram?.total_bytes) }}</span></span>
                          <span class="text-[11px] font-medium text-emerald-400">{{ formatBytes(hw.ram?.available_bytes) }} Free</span>
                        </div>
                        <div class="w-full h-1.5 bg-[#282f3d] rounded-full mt-1.5 overflow-hidden">
                          <div class="h-full bg-blue-500 rounded-full" [style.width]="getRamPercent(hw.ram) + '%'"></div>
                        </div>
                      </div>
                    </div>

                    <div class="md:col-span-4 bg-[#171c26] border border-[#282f3d] p-4 rounded-lg shadow-sm flex items-center justify-between">
                      <div class="flex items-center gap-3 min-w-0">
                        <div class="w-9 h-9 rounded-lg bg-[#111722] flex items-center justify-center shrink-0 border border-[#282f3d]">
                          <span class="material-symbols-outlined text-purple-400 text-[20px]">terminal</span>
                        </div>
                        <div class="min-w-0">
                          <div class="font-mono text-[10px] text-[#8991a2] uppercase truncate">Operating System</div>
                          <div class="text-[13px] font-semibold truncate">{{ hw.os?.distribution || hw.os?.system }}</div>
                          <div class="font-mono text-[11px] text-purple-400">{{ hw.os?.release }}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- GPUs -->
                  @if (hw.gpus && hw.gpus.length > 0) {
                    <div class="relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch mt-6">
                      @for (gpu of hw.gpus; track gpu.id || $index) {
                        <div class="bg-[#171c26] border border-[#282f3d] p-4 rounded-lg shadow-sm flex flex-col gap-3">
                          <div>
                            <div class="flex items-center justify-between">
                              <span class="font-mono text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                GPU {{ $index }}
                              </span>
                              <span class="font-mono text-[10px] text-[#8991a2]">{{ gpu.vendor }}</span>
                            </div>
                            <div class="text-[14px] font-semibold mt-1">{{ gpu.name }}</div>
                          </div>
                          @if (gpu.memory) {
                            <div class="bg-[#111722] p-2.5 rounded-lg border border-[#282f3d] space-y-1">
                              <div class="flex items-center justify-between font-mono text-[11px]">
                                <span class="text-[#8991a2]">VRAM</span>
                                <span class="text-blue-400 font-semibold">{{ formatBytes(gpu.memory.total_bytes - gpu.memory.free_bytes) }} / {{ formatBytes(gpu.memory.total_bytes) }}</span>
                              </div>
                              <div class="w-full h-2 bg-[#282f3d] rounded-full overflow-hidden">
                                <div class="h-full bg-blue-500 rounded-full" [style.width]="getGpuMemoryPercent(gpu.memory) + '%'"></div>
                              </div>
                            </div>
                          }
                          <div class="mt-auto pt-2 flex flex-col gap-1 text-[11px] font-mono text-[#8991a2]">
                            @for (kv of (gpu | keyvalue); track kv.key) {
                              @if (kv.key !== 'name' && kv.key !== 'memory' && kv.key !== 'vendor' && kv.key !== 'id') {
                                <div class="flex justify-between">
                                  <span>{{ kv.key }}</span>
                                  <span class="text-[#e0e2ec]">{{ kv.value }}</span>
                                </div>
                              }
                            }
                          </div>
                        </div>
                      }
                    </div>
                  } @else {
                     <div class="mt-6 p-4 border border-[#282f3d] rounded-lg text-center text-[#8991a2] font-mono text-sm">
                       No GPU accelerators detected.
                     </div>
                  }
                </div>
              </div>
            </div>

          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
  `]
})
export class HardwarePage implements OnInit {
  readonly payload = signal<any | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly showJson = signal(false);

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<any>('/api/hardware').subscribe({
      next: (response) => {
        this.payload.set(response?.data?.hardware || response?.data || response);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message || 'Failed to fetch hardware info');
        this.loading.set(false);
      }
    });
  }

  toggleJson() {
    this.showJson.set(!this.showJson());
  }

  formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString(), 10);
    return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
  }

  getRamPercent(ram: any): number {
    if (!ram || !ram.total_bytes) return 0;
    const used = ram.total_bytes - (ram.available_bytes || 0);
    return Math.min(100, Math.max(0, (used / ram.total_bytes) * 100));
  }

  getGpuMemoryPercent(mem: any): number {
    if (!mem || !mem.total_bytes) return 0;
    const used = mem.total_bytes - (mem.free_bytes || 0);
    return Math.min(100, Math.max(0, (used / mem.total_bytes) * 100));
  }
}
