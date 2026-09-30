# Capability model

This document defines the vocabulary AI Dream should use to reason about local AI components. The goal is to make heterogeneous models interoperable without pretending that every backend speaks the same protocol or every model is interchangeable.

## 1. Capability identifiers

Capabilities are stable, namespaced identifiers. They describe a useful operation, not a specific model family or runtime command.

Recommended initial taxonomy:

```text
text.generate
text.chat
text.reason
text.summarize
text.translate
text.classify
text.extract
code.generate
code.review
code.explain
code.tool-call
math.solve
vision.understand
vision.screen
vision.video-understand
ocr.extract
document.parse
document.layout
document.render
embedding.create
rerank.score
retrieval.search
memory.store
memory.retrieve
audio.transcribe
audio.synthesize
audio.understand
audio.diarize
audio.prosody
music.understand
music.generate
image.generate
image.edit
image.inpaint
video.generate
video.edit
mesh.generate
computer.control
browser.control
phone.control
tool.call
structured.generate
```

The taxonomy should be intentionally smaller than the set of model names. A model can advertise several capabilities and a skill can require several capabilities.

Capabilities may have optional features rather than creating a new identifier for every variant. For example `vision.understand` can declare `features: [multi_image, bounding_boxes]` and `image.edit` can declare `features: [mask, reference_image]`.

## 2. Canonical artifact types

Pipelines need a transport model richer than strings. Every step consumes and emits one or more typed artifacts.

Initial artifact kinds:

```text
text
chat_messages
json
image
audio
video
document
embedding_batch
rerank_candidates
file_reference
screen_frame
tool_result
model_reference
```

Each artifact has a small common envelope:

```json
{
  "id": "art_...",
  "kind": "image",
  "media_type": "image/png",
  "name": "screenshot.png",
  "storage": {"type": "run-local", "key": "..."},
  "size_bytes": 184221,
  "metadata": {
    "width": 1920,
    "height": 1080
  }
}
```

Large binary data must never be copied repeatedly through JSON. The run-local artifact store owns bytes; workflow nodes receive references plus validated metadata. Text and small structured objects may remain inline up to bounded limits.

Artifacts have lifetimes:

- `ephemeral`: deleted after the run.
- `session`: kept while the chat/workspace remains active.
- `persistent`: explicitly saved by the user or by a skill whose contract says it creates a durable output.

Persistence must never be implied by a model response.

## 3. Capability declarations

A capability declaration answers four questions:

1. What operation can this component perform?
2. What input artifact types does it accept?
3. What output artifact types does it produce?
4. How do we know this is true?

Example:

```json
{
  "id": "vision.understand",
  "inputs": [
    {"kind": "image", "required": true, "max_count": 4},
    {"kind": "text", "required": false}
  ],
  "outputs": [{"kind": "text"}],
  "features": ["multi_image"],
  "evidence": {
    "source": "verified_run",
    "status": "verified",
    "verified_at": "2026-09-30T00:00:00Z"
  }
}
```

## 4. Evidence and provenance

AI Dream must distinguish metadata from evidence. A capability may come from several sources with different confidence:

```text
verified_run       strongest: AI Dream executed a bounded probe successfully
runtime_probe      backend/runtime reports the feature
model_metadata     model/container metadata declares the feature
bundled_manifest   curated manifest shipped with AI Dream
hub_metadata       external repository metadata
user_override      explicit local user declaration
filename_hint      weak hint only
unknown            no reliable evidence
```

Recommended status values:

```text
verified
supported
probable
unknown
failed
```

A weak source may help the UI suggest a configuration, but hard orchestration decisions should prefer `verified` or `supported`. The system should display provenance where a claim matters.

A failed probe should not permanently blacklist a model. Failures are scoped to model revision, runtime version, profile and hardware signature where relevant.

## 5. Component types

The registry stores four kinds of components.

### Model component

A local or remote model artifact plus metadata and capability declarations. A model is not automatically runnable.

### Runtime component

A backend installation such as llama.cpp, vLLM, mistral.rs, whisper.cpp, stable-diffusion.cpp, a Python Diffusers environment or another explicitly supported runtime adapter. A runtime advertises protocol and lifecycle features.

### Tool component

Deterministic/local software such as PDF parser, document renderer, filesystem reader, OCR engine, Git client or browser driver. Tools have permissions in addition to capabilities.

### Skill component

A composed user-facing operation whose own declared input/output capabilities are derived from its workflow graph.

## 6. Runtime protocol capabilities

Runtime capability discovery must remain separate from model capability discovery.

A runtime might support:

```text
protocol.chat_completions
protocol.responses
protocol.embeddings
protocol.rerank
protocol.image_generation
protocol.audio_transcription
protocol.audio_speech
feature.streaming
feature.tool_calls
feature.structured_output
feature.multi_gpu
feature.concurrent_requests
feature.model_hot_swap
feature.lora
feature.multimodal_projector
```

This distinction matters because a vision model may be valid but unusable through a runtime build that lacks the necessary multimodal path.

A runnable route exists only when these sets intersect correctly:

```text
model capability
AND runtime protocol capability
AND runtime/model compatibility
AND required companion artifacts
AND hardware feasibility
AND permissions
```

## 7. Compatibility constraints

Capabilities can carry constraints. Examples:

- accepted media types and maximum input counts;
- tokenizer/template requirements;
- required projector or vision adapter;
- expected embedding dimension;
- supported languages;
- minimum context length;
- maximum image dimensions;
- runtime family/version requirement;
- GPU architecture or CPU instruction requirements;
- optional/required companion model roles such as VAE, text encoder, vocoder or reranker.

Constraints are machine-readable and evaluated before execution.

Example:

```json
{
  "requires": {
    "runtime": {"kinds": ["llama.cpp"], "features": ["feature.streaming"]},
    "companions": [
      {"role": "vision_projector", "required": true}
    ]
  }
}
```

## 8. Capability sets and aliases

The registry should support higher-level aliases for UX and skills while keeping execution on concrete capabilities.

Example:

```text
alias: "general-language"
requires-any: [text.chat, text.generate]

alias: "image-understanding"
requires: [vision.understand]

alias: "voice-conversation-stack"
requires: [audio.transcribe, text.chat, audio.synthesize]
```

Aliases are not runnable entities; they are query helpers.

## 9. Capability queries

The resolver needs a small deterministic query API.

Examples:

```text
find components where capability == vision.understand
find runnable routes for audio.transcribe
find skills accepting document and producing text
find models supporting structured.generate and tool.call
find components matching image.edit + feature.mask
```

The query result should include rejection reasons for nearby candidates. This is essential for UX. "No model available" is less useful than:

```text
FLUX editor: model present, runtime missing
Image editor B: runnable, but requires 18 GiB VRAM and only 15.4 GiB is currently free
Image editor C: runnable with profile 'low-vram'
```

## 10. Capability context for agents and language models

The orchestrator can generate a bounded session snapshot:

```json
{
  "skills": ["image.describe", "document.summarize", "code.review"],
  "tools": ["models.list", "runtime.status"],
  "loaded_models": [
    {"model_id": "...", "capabilities": ["text.chat", "text.reason"]}
  ],
  "available_capabilities": [
    "text.chat",
    "vision.understand",
    "audio.transcribe",
    "image.generate"
  ],
  "constraints": {
    "network": "disabled",
    "filesystem_write": "approval-required"
  }
}
```

This can be shown to an LLM as context, but it is derived from the registry. The executor still validates every attempted operation.

## 11. Capability verification

The system should eventually support explicit, safe probes:

- load model with selected profile;
- send the smallest valid test input;
- validate transport-level output shape;
- optionally validate semantic sanity with deterministic checks where possible;
- record duration, peak memory if observable, runtime version and result.

Verification is not a benchmark. It answers "does this route function?". Benchmarks answer "how well/fast does it function?". Both can later inform selection, but they remain separate records.

## 12. Why capability data must not live only in prompts

Prompt-only capability descriptions create several failure modes: stale state after model unloads, hallucinated tools, no hard validation, impossible UX filtering and no resource planning. A structured registry fixes all five.

The capability registry is therefore the authoritative map of AI Dream's current local abilities. Skills, chat, agents and the UI all consume the same registry instead of keeping separate feature assumptions.
