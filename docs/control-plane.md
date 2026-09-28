# AI Dream control-plane contracts

This document freezes the initial JSON contract for the local model/runtime
control plane. Python types live in `aidream/contracts.py`; Angular types live
in `web/src/app/core/control-plane.types.ts`. These describe transport only;
service validation remains authoritative. JSON success responses use
`{"data": ...}` and errors use `{"error": "..."}`.

## Existing compatible contracts

- `GET /api/models` → `data.models: ModelRecord[]`.
- `GET /api/runtime` → `data.backends`, `data.devices`, `data.status`.
- `POST /api/runtime/load` → `{model_id, backend?, placement?, load?}`.
- `POST /api/runtime/unload` → `{}`.
- `POST /api/runtime/command` → `{model_id, backend?, placement?, load?}`.
- `GET /api/runtime/status` → `data.status`.
- `GET /api/chats/<id>` returns the public transcript and intentionally omits
  private settings and attachment paths.

The existing runtime request shape remains valid. `runtime_id` is an optional
future selector; `backend` continues to select a compatible backend name.

## Additive contracts for the control plane

| Method and path | Request | Success payload |
| --- | --- | --- |
| `GET /api/model-sources` | — | `data.sources: ModelSource[]` |
| `POST /api/model-sources` | `{path}` | `data.source: ModelSource` |
| `DELETE /api/model-sources/<source-id>` | — | `data.removed: true` |
| `POST /api/models/rescan` | `{}` | `data.models: ModelRecord[]` |
| `GET /api/runtime/installations` | — | `data.installations: RuntimeInstallation[]` |
| `POST /api/runtime/installations` | `{name, executable}` | `data.installation` |
| `POST /api/runtime/installations/<id>/probe` | `{}` | refreshed installation/capabilities/devices |
| `DELETE /api/runtime/installations/<id>` | — | `data.removed: true` |
| `GET /api/model-profiles` | optional `?model_id=` | `data.profiles: ModelProfile[]` |
| `POST /api/model-profiles` | profile without timestamps | `data.profile` |
| `PATCH /api/model-profiles/<id>` | partial profile fields | `data.profile` |
| `DELETE /api/model-profiles/<id>` | — | `data.removed: true` |
| `GET /api/settings` | — | `data.settings: AppSettings` |
| `PATCH /api/settings` | `runtime_defaults`, `default_profile_behavior`, `keep_last_model_loaded` | `data.settings: AppSettings` |
| `GET /api/chats/<id>/settings` | — | `data.settings: ChatSettings` |
| `PATCH /api/chats/<id>/settings` | partial settings | `data.settings: ChatSettings` |

All write routes use the same loopback Host and exact Origin checks as existing
mutations. Source/profile/runtime removal deletes only the catalog/config
record. It never deletes a model, executable, or runtime file. Model source
creation accepts one explicit existing directory; there is no filesystem
browsing endpoint. Runtime executables are validated as llama.cpp server
installations before their advertised help/capabilities are trusted.

`AppSettings` contains `runtime_defaults: {runtime_id?, backend_name?,
placement, load}`, read-only `managed_models_dir`, `config_dir`, `data_dir`,
`default_profile_behavior` (`model` or `global`), and
`keep_last_model_loaded`. Directory values are informational and cannot be
patched by the browser.

## Configuration shapes and precedence

`RuntimePlacement` is `{gpu_layers?, device?, tensor_split?, split_mode?,
main_gpu?}`. `RuntimeLoadOptions` is `{context_size?, threads?, batch_size?,
physical_batch_size?, max_concurrent?, threads_batch?, continuous_batching?,
numa?, kv_cache_type_k?, kv_cache_type_v?, flash_attention?,
unified_kv_cache?, offload_kv_cache?, mmap?, keep_model_in_memory?, fit?`.
Only options advertised
by the selected installation are actionable; unsupported supplied values are
rejected.

`ModelProfile` stores model identity, optional runtime/backend selection,
placement, load options, and generation options as separate objects. Effective
configuration precedence is:

```text
llama.cpp defaults < global AI Dream defaults < model profile < chat settings < request override
```

Load fingerprints include runtime, model, placement, and load options. A
fingerprint change requires a reload; generation-only changes do not.
Legacy chat settings without `profile_id` remain valid and resolve as empty
overrides.

## Deferred tuning contract

Benchmark JSON currently records model/load/throughput/token/backend/placement
fields. Persisted hardware signatures, runtime-id comparisons, tuning jobs, and
autotuning remain deferred until runtime installations and profile resolution
are functional. This phase must not start model workloads automatically.
