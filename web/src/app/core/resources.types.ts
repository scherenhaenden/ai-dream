export type ObservationStatus = 'known' | 'observed' | 'unknown' | 'not_supported' | string;

export interface ResourceValue<T> {
  value?: T | null;
  status?: ObservationStatus;
}

export interface RuntimeDeviceMappings {
  status: ObservationStatus;
  items?: Record<string, unknown>[];
}

export interface GpuResource {
  id: string;
  index?: number | null;
  name?: string | null;
  vendor?: string | null;
  backends?: string[];
  runtime_device_mappings?: RuntimeDeviceMappings;
  total_vram_bytes?: number | null;
  total_vram_status?: ObservationStatus;
  free_vram_bytes?: number | null;
  free_vram_status?: ObservationStatus;
  metrics_status?: ObservationStatus;
}

export interface ResidentModel {
  model_id: string;
  route_ids?: string[];
  profile_id?: string | null;
  runtime_id?: string | null;
  state?: string;
  lease_count?: number | null;
  pinned?: boolean | null;
  loaded_for_seconds?: number | null;
  idle_for_seconds?: number | null;
  estimated_ram_bytes?: number | null;
  estimated_ram_status?: ObservationStatus;
  estimated_vram_bytes?: number | null;
  estimated_vram_status?: ObservationStatus;
}

export interface ResourceSnapshot {
  resources?: {
    ram?: { total_bytes?: number | null; total_status?: ObservationStatus; available_bytes?: number | null; available_status?: ObservationStatus; metrics_status?: ObservationStatus };
    gpus?: GpuResource[];
    loaded_models?: ResidentModel[];
    pending_reservations?: unknown[];
    pending_reservations_status?: ObservationStatus;
    active_lease_count?: number | null;
    cpu?: { logical_cores?: number | null; physical_cores?: number | null; active_threads?: number | null; thread_pressure_status?: ObservationStatus };
    temporary_disk?: { available_bytes?: number | null; status?: ObservationStatus };
  };
  status?: ObservationStatus;
  hardware_error?: string | null;
}

export interface ResidencySnapshot {
  items?: ResidentModel[];
  count?: number | null;
  active_lease_count?: number | null;
  status?: ObservationStatus;
  source?: string | null;
}
