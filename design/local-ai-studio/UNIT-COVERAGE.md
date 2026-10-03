# Design Unit coverage

This inventory covers only the 13 screen Units in the React/Vite design
reference. It maps each Unit to the production Angular route and records the
closest checked-in UI/API contract. A route or source-contract check is not
proof of full interaction parity. Fixture-backed browser checks do not verify
real hardware, network services, downloads, or model inference.

| Design Unit | Production route | Closest automated evidence | Coverage and remaining gap |
|---|---|---|---|
| Chat | `/chat` | `test:chat-agent-ui`, `test:chat-orchestration-ui`, `test:chat-attachment-handoff`, `test:chat-document-suggestion-ui`, `test:voice-transcript-handoff` | Partial: composer, thread, attachment and handoff contracts are covered with fixtures; real generation and runtime telemetry are not exercised. |
| Agent | `/agent` | `test:chat-agent-ui`, `test:chat-orchestration-ui` | Partial: page structure and bounded tool/orchestration contracts are checked; no live model or hardware tool call is made. |
| Models Library | `/models` | `test:model-studio-ui`, `test:models-config`, `test:model-manifest-verification` | Partial: model selection, configuration, and manifest contracts use fixtures; no actual model load is performed. |
| Model Hubs | `/hub` | `test:design-unit-pages` | Fixture UI check: search, inspect repository files, and no-results state. Real hub search and transfer completion remain unverified. |
| Hardware Topology | `/hardware` | `test:hardware-settings-ui`, `test:resource-dashboard` | Partial: browser checks use fixture hardware; host inventory, PCIe topology, and live utilization are not verified here. |
| Load Model Placement | `/load-model` | `test:runtime-layout`, `test:model-studio-ui`, `test:progressive-navigation` | Partial: placement controls and route are checked; loading a model or measuring memory fit is not exercised. |
| Runtime Manager | `/runtime` | `test:runtime-layout`, `test:setup-assistant`, `test:progressive-navigation` | Partial: layout and capability-gated controls are checked; probing or modifying an installed runtime and actual load/unload remain unverified. |
| Local API Server | `/local-api` | `test:design-unit-pages` | Fixture UI check: connected endpoint list and unavailable/503 state. No per-endpoint real service verification is recorded. |
| Knowledge / Local Search | `/knowledge` | `test:knowledge-ui`, `test:rag-capability-contract` | Partial: browser fixture states and API contracts are covered; a fresh end-to-end add/search/delete against the running local service is not established by these checks. |
| Tools & Permissions | `/tools-permissions` | `test:design-unit-pages`, `test:skill-permissions-ux` | Fixture UI check: registry, limits, blocked policies, and registry error state. This does not exercise tool execution. |
| Downloads | `/downloads` | `test:downloads-ui` (`web/scripts/check-downloads-ui.mjs`) | Partial: the UI script covers fixture API states; a real transfer and cancel behavior against the host are not verified. |
| Logs & Traces | `/logs` | `test:design-unit-pages`, `test:shell-telemetry` | Fixture UI check: runtime output filtering, application incident filtering, empty runtime logs, and no matching incidents. Real runtime log capture remains unverified. |
| Settings | `/settings` | `test:settings-information-architecture`, `test:hardware-settings-ui`, `test:interface-visibility` | Partial: information architecture, fixture-backed controls, and visibility modes are checked; live persistence across an actual service restart is not established. |

## Coverage totals

- **13/13 Units (100%)** have a production route and at least one related
  checked-in automated check. This is route/evidence mapping, not 100% behavior
  coverage.
- **13/13 Units (100%)** now have a named route-specific or feature-specific
  UI/API check:
  Chat, Agent, Models Library, Hardware Topology, Load Model Placement, Runtime
  Manager, Knowledge / Local Search, Downloads, Settings, Model Hubs, Local API
  Server, Tools & Permissions, and Logs & Traces. The four formerly navigation-
  only Units now have a dedicated fixture-backed browser smoke.
- The new `test:design-unit-pages` passed for its four routes in the 2026-10-03
  review. It exercises success and empty/unavailable/error states using fixtures,
  and fails on unexpected API requests or browser errors.
- The in-browser responsive pass navigated all 13 Units at 390×844, 768×1024,
  and 1440×900. **39/39 Unit/viewport combinations (100%)** had equal document,
  body, and viewport widths, so no page-level horizontal overflow was observed.
  Internal scroll regions, screenshot parity, and text legibility were not
  signed off by this width-only measurement.
- **4/13 Units (31%)** had their dedicated route smoke rerun during this review;
  evidence for the other nine checks is available in the package but those nine
  were not rerun here.
- The progressive-navigation smoke covers discoverability and route changes;
  it does not substitute for page behavior checks.
- No percentage of source-code line or branch coverage is claimed: the frontend
  package does not currently record a coverage report for these Units.

## Checks run for this snapshot

- Reference app: `npm run lint && npm run build` — passed.
- Production navigation: `npm run test:nav-routes` — passed, confirming six
  standard sidebar entries and 19 command-palette destinations.
- Production browser smoke: `npm run test:progressive-navigation` — passed for
  all 19 destinations, keyboard selection, deep links, and a 390px shell-width
  check. API responses were fixture data.
- Downloads UI: `npm run test:downloads-ui` — passed with fixture responses for
  populated, empty, loading, and error/retry states.
- The named checks in the other nine rows were not all rerun for this snapshot.
  See the readiness report for the exact boundary.

The automated-check inventory is now 13/13 Units (100%), but that is not full
behavioral readiness: **0/13 Units (0%)** have complete, verified behavioral
parity with the design reference. Screenshot parity, screen-reader coverage,
and real-service behavior remain separate acceptance items. Real model
inference and GPU loads are outside this fixture-based Unit audit.
