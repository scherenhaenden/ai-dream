# Capability orchestration readiness

Status date: 2026-09-30

This is the working readiness record for the implementation described in
`implementation-plan.md`. Percentages are estimates of objective coverage, not
test pass rates. A phase is not considered complete until its user-visible
acceptance criteria are implemented and verified.

## Current readiness

| Area | Readiness | Evidence in this worktree | Remaining work |
|---|---:|---|---|
| Capability contracts and registry | 85% | Typed contracts, evidence, resolver, API and searchable provenance in the live capability map; unknown remains distinct from supported. | Broader runtime evidence, complete route/profile queries and verification promotion lifecycle. |
| Manifests and model profiles | 70% | Layered manifest view, manifest API, profile editing and model detail with capability provenance and route evidence. | Persistent user overlay, verify/promote lifecycle and complete semantic cards across the catalog. |
| Runtime adapters and scheduler | 70% | llama.cpp, vLLM and fake adapters; leases, exclusive residency, eviction policy, allowlisted pin/unpin/unload API and dashboard actions. End-to-end fake runtime test found and fixed owner-scoped lease lookup. | Migrate direct chat to leases, preserve cross-surface residency, resource estimates and cancellation guarantees. |
| Artifact store | 92% | Bounded private store, owner-scoped/restorable session uploads, typed run outputs, citation display, and sandboxed HTML/PDF preview/download flows. Static UX contracts and backend ownership tests pass. | Rendered browser review; Canvas integration and fuller cancellation/retention lifecycle coverage. |
| Skills and workflows | 93% | Twelve validated manifests; chat, extraction, summarization, HTML/PDF/report, temporary document RAG, and local STT/TTS execute through typed default-API paths with fake/no-model routes. Image generate/edit skills explain missing local routes. | Compatible image and richer audio routes where available; production-route verification and browser QA. |
| Planner and route resolution | 70% | Default planner discovers compatible text routes without loading models; deterministic plans include selected routes, reasons and alternatives; a full fake-runtime invocation proves scheduler lease handoff. | Live profiles/resources, selection-mode UX, specialist routes and executable composition beyond serial nodes. |
| Resource dashboard and residency | 75% | Hardware snapshots, residency drawer, allowlisted pin/unpin/unload controls; mutations cannot load arbitrary models. | Keep residency coherent with direct chat; add reservations, detailed alternatives and browser QA. |
| Runs and SSE | 95% | Bounded RunManager, reconnectable event journal, node lifecycle, cancellation, typed output artifacts, shared owner-scoped storage and output preview UI; HTML/PDF artifacts are fetched under run ownership. | Verify actual browser preview/download and durable run association/persistence; tighten backend cancellation guarantees. |
| Chat migration | 90% | `chat.general` preview/execute with model/profile pins, run association, and selectable plan inspector; direct chat remains available. | Rendered app review and continuity against installed runtime routes. |
| Composition and specialist pipelines (phases 10–15) | 48% | Bounded deterministic parallel layers, explicit typed `parallel` fan-in, JSON join, registered-transform loops, traceable fallback revisions, and tool-only typed subskills with hierarchical run events. | Nested model-route planning, multi-model resource reservations, real image generation/editing, richer audio, optional assisted drafts and full rendered workspace integration. |

### Specialist phase readiness

| Phase | Readiness | Evidence | Remaining work |
|---|---:|---|---|
| 10. Composition primitives | 88% | Independent DAG layers, typed `parallel`/`join`, bounded loops, traceable fallback revisions, and tool-only typed subskills with hierarchical run events are covered by tests. | Nested route planning, inherited permission/resource enforcement, multi-runtime reservations and stronger cancellation semantics. |
| 11. Image generation/editing | 15% | Typed image I/O and declarative generate/edit skills expose honest unavailable routes; environment audit found no compatible local runtime, adapter or model. | Integrated local image adapter, generate/edit execution, independent pins, output preview from a real route and low-resource explanations. |
| 12. Audio understanding | 45% | Local STT/TTS callbacks are wired as discovered tool routes and fake end-to-end runs persist text/audio outputs. | Diarization, audio understanding/music, sequential specialist residency and rendered audio workflow QA. |
| 13. Temporary document RAG | 70% | A stateless per-run lexical retriever chunks one selected document, bounds context, emits deterministic offsets/citations, and powers `document.answer-with-rag`; Runs shows citation source, quote and offsets. | Relevance evaluation, rendered citation QA, scanned-PDF OCR, and embeddings/reranking when compatible local routes exist. |
| 14. Document generation | 80% | Safe bounded HTML/report and paginated PDF renderers produce run-owned artifacts; Runs shows JSON/text and sandboxed HTML with PDF actions. | Rendered preview/download QA, richer templates/layout and model-generated structured content. |
| 15. Assisted planner | 15% | Deterministic preview/review and strict disabled-by-default draft validation exist; the UI states AI-assisted drafting is unavailable. | Bounded draft generation, explicit user-controlled enable switch and rendered approval flow. |

## Milestone target: first orchestration release

Close the ten acceptance criteria at the end of `implementation-plan.md` before
calling the first orchestration release ready:

1. Show a live capability map with evidence and provenance.
2. Show model input/output roles on model cards.
3. Keep profiles directly attached to the selected model.
4. Execute at least three declarative skills on the normal application path.
5. Resolve each skill to a compatible runtime/model/profile and explain why.
6. Load and unload models through leases while preserving direct chat behavior.
7. Execute and type-check a multi-step workflow.
8. Stream a transparent run trace, including node lifecycle.
9. Render non-text output artifacts in the workspace/canvas.
10. Explain why unavailable skills cannot run and show practical alternatives.

| Acceptance criterion | Readiness | Evidence and remaining work |
|---|---:|---|
| 1. Live capability map with evidence | 80% | API and map page are wired; widen runtime facts and review the rendered page. |
| 2. Input/output roles on model cards | 60% | Model detail exposes declared capabilities and provenance; full catalog card review remains. |
| 3. Profiles directly under selected model | 80% | Editing is attached to the selected model detail; verify visually and test broader catalog data. |
| 4. Three declarative skills on normal path | 85% | Chat, local document extraction and document summarization execute through the default API with a fake runtime; validate installed runtime behavior without starting workloads. |
| 5. Compatible route/model/profile and explanation | 70% | Deterministic routes and reasons are visible; profile/resource-aware route breadth remains. |
| 6. Lease load/unload and direct-chat continuity | 75% | Lease API, residency controls, `chat.general` pins, fake-runtime conversation continuity and assistant `run_id` association are covered. | Verify with installed routes and rendered chat UI; review unload/cancel behavior under active user interaction. |
| 7. Typed multi-step workflow | 80% | Document extraction→chat graph is type-checked and exercised with a fake runtime. |
| 8. Transparent node lifecycle trace | 90% | Run event journal carries started/completed/failed node events; rendered trace review remains. |
| 9. Non-text output artifacts in workspace | 90% | Run outputs become owner-scoped image/audio/document envelopes; HTML is sandbox-previewable and PDF has open/download actions; browser QA remains. |
| 10. Missing-skill reasons and alternatives | 75% | API returns missing routes and suggested alternatives; inspect copy and interactions in browser. |

Current automated evidence: `python3 -m unittest discover -s tests` passed
424/424 on the integrated snapshot, including bounded tool-only subskills and
hierarchical run events. Static UI checks for chat orchestration,
artifact/run previews, assisted-planner gating, model-profile context, and
pre-run skill permissions pass. Navigation verifies 17 links; model
configuration checks pass; `git diff --check` is clean. Angular typecheck and
rendered browser review remain unverified because this worktree has no
`tsc`, Angular packages, or `web/node_modules`. No model inference or GPU
workload was run.

## Full-scope completion gate

The first orchestration release above is an intermediate milestone, not the
completion target for the active capability-orchestration objective. The full
target covers every Phase 0–15 deliverable and acceptance criterion in
`implementation-plan.md`, every applicable interaction in `ux.md`, and the
contracts, API and pipeline requirements in the other files in this directory.
Do not call this work complete when only the first-release milestone passes.

| Phase | Current | Full-scope evidence required before 100% |
|---|---:|---|
| 0. Contracts and terminology | 85% | Versioned Python/TypeScript schemas, forward compatibility and bounded artifact contract tests. |
| 1. Capability registry | 85% | Live provenance from actual components, honest unknown states and complete model-card roles. |
| 2. Manifests and profiles | 70% | Persistent overlay lifecycle, verify/promote flow, backward-compatible profile data and full model detail UX. |
| 3. Runtime adapter boundary | 70% | Conformance and lifecycle coverage for each integrated runtime with current direct chat intact. |
| 4. Artifact store | 92% | Full lifetime/cleanup/cancellation coverage and rendered canvas/artifact integration. |
| 5. Skills and deterministic executor | 93% | All registered skills operational or truthfully unavailable, plus contract and permission boundary coverage. |
| 6. Resolver | 70% | Resource/profile aware selection, pin behavior, verified preference and rejection alternatives. |
| 7. Scheduler and leases | 70% | Deadlock-free multi-runtime reservations, unload/reload and cancellation guarantees. |
| 8. RunManager and SSE | 95% | Durable run association, reconnect/cancel guarantees and rendered trace QA. |
| 9. Chat migration | 90% | Attachment-to-skill execution, selectable plan inspector and run association; rendered continuity review remains. |
| 10. Composition | 88% | Parallel/join/loop, fallback revisions and tool-only typed subskills are tested; nested model routing and multi-runtime reservations remain. |
| 11. Image generation/editing | 15% | Generate/edit skills and honest unavailable evidence exist. Repo/environment audit found no compatible local image runtime, adapter or model. |
| 12. Audio stack | 45% | Fake end-to-end STT/TTS routes and tool/model readiness are implemented; diarization, audio understanding/music and sequential specialist residency remain. |
| 13. Knowledge/RAG | 70% | Bounded lexical retrieval, citations and source/quote/offset display in Runs; OCR, embeddings/reranking and browser review remain. |
| 14. Document generation | 80% | HTML/PDF/report outputs, typed JSON display, retryable previews, sandboxed HTML and PDF open/download exist; templates and browser QA remain. |
| 15. Assisted planner | 15% | Deterministic preview/review and strict disabled-by-default draft validation exist; LLM draft generation, explicit user enable control and browser QA remain. |

The 20 sections in `ux.md` are also in scope; automated route checks or backend
tests do not prove visual quality. Completion requires a rendered review of the
operating modes, model cards/details/profiles, Skills, chat plan strip/inspector,
resource dashboard, unavailable-route explanations, workspace/canvas,
capability map, setup and permission UX. Track those reviews as evidence when
the web dependency toolchain is available.
