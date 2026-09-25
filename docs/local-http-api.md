# Local JSON API

Start the optional API alongside the existing desktop/CLI workflows:

```sh
app serve
# or choose a local port
app serve --port 8765
```

The server always binds to `127.0.0.1`; there is no option to expose it to a
LAN interface. Snapshot and history routes are GET/HEAD. The only write routes
create a local chat and submit a prompt to a catalog-selected local model. There
is no install, arbitrary file read, caller-selected model path, or arbitrary
filesystem action endpoint. Chat generation keeps one local backend/model loaded and
reuses it for consecutive turns in the same chat; switching chat or model
restores bounded history and reloads. Server shutdown unloads the model.
Successful JSON responses use a `{ "data": ... }` envelope. Errors use a short
`{ "error": ... }` body.

- `GET /api/health` → `data.status`, `data.service`
- `GET /api/hardware` → `data.hardware` (the existing hardware snapshot)
- `GET /api/models` → `data.models` (up to 1,000 local `ModelRecord` objects)
- `GET /api/runtime` → `data.backends` (name, availability, and advertised capability fields)
- `GET /api/chats` → `data.chats` (id, title and timestamps only)
- `GET /api/chats/<32-hex-id>` → `data.chat` (transcript roles, text and timestamps; excludes settings and attachment paths)
- `POST /api/chats` with optional `{"title":"..."}` → creates one local session and returns `data.chat`
- `POST /api/chat` with `{"chat_id":"...","model_id":"...","prompt":"..."}` → SSE `delta` events (`{"text":"..."}`), then `complete` (`chat_id`, saved `assistant` text, and `session_id`). Model IDs must match the local catalog; callers cannot provide paths.

Requests must send a Host header for `127.0.0.1:<port>` or
`localhost:<port>`. Other Host values are rejected. Chat creation and
submission require an exact allowed `Origin`: the
Angular development origin `http://127.0.0.1:5173` or same-origin production;
no credentials are allowed. Other mutating HTTP methods return 405 without
consuming request bodies.
The server caps JSON responses at 4 MiB and POST bodies at 32 KiB, bounds chat
history and transcript sizes, permits one model generation at a time, and
cancels generation when the SSE client disconnects. Snapshot service calls have
a six-second deadline. Responses are not cached. Model paths are returned for
local model identity; paths in existing saved attachments are revalidated by
the local runtime before reading and are never returned in browser transcripts.
