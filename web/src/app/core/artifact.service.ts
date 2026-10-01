import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiService } from './api.service';
import type { ArtifactEnvelope, UploadArtifactKind } from './artifact.types';

export const MAX_ARTIFACT_UPLOAD_BYTES = 32 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, Record<string, string>> = {
  image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' },
  audio: { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', m4a: 'audio/mp4' },
  document: { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv' },
};
const ARTIFACT_KINDS = new Set(['text', 'chat_messages', 'json', 'image', 'audio', 'video', 'document', 'embedding_batch', 'rerank_candidates', 'file_reference', 'screen_frame', 'tool_result', 'model_reference']);
const MIME_ALIASES: Record<string, string> = { 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'application/x-pdf': 'application/pdf' };

export class ArtifactUploadError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'ArtifactUploadError';
  }
}

interface ArtifactResponse { data?: { artifact?: unknown }; }
interface ArtifactListResponse { data?: { artifacts?: unknown }; }

@Injectable({ providedIn: 'root' })
export class ArtifactService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private sessionId: string | null = null;

  async upload(file: File, kind: UploadArtifactKind): Promise<ArtifactEnvelope> {
    if (typeof File === 'undefined' || !(file instanceof File)) throw new ArtifactUploadError('Select a local file to upload.');
    if (file.size <= 0) throw new ArtifactUploadError('The selected file is empty.', 400, 'empty_artifact');
    if (file.size > MAX_ARTIFACT_UPLOAD_BYTES) {
      throw new ArtifactUploadError(`File exceeds the 32 MiB upload limit (${this.formatSize(file.size)} selected).`, 413, 'artifact_too_large');
    }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const expectedMime = MIME_BY_EXTENSION[kind][extension];
    if (!expectedMime) throw new ArtifactUploadError(`This file extension is not accepted for ${kind} inputs.`, 415, 'unsupported_file_type');
    const suppliedMime = MIME_ALIASES[file.type.toLowerCase()] ?? file.type.toLowerCase();
    if (suppliedMime && suppliedMime !== 'application/octet-stream' && suppliedMime !== expectedMime) {
      throw new ArtifactUploadError(`The selected file type (${suppliedMime}) does not match .${extension} (${expectedMime}).`, 415, 'media_type_mismatch');
    }
    const name = safeFilename(file.name);
    const ownerId = this.getSessionId();
    const headers = new HttpHeaders({
      'Content-Type': expectedMime,
      'X-AI-Dream-Artifact-Kind': kind,
      'X-AI-Dream-Artifact-Name': name,
      'X-AI-Dream-Artifact-Owner-Type': 'session',
      'X-AI-Dream-Artifact-Owner-ID': ownerId,
      'X-AI-Dream-Artifact-Lifetime': 'session',
    });
    let response: ArtifactResponse;
    try {
      response = await firstValueFrom(this.http.post<ArtifactResponse>(`${this.api.baseUrl()}/api/artifacts`, file, { headers }).pipe(timeout(60000)));
    } catch (error) { throw uploadError(error); }
    const artifact = response?.data?.artifact;
    if (!isArtifactEnvelope(artifact) || artifact.kind !== kind || artifact.owner.type !== 'session'
        || artifact.owner.id !== ownerId || artifact.lifetime !== 'session'
        || artifact.storage.type !== 'session' || artifact.size_bytes !== file.size) {
      throw new ArtifactUploadError('The local API returned an invalid artifact envelope.', 502, 'invalid_artifact_response');
    }
    return artifact;
  }

  async listSessionArtifacts(): Promise<ArtifactEnvelope[]> {
    const ownerId = this.getSessionId();
    const query = new URLSearchParams({ owner_type: 'session', owner_id: ownerId });
    try {
      const response = await firstValueFrom(this.http.get<ArtifactListResponse>(`${this.api.baseUrl()}/api/artifacts?${query}`).pipe(timeout(30000)));
      if (!Array.isArray(response?.data?.artifacts)) throw new ArtifactUploadError('The local API returned an invalid artifact list.', 502, 'invalid_artifact_list');
      return response.data.artifacts.filter((value): value is ArtifactEnvelope => isArtifactEnvelope(value)
        && value.owner.type === 'session' && value.owner.id === ownerId
        && value.lifetime === 'session' && value.storage.type === 'session'
        && value.size_bytes <= MAX_ARTIFACT_UPLOAD_BYTES);
    } catch (error) { throw uploadError(error); }
  }

  async delete(artifactId: string): Promise<void> {
    if (!/^art_[A-Za-z0-9_-]{1,75}$/.test(artifactId)) throw new ArtifactUploadError('Artifact ID is malformed.', 400, 'invalid_artifact_id');
    const query = new URLSearchParams({ owner_type: 'session', owner_id: this.getSessionId() });
    try {
      await firstValueFrom(this.http.delete(`${this.api.baseUrl()}/api/artifacts/${encodeURIComponent(artifactId)}?${query}`)
        .pipe(timeout(30000)));
    } catch (error) { throw uploadError(error); }
  }

  async createPreviewUrl(artifact: ArtifactEnvelope): Promise<string> {
    if (!artifact || !/^art_[A-Za-z0-9_-]{1,75}$/.test(artifact.id)
        || !artifact.owner || !['run', 'session', 'user'].includes(artifact.owner.type)
        || typeof artifact.owner.id !== 'string' || !artifact.owner.id) {
      throw new ArtifactUploadError('Artifact reference is invalid.', 400, 'invalid_artifact_reference');
    }
    const query = new URLSearchParams({ owner_type: artifact.owner.type, owner_id: artifact.owner.id });
    try {
      const blob = await firstValueFrom(this.http.get(`${this.api.baseUrl()}/api/artifacts/${encodeURIComponent(artifact.id)}/content?${query}`, {
        responseType: 'blob',
      }).pipe(timeout(30000)));
      if (blob.size !== artifact.size_bytes) throw new ArtifactUploadError('Artifact content size does not match its envelope.', 502, 'artifact_size_mismatch');
      return URL.createObjectURL(blob);
    } catch (error) { throw uploadError(error); }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }

  private getSessionId(): string {
    if (this.sessionId) return this.sessionId;
    const key = 'aidream.artifactSessionId';
    try {
      const existing = sessionStorage.getItem(key);
      if (existing && /^[a-f0-9-]{32,36}$/.test(existing)) return this.sessionId = existing;
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replaceAll('-', '')
        : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      sessionStorage.setItem(key, id);
      return this.sessionId = id;
    } catch {
      const id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      return this.sessionId = id;
    }
  }
}

function isArtifactEnvelope(value: unknown): value is ArtifactEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<ArtifactEnvelope>;
  const owner = item.owner;
  const storage = item.storage;
  return item.schema_version === 1
    && typeof item.id === 'string' && /^art_[A-Za-z0-9_-]{1,75}$/.test(item.id)
    && typeof item.kind === 'string' && ARTIFACT_KINDS.has(item.kind)
    && typeof item.media_type === 'string' && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(item.media_type)
    && typeof item.name === 'string' && !!item.name.trim() && item.name.length <= 255 && !/[\\/\x00-\x1f]/.test(item.name)
    && Number.isSafeInteger(item.size_bytes) && (item.size_bytes ?? -1) >= 0
    && ['ephemeral', 'session', 'persistent'].includes(String(item.lifetime))
    && !!owner && ['run', 'session', 'user'].includes(String(owner.type)) && typeof owner.id === 'string' && !!owner.id
    && !!storage && ['run-local', 'session', 'persistent'].includes(String(storage.type))
    && typeof storage.key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(storage.key)
    && !!item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata);
}

function safeFilename(value: string): string {
  const leaf = value.split(/[\\/]/).pop() ?? 'upload';
  const ascii = leaf.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  const bounded = ascii.slice(0, 255);
  return bounded && bounded !== '.' && bounded !== '..' ? bounded : 'upload';
}

function uploadError(error: unknown): ArtifactUploadError {
  if (!(error instanceof HttpErrorResponse)) {
    return new ArtifactUploadError(error instanceof Error ? error.message : 'Artifact upload failed.');
  }
  const response = error.error as { error?: unknown; message?: unknown } | string | null;
  const nested = response && typeof response === 'object' ? response.error : null;
  const code = nested && typeof nested === 'object' && 'code' in nested && typeof nested.code === 'string' ? nested.code : undefined;
  const message = nested && typeof nested === 'object' && 'message' in nested && typeof nested.message === 'string' ? nested.message
    : typeof nested === 'string' ? nested
    : response && typeof response === 'object' && typeof response.message === 'string' ? response.message : undefined;
  if (error.status === 413) return new ArtifactUploadError(message || 'The file is larger than the server upload limit of 32 MiB.', 413, code || 'artifact_too_large');
  if (error.status === 415) return new ArtifactUploadError(message || 'This file format is not supported for the selected input.', 415, code || 'unsupported_file_type');
  if (error.status === 0) return new ArtifactUploadError('Could not reach the local artifact API. Check that AI Dream is running.', 0, 'api_unavailable');
  return new ArtifactUploadError(message || `Artifact upload failed (HTTP ${error.status || 'unknown'}).`, error.status, code);
}
