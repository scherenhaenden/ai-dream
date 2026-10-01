# Operational testing guide: what this host can verify today

This guide distinguishes recorded results from commands that are available to
run and from behavior that cannot be validated on this host. A passing fake or
contract test proves the exercised boundary only; it does not prove a real
model, provider, or end-user service is installed.

## Readiness matrix

| Area | Command available | What the check establishes | Latest recorded result | State / limit |
|---|---|---|---|---|
| Python backend regression suite | `python3 -m unittest discover -s tests -q` | Deterministic unit and integration behavior using fixtures/fakes where configured. The suite itself does not start model inference. | **552 passed** in the integrated checkpoint recorded in `readiness.md` on 2026-10-01. | Verified at that checkpoint; not rerun for this guide. The count is a historical result, not a claim about a fresh checkout or subsequent edits. |
| Skills API, including run readiness | `PYTHONPYCACHEPREFIX=/tmp/ai-dream-pycache python3 -m unittest tests.test_skill_api -q` | Skill catalog readiness and the API refusal path for a skill whose required capability is unavailable. The tests use a deterministic API fixture. | **20 passed** in the current work round. | Verified. Does not prove a real STT provider exists. |
| Other focused Python tests | `python3 -m unittest tests.test_voice tests.test_voice_orchestration tests.test_capability_api tests.test_document_skill_api -q` | Provider detection/callback contracts, capability API serialization, and document-skill integration under their test fixtures. | A combined focused run passed **41 tests** during the current audio work. | Verified as a previous focused run; fake tests are deterministic and do not establish transcription or neural audio understanding. |
| Angular typecheck | `cd web && npm run typecheck` | TypeScript static checking (`tsc --noEmit`). | Passed in the separate Phase 15 agent report. A later, separate attempt in this checkout failed before checking source because `tsc` was not found. | **Dependency/worktree dependent:** `web/node_modules` is absent in this checkout, so the local attempt is unavailable. The reported Phase 15 pass belongs to the agent environment and is not a fresh pass here. |
| Production frontend build | `cd web && npm run build` | Vite production bundle generation. | Passed in the separate Phase 15 agent report; earlier integrated checkpoint also passed with the bundle above the existing 500 KB advisory threshold. | Command exists, but `web/node_modules` is absent in this checkout. The latest reported pass is not independently reproducible here until dependencies are available. |
| Knowledge browser smoke | `cd web && npm run test:knowledge-ui` | Headless Chromium checks load error/retry, an empty index, no-match/matched lexical search, and 360 px horizontal overflow. API responses are intercepted and stubbed. | Passed in the integrated browser-smoke checkpoint on 2026-10-01. | Verified as UI behavior against fixtures only; it does not contact or validate a live Knowledge/RAG backend. Requires Playwright, a local Chromium-compatible browser, and a built `web/dist`. |
| Runs browser smoke | `cd web && npm run test:runs-ui` | Headless Chromium checks run recovery/durability notices, chat association, typed output, owner-scoped HTML preview retry, download action, and narrow layout. API responses are stubbed. | Passed in the integrated browser-smoke checkpoint on 2026-10-01. | Verified UI contract only, not live backend persistence/restart behavior. Requires Playwright, local Chromium, and built `web/dist`. |
| Capability Map browser smoke | `cd web && npm run test:capability-map-ui` | Rendered map and skill relationship interactions with intercepted fixture responses. | Passed in the integrated browser-smoke checkpoint on 2026-10-01. | No claim about live provider/model discovery. Requires Playwright, local Chromium, and built `web/dist`. |
| Assisted planner static UX contract | `cd web && npm run test:assisted-planner-ux` | Node source-contract checks for explicit opt-in, already-loaded-model gate, metadata-grounded goal search, distinct draft/resolved-plan review, stale-plan handling, and backend draft bounds. | Passed in the separate Phase 15 agent report. | Reported contract check only; it does not generate a draft or exercise dynamic approval in a browser. It does **not** verify the API enforces `draft.skill_id == skill_id` requested by the caller: the reviewer found the validator can resolve another installed skill. That binding contract remains unverified. |
| Assisted planner browser smoke | `cd web && npm run test:assisted-planner-ui` | Playwright/Chromium smoke of metadata-based skill-goal search, disabled-by-default global opt-in, loaded-model status, and 390 px horizontal layout. API responses are fixtures; it verifies no model load or run request is issued. | Passed in the separate Phase 15 agent report. | The fixture lacks the controls needed to complete the actual generated-draft/resolved-plan approval flow, so dynamic approval remains **unverified by this smoke**. Requires Playwright, local Chromium, and built `web/dist`. |
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
