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

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.resourcesError.set('');
    this.residencyError.set('');
    const [resources, residency] = await Promise.allSettled([
      firstValueFrom(this.api.get<{ data?: ResourceSnapshot }>('/api/resources')),
      firstValueFrom(this.api.get<{ data?: { residency?: ResidencySnapshot } }>('/api/models/residency')),
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
    if (resources.status === 'fulfilled' || residency.status === 'fulfilled') this.refreshedAt.set(new Date());
    this.loading.set(false);
  }

  async control(routeId: string, action: 'pin' | 'unpin' | 'unload'): Promise<void> {
    await firstValueFrom(this.api.post('/api/models/residency/actions', { route_id: routeId, action }));
    await this.refresh();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'This local API endpoint is unavailable or returned an unsupported response.';
}
