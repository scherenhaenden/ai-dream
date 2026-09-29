export type ActiveScreen =
  | 'chat'
  | 'models'
  | 'model-hubs'
  | 'hardware'
  | 'load-model'
  | 'providers-and-runtimes'
  | 'local-api'
  | 'knowledge'
  | 'tools-and-permissions'
  | 'downloads'
  | 'logs-and-traces'
  | 'settings'
  | 'profiles';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  tokens?: number;
  content: string;
  thoughtProcess?: {
    durationMs: number;
    tokens: number;
    steps: string[];
  };
  codeArtifact?: {
    filename: string;
    lang: string;
    code: string;
  };
  benchmarkData?: {
    device: string;
    split: string;
    tile: string;
    bandwidth: string;
    tflops: string;
    isPrimary?: boolean;
    isSecondary?: boolean;
    isTotal?: boolean;
  }[];
  ragSources?: {
    title: string;
    location: string;
    snippet: string;
    score: string;
  }[];
}

export interface ModelItem {
  id: string;
  title: string;
  path: string;
  hash: string;
  architecture: string;
  format: 'gguf' | 'safetensors' | 'hf-cache';
  quant: string;
  params: string;
  size: string;
  layers: string;
  heads: string;
  contextLimit: string;
  status: 'ACTIVE_IN_MEMORY' | 'STANDBY_ON_DISK' | 'READY_TO_LOAD' | 'EXTERNAL_LINK';
  tokPerSec?: number;
  locationCategory: 'primary' | 'nvme' | 'lmstudio' | 'cold';
  vramPlacement?: {
    gpu0: number;
    gpu1: number;
    hostRam: number;
    total: number;
    description: string;
  };
}
