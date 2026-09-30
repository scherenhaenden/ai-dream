export type UploadArtifactKind = 'image' | 'audio' | 'document';
export type ArtifactKind =
  | 'text' | 'chat_messages' | 'json' | 'image' | 'audio' | 'video' | 'document'
  | 'embedding_batch' | 'rerank_candidates' | 'file_reference' | 'screen_frame'
  | 'tool_result' | 'model_reference';
export type ArtifactLifetime = 'ephemeral' | 'session' | 'persistent';
export type ArtifactStorageType = 'run-local' | 'session' | 'persistent';
export type ArtifactOwnerType = 'run' | 'session' | 'user';

export type ArtifactJsonValue =
  | null | boolean | number | string
  | ArtifactJsonValue[]
  | { [key: string]: ArtifactJsonValue };

export interface ArtifactEnvelope {
  schema_version: 1;
  id: string;
  kind: ArtifactKind;
  media_type: string;
  name: string;
  storage: { type: ArtifactStorageType; key: string };
  size_bytes: number;
  lifetime: ArtifactLifetime;
  owner: { type: ArtifactOwnerType; id: string };
  metadata: Record<string, ArtifactJsonValue>;
}
