# AI Dream Angular Console

A compact Angular standalone front-end based on the supplied Local AI Studio visual direction. Uses Vite with the Analog Angular plugin, lazy standalone route components, strict TypeScript, and no UI framework or icon package.

## Run

```sh
npm install
npm run start
```

Open <http://127.0.0.1:5173>. For a production bundle, run `npm run build`.

## Local API

The browser checks `GET http://127.0.0.1:8765/api/health`. Change the base URL in Settings (only `http://127.0.0.1:<port>` and `http://localhost:<port>` are accepted; port must be 1–65535). Hardware, Models, and Runtime request `GET /api/hardware`, `/api/models`, and `/api/runtime`. Chat loads sessions from `GET /api/chats`, creates them with `POST /api/chats`, and reads `GET /api/chats/:id`. It sends `{chat_id, model_id, prompt}` to `POST /api/chat` and parses SSE `delta`, `complete`, and `error` events; Stop aborts the stream. Interrupted turns are discarded by the backend and the prompt is restored in the composer. GET responses may be raw JSON or `{ "data": ... }`; both are accepted. Hub and Downloads are not wired to backend actions yet. Screens do not invent model, device, download, or runtime data.

## Performance and dependencies

Standalone routes load on demand; Angular change detection uses OnPush, and the app uses signals for local connection and palette state. System fonts avoid network requests. CSS is native. Vite serves locally on loopback.
