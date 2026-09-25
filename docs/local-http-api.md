# Local JSON API

Start the local API alongside the desktop/CLI workflows:

```sh
app serve
# or choose a local port
app serve --port 8765
```

The server always binds to `127.0.0.1`; there is no option to expose it to a
LAN interface. Snapshot and history routes are GET/HEAD. The only write routes
create a local chat and submit a prompt to a catalog-selected local model. There
is no install, arbitrary file read, caller-selected model path, or arbitrary
filesystem action endpoint. Agent mode exposes only its existing fixed
read-only hardware, model-catalog, and runtime-status tools. Chat generation
keeps one local backend/model loaded and reuses it for consecutive turns in the
same chat; switching chat or model restores bounded history and reloads. Server
shutdown unloads the model.
Successful JSON responses use a `{ "data": ... }` envelope. Errors use a short
`{ "error": ... }` body.

- `GET /api/health` → `data.status`, `data.service`
- `GET /api/hardware` → `data.hardware` (the existing hardware snapshot)
- `GET /api/models` → `data.models` (up to 1,000 local `ModelRecord` objects)
- `GET /api/runtime` → `data.backends` (name, availability, and advertised capability fields)
- `GET /api/chats` → `data.chats` (id, title and timestamps only)
- `GET /api/chats/<32-hex-id>` → `data.chat` (transcript roles, text and timestamps; excludes settings and attachment paths)
- `GET /api/hub/search?q=<text>&limit=<1-100>` → `data.items` with public Hugging Face GGUF repository metadata
- `GET /api/hub/repos/<percent-encoded-owner%2Frepo>/files?revision=main` → validated GGUF filenames and public repository details
- `GET /api/downloads` → current in-memory downloads with status and received/total byte counts
- `POST /api/chats` with optional `{"title":"..."}` → creates one local session and returns `data.chat`
- `PATCH /api/chats/<32-hex-id>` with `{"title":"..."}` → renames a local session; title must contain 1–120 characters
- `DELETE /api/chats/<32-hex-id>` → deletes only the saved chat record; referenced attachment files remain untouched
- `POST /api/chat` with `{"chat_id":"...","model_id":"...","prompt":"..."}` → SSE `delta` events (`{"text":"..."}`), then `complete` (`chat_id`, saved `assistant` text, and `session_id`). Model IDs must match the local catalog; callers cannot provide paths.
- `POST /api/agent` with the same body → SSE `status`, then `complete` with `assistant`, `chat_id`, `session_id`, and a bounded `agent` summary (`tools`, `tool_call_count`, `elapsed_seconds`, `stop_reason`, `tool_calls_supported`). Agent mode requires the selected catalog model's runtime to support tool calls. It permits at most four registered read-only calls and 45 seconds per turn; results and audit snippets are bounded. Disconnecting cancels the active backend call. Completed agent turns and a compact audit record are saved to that chat; `GET /api/chats/<id>` returns audit data in `agent_audits` and keeps the internal audit record out of visible transcript messages.
- `POST /api/downloads` with `{"repo_id":"owner/model","file_name":"model.Q4_K_M.gguf"}` → HTTP 202 and a download ID; only one transfer runs at a time. Files go under `$XDG_DATA_HOME/ai-dream/models` (normally `~/.local/share/ai-dream/models`), and that folder is registered in the local catalog on completion.
- `GET /api/downloads/<32-hex-id>/events` → SSE `progress` events with transfer state, received bytes, optional total and percentage, and a terminal state.
- `POST /api/downloads/<32-hex-id>/cancel` → requests safe cancellation; incomplete transfers use the downloader's validated resumable partial-file behavior.

Requests must send a Host header for `127.0.0.1:<port>` or
`localhost:<port>`. Other Host values are rejected. Chat creation, rename,
deletion, chat generation, agent calls, and download cancellation require an
exact allowed `Origin`: the
Angular development origin `http://127.0.0.1:5173` or same-origin production;
no credentials are allowed. Other mutating HTTP methods return 405 without
consuming request bodies.
The server caps JSON responses at 4 MiB and POST bodies at 32 KiB, bounds chat
history and transcript sizes, permits one model generation at a time, and
cancels generation or agent work when the SSE client disconnects. Snapshot service calls have
a six-second deadline. Hugging Face requests access public repositories only.
Responses are not cached. Model paths are returned for
local model identity; paths in existing saved attachments are revalidated by
the local runtime before reading and are never returned in browser transcripts.

## Run the bundled web app

Build the Angular frontend from the repository root with `npm --prefix web run build`. The app bundle is expected at `web/dist/index.html`; development build output is ignored by Git and release packaging should include the complete `web/dist` directory.

```sh
./open-ai-dream-web
# or choose another loopback port
./open-ai-dream-web --port 8780
```

This serves the static app and API from one origin at `http://127.0.0.1:<port>`, then opens that address in the default browser. The same command is available as `python3 -m aidream web --port 8780`. If the production bundle is absent, it exits with the exact build path needed. `AI Dream.desktop` launches the Angular app; the established Tk interface remains available as `./open-ai-dream`.

Static files are read only from the bundled `web/dist` tree. SPA fallback serves `index.html` for extensionless client routes; unknown assets, dotfiles, traversal paths and symlinks escaping the bundle are rejected. The server applies MIME, cache and browser security headers and keeps the API routes ahead of SPA fallback.
