# Capability orchestration readiness

Status date: 2026-09-30

This is the working readiness record for the implementation described in
`implementation-plan.md`. Percentages are estimates of objective coverage, not
test pass rates. A phase is not considered complete until its user-visible
acceptance criteria are implemented and verified.

## Current readiness

| Area | Readiness | Evidence in this worktree | Remaining work |
|---|---:|---|---|
| Capability contracts and registry | 88% | Typed contracts, evidence, API and live capability map; search covers capability/status/I/O/provenance and discovered route/model/runtime identifiers. Unknown remains distinct from supported; artifact v1 Python/TypeScript parity and future-version rejection are checked. | Broader runtime evidence, complete route/profile queries and genuine verified-route coverage. |
| Manifests and model profiles | 82% | Layered manifest view; atomic XDG user-metadata and generated-verification stores; typed injected verifier contract; `POST /api/model-manifests/<id>/verify` validates/promotes only typed successful claims, persists a verified profile, and composes generated claims below user metadata. Model details expose the explicit verification action and disable it when no local verifier is configured. Fake API/store tests pass; legacy profile fallbacks remain. | No default runtime startup/minimal-probe verifier is configured on this host, so live verify/promote is unavailable; broader semantic cards and rendered browser QA remain. |
| Runtime adapters and scheduler | 78% | llama.cpp, vLLM and fake adapters; leases, exclusive residency, persisted `lru`/`never` policy, allowlisted pin/unpin/unload API and dashboard controls. Fakes verify LRU evicts only idle/unpinned residents and `never` preserves residents under pressure and on exclusive-runtime switches. RunManager now retains active runs and leases through non-waiting shutdown until the runtime callback returns; a controlled regression test passes. | Migrate direct chat to leases, preserve cross-surface residency, resource estimates and full cancellation lifecycle guarantees. |
| Artifact store | 94% | Bounded private store, owner-scoped/restorable session uploads, typed run outputs, citations, and sandboxed HTML/PDF preview/download. TTL starts after private bytes are flushed/fsynced; fake-clock tests cover expiry cleanup on delete/delete-owner; static contract and Python/TypeScript parity checks pass. | Idle stores sweep only on a later operation/explicit cleanup; process exit can leave temporary directories; rendered browser review remains. |
| Skills and workflows | 93% | Fourteen validated manifests; chat, extraction, summarization, HTML/PDF/report, temporary document RAG, and local STT/TTS execute through typed default-API paths with fake/no-model routes. Structured text/bullet/table reports can produce both safe HTML and paginated PDF. Image generate/edit skills explain the missing genuine host provider; injected offline image routes are wired through the planner, artifact store and Canvas. | Compatible image runtime on a real host; production-route verification and browser QA. |
| Planner and route resolution | 76% | Default planner discovers compatible text and explicitly local, network-disabled image routes without loading models; deterministic plans include selected routes, reasons and alternatives; fake adapters exercise scheduler lease handoff. Assisted drafts are opt-in/off by default, require an already-loaded model and pass strict installed-skill validation. | Live model-generation verification, richer selection-mode behavior, production image backend verification and executable composition beyond serial nodes. |
| Resource dashboard and residency | 85% | Hardware snapshots and residency drawer; global topbar shows per-GPU VRAM free/total, RAM available and loaded-model count with explicit Unknown values. Persisted `lru`/`never` policy and allowlisted pin/unpin/unload controls are connected to the scheduler. | Keep residency coherent with direct chat, add reservations/detailed alternatives and complete rendered browser QA. |
| Runs and SSE | 95% | Bounded RunManager, reconnectable event journal, node lifecycle, cancellation, typed output artifacts, shared owner-scoped storage and output preview UI; HTML/PDF artifacts are fetched under run ownership. | Verify actual browser preview/download and durable run association/persistence; tighten backend cancellation guarantees. |
| Chat migration | 93% | `chat.general` preview/execute with model/profile pins, run association and selectable plan inspector; direct `/api/chat` remains available. Chat uploads offer explicit skill selection by declared input kind, hand off only opaque IDs, and Skills validates the artifact against the current owner-scoped session list before attachment. PDFs remain typed documents and are never converted by the handoff. Static contract check: `web/scripts/check-chat-attachment-handoff.mjs`. | Browser review; uploaded artifacts remain process-local/session scoped and cannot survive API store expiry/restart; vision-capable direct chat routing is not yet supported. |
| Composition and specialist pipelines (phases 10–15) | 74% | Bounded deterministic parallel layers, typed `parallel`/join, loops, fallback revisions, permission-bounded subskills, nested route resolution with a shared cancellation-aware budget, verified report-to-PDF workflow, reviewed-transcript voice response and measured lexical retrieval evidence. | Genuine image provider, richer audio, broader retrieval evaluation, concurrent cancellation race stress, runtime verifier availability and rendered UX remain. |

### Specialist phase readiness

| Phase | Readiness | Evidence | Remaining work |
|---|---:|---|---|
| 10. Composition primitives | 97% | Independent DAG layers, typed `parallel`/`join`, bounded loops, traceable fallback revisions, typed subskills with cycle/depth/step and inherited-permission bounds, hierarchical traces, nested route resolution by stable path, plan fingerprints for child definitions, an exposed shared `max_parallel_routes` budget, atomic nested reservation, rollback, lease release, and run-token propagation. Fakes verify nested invocation and parent concurrency caps across parallel child workflows. | Cancellation races during concurrently active runtime calls, cleanup-under-failure stress coverage and complete rendered UX review. |
| 11. Image generation/editing | 63% | Typed image I/O and declarative skills; fail-closed `LocalImageRuntimeAdapter` requires explicit local-only/network-disabled claims, reports compatible opaque model IDs without loading, and supports bounded PNG/JPEG/WebP generation/edit callbacks. API discovery and default planner/scheduler execution persist owner-scoped image outputs; independent hard pins for generator/editor are separate from chat pins. Explicit backend VRAM estimates are exposed in plans/UI and insufficient measured free VRAM gives a bounded explanation before load. Four deterministic suite groups pass (51 tests total across adapter, capabilities, skill API and orchestration). No genuine local provider was found on this host or in declared project dependencies, so real generation and rendered output review remain unverified. | Integrate and verify a genuine compatible local provider/model; inspect real output in Canvas/browser; browser QA. Resource safety remains unknown when a backend omits estimates. |
| 12. Audio understanding | 62% | Local STT/TTS callbacks are wired as discovered tool routes; fake runs verify typed transcript and audio outputs. Chat offers transcript-only and direct sequential voice-conversation skills; new `voice.respond` takes an explicit user-reviewed text transcript through serial text.chat → TTS. Fake API coverage verifies stage order, no audio auto-submit, and exact missing-TTS reason/text fallback. No inference/GPU was used. | Diarization, general audio understanding/music, richer review-to-run continuity and rendered audio workflow QA. |
| 13. Temporary document RAG | 82% | A stateless per-run BM25-style lexical retriever chunks one selected document, bounds context, emits deterministic offsets/citations plus matched terms and heuristic lexical scores, and powers `document.answer-with-rag`; Runs exposes citation source, quote, offsets, matched terms and score. Three fixed labeled retrieval fixtures achieve MRR@5 1.0; this is a small regression set, not a general relevance claim. PDF text extraction has bounded Poppler fallback and optional first-pages OCR when local tools are installed. | Broader relevance evaluation, rendered citation QA, OCR host verification, and embeddings/reranking when compatible local routes exist. |
| 14. Document generation | 86% | Safe bounded HTML/report and paginated PDF renderers produce run-owned artifacts; new `document.create-report-pdf` renders validated structured text, bullets and tables as paginated PDF. Fake API runs verify owner-scoped PDF output. Runs shows typed JSON/text, sandboxed HTML and PDF actions. | Rendered browser/PDF visual QA, richer templates/layout and template selection. |
| 15. Assisted planner | 55% | Global `assisted_planner_enabled` defaults false. An explicit Skills action requires the currently loaded local model, bounds output to 256 tokens/32 KB, validates strict JSON through `resolve_assisted_draft`, returns the resolved plan, and requires a review checkbox before Run. A fake already-loaded backend generates the JSON draft; tests cover both gates, validator handoff and restoration of chat history. | Verify generation with an intentionally loaded real model only when separately authorized; improve planner goal/skill discovery and complete rendered approval-flow QA. |

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

Final integrated verification: `python3 -m unittest discover -s tests -q` passed 503 tests. Angular `npm run typecheck -- --pretty false` and `npm run build` passed. Static checks passed for runtime layout, navigation, templates, citation/document UI, voice transcript handoff, capability search, artifact contract parity, skill permission UX, global residency UX, resource dashboard, model-profile context, and manifest verification. `npm run test:assisted-planner-ux` fails because its source assertion expects a call pattern no longer present in the integrated API; `npm run test:model-studio-ui` and `npm run test:ui-smoke` also fail on stale smoke-test expectations (unexpected API request list / duplicate matching labels). No real model inference or GPU workload was run; rendered browser QA is not fully verified.

## Full-scope completion gate

The first orchestration release above is an intermediate milestone, not the
completion target for the active capability-orchestration objective. The full
target covers every Phase 0–15 deliverable and acceptance criterion in
`implementation-plan.md`, every applicable interaction in `ux.md`, and the
contracts, API and pipeline requirements in the other files in this directory.
Do not call this work complete when only the first-release milestone passes.

| Phase | Current | Full-scope evidence required before 100% |
|---|---:|---|
| 0. Contracts and terminology | 88% | Versioned schemas, bounded artifact envelopes, explicit extension metadata, future-version/root-field rejection, and static Python/TypeScript enum/field parity are tested. Runtime API payload validation remains Python-owned. |
| 1. Capability registry | 88% | Live runtime provenance, honest unknown states, directional model roles and capability-map filtering across route/model/runtime identifiers are covered. Wider runtime inventory and rendered review remain. |
| 2. Manifests and profiles | 82% | Persistent XDG metadata and typed generated-verification records, user-over-generated merge precedence, fake successful/failed probe promotion, verified-profile persistence, loopback endpoint with fail-closed default, and model-detail action/state are covered. Live startup/probe integration on an available runtime and rendered detail UX remain. |
| 3. Runtime adapter boundary | 76% | Fakes conform to runtime-checkable adapter contracts and stale handles fail after unload/reload; selected runtime suites pass. Broader lifecycle conformance for each integrated runtime and current direct-chat coordination remain. |
| 4. Artifact store | 94% | TTL begins after durable byte write; delete and delete-owner operations also sweep expired records; fake-clock cleanup and API ownership checks pass. Idle cleanup and rendered canvas/artifact integration remain. |
| 5. Skills and deterministic executor | 93% | All registered skills operational or truthfully unavailable, plus contract and permission boundary coverage. |
| 6. Resolver | 93% | Resolver v1 is deterministic across all 24 permutations of a mixed eligible/ineligible candidate set, rejects failed evidence, hard model/profile pins, incompatible types/features/dependencies and estimates below rounded-up resource headroom. Verified evidence outranks semantic model/profile choices by contract; loaded and priority tie-breaks remain ordered. Per-route `selection_factors` exposes evidence/model/profile/load/priority and resource facts; unique route IDs keep explanations unambiguous. `unknown_resource_policy=allow|reject` is explicit and tested. Twelve resolver tests pass. | Broader changing-inventory integration and rendered explanation review. |
| 7. Scheduler and leases | 78% | Deadlock-free multi-runtime reservations, configurable LRU/never eviction, pin/lease-aware unload, and non-waiting run shutdown retaining leases until callbacks stop. Full lifecycle cancellation stress and direct-chat residency coordination remain. |
| 8. RunManager and SSE | 95% | Durable run association, reconnect/cancel guarantees and rendered trace QA. A controlled test proves non-waiting shutdown does not release active runtime leases before the callback stops. |
| 9. Chat migration | 93% | Explicit image/document/audio skill suggestions with user-selected Chat→Skills handoff; exact typed input matching, owner-scoped session lookup, no PDF transformation, and text-only legacy direct chat preserved. Static handoff contract check passes. | Browser continuity review, restart/expiry continuity, and vision-capable direct chat route remain. |
| 10. Composition | 97% | Parallel/join/loop, fallback revisions, permission-bounded typed subskills, nested route resolution/invocation by stable path, child-definition fingerprints, inherited route concurrency budget, and multi-runtime batch rollback are covered by fakes; concurrent active-runtime cancellation races and cleanup stress remain. |
| 11. Image generation/editing | 63% | A fail-closed local-only adapter contract, optional API/planner registration, bounded typed outputs, owner-scoped image artifacts, independent hard generator/editor pins and low-VRAM explanations exist. Four deterministic suite groups pass (51 tests total). A repository/dependency/command audit found no genuine image provider on this host, so production generation, output preview and rendered browser QA remain unverified. |
| 12. Audio stack | 62% | Fake end-to-end STT, direct conversation, and reviewed-transcript response routes; transcript text must be explicitly supplied to `voice.respond`, which executes text.chat → TTS serially. Catalog explains unavailable routes and text fallback. | Diarization, audio understanding/music, smoother transcript-to-response handoff and browser QA. |
| 13. Knowledge/RAG | 82% | Bounded BM25-style lexical retrieval reports matched terms and heuristic scores; fixed labeled tests achieve MRR@5 1.0 across three fixtures; Runs shows retrieval evidence; citations retain exact offsets/quotes and PDF text/optional first-pages OCR tools have fake coverage. | Broader relevance evaluation, embeddings/reranking, host and browser review remain. |
| 14. Document generation | 86% | HTML/PDF/report outputs, typed JSON display, retryable previews, sandboxed HTML, PDF actions and Canvas content tabs exist; structured text/bullet/table reports now render to paginated PDF and pass fake owner-scoped API coverage. Richer template selection and rendered visual QA remain. |
| 15. Assisted planner | 55% | Explicit global opt-in, already-loaded-model-only draft endpoint, strict skill validator, resolved-plan response and review checkbox are implemented. Fake-loaded-model generation is tested; real runtime generation and browser QA remain unverified. |

The 20 sections in `ux.md` are also in scope; automated route checks or backend
tests do not prove visual quality. Completion requires a rendered review of the
operating modes, model cards/details/profiles, Skills, chat plan strip/inspector,
resource dashboard, unavailable-route explanations, workspace/canvas,
capability map, setup and permission UX. The dependency toolchain is available,
but Vite could not bind localhost in the sandbox and browser policy rejected
opening the build via `file:`; rendered browser QA remains unverified.

## UX12/13 Canvas update (2026-09-30)

Canvas now retains owner-scoped artifact tabs and text outputs without
reselecting the user's active tab when unchanged results are refreshed. It
renders safe Markdown (headings, lists, fenced code, tables, inline styles and
HTTP(S)/mailto links), JSON records with an explicit bounded table view,
editable session-local code, sandboxed HTML with source, image open/save, audio
playback, PDF preview/open/download, and text document preview/download. The
inline Chat code preview no longer opens automatically. Static fake-input
coverage includes Markdown headings/lists/code/table, safe versus javascript
links, raw HTML injection text, JSON record arrays and row limits. The
artifact contract currently declares no `code_patch`/patch kind, so a diff view
is intentionally not claimed or inferred from arbitrary text.

Checks run: `node web/scripts/test-canvas-renderers.mjs`,
`node web/scripts/check-canvas-workspace.mjs`,
`node web/scripts/check-setup-assistant.mjs`, `node web/scripts/check-nav-routes.mjs`,
`npm run typecheck`, and `git diff --check` all pass. Browser-visible QA remains
unverified: Vite could not bind `127.0.0.1:5173` in the sandbox (`listen EPERM`).
Markdown rendering is a deliberately small safe subset rather than full
CommonMark, and the table view only handles JSON arrays of objects, capped at
200 displayed rows and 50 columns.

## Phase 14 report-renderer update (2026-09-30)

`document.create-report` now accepts deterministic text, bullet-list, and
table section shapes while preserving the existing text-section input. The
renderer validates shape and size limits before publishing HTML, escapes
headings/cells, and rejects unknown section kinds or undeclared fields. The
document skill remains model-independent and its output continues through the
typed run artifact path. `docs/capability-orchestration/skills-and-workflows.md`
records the explicit JSON input format and limits.

Evidence at the initial report-renderer update: `python3 -m unittest
tests.test_document_render tests.test_document_skill_api
tests.test_builtin_skills` passed (16 tests), covering fake-run HTML/PDF/report
outputs, deterministic report bytes, injection escaping, and invalid/over-limit
section rejection. The later `document.create-report-pdf` skill now accepts
those same structured sections; ordinary `document.create-pdf` still accepts
plain text. No model or GPU workload was run. Remaining gaps: no template
chooser exists in Skills; rendered browser/PDF visual review and more layout
presets remain unverified.

`document.create-report-pdf` now accepts the exact bounded report JSON contract
used by `document.create-report`. The PDF renderer first validates through the
canonical structured report renderer, then lays out text sections, bullets and
column-labeled table rows into deterministic paginated PDF text. Existing
`document.create-pdf` plain-text inputs and report HTML are unchanged. Direct
renderer tests cover escaping of PDF delimiters, markup as inert text, shape
and total-size rejection, valid pagination, and a fake default-API run proves
that the PDF is stored as a run-owned artifact. No browser was started.

Evidence: `test_document_render`, `test_document_skill_api` and
`test_builtin_skills` pass. Remaining gaps are template selection, visual PDF
review, richer layout beyond the readable pipe-separated table representation,
and rendered browser QA.

## Phase 11 local-provider and resource audit (2026-09-30)

The project declares no Python runtime dependencies in `pyproject.toml`, and
the repository contains no Diffusers, stable-diffusion.cpp, ComfyUI,
Automatic1111/Forge, or InvokeAI adapter or integration. Read-only host checks
found none of the queried Python packages (`diffusers`, `transformers`,
`torch`, `safetensors`) and no `stable-diffusion.cpp`, `comfy`, or `invokeai`
executable on `PATH`. The generic injected adapter is therefore the honest
available boundary; no package was installed and no model or inference process
was started.

The existing fake coverage now verifies that generation and edit consume
typed inputs and persist PNG bytes as run-owned artifacts, while planning
doesn't load a model, independent capability pins remain hard constraints, and
an explicit estimate larger than observed free VRAM returns the estimated and
available GiB plus headroom guidance. Missing backend estimates remain unknown
and cannot support a low-VRAM guarantee. The full focused module set
(`test_image_runtime`, `test_capability_api`, `test_skill_api`,
`test_orchestration`) passed 51 tests. Remaining gates are a genuine provider
and model, a real image preview in Canvas, and rendered browser QA.
