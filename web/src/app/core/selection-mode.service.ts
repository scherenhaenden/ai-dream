import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export type SelectionMode = 'auto' | 'guided' | 'manual';
interface PreferenceResponse { data?: { selection_defaults?: { mode?: unknown } }; }

@Injectable({ providedIn: 'root' })
export class SelectionModeService {
  private readonly api = inject(ApiService);
  readonly mode = signal<SelectionMode>('auto');
  readonly loading = signal(true);
  readonly error = signal('');

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.api.get<PreferenceResponse>('/api/capability-preferences'));
      const mode = response?.data?.selection_defaults?.mode;
      if (mode !== 'auto' && mode !== 'guided' && mode !== 'manual') {
        throw new Error('The local API returned an unsupported selection mode.');
      }
      this.mode.set(mode);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The local API could not read selection defaults.');
    } finally {
      this.loading.set(false);
    }
  }

  async set(value: SelectionMode): Promise<boolean> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.api.patch<PreferenceResponse>(
        '/api/capability-preferences', { selection_defaults: { mode: value } },
      ));
      if (response?.data?.selection_defaults?.mode !== value) {
        throw new Error('The local API did not confirm the saved mode.');
      }
      this.mode.set(value);
      return true;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The local API could not save selection defaults.');
      return false;
    } finally {
      this.loading.set(false);
    }
  }
}
