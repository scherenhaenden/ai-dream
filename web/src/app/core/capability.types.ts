/** Shared Phase 0 contracts for capability orchestration. */

export type CapabilityStatus = 'ready' | 'supported' | 'degraded' | 'unavailable' | 'unknown';
export type CapabilityConfidence = 'high' | 'medium' | 'low' | 'unknown' | 'observed' | 'verified' | 'inferred' | 'declared';

export interface ArtifactTypeDeclaration {
  kind: string;
  media_types?: string[];
}

export interface CapabilityEvidence {
  source: string;
  status?: 'verified' | 'supported' | 'probable' | 'unknown' | 'failed';
  confidence?: CapabilityConfidence;
  verified_at?: string;
  details?: string;
}

export interface CapabilityDeclaration {
  id: string;
  inputs: ArtifactTypeDeclaration[];
  outputs: ArtifactTypeDeclaration[];
  status: CapabilityStatus;
  evidence: CapabilityEvidence[];
  routes?: CapabilityRouteSummary[];
  preferred_route_id?: string | null;
}

export interface CapabilityRouteSummary {
  id: string;
  model_id?: string;
  runtime_id?: string | null;
}
