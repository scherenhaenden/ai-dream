# AI Dream Angular frontend

This directory contains the local browser interface. It is an Angular 20 standalone application bundled with Vite and the Analog Angular plugin. It talks to AI Dream's Python loopback API; the browser does not load GGUF files or run inference itself.

## Start

From the repository root, build and launch the app and API together:

```sh
npm --prefix web ci
npm --prefix web run build
./open-ai-dream-web
```

`./open-ai-dream-web --port 8780` selects another loopback port. The server opens the browser and serves `web/dist` plus `/api/*` from the same origin. The root `AI Dream.desktop` launcher runs the same command. If the bundle is missing, the launcher reports that the web build is required.

For frontend development, start the API and Vite in separate terminals:

```sh
python3 -m aidream serve --port 8765
cd web && npm ci && npm run start
```

Open <http://127.0.0.1:5173>. Vite listens on loopback only. Its browser client defaults to `http://127.0.0.1:8765`; Settings accepts another explicit loopback port. Use `npm run typecheck` for strict TypeScript checking and `npm run build` to produce `web/dist`.

## What the browser offers

- Chat: choose a catalogued model, create/select/rename/delete conversations, stream a response, stop a turn, retry a failed draft, copy response text, and export the visible transcript as Markdown.
- Agent: run bounded read-only hardware, model and runtime queries through a compatible local model; see status and the saved tool audit.
- Model Hub and Downloads: search public Hugging Face GGUF repositories, inspect GGUF files, start transfers, follow live progress, cancel, and restore the backend's current transfer list when the screen reopens.
- Hardware, Models and Runtime: show API snapshots as JSON. These are diagnostic views, not full management editors.
- Settings: configure the local API base URL and check connectivity.

The web chat currently sends text only. Attachments, voice, presets, per-chat parameter editing and response regeneration are not exposed here. Some of these capabilities are available in the Python desktop interface. See [the frontend guide](../docs/angular-frontend.md) for architecture, data flow, route-by-route behavior, limitations, and accessibility notes. See [the local API contract](../docs/local-http-api.md) for endpoints and security rules.
