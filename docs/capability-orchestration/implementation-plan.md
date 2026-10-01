# Implementation plan

This plan is intentionally incremental. The goal is to reach useful orchestration without a rewrite of the existing chat/runtime stack. Each phase leaves the application runnable and testable.

## Guiding migration rule

Do not replace working model discovery, runtime/profile control or chat in one step. Add the capability layer around them, then migrate surfaces gradually.

The dependency order is:

```text
contracts/ontology
      |
      +--> manifests/profiles
      |
      +--> skill schemas
      |
      +--> runtime adapter normalization
      |
      v
resolver + artifact store
      |
      v
scheduler + run manager
      |
      v
first built-in skills
      |
      v
chat/workspace integration
      |
      v
advanced multimodal/agent flows
```

## Phase 0 — freeze contracts and terminology

Deliverables:

- `CapabilityId`, artifact kinds and evidence/status enums.
- JSON-schema or equivalent Python validation for model manifests and skills.
- TypeScript mirror types.
- versioning rules.
- no runtime behavior changes yet.

Suggested Python modules:

```text
aidream/capabilities/contracts.py
aidream/capabilities/artifacts.py
aidream/skills/contracts.py
```

Suggested Angular types:

```text
web/src/app/core/capability.types.ts
web/src/app/core/skill.types.ts
web/src/app/core/run.types.ts
```

Tests:

```text
schema accepts minimum valid object
rejects unknown required types
forward-compatible optional fields
capability IDs normalized/validated
artifact contracts bounded
```

## Phase 1 — capability registry over existing components

Build `CapabilityRegistry` without orchestration.

Sources:

```text
existing ModelCatalog records
runtime installation probes
bundled model-family manifest overlays
voice capabilities
agent tool registry
knowledge/retrieval services already present
```

The first registry may expose only a small set:

```text
text.chat
text.generate
vision.understand
audio.transcribe
audio.synthesize
tool.call
document.parse
embedding.create (when available)
```

Deliver UI read-only Capability Map. This phase already adds user value by showing what the current machine can actually do.

Acceptance criteria:

- starting AI Dream does not load a model;
- capability claims show provenance;
- model cards gain input/output/capability chips;
- missing facts are `unknown`, never guessed as supported.

## Phase 2 — model manifest store and richer profiles

Build manifest layering:

```text
observed metadata
bundled overlay
local generated verification overlay
user override
```

Extend `ModelProfileStore` additively with:

```text
purpose capabilities
hardware signature
profile class
verification summary
optional companion bindings
```

Keep existing profile fields and APIs backward-compatible.

Add model details UX where profile management lives directly under the selected model.

Acceptance criteria:

- a model can have multiple named launch profiles;
- a profile clearly says which runtime it uses;
- model detail shows runnable/not-runnable reason;
- old profiles continue loading.
- only a typed successful local runtime probe may promote verified claims/profile data;
- user-authored metadata cannot overwrite generated capability evidence.

## Phase 3 — runtime adapter boundary

Current backends can be wrapped rather than rewritten.

Introduce a normalized `RuntimeAdapter` contract around llama.cpp and vLLM first. Existing backend classes remain the implementation engines.

Normalized operations:

```text
probe
supports
prepare
load
invoke
cancel
unload
health
```

The adapter returns typed outputs and normalized errors.

Parallel workstreams:

### llama.cpp adapter

Map current chat/multimodal behavior and runtime controls.

### vLLM adapter

Map supported text/structured/tool features and its lifecycle separately.

### generic runtime contract tests

Run the same compatibility/lifecycle tests against fake adapters.

Acceptance criteria:

- resolver code never assembles llama.cpp/vLLM CLI flags;
- runtime feature differences are surfaced as capabilities;
- current direct chat still works.

## Phase 4 — artifact store

Implement typed artifact envelopes and bounded temporary storage.

Initial artifact kinds:

```text
text
json
image
audio
document
file_reference
chat_messages
tool_result
```

Use private temporary directories for binary run data. Integrate current image/document upload paths as artifact producers rather than rewriting parsers.

Acceptance criteria:

- binary data is referenced, not copied through every JSON event;
- artifact lifetimes are enforced;
- cancellation deletes ephemeral artifacts;
- existing image/document limits remain in force.

## Phase 5 — skill registry and deterministic executor

Implement declarative built-in skills with only these initial node types:

```text
input
capability
model
tool
transform
router
output
```

Defer general parallel/loop/sub-skill behavior until the core executor is stable.

First built-in skills:

```text
chat.general
image.describe
document.summarize
voice.transcribe
voice.conversation
voice.respond
```

These cover text, image, document and audio while using existing AI Dream functionality.

Acceptance criteria:

- skill schemas validate at startup;
- invalid user skill does not crash the application;
- graph is type-checked before execution;
- tool names are resolved only from registered executors.

## Phase 6 — resolver

Build deterministic capability resolution.

Algorithm v1:

```text
1. gather candidates
2. apply hard capability/type/runtime/dependency filters
3. apply manual pins
4. reject impossible resource estimates
5. prefer verified routes
6. prefer semantic user preference
7. prefer already-loaded route
8. use static priority as final tie-breaker
```

Do not use an LLM for candidate selection in v1.

Expose a `why` structure for every selection and rejection.

Acceptance criteria:

- same state/preferences yield same plan;
- unsupported route never reaches runtime invocation;
- manual mode never silently swaps a pinned model;
- auto mode can show alternatives.

## Phase 7 — scheduler and model leases

Generalize today's single retained backend concept into explicit residency records and leases.

Start conservative:

```text
one scheduler mutation lock
one load/unload at a time
runtime concurrency only when advertised
simple LRU idle eviction
configurable VRAM/RAM headroom
```

Do not begin with an optimizer.

Add resource dashboard and residency drawer.

Acceptance criteria:

- two sequential skill nodes can reuse a loaded model;
- a required specialist can evict an idle model according to policy;
- user-pinned residency is respected;
- cancellation releases leases;
- resource failures provide alternatives.

## Phase 8 — RunManager and SSE event stream

A run owns:

```text
immutable resolved plan
node states
artifacts
leases
cancellation token
event sequence
bounded operational record
```

Add `/api/runs` and `/events`.

Angular gets a reusable run state service, independent from chat.

Acceptance criteria:

- browser reconnect can recover active run state;
- cancelling from UI reaches the current runtime/tool;
- run completion produces typed output artifacts;
- diagnostics incident IDs are linked but backend logs are not streamed unbounded.

## Phase 9 — migrate chat to a built-in skill

Keep old direct chat endpoint as compatibility path while adding orchestration-backed chat.

`chat.general` can initially be a single capability node, preserving behavior.

Then add attachment-aware routing:

```text
text only -> text.chat
image + text -> vision-capable chat route
PDF + question -> explicit document skill when user selects it
```

Do not silently transform every attachment into a complex pipeline.

Acceptance criteria:

- current saved conversations remain readable;
- model/profile pins still work;
- run IDs can be associated with assistant turns;
- old endpoint remains usable during migration.

## Phase 10 — composition primitives

Add:

```text
parallel
join
sub-skill
bounded loop
fallback branches
```

Use them for:

```text
OCR + vision fan-out
RAG pipeline
meeting transcription + diarization
chapter summarization map/reduce
```

Acceptance criteria:

- deadlock-free resource reservation for bounded parallel branches;
- nested capability/model routes resolve by stable skill-node path;
- nested route invocation shares an inherited, cancellation-aware concurrency budget;
- join node type-checking;
- fallback creates traceable plan revision/event;
- loops require explicit maximum iterations.

## Phase 11 — image generation/editing runtime family

Add one image runtime adapter and two capabilities:

```text
image.generate
image.edit
```

Do not hard-code image logic into the language runtime adapter.

Support compound dependencies such as VAE/text encoder where required by the chosen backend.

Built-in skills:

```text
image.generate
image.edit-from-instruction
```

Acceptance criteria:

- output is first-class image artifact;
- canvas/workspace can open generated artifact;
- low-VRAM/unavailable states are explained;
- user can pin generator/editor independently from chat LLM.

## Phase 12 — richer audio stack

Add audio runtime adapters where useful for:

```text
speech-to-text
TTS
speaker diarization
audio understanding
music generation/analysis
```

Existing local voice integration can become a tool/runtime route rather than being discarded.

The scheduler must support sequential unload/reload on machines that cannot keep STT + LLM + TTS resident together.

Transcript review is an explicit branch: users may run `voice.transcribe`, inspect
and edit its text output, then provide that text as the required input to
`voice.respond`. Audio must never be auto-submitted from transcription to a
response step without that user handoff. `voice.conversation` remains the direct,
no-review sequential option when all three routes are available.

## Phase 13 — knowledge/RAG as skills

Integrate current/future knowledge service into capability contracts:

```text
document.parse
embedding.create
retrieval.search
rerank.score
```

Build temporary document Q&A before persistent knowledge-base management.

Reason: temporary RAG exercises the orchestration path with fewer lifecycle/migration concerns.

The current implementation keeps that temporary path in
`document.answer-with-rag` and also exposes the existing app-managed SQLite
FTS5 index through the model-free `knowledge.search` workflow. The persistent
index is installation-scoped; it is not a per-chat or multi-user store. The
`retrieval.search` capability contract should describe an executable local
search route only when the same bounded index handler is available. Neither
path implies embeddings or reranking.

## Phase 14 — document generation

Add deterministic document renderers as tools.

Built-in skills:

```text
document.create-html
document.create-pdf
document.create-report
```

The language model produces structured content; renderer owns layout/export. This keeps document generation model-independent.

## Phase 15 — assisted planner

Only after deterministic skills are mature, optionally add an LLM planner.

Input:

```text
user goal
available skill/capability snapshot
permissions
resource constraints
```

Output:

```text
RunPlanDraft JSON
```

The deterministic validator resolves/approves it before execution.

Acceptance criteria:

- invented tools/components rejected;
- permissions cannot be elevated;
- planner can be disabled globally;
- generated plan is visible before side-effecting steps.

Current local UI/API contract: the global `assisted_planner_enabled` preference defaults to false. An explicit `Generate assisted draft` action requires an already-loaded model and returns strict JSON only after the installed-skill validator accepts it. The UI requires an explicit review check before enabling Run. The action does not load a model or execute workflow nodes.

## Parallel team/workstream split

The architecture is intentionally divisible.

### Track A — contracts/backend core

```text
capability schema
manifest store
skill schema
resolver
RunManager
```

### Track B — runtime lifecycle

```text
runtime adapter interface
llama.cpp adapter
vLLM adapter
scheduler/resource monitor
```

### Track C — Angular UX

```text
capability map
model card redesign
model detail/profiles
skills page
plan inspector
resource drawer
artifact cards
```

### Track D — artifacts and inputs

```text
artifact store
image/document migration
uploads
canvas artifact integration
```

### Track E — built-in skills

```text
chat.general
image.describe
document.summarize
voice.transcribe
voice.conversation
voice.respond
later RAG/image generation/editing
```

### Track F — tests/diagnostics

```text
schema fixtures
fake runtime adapters
scheduler simulations
run cancellation
SSE reconnect
migration/compatibility tests
```

Tracks A/B need to define contracts first, but much of C/D/E/F can proceed against fakes immediately afterward.

## Suggested repository layout

```text
aidream/
  capabilities/
    contracts.py
    registry.py
    manifests.py
    evidence.py
  artifacts/
    contracts.py
    store.py
  skills/
    contracts.py
    registry.py
    resolver.py
    executor.py
    builtin/
  orchestration/
    plan.py
    runs.py
    scheduler.py
    resources.py
    events.py
  runtimes/
    base.py
    llama_cpp.py
    vllm.py
    ...

web/src/app/
  core/
    capability.service.ts
    skills.service.ts
    runs.service.ts
    resources.service.ts
  pages/
    capability-map.page.ts
    skills.page.ts
  components/
    plan-inspector/
    artifact-viewer/
    model-residency/
```

This can be introduced gradually around current modules. Moving existing files into this layout is optional and should not be mixed with the first feature changes unless it materially reduces duplication.

## Test strategy

The orchestration core should be testable without real GPUs/models.

Create fake components:

```text
FakeRuntimeAdapter
FakeResourceMonitor
FakeArtifactStore
FakeToolExecutor
```

Use them for deterministic tests of:

```text
candidate selection
profile precedence
resource rejection
eviction policy
multi-node execution
fallback
cancellation
parallel joins
timeouts
artifact cleanup
permission denial
```

Then keep a smaller suite of real-model smoke tests for actual runtime integration.

## Milestone definition

A meaningful first orchestration release does **not** need all modalities. It is complete when AI Dream can:

```text
1. show a live capability map;
2. describe model input/output roles on cards;
3. keep model profiles directly attached to model UX;
4. run at least three declarative skills;
5. resolve a capability to a valid model/runtime/profile;
6. load/unload through leases;
7. execute a typed multi-step workflow;
8. stream a transparent run trace;
9. render non-text artifacts in the workspace/canvas;
10. explain why a requested skill is unavailable.
```

Once that exists, adding more specialist models becomes mostly a matter of new manifests, runtime adapters and skills instead of adding another bespoke page every time.
