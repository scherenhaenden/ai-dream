# Angular frontend: architecture and behavior

This guide describes the browser client in `web/` as implemented. The Python API owns model discovery, chat storage, inference, agent tools and downloads. The Angular application displays and edits that state through loopback HTTP. For API request/response details and server safeguards, read [local-http-api.md](local-http-api.md).

## Entry points and build

`web/index.html` mounts `<ai-root>`. `web/src/main.ts` imports `zone.js` and global CSS, then bootstraps standalone `AppComponent` with Angular Router and HttpClient. `web/vite.config.ts` uses `@analogjs/vite-plugin-angular`, targets ES2022 and splits CSS. TypeScript enables strict type and template checks in `web/tsconfig.json`.

The npm scripts in `web/package.json` are `start` (Vite on `127.0.0.1:5173`), `typecheck` (`tsc --noEmit`) and `build` (Vite output to `web/dist`). There is no Angular CLI workspace or component library. Use `npm ci` from `web/` to install the lockfile's dependencies.

For local development, run the Python API on port 8765 (`python3 -m aidream serve --port 8765`) and `npm run start` in `web/`. The API permits the exact development origin `http://127.0.0.1:5173`. A production build is served together with the API via `./open-ai-dream-web` or `python3 -m aidream web --port 8765`; the Python server serves `web/dist/index.html` for client routes and static assets from that bundle. It binds to loopback, and a missing production bundle produces an error. The root `AI Dream.desktop` starts this browser flow. Additional details are in [web/README.md](../web/README.md).

## File map and navigation

| File | Responsibility |
| --- | --- |
| `src/app/app.component.ts` | Sidebar, connection indicators, mobile navigation, route title and Ctrl/⌘+K page palette. |
| `src/app/app.routes.ts` | Lazy standalone routes; `/` and unknown routes redirect to `/chat`. |
| `src/app/core/api.service.ts` | API base URL, health state, HttpClient helpers and 30-second one-shot requests. |
| `src/app/core/hub.service.ts` | Hub requests, download list state, progress EventSource subscriptions and cancellation. |
| `src/app/pages/chat.page.ts` | Conversation list, transcript, text composer and chat SSE stream. |
| `src/app/pages/agent.page.ts` | Read-only agent conversations, SSE status/answer/audit and stop. |
| `src/app/pages/hub.page.ts`, `downloads.page.ts` | Public GGUF search/file picker and transfer progress. |
| `src/app/pages/page-shell.ts` | Common snapshot viewer for Hardware, Models and Runtime. |
| `src/app/pages/settings.page.ts` | API address editor and health feedback. |
| `src/styles.css` | Theme tokens, layout, responsive styles and shared page styles. Agent also has component-local CSS. |

Each route uses a dynamic `loadComponent()` import, so the page's code is loaded when visited. Navigation is grouped into Workspace (Chat, Agent), Library (Models, Model Hub), System (Hardware, Runtime, Downloads) and Preferences (Settings). The shell shows the last health result; the sidebar refresh button calls `/api/health`. The page palette filters route names; Enter opens its first result, Escape closes it. The palette's displayed ↑/↓ hints do not currently have corresponding selection logic.

## API address, state and persistence

`ApiService` stores an explicit base URL in browser `localStorage` under `aidream.apiBase`. It accepts only `http://127.0.0.1:<port>` or `http://localhost:<port>` with a valid port. In Vite development the default is `http://127.0.0.1:8765`; for a loopback production page the default is the page's own origin. Changing the URL immediately runs `GET /api/health` with a two-second timeout. The shared `connection` signal is `checking`, `connected` or `unavailable`; it reflects the last check and is not a continuous monitor.

`ApiService.get/post/patch/delete` return HttpClient observables. `request()` performs one GET or POST with a 30-second timeout, used for Hub/download actions. Chat and Agent use `fetch()` directly for incremental SSE; downloads use `EventSource` for server-sent progress. Most page state is held in Angular signals and disappears when the browser page is reloaded. Chat records and downloads are owned by the backend, not localStorage.

The Python API wraps successful JSON in `{ "data": ... }`. Chat, Hub and the snapshot shell unwrap it, with some tolerance for raw responses. Agent expects the enveloped API shape. The browser cannot choose an arbitrary model path: it sends an ID from `GET /api/models`. The server accepts only loopback Host values and specific Origins for mutations. In production the static app and API share one origin; in development the allowed Vite origin makes cross-origin requests possible.

## Route behavior

### Chat (`/chat`)

On entry, Chat checks health, loads `GET /api/models` and `GET /api/chats`, selects an available conversation and fetches its messages with `GET /api/chats/<id>`. A monotonically increasing selection counter discards late transcript responses after the user changes chats. Models are displayed using the filename from their path when present; the first catalogued model is selected initially. The browser does not currently read or set per-chat saved model/settings state, despite the composer hint suggesting the model ID is stored with the conversation by the backend.

The toolbar creates a chat (`POST /api/chats`), renames it (`PATCH /api/chats/<id>`), deletes its saved record (`DELETE /api/chats/<id>`) after a browser confirmation, and exports the currently displayed text as a downloaded `.md` file. Rename accepts 1–120 trimmed characters. Delete does not delete source files referenced by that chat. The transcript renders text with preserved whitespace; it does not render Markdown. Assistant responses can be copied via the browser clipboard API.

Enter sends the composer text and Shift+Enter inserts a newline. A valid chat, model, connected API and nonempty prompt are required. `POST /api/chat` sends `{chat_id, model_id, prompt}` and requests `text/event-stream`. Chat parses SSE frames by blank lines: `delta` appends text; `complete` marks a finished turn and may provide final assistant text; `error` fails the turn. It temporarily shows the user's prompt and the streaming answer, then reloads the authoritative saved transcript. If that refresh fails, it keeps a local fallback pair from the completed stream. Stop aborts the request. On cancellation, stream error or premature end, Chat restores the draft and previous visible messages and offers a Retry message action. The backend discards incomplete turns. While a request or chat mutation is active, controls are disabled.

The web composer is text-only. It does not expose attachment selection, voice, per-chat load or generation parameters, presets, a system prompt, reasoning toggles or response regeneration. Export contains the visible text and title, not the backend's full attachment metadata or hidden audit records.

### Agent (`/agent`)

Agent loads model and chat lists from the same API and uses saved chat records. It can create an `Agent session`, select an existing chat and load its transcript plus the latest `agent_audits` entry. It sends `{chat_id, model_id, prompt}` to `POST /api/agent` and parses `status`, `complete` and `error` SSE events. The screen shows tool names, status, duration and bounded result snippets from the returned audit. Stop aborts the stream and rolls back the optimistic user turn in the current view. It does not currently restore the canceled agent prompt to the composer.

The backend limits a turn to four registered read-only calls and 45 seconds. Available queries cover hardware, local model catalog and runtime status. A suitable local model/runtime must support tool calling. There is no browser UI for installing software, running shell commands, writing files or starting downloads from agent tools. See [local-http-api.md](local-http-api.md) for the server contract.

### Model Hub (`/hub`) and Downloads (`/downloads`)

Hub sends the entered query to `GET /api/hub/search?q=...&limit=30`, displays public Hugging Face GGUF repositories and requests a selected repository's GGUF files through `GET /api/hub/repos/<encoded-id>/files`. Pressing Download calls `POST /api/downloads` with repository ID and filename. The Python service controls destination, validation, queueing and catalog registration; the browser only selects a listed public file.

`HubService` is a singleton with a signal for the download list. It reads `GET /api/downloads` when created and when the Downloads page opens, normalizes the backend state and starts one `EventSource` per active job at `/api/downloads/<id>/events`. Progress events update bytes, optional total/progress and state; terminal events close the stream. The Downloads page displays progress and calls `POST /api/downloads/<id>/cancel`. Reloading the browser reconstructs the list from the backend's current in-memory jobs and reconnects to active streams. This browser state is not a permanent download history after a backend restart; the downloader's resumable file behavior is separately described by the backend documentation.

### Hardware, Models and Runtime (`/hardware`, `/models`, `/runtime`)

These routes wrap `PageShell`, which loads `/api/hardware`, `/api/models` or `/api/runtime` when the route initializes while connected. It shows the returned JSON and a manual Load/Retry button. These pages are diagnostic snapshots. The Models page does not add folders or delete model files, and Runtime does not install/select backends or edit placement from this Angular screen. Chat and Agent have their own model selectors.

### Settings (`/settings`)

The one Settings card accepts the loopback API URL, stores it in browser localStorage and checks health. It is not the chat or runtime parameter editor.

## Styling, accessibility and performance

The global stylesheet defines a dark palette with CSS variables, a fixed sidebar and content area, breakpoint layouts at 800/700/540 px, and `prefers-reduced-motion` handling. Agent has its own responsive styles. UI uses system fonts and text symbols; there is no external font, icon library or UI framework. Most components use `ChangeDetectionStrategy.OnPush` and signals. This keeps dependencies and network assets small, while route imports keep secondary pages out of the initial load.

The UI provides visible labels or screen-reader labels for most form controls, live status/error regions in Chat/Agent/Hub, a progressbar for downloads, and keyboard support for chat Enter/Shift+Enter, page palette Ctrl/⌘+K and Escape. Known accessibility gaps: the palette advertises arrow navigation but only its first result is actionable by Enter, and it has no dialog focus trap or dialog role. Some icon-only buttons rely on a title or glyph without an accessible name; `textarea` and `select` focus styles are less explicit than buttons/links/inputs. The transcript and downloads are not virtualized, so very long lists can increase DOM and memory use. The shell displays a last-known health check, so a connection badge can lag behind an API failure until the next check.

## Where to extend behavior

Add a route in `app.routes.ts` and a navigation item in `AppComponent.NAV`. Put ordinary JSON request coordination in `ApiService` or a focused service such as `HubService`; use a stream reader for incremental POST SSE, and close/abort active streams on cancellation. Keep server-owned chat and transfer state authoritative after completion or reload. Update [local-http-api.md](local-http-api.md) when changing API payloads, and update this guide when a route gains an editor rather than a snapshot view.
