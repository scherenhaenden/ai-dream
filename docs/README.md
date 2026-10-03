# AI Dream documentation

This directory documents the implemented application. Start with the page that
matches your task. [ROADMAP.md](../ROADMAP.md) records planned work; a roadmap
item is not an available feature until the corresponding implementation exists.

| Task | Document |
|---|---|
| Install, launch, find local data, or diagnose a startup problem | [Operations and local data](operations.md) |
| Understand Python modules and the flow from a prompt to llama.cpp | [Backend architecture](backend-architecture.md) |
| Understand Angular routes, services, state, and build | [Angular frontend](angular-frontend.md) |
| Review the proposed navigation, Settings/API consolidation, and progressive-disclosure UX direction | [UX information architecture](ux-information-architecture.md) |
| Integrate with the browser-facing HTTP service | [Local HTTP API](local-http-api.md) |
| Understand chat settings and presets | [Per-chat settings](chat-session-settings.md) |
| Understand saved image and document references | [Chat attachment history](chat-attachment-history.md) |
| Use and extend image input | [Image input](image-input.md) |
| Use and extend document input | [Document input](document-input.md) |
| Use offline speech tools | [Voice](voice.md) |
| Interpret local GGUF metadata | [Local model metadata](model-metadata.md) |
| Interpret Hub repository metadata | [Hugging Face metadata](huggingface-metadata.md) |
| Understand capability, skill and multimodal orchestration design and implementation status | [Capability orchestration](capability-orchestration/README.md) |
| Review proposed (not implemented) RAG work: shared provider core, SQLite sources, drag-and-drop, per-model context window | [RAG integration proposals](proposals/rag-integration/README.md) |

The Python Tk interface and Angular browser interface share the backend and
local files, but their controls differ. The feature tables in the architecture
guides identify which interface currently exposes each workflow.

## Capability orchestration: design and current implementation

The `capability-orchestration/` package documents an active implementation as
well as its architecture target. Typed capabilities and artifacts, planning,
local runtime/scheduler integration, skills, run events/artifacts and parts of
the multimodal workflows already exist. Other areas remain partial or depend
on host configuration: real image inference, Whisper STT, semantic manifest
verification, assisted planning with an already-loaded model, and broader
rendered UX verification. The design chapters also describe planned behavior;
they should not be read as feature availability claims.

Start with the [architecture and implementation snapshot](capability-orchestration/README.md).
For day-to-day operation and validation, use the [user handbook](capability-orchestration/user-handbook.md),
[testing guide](capability-orchestration/testing-guide.md),
[local provider operations](capability-orchestration/local-provider-operations.md),
and [readiness snapshot](capability-orchestration/readiness.md). The readiness
percentages summarize objective coverage and unresolved acceptance gates; they
do not mean the whole system is ready or complete.
