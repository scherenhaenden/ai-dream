# Local AI Studio — visual prototype

This React/Vite application is a **visual and interaction prototype** for Local AI Studio. It helps review a possible workstation layout and screen vocabulary. It is not the production application, and its screens do not establish that the corresponding product features are implemented.

The production application is the Angular app in [`web/`](../../web/). Its routes and behavior are the source of truth. This prototype currently has no connection to that app's API or runtime services.

## Prototype screens and production routes

| Prototype screen | Closest production route | Parity |
| --- | --- | --- |
| Chat | `/chat` | Visual reference only; prototype conversation and model state are local UI state. |
| Models Library | `/models` | Visual reference only; prototype catalog/actions are not backed by the production model catalog. |
| Model Hubs | `/hub` | Visual reference only; no verified provider or download operation is performed. |
| Hardware Topology | `/hardware` | Visual reference only; displayed hardware/usage values are not live system readings. |
| Load Model / Placement | `/load-model` | Visual reference only; its deploy action does not start a runtime. |
| Providers & Runtimes | `/runtime` | Partial conceptual reference; production runtime management behavior is not wired to this screen. |
| Local API Server | `/local-api` | Visual reference only; it does not start or inspect the production local API. |
| Knowledge / RAG | `/knowledge` | Visual reference only; no production knowledge index is queried or changed. |
| Tools & Security | `/tools-permissions` | Visual reference only; it does not change production permissions. |
| Downloads | `/downloads` | Visual reference only; no download is initiated. |
| Logs & Traces | `/logs` | Visual reference only; shown log/trace content is not a production log stream. |
| Settings | `/settings` | Visual reference only; settings are not persisted to the production app. |

There is **no Agent screen** in this prototype, while production has `/agent`. Production also exposes runtime management through `/runtime`; it has no separate Profiles route, and this prototype does not implement a profile-management flow. Production route definitions are in [`web/src/app/app.routes.ts`](../../web/src/app/app.routes.ts).

## Prototype-only behavior

Treat displayed values and success messages as illustrative. In particular, the prototype generates GPU and RAM percentages with a timer, uses hard-coded model/runtime examples, and keeps navigation and selections in browser memory. Load/deploy controls show local success notifications rather than loading a model or allocating hardware. Other screen actions and data are presentation scaffolding; they do not call the Angular control plane. Do not use this prototype to infer actual hardware status, service health, persistence, permission enforcement, or completed product capability.

## Run locally

Prerequisite: Node.js with npm.

From this directory:

```sh
npm install
npm run dev
```

Vite prints the local development URL (the configured port is `3000`). To create a production bundle or preview that bundle:

```sh
npm run build
npm run preview
```

`npm run lint` runs TypeScript's no-emit check. The npm scripts are defined in [`package.json`](./package.json). No API key or cloud service is required to run this visual prototype.
