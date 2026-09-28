/** Wire contracts for the local control-plane API. Keep these aligned with
 * aidream/contracts.py and docs/control-plane.md. */

export interface ApiEnvelope<T> { data: T; }
export interface ApiError { error: string; }

export interface ModelRecord {
  id: string;
  path: string;
  size: number;
  format: string;
  metadata: Record<string, unknown>;
}

export interface ModelSource {
  id: string;
  path: string;
  exists: boolean;
  readable: boolean;
  managed: boolean;
  model_count: number;
  total_bytes: number;
}

export interface RuntimeCapabilities {
  available: boolean;
  device_listing: boolean;
  executable: string | null;
  details: string;
  gpu_layers: boolean;
  device_selection: boolean;
  tensor_split: boolean;
  split_mode: boolean;
  main_gpu: boolean;
  context_size: boolean;
  threads: boolean;
  batch_size: boolean;
  physical_batch_size: boolean;
  max_concurrent: boolean;
  threads_batch: boolean;
  continuous_batching: boolean;
  numa: boolean;
  mlock: boolean;
  kv_cache_type_k: boolean;
  kv_cache_type_v: boolean;
  flash_attention: boolean;
  unified_kv_cache: boolean;
  offload_kv_cache: boolean;
  mmap: boolean;
  keep_model_in_memory: boolean;
  fit: boolean;
  reasoning: boolean;
  chat_completions: boolean;
}

export interface RuntimeDevice {
  id: string;
  name: string;
  backend: string;
  runtime_id?: string;
  index?: number;
  memory_bytes?: number | null;
}

export interface RuntimeInstallation {
  id: string;
  name: string;
  kind: string;
  executable: string;
  enabled: boolean;
  version: string | null;
  backend: string | null;
  available: boolean;
  capabilities: RuntimeCapabilities;
  devices: RuntimeDevice[];
}

export interface RuntimePlacement {
  gpu_layers?: number;
  device?: string;
  split_mode?: string;
  tensor_split?: string;
  main_gpu?: number;
}

export interface RuntimeLoadOptions {
  context_size?: number;
  threads?: number;
  batch_size?: number;
  physical_batch_size?: number;
  max_concurrent?: number;
  threads_batch?: number;
  continuous_batching?: boolean;
  numa?: string;
  kv_cache_type_k?: string;
  kv_cache_type_v?: string;
  flash_attention?: boolean;
  unified_kv_cache?: boolean;
  offload_kv_cache?: boolean;
  mmap?: boolean;
  keep_model_in_memory?: boolean;
  fit?: boolean;
}

export interface GenerationOptions {
  system_prompt?: string;
  reasoning?: boolean;
  temperature?: number;
  max_tokens?: number | null;
  stop_strings?: string[];
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
  seed?: number | null;
  structured_output?: Record<string, unknown> | null;
}

export interface RuntimeLoadRequest {
  model_id: string;
  backend?: string;
  runtime_id?: string;
  placement?: RuntimePlacement;
  load?: RuntimeLoadOptions;
}

export interface ModelProfile {
  id: string;
  model_id: string;
  name: string;
  runtime_id?: string | null;
  backend_name?: string | null;
  placement: RuntimePlacement;
  load: RuntimeLoadOptions;
  generation: GenerationOptions;
  created_at: string;
  updated_at: string;
}

export interface ChatSettings {
  backend_name?: string;
  model_id?: string;
  model_path?: string;
  runtime?: { placement?: RuntimePlacement; load?: RuntimeLoadOptions };
  generation?: GenerationOptions;
  preset_id?: string | null;
  profile_id?: string | null;
}

export interface RuntimeDefaults {
  runtime_id: string | null;
  backend_name: string | null;
  placement: RuntimePlacement;
  load: RuntimeLoadOptions;
}

export interface AppSettings {
  runtime_defaults: RuntimeDefaults;
  managed_models_dir: string;
  config_dir: string;
  data_dir: string;
  default_profile_behavior: 'model' | 'global';
  keep_last_model_loaded: boolean;
}

export interface BenchmarkResult {
  timestamp: string;
  model: string;
  runtime_id?: string;
  model_load_seconds: number;
  prompt_processing_tokens_per_second: number;
  generation_tokens_per_second: number;
  prompt_token_count: number;
  generated_token_count: number;
  backend: string;
  devices?: string | string[] | null;
  split_mode?: string | null;
  tensor_split?: string | null;
  load_settings: Record<string, unknown>;
  hardware_signature?: string;
  matrix_name?: string;
}
