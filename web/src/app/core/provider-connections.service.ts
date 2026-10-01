import { Injectable, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiService } from './api.service';

export interface ProviderConnection {
  id: string;
  name: string;
  provider_type: 'openai-compatible';
  base_url: string;
  enabled: boolean;
  secret_ref: string | null;
  credential_configured: boolean;
}

export interface ProviderModel {
  id: string;
  provider_model_id: string;
  connection_id: string;
  connection_name: string;
  provider_type: string;
  name: string;
  source: 'remote-provider';
}

export interface ProviderConnectionsSnapshot {
  connections: ProviderConnection[];
  secure_storage: { available: boolean; reason: string | null };
}

@Injectable({ providedIn: 'root' })
export class ProviderConnectionsService {
  /** Models explicitly discovered in Settings during this SPA session. Never populated by background network calls. */
  readonly discoveredModels = signal<ProviderModel[]>([]);

  constructor(private readonly api: ApiService) {}

  rememberDiscoveredModels(connectionId: string, models: ProviderModel[]): void {
    this.discoveredModels.update(current => [
      ...current.filter(model => model.connection_id !== connectionId),
      ...models.filter(model => model.connection_id === connectionId && model.source === 'remote-provider'),
    ]);
  }

  forgetConnectionModels(connectionId: string): void {
    this.discoveredModels.update(current => current.filter(model => model.connection_id !== connectionId));
  }

  clearDiscoveredModels(): void { this.discoveredModels.set([]); }

  list(): Promise<{ data?: ProviderConnectionsSnapshot }> {
    return firstValueFrom(this.api.get<{ data?: ProviderConnectionsSnapshot }>('/api/provider-connections').pipe(timeout(10000)));
  }

  create(value: { name: string; base_url: string; api_key?: string; enabled: boolean }): Promise<{ data?: { connection: ProviderConnection } }> {
    return firstValueFrom(this.api.post<{ data?: { connection: ProviderConnection } }>('/api/provider-connections', value).pipe(timeout(15000)));
  }

  update(id: string, value: { name?: string; base_url?: string; api_key?: string; clear_api_key?: boolean; enabled?: boolean }): Promise<{ data?: { connection: ProviderConnection } }> {
    return firstValueFrom(this.api.patch<{ data?: { connection: ProviderConnection } }>(`/api/provider-connections/${encodeURIComponent(id)}`, value).pipe(timeout(15000)));
  }

  delete(id: string): Promise<unknown> {
    return firstValueFrom(this.api.delete(`/api/provider-connections/${encodeURIComponent(id)}`).pipe(timeout(15000)));
  }

  test(id: string): Promise<{ data?: { connected: boolean; model_count: number } }> {
    return firstValueFrom(this.api.post<{ data?: { connected: boolean; model_count: number } }>(`/api/provider-connections/${encodeURIComponent(id)}/test`, {}).pipe(timeout(30000)));
  }

  models(id?: string): Promise<{ data?: { models: ProviderModel[] } }> {
    const path = id
      ? `/api/provider-connections/${encodeURIComponent(id)}/models`
      : '/api/provider-models';
    return firstValueFrom(this.api.get<{ data?: { models: ProviderModel[] } }>(path).pipe(timeout(30000)));
  }
}
