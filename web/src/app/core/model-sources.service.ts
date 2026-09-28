import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { ModelRecord, ModelSource } from './control-plane.types';

@Injectable({ providedIn: 'root' })
export class ModelSourcesService {
  constructor(private readonly api: ApiService) {}

  async list(): Promise<ModelSource[]> {
    const response = await this.api.request<unknown>('/api/model-sources');
    const data = unwrap(response);
    return Array.isArray(data?.sources) ? data.sources as ModelSource[] : [];
  }

  async models(): Promise<ModelRecord[]> {
    const response = await this.api.request<unknown>('/api/models');
    const data = unwrap(response);
    return Array.isArray(data?.models) ? data.models as ModelRecord[] : [];
  }

  async add(path: string): Promise<ModelSource> {
    const response = await this.api.request<unknown>('/api/model-sources', { path });
    const source = unwrap(response)?.source;
    if (!source || typeof source.id !== 'string') throw new Error('The API returned an invalid model source.');
    return source as ModelSource;
  }

  async remove(id: string): Promise<void> {
    await this.api.delete<unknown>(`/api/model-sources/${encodeURIComponent(id)}`).toPromise();
  }

  async rescan(): Promise<ModelRecord[]> {
    const response = await this.api.request<unknown>('/api/models/rescan', {});
    const data = unwrap(response);
    return Array.isArray(data?.models) ? data.models as ModelRecord[] : [];
  }
}

function unwrap(value: unknown): any {
  if (!value || typeof value !== 'object') return {};
  const envelope = value as { data?: unknown; error?: unknown };
  if (typeof envelope.error === 'string') throw new Error(envelope.error);
  return envelope.data && typeof envelope.data === 'object' ? envelope.data : value;
}
