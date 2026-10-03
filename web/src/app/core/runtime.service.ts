import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { ModelRecord, RuntimeCapabilities, RuntimeDevice, RuntimeInstallation, RuntimeLoadOptions, RuntimePlacement } from './control-plane.types';

export interface RuntimeBackend { name: string; available: boolean; capabilities: RuntimeCapabilities; }
export interface RuntimeSnapshot { backends: RuntimeBackend[]; devices: RuntimeDevice[]; status: unknown; }
export interface RuntimeSettingsRequest {
  model_id: string; backend?: string; runtime_id?: string; profile_id?: string;
  placement?: RuntimePlacement; load?: RuntimeLoadOptions;
}

export interface RuntimeCommandResult { data: { command: string; argv: string[]; runtime_id?: string | null }; }

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
  async installations(): Promise<RuntimeInstallation[]> {
    const response = await this.api.request<{data?: {installations?: RuntimeInstallation[]}}>('/api/runtime/installations');
    return response.data?.installations ?? [];
  }
  async unload(modelId?: string) { return this.api.request('/api/runtime/unload', modelId ? { model_id: modelId } : {}); }
  async status() { return this.api.request('/api/runtime/status'); }
  async command(request: RuntimeSettingsRequest): Promise<RuntimeCommandResult> {
    return this.api.request<RuntimeCommandResult>('/api/runtime/command', request);
  }
  async addInstallation(value: { executable: string; name?: string }): Promise<RuntimeInstallation> {
    const response = await this.api.request<{ data: { installation: RuntimeInstallation } }>('/api/runtime/installations', value);
    return response.data.installation;
  }
  async probeInstallation(id: string): Promise<RuntimeInstallation> {
    const response = await this.api.request<{ data: { installation: RuntimeInstallation } }>(`/api/runtime/installations/${encodeURIComponent(id)}/probe`, {});
    return response.data.installation;
  }
  async setInstallationEnabled(id: string, enabled: boolean): Promise<RuntimeInstallation> {
    const response = await firstValueFrom(this.api.patch<{ data: { installation: RuntimeInstallation } }>(`/api/runtime/installations/${encodeURIComponent(id)}`, { enabled }));
    return response.data.installation;
  }
  async removeInstallation(id: string): Promise<void> {
    await firstValueFrom(this.api.delete<unknown>(`/api/runtime/installations/${encodeURIComponent(id)}`));
  }
}
