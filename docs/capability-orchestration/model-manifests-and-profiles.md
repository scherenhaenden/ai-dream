# Model manifests and load profiles

AI Dream currently has a useful file-centric catalog and a separate runtime/profile control plane. To orchestrate specialist models, those pieces need a richer declarative bridge: a **model manifest** says what a model is and what it can do; a **load profile** says how to run it on a particular machine/runtime.

The manifest must not replace observed GGUF/Hugging Face metadata. It overlays it with explicit orchestration information and provenance.

## 1. Separation of concerns

Keep these objects separate:

```text
ModelRecord
  = discovered artifact facts

ModelManifest
  = semantic identity, modalities, roles, dependencies, runtime compatibility

ModelProfile
  = concrete runtime + placement + load/generation settings

VerificationRecord
  = evidence that a model/profile/runtime/hardware combination worked

BenchmarkRecord
  = measured speed/quality/resource observations
```

This prevents today's common failure mode where "model" means file, runtime, launch arguments, task role and quality preference all at once.

## 2. Stable model identity

The existing path-derived catalog ID is practical for local discovery, but orchestration also benefits from a semantic model identity that survives a file move.

Recommended identities:

```text
artifact_id      existing local catalog/file identity
model_key        semantic identity, e.g. family/revision/variant
manifest_id      AI Dream manifest identity
profile_id       concrete launch configuration
```

A manifest may bind several artifact IDs when a model is split across files or has companion artifacts.

Example:

```json
{
  "schema_version": 1,
  "id": "local.qwen-vl-4b-q4",
  "display_name": "Qwen Vision 4B Q4",
  "artifacts": [
    {"role": "model", "model_id": "abc123..."},
    {"role": "vision_projector", "model_id": "def456...", "optional": false}
  ]
}
```

## 3. Model manifest schema

Recommended first schema:

```json
{
  "schema_version": 1,
  "id": "example.model",
  "display_name": "Example Model",
  "description": "Short user-facing description",
  "family": "example-family",
  "variant": "4b-q4",
  "artifacts": [],
  "capabilities": [],
  "modalities": {
    "inputs": ["text", "image"],
    "outputs": ["text"]
  },
  "runtime_compatibility": [],
  "dependencies": [],
  "resource_hints": {},
  "defaults": {},
  "provenance": {},
  "ui": {}
}
```

The schema is additive and versioned. Unknown fields must be ignored by older readers rather than causing model loss.

## 4. Runtime compatibility

A model can have several runnable routes. Do not encode one backend as the model's identity.

```json
{
  "runtime_compatibility": [
    {
      "runtime_kind": "llama.cpp",
      "formats": ["gguf"],
      "required_features": ["protocol.chat_completions"],
      "preferred": true
    },
    {
      "runtime_kind": "vllm",
      "formats": ["safetensors"],
      "required_features": ["protocol.chat_completions"]
    }
  ]
}
```

A runtime adapter owns the translation from normalized profile fields to backend-specific launch arguments.

## 5. Dependencies and compound models

Many non-text models are not one file. The manifest needs explicit roles:

```text
model
vision_projector
text_encoder
vae
vocoder
tokenizer
processor
controlnet
lora
adapter
reranker
embedding_model
```

Example:

```json
{
  "dependencies": [
    {
      "role": "vae",
      "required": true,
      "selector": {"family": "flux-vae"}
    },
    {
      "role": "text_encoder",
      "required": true,
      "selector": {"model_key": "clip-large"}
    }
  ]
}
```

Dependencies may resolve to installed artifacts or to another manifest. Resolution should be explicit and visible before a run begins.

## 6. Resource hints

The manifest can carry estimates, never guarantees:

```json
{
  "resource_hints": {
    "ram_bytes_estimate": 10000000000,
    "vram_bytes_estimate": 8000000000,
    "disk_working_bytes_estimate": 0,
    "supports_partial_gpu_offload": true,
    "supports_multi_gpu": true,
    "warmup_cost": "medium"
  }
}
```

Every estimate has provenance. Hardware-specific observations belong in benchmark/verification records rather than mutating generic manifests.

## 7. Load profiles as first-class preconfigurations

The user explicitly needs AI Dream to "know how to load model X". This belongs in reusable profiles linked directly from the model card.

A profile should answer:

- which runtime installation to use;
- which runtime adapter/backend;
- which companion artifacts to bind;
- GPU placement and tensor split;
- context/batch/cache settings;
- concurrency;
- model-specific runtime options;
- default generation settings;
- intended use/capability;
- hardware signature and verification state.

Recommended extension of today's `ModelProfile` concept:

```json
{
  "id": "profile_...",
  "model_id": "artifact-or-manifest-id",
  "name": "2x RX 9070 - balanced chat",
  "purpose": ["text.chat", "text.reason"],
  "runtime_id": "llama-main",
  "backend_name": "llama.cpp",
  "hardware_signature": "hw_...",
  "placement": {
    "gpu_layers": 99,
    "tensor_split": "0.55,0.45",
    "split_mode": "layer"
  },
  "load": {
    "context_size": 32768,
    "flash_attention": true,
    "fit": false
  },
  "generation": {
    "temperature": 0.7
  },
  "verification": {
    "status": "verified",
    "runtime_version": "...",
    "verified_at": "..."
  }
}
```

The exact fields remain normalized and validated by runtime capability support.

## 8. Profile categories

A model may ship or learn several profiles:

```text
safe/default      conservative settings expected to start reliably
balanced          quality/speed/memory compromise
fast              smaller context/batch or more aggressive runtime tuning
max-context       optimized for larger context
low-vram          more offload / smaller batches
multi-gpu         explicit split for known hardware
capability-specific  e.g. vision, coding, embedding throughput
user              manually created
verified          generated or promoted after successful bounded probe
```

These are labels, not separate schema types.

## 9. Profile resolution precedence

Preserve the existing control-plane rule and extend it carefully:

```text
runtime defaults
< model manifest defaults
< selected model profile
< skill node overrides
< chat/session settings
< one-run request override
```

A skill may request a capability-specific profile, but should not silently overwrite user-pinned runtime settings when manual mode is active.

## 10. Hardware signatures

A profile that works on one machine may be wrong on another. AI Dream should calculate a stable hardware signature from relevant facts only, for example:

```text
GPU vendor/model/count/VRAM
CPU architecture/instruction set
RAM bucket
runtime device mapping
```

Do not include usernames, hostnames or serial numbers.

A profile may be:

```text
portable          no hardware signature; expected to work broadly
hardware-bound    intended for one compatible hardware signature
adapted           copied from a profile and adjusted for current hardware
```

## 11. Manifest layering and trust

Do not create one mutable mega-file. Merge layers in a documented order:

```text
observed local metadata
< bundled curated manifest
< downloaded trusted manifest metadata
< local generated/verified overlay
< user override
```

Each field should retain provenance internally when conflicts matter.

A user override can intentionally correct metadata, but it should be visually distinguishable from verified facts.

## 12. Auto-generated candidate manifests

Discovery may create a candidate manifest from filename/GGUF/HF metadata, but it must mark uncertain fields as inferred.

Example:

```text
filename contains "vision" -> suggestion only
GGUF architecture says clip -> strong projector evidence
Hub pipeline tag says image-text-to-text -> useful metadata, still not local verification
successful image+text probe -> verified vision route
```

This lets AI Dream become useful immediately without pretending inference is certainty.

## 13. Runtime-specific adapters

Each runtime adapter should implement a contract roughly like:

```python
probe_installation() -> RuntimeDescriptor
supports(manifest, profile) -> CompatibilityResult
prepare(manifest, profile) -> PreparedLaunch
start(prepared) -> RuntimeHandle
health(handle) -> HealthState
invoke(handle, operation, inputs, options) -> Artifact(s)
cancel(handle, request_id)
stop(handle)
```

The public orchestration layer should never assemble backend CLI flags itself.

For current AI Dream, llama.cpp and vLLM can gradually implement this interface around existing backend classes rather than being rewritten at once.

The current `BackendRuntimeAdapter` owns one loaded handle and rejects a second
`load()` until that handle is unloaded. Its synchronous backend call is
serialized per adapter. Existing engines expose a process-wide
`cancel_generation()` rather than request-scoped cancellation, so the adapter
only cancels the currently active call when the optional request ID matches;
an idle call or mismatched ID returns `false`. It does not advertise
`requests.concurrent`, even if the engine supports internal batching, because
this adapter boundary cannot safely run concurrent invocations with global
cancellation. A future adapter may advertise concurrency after it provides
request-scoped cancellation and matching lifecycle tests.

## 14. Model card requirements

Every model card should eventually show the information the resolver uses:

```text
Input: text / image / audio / ...
Output: text / image / embeddings / ...
Capabilities: chat, reasoning, OCR, image edit, ...
Runtime: llama.cpp / vLLM / ...
Status: present / runnable / verified / loaded
Profiles: default / 2xGPU / low-vram / ...
Estimated memory
Companion artifacts
Evidence badge
```

The card must offer "Configure / Load" in-place. The user should not need to select a model in one screen and hunt for its profile somewhere unrelated.

## 15. Verification and promotion flow

A good UX for new models:

```text
1. Discover artifact
2. Build candidate manifest
3. Resolve compatible runtime(s)
4. Suggest a conservative profile
5. User runs "Verify"
6. AI Dream performs bounded startup + minimal capability probe
7. Successful settings are stored as verified profile
8. Optional benchmark later refines ranking
```

This is the foundation for a system that becomes more accurate about its own local stack over time without uncontrolled self-modification.
