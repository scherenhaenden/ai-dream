export type SkillReadiness = 'ready' | 'not_ready' | 'unknown';

export interface SkillPort {
  name: string;
  artifact: string;
  required?: boolean;
}

export type SkillPermissionKey = 'filesystem_read' | 'filesystem_write' | 'network' | 'shell'
  | 'browser_control' | 'computer_control' | 'desktop_control' | 'microphone' | 'camera' | 'clipboard';
export type SkillPermissions = Record<SkillPermissionKey, string>;
export interface SkillPermissionRow { key: SkillPermissionKey; value: string; }

export interface SkillCatalogItem {
  id: string;
  name: string;
  version?: string;
  description: string;
  category?: string | null;
  inputs: SkillPort[];
  outputs: SkillPort[];
  status: SkillReadiness;
  not_ready_reasons?: string[];
  alternatives?: string[];
  preferred_route_id?: string | null;
}
