import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { SkillCatalogItem, SkillPermissionKey, SkillPermissions } from './skill.types';

interface SkillsResponse {
  data?: { skills?: SkillCatalogItem[] };
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

  async plan(skillId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await firstValueFrom(this.api.post<{ data?: { plan?: Record<string, unknown> } }>(
      `/api/skills/${encodeURIComponent(skillId)}/plan`, { inputs },
    ));
    if (!response?.data?.plan || typeof response.data.plan !== 'object') throw new Error('The local API returned no plan preview.');
    return response.data.plan;
  }

  async run(skillId: string, inputs: Record<string, unknown>): Promise<{ id: string }> {
    const response = await firstValueFrom(this.api.post<{ data?: { run?: { id?: string } } }>(
      `/api/skills/${encodeURIComponent(skillId)}/run`, { inputs },
    ));
    const id = response?.data?.run?.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('The local API returned an invalid run ID.');
    return { id };
  }
}
