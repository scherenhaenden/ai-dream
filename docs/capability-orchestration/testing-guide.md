# Operational testing guide: what this host can verify today

This guide distinguishes recorded results from commands that are available to
run and from behavior that cannot be validated on this host. A passing fake or
contract test proves the exercised boundary only; it does not prove a real
model, provider, or end-user service is installed.

## Readiness matrix

| Area | Command available | What the check establishes | Latest recorded result | State / limit |
|---|---|---|---|---|
| Python backend regression suite | `python3 -m unittest discover -s tests -q` | Deterministic unit and integration behavior using fixtures/fakes where configured. The suite itself does not start model inference. Tests that bind loopback sockets require an execution environment that permits local socket bind/connect. | **574 passed** outside the sandbox on 2026-10-01. | Latest confirmed full-suite result; tests use deterministic fakes where configured and do not validate real model inference/GPU behavior. |
| Scheduler reservation preflight | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_model_scheduler.ModelSchedulerTest.test_acquire_many_preflights_aggregate_estimates_before_any_load -v` | Confirms a multi-runtime reservation checks the aggregate resource estimate before loading any member, so rejection cannot leave a partial load. | Passed in the latest scheduler verification; **19 scheduler tests passed**. | Fake adapters only; it verifies reservation behavior, not actual hardware pressure or engine loading. |
| Unknown resource policy API | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_http_api.HTTPAPITests.test_capability_preferences_patch_persists_and_updates_scheduler_eviction_policy -v` | Exercises GET/PATCH persistence of `selection_defaults.unknown_resource_policy` alongside scheduler eviction preferences. | **Passed 1 test** outside the sandbox on 2026-10-01. | Verifies API preference persistence and scheduler update with fixtures. Resolver `reject` mode excludes candidates with unknown estimate/available resource data and reports `resource_estimate_unknown`; this does not validate real hardware readings or runtime execution. |
| Skills API, including run readiness | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_skill_api -q` | Skill catalog readiness and the API refusal path for a skill whose required capability is unavailable. The tests use a deterministic API fixture. | **20 passed** in the current work round. | Verified. Does not prove a real STT provider exists. |
| Capability/skill readiness under measured resource limits | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_skill_api tests.test_capability_api -q` | Verifies that all known routes exceeding measured VRAM headroom lead to `not_ready`, no preferred route, and a repair alternative; also checks that separate GPUs are not treated as pooled memory without route-to-device mapping. | **36 focused tests passed** outside the sandbox on 2026-10-01. | Fixture inventory only; missing measurements stay Unknown, and this does not verify actual runtime-to-GPU placement or model execution. |
| Other focused Python tests | `python3 -m unittest tests.test_voice tests.test_voice_orchestration tests.test_capability_api tests.test_document_skill_api -q` | Provider detection/callback contracts, capability API serialization, and document-skill integration under their test fixtures. | A combined focused run passed **41 tests** during the current audio work. | Verified as a previous focused run; fake tests are deterministic and do not establish transcription or neural audio understanding. |
| Angular typecheck | `cd web && npm run typecheck` | TypeScript (`tsc --noEmit`) and Angular AOT template/compiler checking (`ngc -p tsconfig.app.json --noEmit`). | Passed on 2026-10-01 in this worktree. | Freshly verified. This checks application source/templates, not browser behavior. |
| Production frontend build | `cd web && npm run build` | Vite production bundle generation, including lazy Angular routes. | Passed on 2026-10-01 in this worktree. The main bundle is 897.15 KB minified and triggers Vite's existing 500 KB advisory. | Freshly verified; bundle-size optimization remains open. |
| Chat / Agent browser smoke | `cd web && npm run test:chat-agent-ui` | Fixture-backed browser checks of Chat and Agent layout, Chat execution-path group semantics, dynamic `aria-pressed` values when switching between Plan + run and Direct chat, Direct Chat request shape, Canvas handoff, and Guided review/confirmation. In Guided mode it observes the run as running then succeeded, validates `current_nodes` and announces the active `reply` step through a status/`aria-live` region at 390 px. | Passed on 2026-10-01. `npm run typecheck`, `npm run build`, and `git diff --check` also passed in this verification round. | Verifies rendered behavior against fixture API responses; it does not establish live model execution, changing multi-runtime steps, cancellation/error announcements, or malformed live API data. Requires Playwright, local Chromium, and built `web/dist`. |
| Knowledge browser smoke | `cd web && npm run test:knowledge-ui` | Headless Chromium checks load error/retry, an empty index, no-match/matched lexical search, and 360 px horizontal overflow. API responses are intercepted and stubbed. | Passed in the integrated browser-smoke checkpoint on 2026-10-01. | Verified as UI behavior against fixtures only; it does not contact or validate a live Knowledge/RAG backend. Requires Playwright, a local Chromium-compatible browser, and a built `web/dist`. |
| Runs browser smoke | `cd web && npm run test:runs-ui` | Headless Chromium checks fixture SSE success, node failure and cancellation traces; sequence tracking, expandable node data, recovery/durability notices, chat association, typed output, owner-scoped HTML preview retry/download, filtering, and 390 px layout. API and event-stream responses are fixtures. | Passed on 2026-10-01 outside the sandbox after correcting run selection in the recovery and output assertions. | Verified UI/event-consumer contract only; it does not prove live backend persistence, HTTP-level restart recovery, cross-chat isolation, or deployed SSE. Requires Playwright, local Chromium, and built `web/dist`. |
| Run journal restart recovery over HTTP | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_http_api.HTTPAPITests.test_runs_http_api_exposes_restart_recovery_from_the_private_journal -v` | Initializes a new API from a private journal containing an interrupted run; checks `/api/runs` list/detail and event SSE recover it as `failed/process_restarted`, retain `chat_id`, clear active nodes/outputs, and emit `run.failed` without resuming execution. | **Passed 1 test** outside the sandbox on 2026-10-01. | Deterministic journal/API fixture; proves HTTP recovery boundary, not browser reconnect to a live run, cross-chat isolation, or deployed SSE. |
| Existing saved chat compatibility | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_http_api.HTTPAPITests.test_chat_crud_redacts_attachment_paths_and_settings -v` | Reads an existing persisted transcript, redacts private attachment/settings paths from the public response, then continues it through legacy `/api/chat`. | Included in the **574-test** full suite recorded above; no separate focused result recorded. | Proves the covered API fixture and compatibility route; does not establish UI behavior for every historical schema/version. |
| Canvas keyboard and artifact smoke | `cd web && npm run test:canvas-keyboard-ui` | Chromium fixture checks ARIA tab navigation, Enter/Arrow/Home/End behavior, owner-scoped image content, open/save actions, focus restoration after closing tabs and 390 px overflow. | Passed on 2026-10-01 in this worktree. | Fixture/UI behavior only; does not validate real model-generated artifacts. Requires Playwright and a built `web/dist`. |
| Capability Map browser smoke | `cd web && npm run test:capability-map-ui` | Rendered map and skill relationship interactions with intercepted fixture responses. | Passed in the integrated browser-smoke checkpoint on 2026-10-01. | No claim about live provider/model discovery. Requires Playwright, local Chromium, and built `web/dist`. |
| Assisted planner API skill binding | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_http_api.HTTPAPITests.test_assisted_draft_http_rejects_a_different_installed_skill -v` | Sends `/api/skills/chat.general/draft` a fixture response naming a different installed skill; verifies HTTP 400 and verifies the deterministic draft resolver was not called. The API endpoint binds generated `draft.skill_id` to the skill ID in the request path before resolution. | **Passed 1 test** in the current checkout on 2026-10-01. Fake backend/model only; no inference. | Verified API boundary. `OrchestrationService.resolve_assisted_draft()` independently validates the skill named in its draft; the request-to-draft binding is enforced by `ReadOnlyAPI.draft_skill()`. |
| Assisted planner static UX contract | `cd web && npm run test:assisted-planner-ux` | Node source-contract checks for explicit opt-in, already-loaded-model gate, metadata-grounded goal search, distinct draft/resolved-plan review, stale-plan handling, skill binding before plan resolution, and backend draft bounds. | Passed on 2026-10-01 in this worktree. | Contract/source check only; it does not generate a draft or exercise dynamic approval in a browser. |
| Assisted planner browser smoke | `cd web && npm run test:assisted-planner-ui` | Playwright/Chromium smoke of persisted opt-in, goal and required-input entry, mocked draft and resolved-plan review, Run disabled until explicit approval, exact reviewed `plan_id` binding, one Run request, and 390 px layout. API responses are fixtures; no model load or inference is requested. | Passed in the current work round. | Covers frontend approval wiring only, not model-generated drafts or backend workflow/runtime execution. Requires Playwright, local Chromium, and built `web/dist`. |
| Skills goal grouping browser smoke | `cd web && npm run test:skills-goals-ui` | Fixture-backed browser check of goal grouping/readiness, selected voice choice, and stale image-pin recovery when no compatible image route remains. The UI clears the stale pin rather than leaving selection blocked on an unavailable route; checks include navigation and 390 px catalog/picker layout. | Passed on 2026-10-01. | UI behavior against fixtures only; it does not validate live route inventory or model execution. Requires Playwright, local Chromium, and built `web/dist`. |
| Other frontend contract checks | `cd web && npm run test:rag-capability-contract` (or another `test:*` script listed in `web/package.json`) | Node-based source/UI contract checks; they do not start AI models. | Multiple named contract checks passed in the integrated checkpoint; see `readiness.md` for the specific recorded browser and contract coverage. | Command availability is confirmed by `web/package.json`; each script must be run to claim a fresh pass. Browser smoke scripts need Playwright/browser; pure `check-*.mjs` scripts generally do not launch a browser. |
| Real local TTS artifact smoke | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 tests/smoke_flite_tts.py` | Runs the installed FFmpeg Flite filter on CPU to synthesize a WAV and uses `ffprobe` to verify codec, sample rate and channel count. No model or GPU is used. | Passed in the current audio work: 22,050 Hz mono `pcm_s16le` WAV. | Verified real local TTS/format path. Requires FFmpeg built with `libflite` and `ffprobe`. It does not establish STT, playback UX, voice selection, or end-to-end chat. |
| Real PDF render smoke | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 tests/smoke_document_render.py` | Produces a real multi-page PDF, extracts text, rasterizes every page, and rejects blank or undersized pages. CPU/local tools only; no model or GPU. | Passed in the integrated document-render work: three-page PDF, text extraction and raster checks; visual inspection found readable text/page breaks and table-layout limitations. | Verified on that run. Requires Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) and Pillow. It does not verify PDF presentation inside the application browser. |
| ComfyUI real image generation | No successful host smoke command yet. | Would require a deliberately configured loopback ComfyUI service with a compatible checkpoint/model. Current fake tests verify request construction, bounded upload/output and cancellation only. | No ComfyUI service/model was configured in the host audit recorded in `readiness.md`. | **Cannot validate real generation, editing quality, VRAM use, or Canvas output on this host today.** Do not start or install a model as part of these checks. |
| Speech-to-text / transcription | No successful host smoke command yet. | Would require an installed compatible STT executable/runtime and an already-present local model. | Host audit found no Whisper executable, GGML model, or supported Python STT package. Deterministic fake tests cover contracts only. | **Real STT is unavailable here.** No transcription accuracy, conversation, diarization, or general audio/music understanding claim is supported. |
| Real local LLM or GPU inference | No command in this guide starts it. | Requires an installed compatible model/runtime and explicit authorization to run the workload. Existing backend tests use fakes. | The recorded integration checkpoints did not run real model inference or GPU workloads. | **Not validated.** No model/GPU test should be inferred from unit tests, browser fixtures, TTS, or PDF rendering. |

## Recommended local sequence

Run the deterministic suite first, then typecheck/build and browser checks if the
frontend dependencies and browser are installed. For the full Python suite,
prefer a fresh isolated `XDG_STATE_HOME`; several HTTP/Knowledge tests bind
ephemeral `127.0.0.1` listeners, so the execution environment must permit
loopback socket bind/connect. Run the CPU artifact smokes only when their local
tools are present:

```bash
XDG_STATE_HOME="$(mktemp -d /tmp/ai-dream-test-state.XXXXXX)" python3 -m unittest discover -s tests -q
cd web
npm run typecheck
npm run build
npm run test:assisted-planner-ux
npm run test:assisted-planner-ui
npm run test:knowledge-ui
npm run test:runs-ui
npm run test:capability-map-ui
cd ..
python3 tests/smoke_flite_tts.py
python3 tests/smoke_document_render.py
```

The browser smokes serve the built frontend bundle through Playwright routing
and provide stub API responses; they do not require the AI Dream API server or
local inference. They do require a Playwright installation and a compatible
local browser. The two artifact smokes invoke local CPU utilities and may leave
their WAV/PDF and raster outputs under a temporary directory, which each script
prints on success.

## Interpreting a result

- **Verified** means a result above was recorded for that exact command or
  explicitly named scenario. Check its date/scope before applying it to newer
  edits.
- **Available** means the script/command exists. It is not evidence that it
  passed on the current machine.
- **Unavailable** means a required local executable, package, service, or model
  is absent; a fake test cannot substitute for that missing real-provider
  check.
- Keep fixture coverage, local CPU artifact generation, browser interaction,
  and model-backed inference as separate evidence categories.
