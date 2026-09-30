import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { ResourceSnapshot, ResidencySnapshot } from './resources.types';

@Injectable({ providedIn: 'root' })
export class ResourcesService {
  private readonly api = inject(ApiService);
  readonly resources = signal<ResourceSnapshot | null>(null);
  readonly residency = signal<ResidencySnapshot | null>(null);
  readonly resourcesError = signal('');
  readonly residencyError = signal('');
  readonly loading = signal(false);
  readonly refreshedAt = signal<Date | null>(null);
  readonly evictionPolicy = signal<'lru' | 'never' | null>(null);
  readonly preferenceError = signal('');
  readonly savingEvictionPolicy = signal(false);

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.resourcesError.set('');
    this.residencyError.set('');
    this.preferenceError.set('');
    const [resources, residency, preferences] = await Promise.allSettled([
      firstValueFrom(this.api.get<{ data?: ResourceSnapshot }>('/api/resources')),
      firstValueFrom(this.api.get<{ data?: { residency?: ResidencySnapshot } }>('/api/models/residency')),
      firstValueFrom(this.api.get<{ data?: { selection_defaults?: { eviction_policy?: unknown } } }>('/api/capability-preferences')),
    ]);
    if (resources.status === 'fulfilled' && resources.value?.data && typeof resources.value.data === 'object') {
      this.resources.set(resources.value.data);
    } else {
      this.resources.set(null);
      this.resourcesError.set(errorMessage(resources.status === 'rejected' ? resources.reason : null));
    }
    if (residency.status === 'fulfilled' && residency.value?.data?.residency && typeof residency.value.data.residency === 'object') {
      this.residency.set(residency.value.data.residency);
    } else {
      this.residency.set(null);
      this.residencyError.set(errorMessage(residency.status === 'rejected' ? residency.reason : null));
    }
    if (preferences.status === 'fulfilled') {
      const policy = preferences.value?.data?.selection_defaults?.eviction_policy;
      this.evictionPolicy.set(policy === 'lru' || policy === 'never' ? policy : null);
      if (this.evictionPolicy() === null) this.preferenceError.set('The local API returned an unsupported eviction policy.');
    } else {
      this.evictionPolicy.set(null);
      this.preferenceError.set(errorMessage(preferences.reason));
    }
    if (resources.status === 'fulfilled' || residency.status === 'fulfilled') this.refreshedAt.set(new Date());
    this.loading.set(false);
  }

  async control(routeId: string, action: 'pin' | 'unpin' | 'unload'): Promise<void> {
    await firstValueFrom(this.api.post('/api/models/residency/actions', { route_id: routeId, action }));
    await this.refresh();
  }

  async setEvictionPolicy(policy: 'lru' | 'never'): Promise<void> {
    this.savingEvictionPolicy.set(true);
    this.preferenceError.set('');
    try {
      const response = await firstValueFrom(this.api.patch<{
        data?: { selection_defaults?: { eviction_policy?: unknown } }
      }>('/api/capability-preferences', { selection_defaults: { eviction_policy: policy } }));
      const confirmed = response?.data?.selection_defaults?.eviction_policy;
      if (confirmed !== policy) throw new Error('The local API did not confirm the saved eviction policy.');
      this.evictionPolicy.set(policy);
    } catch (error) {
      this.preferenceError.set(errorMessage(error));
    } finally {
      this.savingEvictionPolicy.set(false);
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'This local API endpoint is unavailable or returned an unsupported response.';
}
