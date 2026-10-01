export type RunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunSnapshot {
  id: string;
  chat_id?: string | null;
  recovered?: boolean;
  durable?: boolean;
  durability_error?: string | null;
  skill_id: string;
  skill_version: string;
  plan?: Record<string, unknown>;
  state: RunState | string;
  created_at?: number | string;
  started_at?: number | string | null;
  completed_at?: number | string | null;
  current_nodes?: string[];
  outputs?: unknown[];
  error?: Record<string, unknown> | null;
  last_sequence?: number;
}

export interface RunEvent {
  run_id: string;
  sequence: number;
  timestamp: number | string;
  type: string;
  data: Record<string, unknown>;
}

export type RunStreamState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';
