# Capability, skill and multimodal orchestration

This package is both an **architecture/design reference** and an **implementation
status snapshot**. The architecture chapters describe the target model and can
include proposed behavior; they are not evidence that every example is shipped.
For current implementation and remaining acceptance gates, use
[readiness.md](readiness.md). This project is in active implementation, not a
complete capability operating system.

## Current status at a glance

| Status | What is covered today |
|---|---|
| Implemented | Typed capability/artifact contracts; deterministic skill planning and route resolution; local runtime and scheduler leases; bounded run execution, events and artifacts; capability/skill APIs and UI; explicit ComfyUI generation plus unmasked img2img integration; local FFmpeg/Flite WAV synthesis. |
| Partial or host-dependent | Persistent manifest/profile verification has a runtime-bound verifier seam but no semantic verifier configured on this host; ComfyUI operations need an explicitly configured local service and have no real generation/edit result verified here; image editing has no mask; Whisper STT requires an installed CLI and GGML model; assisted planning is opt-in and requires an already-loaded model; responsive and multimodal Canvas review remains incomplete. |
| Planned or not yet complete | Remaining acceptance criteria in the [implementation plan](implementation-plan.md), including real-provider verification, richer multimodal composition, broader visual QA, and any feature called out as planned in the architecture chapters. |

For an operational view, see the [user handbook](user-handbook.md),
[testing guide](testing-guide.md), [local provider operations](local-provider-operations.md),
and the detailed [readiness snapshot](readiness.md). Percentages in readiness
are estimates of objective coverage, not test pass rates or a product-completion
claim.

## Why this layer is needed

AI Dream is already able to discover local models, keep a local inference runtime alive, manage per-model profiles, chat, pass images/documents to compatible models, expose bounded tools and support multiple runtime installations. The next problem is qualitatively different: a complete local AI workstation cannot be modeled as "one selected LLM plus some settings".

A useful local stack contains many specialists: language/reasoning, coding, vision, OCR, speech-to-text, text-to-speech, embeddings, reranking, image generation/editing, video, audio/music, structured extraction, computer-use, domain models and document/rendering tools. Some tasks require one specialist. Others require a pipeline of several models and ordinary software tools.

The architecture therefore needs four first-class concepts above today's model/runtime control plane:

1. **Capabilities** — normalized statements about what a model, runtime, tool or skill can consume and produce.
2. **Model manifests and load recipes** — explicit metadata describing how a model can be run on this machine, with which runtime, dependencies and tested settings.
3. **Skills** — user-facing tasks expressed as bounded, typed workflows rather than hidden prompt magic.
4. **Orchestration** — planning, scheduling, loading, unloading and connecting those components under hardware constraints.

The central design rule is: **AI Dream must know what it can do from machine-readable state, not by asking a language model to guess.** A language model may help choose among valid options, but the system owns the capability registry, permissions, model lifecycle and execution graph.

## Target mental model

```text
User goal / explicit skill / attachment
                |
                v
         Intent + IO typing
                |
                v
       Capability Resolver
                |
        +-------+--------+
        |                |
        v                v
   Skill Registry    Capability Registry
        |                |
        +-------+--------+
                |
                v
          Execution Plan
       (typed workflow DAG)
                |
                v
      Resource-aware Scheduler
                |
      +---------+----------+
      |         |          |
      v         v          v
  Runtime A  Runtime B   Tool/Transform
  model X    model Y     OCR/PDF/etc.
      |         |          |
      +---------+----------+
                |
                v
          Artifact Store
                |
                v
       Final result + trace
```

A chat remains one surface on top of this system. It is no longer the architecture itself.

## Architectural layers

### 1. Inventory layer

Discovers the facts that exist on the host: GPUs, RAM, runtimes, runtime-native devices, local model files, model families, optional projectors/adapters, external executables and installed skill packages.

This layer stays conservative. Observed facts are recorded as observed facts. Guesses are kept separate.

### 2. Capability layer

Normalizes inputs, outputs and task roles. Examples include `text.generate`, `text.reason`, `code.generate`, `vision.understand`, `ocr.extract`, `audio.transcribe`, `audio.synthesize`, `image.generate`, `image.edit`, `embedding.create`, `rerank.score`, `document.parse`, `document.render`, `computer.control` and `tool.call`.

Capabilities are attached to models, runtimes, tools and skills with provenance and confidence. The registry can answer questions such as:

- Which installed components can consume an image and return text?
- Which model can produce embeddings with dimension metadata?
- Which image editor can accept an input image plus mask?
- Which speech model can transcribe locally in the user's language?
- Which skills can convert a document into a rendered PDF?

### 3. Configuration layer

A model file alone is not enough. AI Dream needs a declarative model manifest plus one or more hardware-aware load recipes. A recipe binds a model to a runtime and concrete settings such as context, quantization/runtime mode, GPU placement, tensor split, cache settings, concurrency and companion artifacts.

Existing `ModelProfile` objects become the foundation for this layer instead of being replaced. The new design extends profiles with purpose, hardware signature, verification state and optional component dependencies.

### 4. Skill layer

A skill is a named task contract with typed inputs, typed outputs, requirements, an execution graph, permissions and UI hints. A skill may call one model, several models, tools, deterministic transforms or another skill.

Examples:

- `chat.general`
- `document.summarize`
- `document.answer-with-rag`
- `knowledge.search`
- `image.describe`
- `image.edit-from-instruction`
- `voice.conversation`
- `voice.respond` (explicit, user-reviewed transcript input)
- `code.review`
- `research.local-files`
- `document.create-pdf`
- `media.transcribe-and-summarize`

Skills are declarative wherever possible. Custom code is allowed only behind a small, versioned executor interface.

### 5. Orchestration layer

The orchestrator resolves a goal to a workflow, validates every node, asks the scheduler for resources, executes nodes, records events and carries typed artifacts between them. It also exposes the plan before execution when useful.

The scheduler owns model residency. A skill does not directly start or kill servers. It requests leases such as "vision model with `vision.understand` and <= 10 GiB estimated VRAM". The scheduler may reuse an already loaded model, load a preferred profile, evict an idle model, or fail with an explicit resource explanation.

### 6. Experience layer

The UI presents capabilities and skills in human terms. Users should be able to work in three modes without switching products:

- **Auto**: choose a task and let AI Dream select valid local components.
- **Guided**: AI Dream proposes a plan and the user can replace individual models/nodes.
- **Pinned/manual**: the user explicitly selects models, profiles and runtimes.

This preserves expert control while making a many-model system usable.

## "Self-awareness" without hallucination

AI Dream should expose a machine-generated `CapabilityContext` for each run/session. It contains only verified current facts: installed skills, available/loaded models, active profiles, runtime state, permitted tools, resource budget and unavailable requirements.

When a language model is involved in planning or agent behavior, a bounded projection of that context can be injected into its system/tool context. The language model can then say "I can call OCR and image generation" because those operations are registered for the run. It must never gain capabilities merely because it claims to have them.

The authoritative flow is:

```text
registry says capability exists -> planner may use it -> executor validates it again
```

not:

```text
LLM says it can do X -> system attempts X
```

## Design principles

**Declarative before procedural.** Model/runtime/skill metadata should be inspectable JSON/YAML and versioned schemas. This makes the system debuggable and lets the UI render configuration without hard-coding every model family.

**Typed modality boundaries.** A pipeline moves `Artifact` objects such as text, image, audio, document, embedding batch or structured JSON. Raw strings should not be the universal transport.

**Hard constraints before preferences.** Compatibility, permissions, input/output types and memory feasibility are hard filters. Quality, speed, residency and user preference are ranking criteria only after filtering.

**No invisible model switching.** The UI should always be able to show which models/tools are used, why they were selected and which profile loaded them.

**Local-first and bounded.** Skills inherit the current loopback-only and bounded-execution philosophy. Any future filesystem writes, desktop control, network access or shell execution must be a separately permissioned capability.

**Additive migration.** Existing chat, runtime and profile APIs continue to work. The orchestration API is layered above them and gradually becomes the preferred path.

## Documentation map

- [Capability model](capability-model.md) — ontology, artifacts, provenance and compatibility.
- [Model manifests and profiles](model-manifests-and-profiles.md) — how a discovered file becomes a runnable component with preconfigurations.
- [Skills and workflows](skills-and-workflows.md) — skill manifest schema and graph semantics.
- [Orchestrator and scheduler](orchestrator-and-scheduler.md) — planning, model residency, VRAM/resource management and failure behavior.
- [Multimodal pipelines](multimodal-pipelines.md) — concrete examples for image, audio, RAG, coding and document generation.
- [UX architecture](ux.md) — model cards, skill chooser, plan inspector and expert controls.
- [API and storage](api-and-storage.md) — API/storage design contracts and implemented behavior notes.
- [Implementation plan](implementation-plan.md) — staged deliverables and acceptance criteria; completed-looking prose still needs evidence in readiness.
- [User handbook](user-handbook.md) — task-oriented operating guide.
- [Testing guide](testing-guide.md) — deterministic and real-host verification commands and constraints.
- [Local provider operations](local-provider-operations.md) — provider preconditions, side effects, limits and evidence.
- [Readiness](readiness.md) — phase-by-phase implementation evidence and unresolved gates.

## Non-goals for the first implementation

The first version should not attempt an autonomous general-purpose agent, a visual no-code workflow editor, distributed inference across hosts, automatic internet downloads without approval, or opaque ML-based scheduling. The initial system should be deterministic enough that a failed run can be explained from its manifest, plan, profile and event log.

The goal is simpler and more useful: **make AI Dream a local capability operating system that can reliably compose specialist AI models and normal tools into understandable workflows.**
