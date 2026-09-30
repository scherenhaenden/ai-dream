import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { CapabilityConfidence, CapabilityDeclaration, CapabilityStatus } from './capability.types';

export interface CapabilityMapItem {
  id: string;
  status: CapabilityStatus;
  routes?: number;
  route_count?: number;
  preferred_route_id?: string | null;
  inputs?: string[];
  outputs?: string[];
  evidence?: { source: string; status?: string; confidence: CapabilityConfidence; verified_at?: string; observedAt?: string; details?: Record<string, unknown> }[];
}

export interface ManifestEvidence {
  source?: string;
  status?: string;
  confidence?: string;
  verified_at?: string;
  details?: string;
}

export interface ModelManifestView {
  id: string;
  display_name: string;
  artifacts?: { role?: string; model_id?: string; optional?: boolean }[];
  capabilities?: { id: string; inputs?: { kind: string }[]; outputs?: { kind: string }[]; features?: string[]; evidence?: ManifestEvidence }[];
  provenance?: ManifestEvidence;
  modalities?: { inputs?: string[]; outputs?: string[] };
  runtime_compatibility?: { runtime_id?: string; backend?: string; status?: string; evidence?: ManifestEvidence }[];
  verification_available?: boolean;
  verification?: { success: boolean; completed_at: string } | null;
}

export interface ModelCapabilityEvidence {
  manifest: ModelManifestView | null;
  routes: CapabilityDeclaration[];
  error: string;
}

interface CapabilityListResponse { data?: { capabilities?: CapabilityDeclaration[] } }
interface ManifestListResponse { data?: { manifests?: ModelManifestView[] } }
interface ManifestDetailResponse {
  data?: {
    manifest?: ModelManifestView;
    verification_available?: boolean;
    verification?: { success: boolean; completed_at: string } | null;
  };
}
interface ManifestVerificationResponse {
  data?: {
    verification?: { success: boolean; completed_at: string };
    profile?: Record<string, unknown> | null;
    manifest?: ModelManifestView;
  };
}

interface CapabilityMapResponse {
  data: { capabilities: CapabilityMapItem[] };
}

@Injectable({ providedIn: 'root' })
export class CapabilityService {
  private readonly api = inject(ApiService);

  async getMap(): Promise<CapabilityMapItem[]> {
    const response = await firstValueFrom(
      this.api.get<CapabilityMapResponse>('/api/capability-map'),
    );
    return Array.isArray(response?.data?.capabilities) ? response.data.capabilities : [];
  }

  async getModelEvidence(modelId: string): Promise<ModelCapabilityEvidence> {
    const [capabilities, manifests] = await Promise.allSettled([
      firstValueFrom(this.api.get<CapabilityListResponse>('/api/capabilities')),
      firstValueFrom(this.api.get<ManifestListResponse>('/api/model-manifests')),
    ]);
    const errors: string[] = [];
    const declarations = capabilities.status === 'fulfilled' && Array.isArray(capabilities.value?.data?.capabilities)
      ? capabilities.value.data.capabilities : [];
    if (capabilities.status === 'rejected') errors.push('Capability routes could not be loaded.');
    const manifestRows = manifests.status === 'fulfilled' && Array.isArray(manifests.value?.data?.manifests)
      ? manifests.value.data.manifests : [];
    if (manifests.status === 'rejected') errors.push('Model manifest provenance could not be loaded.');
    let manifest = manifestRows.find(item => Array.isArray(item.artifacts)
      && item.artifacts.some(artifact => artifact.model_id === modelId)) ?? null;
    if (manifest) {
      try {
        const detail = await firstValueFrom(this.api.get<ManifestDetailResponse>(
          `/api/model-manifests/${encodeURIComponent(manifest.id)}`));
        manifest = {
          ...manifest,
          ...(detail?.data?.manifest || {}),
          verification_available: detail?.data?.verification_available === true,
          verification: detail?.data?.verification || null,
        };
      } catch {
        errors.push('Model manifest verification state could not be loaded.');
      }
    }
    return {
      manifest,
      routes: declarations.filter(item => Array.isArray(item.routes)
        && item.routes.some(route => route.model_id === modelId)),
      error: errors.join(' '),
    };
  }

  async verifyModelManifest(manifestId: string): Promise<ManifestVerificationResponse['data']> {
    const response = await firstValueFrom(this.api.post<ManifestVerificationResponse>(
      `/api/model-manifests/${encodeURIComponent(manifestId)}/verify`, {}));
    return response?.data;
  }
}
