import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { RuntimeLoadOptions, RuntimePlacement } from './control-plane.types';

export interface GlobalSettings {
  runtime_defaults: { runtime_id: string | null; backend_name: string | null; placement: RuntimePlacement; load: RuntimeLoadOptions };
  managed_models_dir: string;
  config_dir: string;
  data_dir: string;
  default_profile_behavior: 'model' | 'global';
  keep_last_model_loaded: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private readonly api: ApiService) {}
  get() { return this.api.request<{data?: {settings: GlobalSettings}}>('/api/settings'); }
  patch(settings: Partial<Pick<GlobalSettings, 'runtime_defaults'|'default_profile_behavior'|'keep_last_model_loaded'>>) {
    return this.api.request<{data?: {settings: GlobalSettings}}>('/api/settings', settings);
  }
}
