"""Wire-level control-plane contracts shared by API services and adapters.

These TypedDicts document JSON payloads; validation remains in the owning
service (catalog, runtime, profile store, or API boundary).
"""
from __future__ import annotations

from typing import Any, NotRequired, TypedDict


class ApiEnvelope(TypedDict, total=False):
    data: dict[str, Any]
    error: str


class ModelSource(TypedDict):
    id: str
    path: str
    exists: bool
    readable: bool
    managed: bool
    model_count: int
    total_bytes: int


class RuntimeDevice(TypedDict):
    id: str
    name: str
    backend: str
    runtime_id: NotRequired[str]
    index: NotRequired[int]
    memory_bytes: NotRequired[int | None]


class RuntimeCapabilities(TypedDict, total=False):
    available: bool
    device_listing: bool
    executable: str | None
    details: str
    gpu_layers: bool
    device_selection: bool
    tensor_split: bool
    split_mode: bool
    main_gpu: bool
    context_size: bool
    threads: bool
    batch_size: bool
    physical_batch_size: bool
    max_concurrent: bool
    flash_attention: bool
    unified_kv_cache: bool
    offload_kv_cache: bool
    mmap: bool
    keep_model_in_memory: bool
    fit: bool
    reasoning: bool
    chat_completions: bool


class RuntimeInstallation(TypedDict, total=False):
    id: str
    name: str
    kind: str
    executable: str
    enabled: bool
    version: str | None
    backend: str | None
    available: bool
    capabilities: RuntimeCapabilities
    devices: list[RuntimeDevice]


class RuntimePlacement(TypedDict, total=False):
    gpu_layers: int
    device: str
    split_mode: str
    tensor_split: str
    main_gpu: int


class RuntimeLoadOptions(TypedDict, total=False):
    context_size: int
    threads: int
    batch_size: int
    physical_batch_size: int
    max_concurrent: int
    flash_attention: bool
    unified_kv_cache: bool
    offload_kv_cache: bool
    mmap: bool
    keep_model_in_memory: bool
    fit: bool


class GenerationOptions(TypedDict, total=False):
    system_prompt: str
    reasoning: bool
    temperature: float
    max_tokens: int | None
    stop_strings: list[str]
    top_p: float
    top_k: int
    min_p: float
    repeat_penalty: float
    seed: int | None
    structured_output: dict[str, Any] | None


class ModelProfile(TypedDict, total=False):
    id: str
    model_id: str
    name: str
    runtime_id: str | None
    backend_name: str | None
    placement: RuntimePlacement
    load: RuntimeLoadOptions
    generation: GenerationOptions
    created_at: str
    updated_at: str


class ChatSettings(TypedDict, total=False):
    backend_name: str
    model_id: str
    model_path: str
    runtime: dict[str, RuntimePlacement | RuntimeLoadOptions]
    generation: GenerationOptions
    preset_id: str | None
    profile_id: str | None


class RuntimeLoadRequest(TypedDict, total=False):
    model_id: str
    backend: str
    runtime_id: str
    placement: RuntimePlacement
    load: RuntimeLoadOptions


class BenchmarkResult(TypedDict, total=False):
    timestamp: str
    model: str
    runtime_id: str
    model_load_seconds: float
    prompt_processing_tokens_per_second: float
    generation_tokens_per_second: float
    prompt_token_count: int
    generated_token_count: int
    backend: str
    devices: str | list[str] | None
    split_mode: str | None
    tensor_split: str | None
    load_settings: dict[str, Any]
    hardware_signature: str
    matrix_name: str
