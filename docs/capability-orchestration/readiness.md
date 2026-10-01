# Capability orchestration readiness

Status date: 2026-10-01

This is the working readiness record for the implementation described in
`implementation-plan.md`. Percentages are estimates of objective coverage, not
test pass rates. A phase is not considered complete until its user-visible
acceptance criteria are implemented and verified.

## Current readiness

| Area | Readiness | Evidence in this worktree | Remaining work |
|---|---:|---|---|
| Capability contracts and registry | 90% | Typed contracts, evidence, API and live capability map; search covers capability/status/I/O/provenance and discovered route/model/runtime identifiers. Unknown remains distinct from supported; artifact v1 Python/TypeScript parity and future-version rejection are checked. Resolver inputs and nested metadata are detached snapshots so caller mutation cannot change an already-built route. Capability status filters expose selected state to assistive technology. The map links declared capabilities to installed skills and distinguishes an empty relation from unavailable reporting. | Broader runtime evidence, complete route/profile queries, genuine verified-route coverage and wider responsive map review. |
| Manifests and model profiles | 82% | Layered manifest view; atomic XDG user-metadata and generated-verification stores; typed injected verifier contract; `POST /api/model-manifests/<id>/verify` validates/promotes only typed successful claims, persists a verified profile, and composes generated claims below user metadata. Model details expose the explicit verification action and report the precise unavailable reason. Runtime-bound verifier seam and fake API/store tests pass; legacy profile fallbacks remain. | No bounded semantic model probe is configured on this host; availability/help probes cannot establish model capabilities. Live verification/promote and broader rendered model-detail QA remain. |
| Runtime adapters and scheduler | 89% | llama.cpp, vLLM and fake adapters; loads reject a second active load, synchronous invocations serialize around global cancellation, and adapters no longer claim unsafe concurrent-request support. Scheduler leases remain held while calls are active; cancel signals do not release them, and unload/release reject active calls. `release_owner_after_calls` defers owner lease release until active callbacks return; cancellation/cleanup race tests cover this behavior. LRU/never, pin/lease eviction and non-waiting shutdown are covered by fakes. Direct Chat and orchestration share a lock; residency actions now fail with a conflict while that runtime is active, and a cancelled run waiting for the lock exits before unloading it. | Add runtime-native request cancellation/concurrency where supported, and larger stress coverage for shutdown/cleanup races. |
| Artifact store | 96% | Bounded private store, owner-scoped/restorable session uploads, typed run outputs, citations, and sandboxed HTML/PDF preview/download. TTL starts after private bytes are flushed/fsynced; fake-clock tests cover expiry cleanup on delete/delete-owner. Caller-provided parent directory permissions are preserved while the store-owned subdirectory stays private; Python/TypeScript contract parity passes. | Idle stores sweep only on a later operation/explicit cleanup; process exit can leave temporary directories; broader rendered artifact review remains. |
| Skills and workflows | 93% | Fourteen validated manifests; chat, extraction, summarization, HTML/PDF/report, temporary document RAG, and typed voice workflows use default API paths. Voice synthesis now discovers FFmpeg's local Flite voices and produces bounded PCM WAV artifacts; fake tests cover STT and provider behavior, and an explicit CPU-only smoke validates a real WAV. This host has no Whisper executable or GGML model, so STT remains unavailable. Structured reports produce safe HTML and paginated PDF. | Real STT route and reviewed voice response with a compatible text model; select among installed TTS voices in the workflow UI; production image provider and browser QA. |
| Planner and route resolution | 78% | Default planner discovers compatible text and explicitly local, network-disabled image routes without loading models; deterministic plans include selected routes, reasons and alternatives; fake adapters exercise scheduler lease handoff. Resolver route inputs and nested metadata are detached/frozen against post-resolution caller mutation, and malformed selection modes fail as contract errors. Assisted drafts are opt-in/off by default, require an already-loaded model, pass strict installed-skill validation, and bind Run to the reviewed plan ID so stale plans require a new review. | Live model-generation verification, richer selection-mode behavior, production image backend verification and executable composition beyond serial nodes. |
| Resource dashboard and residency | 88% | Hardware snapshots and residency drawer; responsive topbar shows measured per-GPU VRAM, available RAM and loaded-model count with explicit Unknown values, verified at desktop and 390 px mobile width. Persisted `lru`/`never` policy and allowlisted pin/unpin/unload controls are connected to the scheduler. Browser smoke covers policy, pin/unpin and idle unload; residency mutations conflict while Direct Chat or orchestration owns the shared runtime. | Add reservations/detailed alternatives and verify the full residency drawer at mobile widths. |
| Runs and SSE | 98% | Bounded RunManager plus a bounded, private per-user local journal for run metadata and sanitized events; validated `chat_id` association; restart recovery marks interrupted runs terminal `failed` with `process_restarted` and never resumes them. Durable records explicitly omit outputs/artifact bytes. Runs UI shows recovery/output-loss and durability warnings, the journal failure reason, and a link that opens the associated chat. Browser smoke covers those states, chat selection, typed text/JSON, owner-scoped HTML preview, 403 guidance/retry, download action and 390 px layout. SSE still reports exact `run.replay_gap` ranges. | Outputs/artifact bytes remain intentionally non-durable; end-to-end restart and cross-chat isolation/recovery tests remain; tighten backend cancellation guarantees. |
| Chat migration | 95% | `chat.general` preview/execute with model/profile pins, run association and selectable plan inspector; Guided confirmation sends the reviewed route pins and plan ID, and the API rejects a changed plan before creating a run. Browser smoke covers Guided review/alternative/confirm, Auto execution, Manual hard-pin behavior, and preservation of the prompt after an incompatible route so the user can retry. Direct `/api/chat` remains available. Chat image uploads suggest both Describe and Edit workflows where the typed image input is accepted. | Uploaded artifacts remain process-local/session scoped and cannot survive API store expiry/restart; vision-capable direct chat routing is not yet supported. |
| Composition and specialist pipelines (phases 10–15) | 76% | Bounded deterministic parallel layers, typed `parallel`/join, loops, fallback revisions, permission-bounded subskills, nested route resolution with a shared cancellation-aware budget, verified report-to-PDF workflow, reviewed-transcript voice response, measured lexical retrieval evidence, and parallel cancellation signaling that makes cancellation win over sibling runtime errors. | Genuine image provider, richer audio, broader retrieval evaluation, non-cooperative active-call cancellation, runtime verifier availability and broader multimodal UX remain. |

### Specialist phase readiness

| Phase | Readiness | Evidence | Remaining work |
|---|---:|---|---|
| 10. Composition primitives | 98% | Independent DAG layers, typed `parallel`/`join`, bounded loops, traceable fallback revisions, typed subskills with cycle/depth/step and inherited-permission bounds, hierarchical traces, nested route resolution by stable path, plan fingerprints for child definitions, an exposed shared `max_parallel_routes` budget, atomic nested reservation, rollback, lease release, and run-token propagation. A barrier-based test proves cancellation signals cooperative siblings and takes precedence over a sibling runtime error. | Cancellation still waits for already-running handlers to cooperate; cleanup-under-failure stress coverage and complete rendered UX review remain. |
| 11. Image generation/editing | 72% | Typed image I/O and declarative skills; fail-closed `LocalImageRuntimeAdapter` requires explicit local-only/network-disabled claims, validates PNG/JPEG/WebP signatures, supports bounded typed outputs and exposes explicit resource estimates. Explicit loopback ComfyUI integration supports generation and unmasked img2img using bounded multipart PNG/JPEG upload and the standard LoadImage/VAEEncode/KSampler graph. Fake API tests cover discovery, upload, workflow/output, and queued cancellation. A host audit found no configured ComfyUI service or compatible image stack, so real inference and output review remain unverified. | Configure a real local provider/model; verify real generation/edit results, resource use, Canvas preview, and rendered browser UX. Add a mask workflow/provider for selective edits. Resource safety remains unknown when a backend omits estimates. |
| 12. Audio understanding | 68% | Local STT/TTS callbacks are wired as discovered routes; FFmpeg's compiled Flite filter exposes five CPU voices here and is now a bounded WAV artifact provider. A real smoke synthesized a 22,050 Hz mono PCM WAV and verified it with `ffprobe`; fake tests cover provider discovery, private text input, typed artifact output, and strict STT scope/size behavior. The host has `arecord` and `spd-say`, but no Whisper executable, GGML model, or Python STT provider, so audio transcription and direct `voice.conversation` cannot run here. No model/GPU workload was started. | Install/configure a local STT provider and existing model; user selection among available TTS voices; verify reviewed text.chat→TTS end to end; diarization, general audio/music understanding, streaming, and rendered playback workflow QA. |
| 13. Temporary document RAG | 82% | A stateless per-run BM25-style lexical retriever chunks one selected document, bounds context, emits deterministic offsets/citations plus matched terms and heuristic lexical scores, and powers `document.answer-with-rag`; Runs exposes citation source, quote, offsets, matched terms and score. Three fixed labeled retrieval fixtures achieve MRR@5 1.0; this is a small regression set, not a general relevance claim. PDF text extraction has bounded Poppler fallback and optional first-pages OCR when local tools are installed. | Broader relevance evaluation, rendered citation QA, OCR host verification, and embeddings/reranking when compatible local routes exist. |
| 14. Document generation | 88% | Safe bounded HTML/report and paginated PDF renderers produce run-owned artifacts; new `document.create-report-pdf` renders validated structured text, bullets and tables as paginated PDF. Fake API runs verify owner-scoped PDF output. A smoke render used Poppler and Pillow to produce and inspect a three-page PDF; visual inspection confirmed readable content and page breaks, while line-based pipe-table layout and richer templates remain improvable. Runs shows typed JSON/text, sandboxed HTML and PDF actions. | Complete visual QA across varied content and browser presentation; improve line wrapping, table formatting and template selection. |
| 15. Assisted planner | 60% | Global `assisted_planner_enabled` defaults false. Goal-first lexical skill discovery is grounded in declared metadata. Draft and resolved plans appear in side-by-side panels with mobile layout; static UX check, typecheck/build, and narrow smoke checks for search, opt-in, loaded-model gating and mobile pass per the current UI report. Draft generation still requires an already-loaded local model, bounds output to 256 tokens/32,000 characters, validates strict JSON through `resolve_assisted_draft`, and requires a review checkbox before Run. | Dynamic smoke remains pending: its fixture did not expose the goal-entry or approval controls. Real model generation has not run, and API enforcement of `draft.skill_id == requested skill_id` is still missing; broader approval-flow UX review remains. |

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

Earlier integrated verification on 2026-10-01: `python3 -m unittest discover -s tests -q` passed 518 tests. Angular typecheck and production build passed (the bundle remains above the existing 500 KB advisory threshold). Browser smokes passed for Chat Guided review/alternative/confirmation, Capability Map skill relationships, Model Studio, Hardware/Settings at desktop and 390 px mobile widths, and explicit Chat→Canvas handoff. HTTP coverage exercises stale-plan rejection and bounded-history replay-gap notification; resolver immutability, citation-marker neutralization, capability-map links and skill readiness have focused tests. No real model inference or GPU workload was run. Remaining UX gaps are listed below; this is not a 100% readiness claim.

Integrated full-suite verification on 2026-10-01: `python3 -m unittest discover -s tests -q` passed 552 tests after the runtime cleanup-race, image integration, and document-render updates. Phase-specific evidence remains below; this test count does not establish host inference or complete visual UX.

Incremental verification on 2026-10-01: the focused backend integration run passed 69 tests across `tests.test_http_api` and `tests.test_skill_registry_executor`, including active-chat residency exclusion and parallel cancellation precedence; the subsequent full `python3 -m unittest discover -s tests -q` run passed 529 tests, including the new runtime-bound manifest-verifier contract. Angular typecheck and production build passed (the main chunk still exceeds the 500 KB advisory). Browser smokes cover Chat Guided review/alternative/confirm, Auto, Manual rejection/retry, Resources pin/unpin/unload and eviction policy, Runs owner-scoped preview/retry/download, Capability Map filtering/skill relationships, and Knowledge error/retry, empty and matched search at narrow mobile widths. Setup Assistant refresh feedback and Skills permission-before-run contracts pass, as do Chat attachment handoff and 16 Chat orchestration contracts. Earlier browser smokes cover Model Studio, Hardware/Settings at desktop and 390 px, and explicit Chat→Canvas handoff. No real model inference or GPU workload was run.

Run durability verification on 2026-10-01: focused `RunJournalStore`/`RunManager` tests cover private-file permissions, bounded records/events/bytes, schema migration, atomic persistence, redaction, validated chat association, and restart recovery to terminal `process_restarted` failure with empty outputs. The Runs browser smoke additionally verified the recovered/non-durable notices, journal diagnostic, associated-chat navigation/selection, typed output preview/retry/download, and a 390 px viewport. Run output values and artifact bytes are not persisted; HTTP-level restart recovery and cross-chat isolation remain unverified. No model or GPU workload was run.

## Full-scope completion gate

The first orchestration release above is an intermediate milestone, not the
completion target for the active capability-orchestration objective. The full
target covers every Phase 0–15 deliverable and acceptance criterion in
`implementation-plan.md`, every applicable interaction in `ux.md`, the
progressive-disclosure stages and preservation requirements in
[`../ux-information-architecture.md`](../ux-information-architecture.md), and
the contracts, API and pipeline requirements in the other files in this
directory. The information-architecture proposal is an additive UX layer: it
does not replace the capability orchestration UX contract in `ux.md`. Both
specifications must be satisfied. Where the proposed navigation hierarchy
changes where an existing capability is reached, preserve its behavior,
deep-links and discoverability through contextual navigation, Settings or
search/command palette. Do not call this work complete when only the
first-release milestone passes.

### Progressive-disclosure information architecture

This matrix tracks the six implementation stages in
[`../ux-information-architecture.md`](../ux-information-architecture.md).
The source document is a proposed direction, not evidence of shipped behavior.
Stage 1 is **completed** based on local frontend implementation and recorded
static, build and browser verification below. Stages 2–4 and 6 remain not
started. Stage 5 is not started; telemetry de-duplication remains an explicit
gap. The cross-stage preservation gate remains in progress because later
stages and its configuration non-mutation criteria are still outstanding.

| Stage | Readiness | Atomic acceptance evidence required for completion | Current evidence / gap |
|---|---|---|---|
| 1. Navigation-only simplification | Completed | Standard navigation contains only primary task surfaces and Settings; every implemented route remains reachable through Settings, contextual links or command palette; existing deep links still work. | `web/src/app/app.component.ts` implements six sidebar destinations and a 19-destination command palette. `npm run test:nav-routes` passes; `npm run typecheck` and `npm run build` pass. Playwright smoke `web/scripts/smoke-progressive-navigation.mjs` verifies click navigation to all 19 destinations, ArrowDown+Enter keyboard selection, `/hub`, the `/capability-map` deep link, and 390 px layout. No routes were removed. This is local verification; deployment is not implied. |
| 2. Settings consolidation | Not started | Settings contains coherent General, Models & Storage, Runtimes, Connections, Appearance and Advanced areas; Local API connection has one authoritative home; runtime defaults relate coherently to runtime installation management; advanced infrastructure pages are discoverable from Settings. | Current readiness records Settings and runtime surfaces, but no evidence of the proposed consolidated categories or advanced-page directory. |
| 3. Model-centered configuration | Not started | User can discover/select a model, configure its runtime/placement/profile and load/use it without an unrelated top-level route; global runtime defaults remain separate; saved profiles remain usable. | Model Studio contains model/profile configuration, while Load Model/Placement and Runtime remain separate destinations. End-to-end model-centered completion and preserved-profile verification are not recorded. |
| 4. Provider connections | Not started | Connections can be added, tested, disabled and edited from Settings; credentials use the selected secure storage strategy and are not shown in plaintext after save; remote model discovery feeds shared model selection; generic OpenAI-compatible endpoints work where supported. | No Connections abstraction/UI or acceptance evidence is recorded. Do not infer this from the existing local API status page or model hub. |
| 5. Telemetry de-duplication | Not started | Local API status is not repeated in three persistent locations; detailed resources are reachable in one interaction; connectivity and resource failures remain obvious and actionable. | The sidebar status card, top-bar connection chip and footer status still repeat API state (`web/src/app/app.component.ts`); stage 1 changed navigation only. No telemetry de-duplication is claimed. |
| 6. Standard/Advanced visibility preference | Not started | Standard is uncluttered by default; Advanced can expose workstation destinations directly; switching modes leaves runtime/model/provider configuration unchanged. | No Standard/Advanced preference or persistence/non-mutation evidence is recorded. |
| Cross-stage preservation gate | In progress | All currently implemented routes remain functional and reachable in the consolidated IA; existing deep links continue to resolve; moving a destination preserves its behavior and capability; advanced destinations remain discoverable through Settings, contextual links or command/search palette; switching visibility mode does not modify model/runtime/provider settings. | Stage 1 preserves all 19 destinations in the command palette and its route smoke covers keyboard selection plus `/hub` and `/capability-map` deep links. Stages 2–6 and visibility-mode configuration non-mutation remain unimplemented and unverified. |

The matrix above is separate from the existing capability-orchestration UX
coverage below. Passing stages 1–6 does not prove the `ux.md` interactions;
passing the `ux.md` interactions does not prove progressive-disclosure
navigation, configuration consolidation or preservation requirements.

| Phase | Current | Full-scope evidence required before 100% |
|---|---:|---|
| 0. Contracts and terminology | 89% | Versioned schemas, bounded artifact envelopes, explicit extension metadata, future-version/root-field rejection, and static Python/TypeScript enum/field parity are tested. Runtime API payload validation remains Python-owned. |
| 1. Capability registry | 90% | Live runtime provenance, honest unknown states, directional model roles and capability-map filtering across route/model/runtime identifiers are covered. Map filters announce selected state; details link only installed skills whose manifests declare the capability and show current readiness. Wider runtime inventory and responsive rendered review remain. |
| 2. Manifests and profiles | 82% | Persistent XDG metadata and typed generated-verification records, user-over-generated merge precedence, fake successful/failed probe promotion, verified-profile persistence, loopback endpoint with fail-closed default, model-detail action/state, and explicit unavailable-reason diagnostics are covered. Live semantic probe integration on an available runtime and rendered detail UX remain. |
| 3. Runtime adapter boundary | 82% | Fakes conform to runtime-checkable adapter contracts; double load is rejected without losing the live handle; synchronous requests serialize; request-ID-scoped cancellation only targets the active request; stale handles fail after unload/reload. The adapter does not advertise concurrency that its global cancel API cannot safely provide. Direct-chat coordination and real engine lifecycle conformance remain. |
| 4. Artifact store | 96% | TTL begins after durable byte write; delete and delete-owner operations sweep expired records; fake-clock cleanup, API ownership and parent-permission preservation pass. Idle cleanup and broader rendered Canvas/artifact integration remain. |
| 5. Skills and deterministic executor | 93% | All registered skills operational or truthfully unavailable, plus contract and permission boundary coverage. |
| 6. Resolver | 95% | Resolver v1 is deterministic across all 24 permutations of a mixed eligible/ineligible candidate set, rejects failed evidence, hard model/profile pins, incompatible types/features/dependencies and estimates below rounded-up resource headroom. Verified evidence outranks semantic model/profile choices by contract; loaded and priority tie-breaks remain ordered. Per-route `selection_factors` exposes evidence/model/profile/load/priority and resource facts; unique route IDs keep explanations unambiguous. `unknown_resource_policy=allow|reject` is explicit and tested. Resolver inputs, requirements and nested metadata are snapshotted against caller mutation. Fourteen resolver tests pass. | Broader changing-inventory integration and rendered explanation review. |
| 7. Scheduler and leases | 89% | Deadlock-free multi-runtime reservations, configurable LRU/never eviction, pin/lease-aware unload, active-call accounting, and non-waiting run shutdown retaining leases until callbacks stop. `release_owner_after_calls` defers owner release until active callbacks return; targeted cancellation/terminal-cleanup race tests pass. Direct Chat and orchestration residency mutations now share the active-turn lock. Larger race stress remains. |
| 8. RunManager and SSE | 98% | Run association, reconnect/cancel guarantees, and rendered trace QA. A controlled test proves non-waiting shutdown does not release active runtime leases before the callback stops. When a bounded journal discards a requested replay range, SSE reports `run.replay_gap` and sequence bounds, and the client refreshes the current run snapshot. A bounded, private local journal persists run metadata and sanitized events with a validated chat ID; restart recovery makes active runs terminal `failed/process_restarted` and does not resume them. Outputs/artifact bytes are deliberately omitted. Runs UI surfaces recovery, non-durability and journal-error states and navigates to the associated chat; browser smoke verifies these states and chat selection alongside owner-scoped typed output preview/retry/download at a narrow viewport. | Persist output values/artifact bytes if product requirements need them; HTTP end-to-end restart recovery and cross-chat isolation remain unverified; strengthen cancellation guarantees. |
| 9. Chat migration | 95% | Explicit image/document/audio skill suggestions with user-selected Chat→Skills handoff; image attachments suggest both describe and edit skills with exact typed input matching, owner-scoped session lookup, no PDF transformation, and text-only legacy direct chat preserved. Guided confirmation pins the reviewed route and binds execution to the reviewed `plan_id`; API rejects stale plan IDs. Browser smoke verifies preview/alternative/confirm, Auto route execution, and Manual hard-pin rejection with prompt retention/retry. | Restart/expiry continuity and vision-capable direct chat route remain. |
| 10. Composition | 98% | Parallel/join/loop, fallback revisions, permission-bounded typed subskills, nested route resolution/invocation by stable path, child-definition fingerprints, inherited route concurrency budget, and multi-runtime batch rollback are covered by fakes. Cancellation signals cooperative siblings immediately and prevails over ordinary sibling failures; non-cooperative call and cleanup stress remain. |
| 11. Image generation/editing | 72% | A fail-closed local-only adapter contract validates actual PNG/JPEG/WebP signatures, supports explicit resource estimates, bounded typed outputs, owner-scoped artifacts, independent hard generator/editor pins and low-VRAM explanations. An explicit loopback-only ComfyUI bridge now supports generation and unmasked img2img with bounded PNG/JPEG upload and the standard local checkpoint graph; fake tests cover discovery, upload, workflow/output, and queued cancellation. No ComfyUI service/model is configured on this host, so actual inference, output quality, resource use, and Canvas review remain unverified. |
| 12. Audio stack | 68% | Fake tests cover STT, direct conversation, reviewed-transcript response, and Flite provider discovery. On this host `LocalVoice` discovers FFmpeg/libflite plus `kal`, `kal16`, `slt`, `rms`, and `awb`; `audio.synthesize` now returns a bounded typed WAV from the local CPU provider, verified by a real `ffprobe` smoke (22,050 Hz mono PCM). Speech Dispatcher `spd-say` is available for local playback. `whisper-cli`/`whisper-cpp`, GGML model files, and Python STT packages were absent, so transcription is not host-ready and no STT inference was claimed. | STT executable plus an existing local model; explicit TTS voice choice in the workflow; real reviewed text.chat→TTS route validation; diarization, audio understanding/music, streaming and rendered user playback QA. |
| 13. Knowledge/RAG | 83% | Bounded BM25-style lexical retrieval reports matched terms and heuristic scores; fixed labeled tests achieve MRR@5 1.0 across three fixtures; Runs shows retrieval evidence; citations retain exact offsets/quotes and PDF text/optional first-pages OCR tools have fake coverage. Source text resembling generated citation labels is neutralized in model context while exact quote and offset evidence is preserved. Knowledge browser smoke covers load failure/retry, confirmed-empty state, lexical no-match/match, and 360 px layout. | Broader relevance evaluation, embeddings/reranking, OCR host verification and broader citation review remain. |
| 14. Document generation | 88% | HTML/PDF/report outputs, typed JSON display, retryable previews, sandboxed HTML, PDF actions and Canvas content tabs exist; structured text/bullet/table reports render to paginated PDF and pass fake owner-scoped API coverage. Poppler+Pillow smoke rendering produced and visually inspected a three-page PDF; content was readable, but line/pipe-table layout and templates need refinement. Broader rendered visual QA remains. |
| 15. Assisted planner | 60% | Goal-first lexical skill discovery uses declared metadata; draft and resolved plans have side-by-side panels with mobile layout. Static UX check, typecheck/build, and narrow smoke checks for search, opt-in, loaded-model gating and mobile pass per report. The endpoint retains explicit global opt-in, already-loaded-model-only generation, strict validation, and Run binding to the current reviewed plan ID; stale-plan conflicts require a fresh preview. | The API now rejects `draft.skill_id != requested skill_id` before plan resolution (`aidream/http_api.py`); the fake-backed HTTP cross-skill test passes (`tests/test_http_api.py`). Dynamic planner smoke remains pending because its fixture did not expose goal-entry or approval controls. Real model generation and the interactive approval flow remain unverified. Readiness stays at 60%; this contract fix alone does not establish broader phase completion. |

All 20 sections in `ux.md` remain independently in scope alongside stages 1–6
above; the information-architecture proposal is additive and does not supersede
these capability UX requirements. Automated route checks or backend tests do
not prove visual quality. Rendered smoke evidence currently covers the
topbar, Hardware, Settings, Model Studio, Chat/Agent, Auto/Guided/Manual route
interactions, explicit Chat→Canvas handoff, Resources eviction/pin/unpin/unload,
Setup Assistant refresh feedback, Skills permission-before-run gating, and
Runs typed output preview/retry/download at 390 px, Capability Map filtering and
relationships, and Knowledge error/empty/matched search at 360 px. Completion
still requires broader responsive review for Skills unavailable-route states,
chat plan inspector, Canvas keyboard behavior in a browser, and multimodal outputs.

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

The project declares no Python runtime dependencies in `pyproject.toml`.
Read-only host checks found none of the queried Python packages (`diffusers`,
`transformers`, `torch`, `safetensors`) and no `stable-diffusion.cpp`, `comfy`,
or `invokeai` executable on `PATH`; no ComfyUI service URL is configured here.
No package was installed and no model or inference process was started.

An explicit loopback-only ComfyUI bridge now supports prompt-to-image and
unmasked img2img. Status and checkpoint discovery are read-only; a user-started
skill uploads bounded PNG/JPEG bytes to `/upload/image`, queues a workflow using
the selected local checkpoint, polls the result, and persists typed PNG output.
The img2img graph has no mask input: it edits the image globally and cannot
promise region preservation. The host does not currently provide a configured
ComfyUI service, so real workflow acceptance, output quality, VRAM use, and
Canvas preview remain unverified. Metadata/listing is not a successful
generation or edit.

Fake coverage verifies typed generation/edit inputs and persisted PNG outputs,
plus read-only ComfyUI discovery, bounded multipart upload, explicit workflow
submission, PNG retrieval, and queued-job cancellation checks. Planning doesn't
load a model, independent capability pins remain hard constraints, and an
explicit estimate larger than observed free VRAM returns estimated and
available GiB plus headroom guidance. Missing backend estimates remain unknown
and cannot support a low-VRAM guarantee. Phase 11 is integration-ready, not
host-verified; remaining gates are a configured local service completing real
generation and edit workflows, output review, Canvas preview, and rendered
browser QA.
