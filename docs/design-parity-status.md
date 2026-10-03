# Design reference to product fidelity

Audit scope: the 13 Units rendered by `design/local-ai-studio/src/App.tsx`, their labels/navigation in the prototype, and their nearest production destinations in Angular (`web/src/app/app.routes.ts`, `app.component.ts`) and the local Python API. This is an architecture and source-contract audit; it is not a rendered-visual or end-to-end action sign-off.

## Architecture boundary

`design/local-ai-studio` is a standalone React/Vite prototype. `App.tsx` keeps the selected Unit, drawer, inspector, and palette in React state; screens are selected conditionally and do not use Angular routes. Its global banner says it has no Angular/backend connection. Production is the Angular router served with the Python loopback API. The prototype is not a production build or backend coverage.

Production has 22 route records: `/` redirects to `/chat`, 20 explicit route patterns, and a wildcard redirect to `/chat`. There are 19 command-palette destinations; `/runs/:id` is the additional detail pattern behind the `/runs` entry. `/runtime` and `/load-model` are distinct URLs that load the same `RuntimePage`. The regular sidebar exposes 6 destinations; the command palette includes 19 navigable entries across WORKSPACE, SYSTEM, DEVELOPER, and SETTINGS. Thus “13/13 navigation entries match” is stale: the design has 13 Units, but product navigation has 19 entries, including six product-only destinations. The design sidebar's four groups are not the current production sidebar taxonomy.

## Readiness snapshot (2026-10-03)

Scores use the same five design/UX dimensions as the previous review. They measure the evidence recorded for this reference and its product mapping; they are not a product completion percentage. A dimension receives 10/10 only when its stated acceptance checks are evidenced.

| Dimension | Previous | Current | Evidence now recorded | Remaining for 10/10 |
|---|---:|---:|---|---|
| Visual direction | 8/10 | **8/10** | Canonical dark workstation palette retained; rendered at 1280×720 and a header overlap found and fixed. All 13 Units now render without document/body horizontal overflow at 390×844, 768×1024, and 1440×900 (39 measurements). | Compare all Units against the supplied Stitch screens and assess visual hierarchy, clipping inside components, and legibility at the three sizes. |
| Information architecture | 9/10 | **9/10** | Atomic inventory maps all 13 reference Units to production destinations and documents six product-only destinations. Navigation smoke passed all 19 destinations, keyboard selection, deep links, and 390px overflow check. | Review hierarchy and visual discoverability at tablet and desktop widths; the 390px run checks the production shell, not the React reference. |
| System consistency | 10/10 | **10/10** | YAML is named as the single color source; all 50 color tokens match the 50 CSS variables; duplicate warning/scrim entries were removed and radii reconciled. | Keep the token inventory synchronized as the system changes. Rendered contrast is tracked under accessibility, not inferred from token consistency. |
| Accessibility and adaptation | 8/10 | **8/10** | Chromium AX checks confirmed clean sampled names, selected states, one-step palette arrow behavior, Tab containment, Enter selection, Escape close and focus restoration. Decorative icon names and a 1280px header overlap were fixed. | Complete Orca/screen-reader coverage, test all Units, validate 390/768/1440px layouts and zoom, and verify rendered contrast/motion states. |
| Product fidelity | 8/10 | **8/10** | The source map distinguishes prototype-only sample actions from Angular/API-backed capabilities and records six production-only destinations. All 13 Units now have a named feature/UI check; the four formerly route-only pages passed a dedicated fixture smoke in this review. | Rerun the other nine checks; compare screenshots/interactions with the reference; verify real-service behavior where safe. |
| **Readiness total** | **8.6/10** | **8.6/10** | Average of the five dimension scores above. All 13 Units have a route/evidence inventory; **0/13** have complete, verified behavioral parity. | The remaining checks above are required before claiming 10/10. |

### Atomic percentages

These percentages keep evidence coverage separate from product completion. The
five design/UX scores above are on a ten-point evidence scale; the atomic counts
below are direct inventory ratios.

| Atomic measure | Result | What the percentage means |
|---|---:|---|
| Design Units mapped to a production route | **13/13 · 100%** | Every reference Unit has a production destination recorded. |
| Units with a named route-specific or feature-specific automated check | **13/13 · 100%** | A check exists for every Unit; this does not mean every check was rerun today. |
| Dedicated page smokes rerun in this review | **4/13 · 31%** | Model Hubs, Local API Server, Tools & Permissions, and Logs & Traces passed fixture-backed state checks. |
| Unit/viewport combinations with no document/body horizontal overflow | **39/39 · 100%** | All 13 reference Units were navigated to and measured at 390×844, 768×1024, and 1440×900. This checks page-level overflow only. |
| Units with screenshot parity sign-off against Stitch | **0/13 · 0%** | The viewport pass did not compare component layout, hierarchy, or visual treatment against reference screenshots. |
| Units with complete, verified behavior parity | **0/13 · 0%** | No Unit has a full sign-off for design-matched interactions and production behavior. |

Unit-specific test evidence and gaps are enumerated separately in [`design/local-ai-studio/UNIT-COVERAGE.md`](../design/local-ai-studio/UNIT-COVERAGE.md). Accessibility evidence and its limits are in [`design/local-ai-studio/ACCESSIBILITY-AUDIT.md`](../design/local-ai-studio/ACCESSIBILITY-AUDIT.md). A 13/13 route mapping is not a 13/13 interaction-parity result.

### Validation run on 2026-10-03

- `design/local-ai-studio`: `npm run lint && npm run build` — passed. Vite emitted a non-blocking `__dirname` config-loader warning.
- `web`: `npm run test:nav-routes` — passed (6 standard sidebar links, 19 command-palette destinations).
- `web`: `npm run test:progressive-navigation` — passed (19 destinations, keyboard selection, deep links, and 390px shell overflow check; API responses were fixtures).
- `web`: `npm run test:downloads-ui` — passed after narrowing an ambiguous `role=alert` assertion to the Downloads error panel; screenshots cover populated, empty, loading, and error/retry states.
- `web`: `npm run typecheck && npm run build` — passed after the production command-palette focus and modal-semantics fix. The bundle-size advisory remains non-blocking.
- `web`: `npm run test:nav-routes` and `npm run test:progressive-navigation` — passed; palette focus, Tab containment, Escape close, and focus restoration were additionally checked with mocked API responses.
- `web`: `npm run test:design-unit-pages` — passed for Model Hubs, Local API Server, Tools & Permissions, and Logs & Traces, including fixture-backed empty/error states. The same run failed under the default sandbox's loopback restriction and passed after the temporary local server was allowed; no backend, model, or external network was used.
- `design/local-ai-studio`: in-browser viewport sweep navigated all 13 Units and measured document/body width at 390×844, 768×1024, and 1440×900 — **39/39 had no horizontal page overflow**. This did not assess internal scroll regions, text zoom, visual parity, contrast, or screen-reader output.
- `git diff --check` — passed.
- No live model inference, GPU load, external hub transfer, or host runtime mutation was performed.

## Atomic Unit inventory

“Live” below means the product page has a production API/service path in source; it does not claim the host operation was exercised during this audit. “Prototype-only” means local presentation state or sample data, never a request to Angular/Python. A prototype interaction can still work locally (navigation, tabs, sliders, copy) while its depicted product operation is simulated or disabled.

| Design Unit | Prototype behavior/data | Production destination and source-backed behavior | Fidelity / unverified boundary |
|---|---|---|---|
| Chat | Local sample transcript, generated token counters, benchmark/runtime figures, artifact and RAG examples. Some view tabs, settings, copy and inspector toggles are local state. Prompt send, generation, loading, sampling controls, attachments and branch/regenerate actions are disabled or preview-only. | `/chat` (`ChatPage`); Python-backed chat/SSE, conversation CRUD, model/profile selection, stop/cancel and optional knowledge retrieval. Source references include `/api/chat`, `/api/chats`, `/api/models`, `/api/model-profiles`, `/api/runtime/status`, `/api/diagnostics`, and run/skill links. | Partial conceptual match. Prototype is not an executable chat. No live inference/stream behavior was verified here. Sample throughput, runtime state, messages and artifacts are not device evidence. |
| Agent | Static entry point and topic cards; prompt and Send are disabled. No agent request or tool call is made. | `/agent` (`AgentPage`); local-model agent request and bounded read-only tools. The UI calls `/api/agent` and reads model/chat APIs; current documented limits are four tool calls and 45 seconds, with read-only inventory. | Partial conceptual match, no interactive prototype coverage. Live agent/model behavior unverified. |
| Models Library | Hard-coded/sample model inventory, placements, scores and statuses; links navigate locally to Chat or placement. No catalog query or model operation. | `/models` (`ModelStudioPage`); production model catalog and model/capability evidence, navigation to Chat and Runtime Manager. | Partial. Prototype inventory and metrics must not be read as host state. Catalog fidelity and each mutating action need browser/API verification to claim behavioral parity. |
| Model Hubs | Example search input and result cards; search/download buttons are disabled. Open Models/Runtime controls only navigate within React. | `/hub` (`HubPage`); local API backed repository search/details/file selection and download initiation. | Partial. No live search/download from prototype; product network/download completion remains a separate runtime behavior, not represented by sample results/progress. |
| Hardware Topology | Sample devices, topology edges, utilization, temperatures and bandwidth. No telemetry request. | `/hardware` (`HardwarePage`) reads `/api/hardware`; displays reported local devices/memory. Current API does not evidence PCIe link width, NUMA, peer routes, bandwidth, or live utilization for all devices. | Partial. Do not imply sample topology/telemetry is available in production. Product must keep unavailable topology explicit rather than infer it. |
| Load Model Placement | Example model/device values and placement outcomes. Any editable controls are prototype state; load/preview outcomes are not executed against a runtime. | `/load-model` (`RuntimePage`); selects model/runtime and supported placement/load settings. `/runtime` loads the same component. The backend has runtime load/unload/status/command operations. | Partial. The two routes do not constitute two product screens. Actual load, fit, and memory behavior require safe host verification; no real model load is evidenced by this documentation audit. |
| Providers & Runtimes | Static unavailable/example states and disabled preview controls; no runtime discovery or registration. | `/runtime` (`RuntimePage`); runtime registry/probe and capability-aware controls; load/unload/preview paths through local APIs. | Partial. Prototype does not show a live runtime inventory or enact actions. OS package installation is not implied by runtime registration. Runtime discovery/action success must be based on actual host results. |
| Local API Server | Example address, health and endpoint copy. Refresh is disabled; the code snippet is explanatory, not executed. | `/local-api` (`LocalApiPage`); checks configured loopback base URL with `/api/health` and presents API contract information. | Partial. A health check does not prove each listed endpoint works; no server start/stop, external exposure, or OpenAI-compatible `/v1` serving is implied by this screen. |
| Knowledge / Local Search | Example corpus/results; search produces synthetic sample content and upload is not wired to the service. | `/knowledge` (`KnowledgePage`); add/list/delete local documents and lexical search via `/api/knowledge/documents` and `/api/knowledge/search`. SQLite FTS5; bounded text/TXT/Markdown/text-PDF inputs, no embeddings or OCR. | Partial. Core concept maps, but prototype's result is fabricated. API-backed add/search/delete and chat opt-in retrieval were not exercised in this audit. |
| Tools & Permissions | Example tool inventory/limits; refresh and permission controls are disabled or absent. | `/tools-permissions` (`ToolsPermissionsPage`); reads `/api/agent/tools` contract, schemas, policies and limits. Tools are constrained/read-only; this page does not grant arbitrary shell, write, or network tools. | Partial. Inventory and limits in the prototype are not live. Read-only policy display is not a permission editor. |
| Downloads | Sample transfers/progress/completion. Controls are not connected to production jobs. | `/downloads` (`DownloadsPage`); local transfer queue/status and supported cancel action. | Partial. Sample percentages and completion do not evidence real transfers. Real external transfer and cancellation behavior require a transfer-level check. |
| Logs & Traces | Example logs, events and traces; no process/API subscription. | `/logs` (`LogsPage`); bounded `/api/logs` runtime output and `/api/diagnostics` application events, with unavailable/unsupported states where no capturable source exists. | Partial. The concept maps; prototype traces are not live. Structured traces are not equivalent to raw logs and must not be claimed unless supplied by a real source. |
| Settings | Example preferences and connection state; edits stay in React state and do not persist to product settings. | `/settings` (`SettingsPage`); browser-side loopback API base URL/health plus app/runtime/model preferences backed by product settings APIs. | Partial. Prototype values are not loaded from the installation and are not persisted to it. Save/reset round trips and effective settings require browser/API verification. |

No Unit earns full product-behavior parity merely because a similarly named Angular route exists. Current result is **0/13 Units verified at 100% product parity**; all 13 have a conceptual destination, while their prototypes remain disconnected design references. This is a per-Unit coverage count, not a claim that product functionality is incomplete or complete.

## Product destinations absent from the prototype

These six distinct navigation destinations have no dedicated design Unit: `/capability-map`, `/setup-assistant`, `/skills`, `/runs` (including `/runs/:id`), `/canvas`, and `/resources`. They represent product capabilities and operational workflows; the Chat prototype's code canvas does not cover the production `/canvas` route. They must be added to a future parity/design scope or explicitly kept outside this prototype's scope. The common wildcard and root redirect are routing behavior, not additional Units.

## Prototype-only versus product-backed action ledger

| Area | React prototype | Production evidence boundary |
|---|---|---|
| Navigation, palette, drawer, tabs, inspector, local sliders/inputs, copy | Some controls change local React state or clipboard; route selection only changes `activeScreen`. | These actions do not call Angular or persist product preferences. Production navigation is router-based and has its own sidebar/palette. |
| Chat / Agent generation | Chat simulates generation counters and sample content; agent prompt/send disabled. | Production Chat and Agent use loopback APIs; no live generation is proven by this static source mapping. |
| Catalog, hub, runtime, hardware | Lists/status/telemetry are illustrative; search/action buttons are disabled or local navigation. | Product has backend-backed pages/actions, subject to actual runtime capabilities, data availability and host verification. |
| Knowledge | Synthetic search match; upload is not connected. | Product document/search APIs exist; lexical FTS5 behavior and input limits apply. |
| Tools / local API / logs | Explanatory sample contract/events; no endpoint probing or runtime log subscription. | Product calls its local API for tool contract, health, bounded logs and diagnostics. Health is not a per-route probe. |
| Downloads / settings | Sample progress/preferences; no production transfer or settings persistence. | Product exposes transfer queue/cancel and app settings flows; real completion/save behavior needs interactive verification. |

## Evidence, naming, and completion criteria

- Canonical sources inspected: `design/local-ai-studio/src/App.tsx`, `src/types.ts`, `src/components/Sidebar.tsx`, each `src/components/screens/*.tsx`; `web/src/app/app.routes.ts`, `app.component.ts`, and the corresponding `web/src/app/pages/*.page.ts`; Python-backed endpoint contracts are exposed through those Angular service/page calls and `aidream/http_api.py`.
- Naming mismatch to preserve explicitly: prototype “Models Library,” “Model Hubs,” “Hardware Topology,” “Load Model Placement,” “Providers & Runtimes,” “Local API Server,” and “Knowledge / Local Search” map to production labels “Models,” “Model Hubs,” “Hardware,” “Load Model (Placement),” “Runtime Manager,” “Local API,” and “Knowledge (RAG).” Prototype “Agent” is a design-only entry point. Production sidebar labels are reduced to Chat, Models, Create / Skills, Knowledge (RAG), Downloads, and Settings; remaining production destinations are discoverable through the command palette/advanced navigation. Product routes remain directly addressable.
- Current product implementation, route parity, visual fidelity, interactive parity, and host verification are separate claims. This audit establishes source-level route/capability correspondence only. It does not establish screenshot parity, accessibility, responsive completeness, or successful API actions.
- To raise a Unit above Partial, record a concrete production screen/action, exact route and API, expected state transition, observed browser result, and any unsupported/degraded state. For full readiness, separately record rendered comparisons at agreed viewport sizes, keyboard/focus and screen-reader results, and successful or accurately degraded product behavior. Do not count sample data as evidence and do not use a global 100% score without completed evidence for each scoped Unit and product-only destination decision.
