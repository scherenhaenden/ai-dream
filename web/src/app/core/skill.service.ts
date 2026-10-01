import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { SkillCatalogItem, SkillPermissionKey, SkillPermissions } from './skill.types';

interface SkillsResponse {
  data?: { skills?: SkillCatalogItem[] };
}

export type ImageCapabilityId = 'image.generate' | 'image.edit';
export interface ImageRouteChoice {
  id: string;
  model_id?: string | null;
  runtime_id?: string | null;
  estimated_vram_bytes?: number;
  available_vram_bytes?: number;
}

const PERMISSION_OPTIONS: Record<SkillPermissionKey, readonly string[]> = {
  filesystem_read: ['none', 'user-selected-only', 'scoped-paths'],
  filesystem_write: ['none', 'user-approved-output', 'scoped-paths'],
  network: ['none', 'specific-hosts', 'unrestricted'],
  shell: ['none', 'registered-command-only'],
  browser_control: ['none', 'allowed'], computer_control: ['none', 'allowed'],
  desktop_control: ['none', 'allowed'], microphone: ['none', 'allowed'], camera: ['none', 'allowed'],
  clipboard: ['none', 'read', 'write', 'read-write'],
};

@Injectable({ providedIn: 'root' })
export class SkillService {
  private readonly api = inject(ApiService);

  async assistedPlannerEnabled(): Promise<boolean> {
    const response = await firstValueFrom(this.api.get<{
      data?: { selection_defaults?: { assisted_planner_enabled?: unknown } }
    }>('/api/capability-preferences'));
    const enabled = response?.data?.selection_defaults?.assisted_planner_enabled;
    if (typeof enabled !== 'boolean') throw new Error('The local API returned no valid assisted-planner setting.');
    return enabled;
  }

  async setAssistedPlannerEnabled(enabled: boolean): Promise<void> {
    const response = await firstValueFrom(this.api.patch<{
      data?: { selection_defaults?: { assisted_planner_enabled?: unknown } }
    }>('/api/capability-preferences', { selection_defaults: { assisted_planner_enabled: enabled } }));
    if (response?.data?.selection_defaults?.assisted_planner_enabled !== enabled) {
      throw new Error('The local API did not confirm the assisted-planner setting.');
    }
  }

  async loadedModelStatus(): Promise<{ loaded: boolean; model: string | null }> {
    const response = await firstValueFrom(this.api.get<{
      data?: { status?: { loaded?: unknown; model?: unknown } }
    }>('/api/runtime/status'));
    const status = response?.data?.status;
    if (typeof status?.loaded !== 'boolean') throw new Error('The local API did not report loaded-model status.');
    return { loaded: status.loaded, model: typeof status.model === 'string' ? status.model : null };
  }

  async draft(skillId: string, goal: string, inputs: Record<string, unknown>, selection?: Record<string, unknown>): Promise<{
    draft: Record<string, unknown>; plan: Record<string, unknown>; model: { id: string; runtime_id?: string | null };
  }> {
    const response = await firstValueFrom(this.api.post<{
      data?: { draft?: Record<string, unknown>; plan?: Record<string, unknown>; model?: { id?: unknown; runtime_id?: unknown } }
    }>(`/api/skills/${encodeURIComponent(skillId)}/draft`, { goal, inputs, ...(selection ? { selection } : {}) }));
    const result = response?.data;
    if (!result?.draft || !result.plan || !result.model || typeof result.model.id !== 'string') {
      throw new Error('The local API returned an incomplete assisted draft.');
    }
    return { draft: result.draft, plan: result.plan, model: { id: result.model.id,
      runtime_id: typeof result.model.runtime_id === 'string' ? result.model.runtime_id : null } };
  }

  async list(): Promise<SkillCatalogItem[]> {
    const response = await firstValueFrom(this.api.get<SkillsResponse>('/api/skills'));
    if (!Array.isArray(response?.data?.skills)) return [];
    return response.data.skills.filter((skill) =>
      !!skill && typeof skill.id === 'string' && typeof skill.name === 'string'
      && typeof skill.description === 'string'
      && ['ready', 'not_ready', 'unknown'].includes(skill.status)
      && Array.isArray(skill.inputs) && Array.isArray(skill.outputs),
    );
  }

  async imageRoutes(): Promise<Record<ImageCapabilityId, ImageRouteChoice[]>> {
    const response = await firstValueFrom(this.api.get<{
      data?: { capabilities?: Array<{ id?: string; routes?: ImageRouteChoice[] }> }
    }>('/api/capabilities'));
    const items = response?.data?.capabilities;
    if (!Array.isArray(items)) throw new Error('The local API returned no image capability routes.');
    const rows = (id: ImageCapabilityId): ImageRouteChoice[] => {
      const routes = items.find(item => item?.id === id)?.routes;
      if (!Array.isArray(routes)) return [];
      return routes.filter((route): route is ImageRouteChoice => !!route
        && typeof route.id === 'string' && typeof route.model_id === 'string'
        && typeof route.runtime_id === 'string');
    };
    return { 'image.generate': rows('image.generate'), 'image.edit': rows('image.edit') };
  }

  async fliteVoices(): Promise<string[]> {
    const response = await firstValueFrom(this.api.get<{
      data?: { capabilities?: Array<{ id?: string; routes?: Array<{ model_id?: string | null; voices?: unknown }> }> }
    }>('/api/capabilities'));
    const capability = response?.data?.capabilities?.find(item => item?.id === 'audio.synthesize');
    if (!Array.isArray(capability?.routes)) throw new Error('The local API did not report audio synthesis routes.');
    const voices = capability.routes.flatMap(route => Array.isArray(route.voices) ? route.voices : []);
    return [...new Set(voices.filter((voice): voice is string => typeof voice === 'string' && /^[a-z0-9_-]{1,40}$/.test(voice)))];
  }

  async imageModelPins(): Promise<Partial<Record<ImageCapabilityId, string>>> {
    const response = await firstValueFrom(this.api.get<{
      data?: { capability_preferences?: Record<string, { model_id?: unknown } | null> }
    }>('/api/capability-preferences'));
    const prefs = response?.data?.capability_preferences;
    if (!prefs || typeof prefs !== 'object') throw new Error('The local API returned no capability preferences.');
    const pins: Partial<Record<ImageCapabilityId, string>> = {};
    for (const capability of ['image.generate', 'image.edit'] as const) {
      const modelId = prefs[capability]?.model_id;
      if (typeof modelId === 'string') pins[capability] = modelId;
    }
    return pins;
  }

  async setImageModelPin(capability: ImageCapabilityId, modelId: string | null): Promise<void> {
    const preference = modelId ? { model_id: modelId } : null;
    const response = await firstValueFrom(this.api.patch<{
      data?: { capability_preferences?: Record<string, { model_id?: unknown } | null> }
    }>('/api/capability-preferences', {
      capability_preferences: { [capability]: preference },
    }));
    const saved = response?.data?.capability_preferences?.[capability]?.model_id;
    if (modelId ? saved !== modelId : saved !== undefined) {
      throw new Error('The local API did not confirm the image model pin.');
    }
  }

  async permissions(skillId: string): Promise<SkillPermissions> {
    const response = await firstValueFrom(this.api.get<{ data?: { skill?: { permissions?: unknown } } }>(
      `/api/skills/${encodeURIComponent(skillId)}`,
    ));
    const raw = response?.data?.skill?.permissions;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The local API returned no skill permission declaration.');
    const permissions = raw as Record<string, unknown>;
    const keys = Object.keys(PERMISSION_OPTIONS) as SkillPermissionKey[];
    if (Object.keys(permissions).some(key => !keys.includes(key as SkillPermissionKey))) throw new Error('The skill returned an unknown permission dimension.');
    const validated = {} as SkillPermissions;
    for (const key of keys) {
      const value = permissions[key] ?? 'none';
      if (typeof value !== 'string' || !PERMISSION_OPTIONS[key].includes(value)) throw new Error(`The skill returned an invalid ${key} permission.`);
      validated[key] = value;
    }
    return validated;
  }

  async plan(skillId: string, inputs: Record<string, unknown>, selection?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await firstValueFrom(this.api.post<{ data?: { plan?: Record<string, unknown> } }>(
      `/api/skills/${encodeURIComponent(skillId)}/plan`, { inputs, ...(selection ? { selection } : {}) },
    ));
    if (!response?.data?.plan || typeof response.data.plan !== 'object') throw new Error('The local API returned no plan preview.');
    return response.data.plan;
  }

  async run(skillId: string, inputs: Record<string, unknown>, expectedPlanId: string,
            selection?: Record<string, unknown>): Promise<{ id: string }> {
    if (!/^[a-f0-9]{24}$/.test(expectedPlanId)) throw new Error('Preview the resolved plan before starting this skill.');
    const response = await firstValueFrom(this.api.post<{ data?: { run?: { id?: string } } }>(
      `/api/skills/${encodeURIComponent(skillId)}/run`, {
        inputs, expected_plan_id: expectedPlanId, ...(selection ? { selection } : {}),
      },
    ));
    const id = response?.data?.run?.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('The local API returned an invalid run ID.');
    return { id };
  }
}
