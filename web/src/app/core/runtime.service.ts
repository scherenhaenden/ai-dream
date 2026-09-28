import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { ModelRecord, RuntimeCapabilities, RuntimeDevice, RuntimeLoadOptions, RuntimePlacement } from './control-plane.types';

export interface RuntimeBackend { name: string; available: boolean; capabilities: RuntimeCapabilities; }
export interface RuntimeSnapshot { backends: RuntimeBackend[]; devices: RuntimeDevice[]; status: unknown; }
export interface RuntimeSettingsRequest {
  model_id: string; backend?: string; runtime_id?: string;
  placement?: RuntimePlacement; load?: RuntimeLoadOptions;
}

@Injectable({ providedIn: 'root' })
export class RuntimeService {
  constructor(private readonly api: ApiService) {}
  async snapshot(): Promise<{ models: ModelRecord[]; runtime: RuntimeSnapshot }> {
    const [models, runtime] = await Promise.all([
      this.api.request<{data?: {models?: ModelRecord[]}}>('/api/models'),
      this.api.request<{data?: RuntimeSnapshot}>('/api/runtime'),
    ]);
    return { models: models.data?.models ?? [], runtime: runtime.data ?? { backends: [], devices: [], status: null } };
  }
  async load(request: RuntimeSettingsRequest) { return this.api.request('/api/runtime/load', request); }
  async unload() { return this.api.request('/api/runtime/unload', {}); }
  async status() { return this.api.request('/api/runtime/status'); }
  async command(request: RuntimeSettingsRequest): Promise<{ command: string; argv?: string[] }> {
    return this.api.request('/api/runtime/command', request);
  }
}
