import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { ModelProfile } from './control-plane.types';

@Injectable({ providedIn: 'root' })
export class ModelProfilesService {
  constructor(private readonly api: ApiService) {}
  async list(modelId: string): Promise<ModelProfile[]> {
    const response = await this.api.request<unknown>(`/api/model-profiles?model_id=${encodeURIComponent(modelId)}`);
    const data = unwrap(response);
    return Array.isArray(data.profiles) ? data.profiles as ModelProfile[] : [];
  }
  async create(profile: Partial<ModelProfile> & Pick<ModelProfile,'model_id'|'name'>): Promise<ModelProfile> {
    const response = await this.api.request<unknown>('/api/model-profiles', profile);
    const value = unwrap(response).profile;
    if (!value || typeof value.id !== 'string') throw new Error('The API returned an invalid model profile.');
    return value as ModelProfile;
  }
  async update(id: string, patch: Partial<ModelProfile>): Promise<ModelProfile> {
    const response = await this.api.patch<unknown>(`/api/model-profiles/${encodeURIComponent(id)}`, patch).toPromise();
    const value = unwrap(response).profile;
    if (!value || typeof value.id !== 'string') throw new Error('The API returned an invalid model profile.');
    return value as ModelProfile;
  }
  async remove(id: string): Promise<void> {
    await this.api.delete<unknown>(`/api/model-profiles/${encodeURIComponent(id)}`).toPromise();
  }
}

function unwrap(value: unknown): any {
  if (!value || typeof value !== 'object') return {};
  const envelope = value as { data?: any; error?: unknown };
  if (typeof envelope.error === 'string') throw new Error(envelope.error);
  return envelope.data && typeof envelope.data === 'object' ? envelope.data : value;
}
