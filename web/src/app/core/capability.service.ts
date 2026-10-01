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
  skills?: Array<{ id: string; name: string; version: string; category: string; status: 'ready' | 'not_ready' | 'unknown' }> | null;
  routeDetails?: CapabilityDeclaration['routes'];
  evidenceDetails?: CapabilityDeclaration['evidence'];
  detailsUnavailable?: boolean;
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
  description?: string;
  artifacts?: { role?: string; model_id?: string; optional?: boolean }[];
  capabilities?: { id: string; inputs?: { kind: string }[]; outputs?: { kind: string }[]; features?: string[]; evidence?: ManifestEvidence }[];
  provenance?: ManifestEvidence;
  modalities?: { inputs?: string[]; outputs?: string[] };
  runtime_compatibility?: { runtime_id?: string; backend?: string; status?: string; evidence?: ManifestEvidence }[];
  verification_available?: boolean;
  verification_unavailable_reason?: string | null;
  verification?: { success: boolean; completed_at: string } | null;
}

export interface ModelCapabilityEvidence {
  manifest: ModelManifestView | null;
  routes: CapabilityDeclaration[];
  error: string;
  detailLoaded?: boolean;
  verificationAvailable?: boolean;
  verificationUnavailableReason?: string | null;
  verification?: { success: boolean; completed_at: string } | null;
}

interface CapabilityListResponse { data?: { capabilities?: CapabilityDeclaration[] } }
interface ManifestListResponse { data?: { manifests?: ModelManifestView[] } }
interface ManifestDetailResponse {
  data?: {
    manifest?: ModelManifestView;
    verification_available?: boolean;
    verification_unavailable_reason?: string | null;
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

  async getCatalogEvidence(modelIds: string[]): Promise<Record<string, ModelCapabilityEvidence>> {
    const ids = [...new Set(modelIds.filter(id => typeof id === 'string' && id.length > 0))];
    if (!ids.length) return {};
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
    if (manifests.status === 'rejected') errors.push('Model manifest evidence could not be loaded.');
    return Object.fromEntries(ids.map(modelId => [modelId, {
      manifest: manifestRows.find(item => Array.isArray(item.artifacts)
        && item.artifacts.some(artifact => artifact.model_id === modelId)) ?? null,
      routes: declarations.filter(item => Array.isArray(item.routes)
        && item.routes.some(route => route.model_id === modelId)),
      error: errors.join(' '),
      detailLoaded: false,
    }]));
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
    let verificationAvailable = false;
    let verificationUnavailableReason: string | null = null;
    let verification: ModelCapabilityEvidence['verification'] = null;
    if (manifest) {
      try {
        const detail = await firstValueFrom(this.api.get<ManifestDetailResponse>(
          `/api/model-manifests/${encodeURIComponent(manifest.id)}`));
        manifest = {
          ...manifest,
          ...(detail?.data?.manifest || {}),
          verification_available: detail?.data?.verification_available === true,
          verification_unavailable_reason: detail?.data?.verification_unavailable_reason ?? null,
          verification: detail?.data?.verification || null,
        };
        verificationAvailable = detail?.data?.verification_available === true;
        verificationUnavailableReason = detail?.data?.verification_unavailable_reason ?? null;
        verification = detail?.data?.verification ?? null;
      } catch {
        errors.push('Model manifest verification state could not be loaded.');
      }
    }
    return {
      manifest,
      routes: declarations.filter(item => Array.isArray(item.routes)
        && item.routes.some(route => route.model_id === modelId)),
      error: errors.join(' '),
      detailLoaded: true,
      verificationAvailable,
      verificationUnavailableReason,
      verification,
    };
  }

  async verifyModelManifest(manifestId: string): Promise<ManifestVerificationResponse['data']> {
    const response = await firstValueFrom(this.api.post<ManifestVerificationResponse>(
      `/api/model-manifests/${encodeURIComponent(manifestId)}/verify`, {}));
    return response?.data;
  }
}
