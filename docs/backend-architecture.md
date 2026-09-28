# Python backend architecture

This guide explains how the Python side of AI Dream is assembled. It describes
the behavior in the current source tree; the user-facing [README](../README.md)
shows how to start the application, while [local-http-api.md](local-http-api.md)
defines the browser API routes and response shapes. The other focused documents
linked below give the exact storage and attachment contracts.

## Process map and entry points

```text
AI Dream.desktop / open-ai-dream-web
    -> python3 -m aidream web
    -> http_api.py: loopback HTTP server + bundled Angular files
    -> ReadOnlyAPI: hardware, model catalog, chat store, runtime, Hub
    -> runtime.py: one local llama-server child process

open-ai-dream / app-gui -> ui.py: Tk event loop -> same core services
python3 -m aidream / app -> cli.py -> same core services
```

`aidream/__main__.py` passes module execution to `cli.main`. The package's
`pyproject.toml` installs `app` and `app-gui` commands. `cli.py` exposes hardware
inspection, model source management, backend inspection, terminal chat, API-only
`serve`, and combined Angular/API `web`. Terminal chat accepts a catalog model
ID or an existing GGUF path, loads a backend, reads prompts until `/exit`, and
unloads it in a `finally` block. This direct path exception applies only to the
CLI; the HTTP chat routes require a catalog model ID.

`open-ai-dream-web` changes to its own directory and executes `python3 -m
aidream web`; `serve_web` requires `web/dist/index.html`, binds to
`127.0.0.1` (default port 8765), and asks the default browser to open it.
`AI Dream.desktop` runs that script. `open-ai-dream` starts the older Tk GUI
through `python3 -m aidream.ui`. Neither launcher embeds a model or starts
llama.cpp until a generation needs it.

## Module responsibilities

| Module | Responsibility and main boundary |
| --- | --- |
| `cli.py`, `__main__.py` | Parse commands and convert core-service results to JSON or terminal text. |
| `ui.py`, `preset_ui.py` | Tk widgets, user actions, background generation/voice workers and event-loop updates; preset dialog. |
| `http_api.py` | Loopback HTTP/static-file adapter, request validation, resource limits, SSE transport and orchestration of chat/download jobs. |
| `hardware.py` | Best-effort CPU/RAM/OS/GPU snapshot from local system data and optional command-line probes. |
| `models.py` | Configured GGUF folders, recursive scan and bounded header metadata extraction. |
| `runtime_manager.py` | Read-only llama.cpp installation status and an explicitly invoked Debian/Ubuntu package installation operation. |
| `runtime.py` | Runtime capability discovery, one persistent `llama-server` process, local chat completions, streaming, cancellation and history restoration. |
| `conversation.py` | Validated, atomic per-chat JSON files and metadata-only attachment references. |
| `presets.py` | Validated reusable parameter presets in one atomic JSON store. |
| `huggingface.py` | Public Hub search/metadata and validated, resumable GGUF transfers. |
| `image_input.py`, `document_input.py` | Bounded local image/document ingestion for the Tk path and saved-history restoration. |
| `voice.py` | Optional offline speech, microphone and Whisper subprocess workers. |
| `agent_tools.py`, `agent.py`, `agent_api.py` | Fixed read-only tool registry, bounded model/tool loop, and HTTP-chat persistence adapter. |

The services are constructed independently by the CLI, Tk GUI and HTTP
adapter. Changes to a core service should be checked at each caller: the
surfaces do not all expose the same features.

## Hardware, model identity and runtime availability

`HardwareService.detect()` gathers CPU and RAM from Linux `/proc` where
available, OS information from the platform and `/etc/os-release`, and GPU
information from available NVIDIA, ROCm, sysfs/PCI and Vulkan probes. Optional
commands are run as argument arrays, without a shell, with short timeouts.
The resulting snapshot is descriptive: the GPU indexes shown to the user are
not automatically llama.cpp `--device` identifiers. Missing tools or fields
produce incomplete/unknown values instead of preventing startup.

`ModelCatalog` stores source directories in
`~/.config/ai-dream/model-sources.json`. `add_source` resolves and validates an
existing directory; `scan` walks configured folders without moving models or
following directory symlinks. Each discovered `.gguf` becomes a `ModelRecord`.
Its ID is the first 24 hex characters of the SHA-256 of the resolved path, so
moving a file changes its catalog ID. Header parsing is best effort and
bounded; invalid or partial GGUF files may still appear with sparse metadata.
`display_info()` reports missing facts as unknown and marks quantization
inferred from a filename. See [model-metadata.md](model-metadata.md).

`RuntimeRegistry` currently contains `LlamaCppBackend`. Its constructor looks
for `llama-server` or `server` on `PATH`; `capabilities()` interprets that
executable's `--help` output to decide which loading controls can be offered.
`RuntimeManager.status()` separately checks installation and version.
`RuntimeManager.install()` is an explicit operation using the distribution's
`llama.cpp-tools` package through `apt-get` and, when needed, `pkexec` or
`sudo`. The current CLI, HTTP and Tk entry points do not call `install()`;
finding a missing runtime does not silently install system packages.

## Model loading and a chat turn

`LlamaCppBackend.validate_load()` requires an existing GGUF chat model,
rejects known `clip`/`mmproj-` vision projectors as standalone models, and
checks each requested option against advertised CLI flags. `load()` first
unloads any retained process, then starts `llama-server` with the model path,
loopback host, a free local port and validated options. It polls `/health`
until ready or until its startup deadline. Startup errors use a bounded tail
of the child's temporary combined log; `unload()` terminates the child and
kills it after a grace period if necessary. Explicit multi-GPU tensor splits
disable llama.cpp auto-fit by default when that flag is available, because an
installed build was observed to abort with the combination.

The backend keeps a Python-side message list. `generate_stream()` sends that
history plus the new user message to its local `/v1/chat/completions` endpoint,
reads SSE deltas and calls the caller's callback. A complete answer is then
added to history. On cancellation or transport failure the tentative user
message is removed, so an incomplete exchange is not retained. The active
response socket can be shut down through `cancel_generation()`.

The HTTP `ReadOnlyAPI` serializes generations with `_chat_lock`. It resolves
the selected model from the local catalog, chooses an available streaming
backend, and reuses the loaded `(backend, model ID, chat ID)` binding for later
turns in the same conversation. A changed or dead binding is unloaded and
reloaded. Up to 32 recent user/assistant messages and 32,768 text characters
are restored from the saved chat. A successful `ChatRun` appends the user turn
and complete assistant answer to `ChatStore`; failed/cancelled turns are not
saved. The SSE handler detects a disconnected browser, signals cancellation
and closes the run. `ReadOnlyAPI.close()` unloads the retained model.

The Tk GUI follows a related flow in its own worker thread and sends deltas
back through a queue to the Tk event loop. Its load identity also includes
placement and supported load options. It saves selected chat settings before
generation, restores saved history on a new load, and restores the draft and
pending attachment paths after failure/cancellation. Unlike HTTP chat, Tk can
pass placement, generation parameters, images and documents directly. The
browser chat API currently accepts only chat ID, catalog model ID and prompt;
saved per-chat settings are not applied by that HTTP generation path.

## Local data and optional inputs

| Data | Default location / ownership | Persistence behavior |
| --- | --- | --- |
| Model source list | `~/.config/ai-dream/model-sources.json` | Catalog registration; model files remain where they are. |
| Chats | `$XDG_DATA_HOME/ai-dream/chats/<32-hex-id>.json`, normally `~/.local/share/ai-dream/chats/` | One file per chat; validated and atomically replaced with fsync. |
| Presets | `$XDG_DATA_HOME/ai-dream/presets.json` | Versioned JSON, validated and atomically replaced. |
| HTTP Hub downloads | `$XDG_DATA_HOME/ai-dream/models/` | Completed GGUF registered as a catalog source. |
| Incomplete Hub transfers | Hidden `.aidream-<key>.part` and `.json` in the destination | Retained for a validated retry after a transfer error; explicit cancellation discards them. |

`ChatStore` creates, lists, loads, renames, deletes and exports conversations.
Each message has a `user`, `assistant` or `system` role. Its optional settings
contain the chosen backend/model, runtime placement/load values, generation
values and preset ID; older chat files receive defaults on read. Settings
updates validate the schema and recursively merge the supported nested
objects, while replacement can clear fields. `PresetStore` uses a separate
validated versioned file and does not itself load a model. See
[chat-session-settings.md](chat-session-settings.md).

Image and document attachments are selected as existing local files in Tk.
Images are signature-checked PNG/JPEG/WebP files and become `data:` URI parts
for a local vision-capable model. Text/Markdown and text-based PDF files are
extracted as bounded reference context; PDF extraction needs optional
`pypdf`, and OCR is absent. Chat files retain path, size, modification time and
SHA-256 references, rather than copied bytes or extracted text. On history
restoration, each reference is rechecked before reading; a changed, missing
or unsupported attachment is skipped without losing the text turn. Deleting
a chat never deletes the original attachment files. See
[image-input.md](image-input.md), [document-input.md](document-input.md) and
[chat-attachment-history.md](chat-attachment-history.md). The HTTP transcript
omits attachment paths and settings even when they exist in local chat JSON.

`LocalVoice` detects installed `espeak-ng`/`espeak`, `arecord` and
`whisper-cli`/`whisper-cpp` executables. Tk runs speech and recording in
workers, supports stopping speech and press-and-hold recording, and inserts a
local transcription into the draft; transcription does not submit the chat
automatically. Voice models are discovered locally; they are not downloaded by
this module. See [voice.md](voice.md).

## Hugging Face transfer path

`HuggingFaceDownloader` calls the public Hugging Face HTTPS API without
authentication to search GGUF repositories, list files and fetch declared
metadata. Repository IDs, revisions and GGUF paths are validated before URL
construction; downloaded subpaths are flattened to a filename in the chosen
destination. The downloader refuses to overwrite an existing final file,
checks free space when total size is known, records progress after flushed
chunks and atomically publishes a complete transfer with a hard link.

After an interrupted transfer it resumes only when the partial file and
metadata agree on repository, file, revision and byte count, and the remote
Range response begins at the expected offset with the saved ETag. Otherwise
it discards the partial file and starts again. A known expected total must
match the received bytes. The code does not currently compare a published
file with a Hub checksum. See [huggingface-metadata.md](huggingface-metadata.md)
for which repository fields may be missing.

The Tk downloader calls this service from its own dialog. The HTTP adapter
adds one background transfer worker, up to eight in-memory job summaries,
progress SSE and cancellation. Browser-created downloads go to the managed
XDG model folder and register it as a catalog source on completion. Job
summaries are process-local; the files and resumable sidecars persist across
restarts, but the old HTTP job IDs/progress do not.

## Read-only agent path

`AgentToolRegistry` publishes four fixed queries: `hardware.status`,
`models.list`, `models.info(model_id)` and `runtime.status`. It checks tool
names, required fields and extra fields before dispatch. No shell, file-write,
package-install or downloader primitive is registered.

`LocalAgent` gives a tool-capable backend a fixed system instruction and the
registered tool schemas, then handles its tool-call responses. Every requested
call is checked against the registry. The default turn allows at most four
tool calls, 45 seconds and 12,000 output characters. Slow backend/tool work
is run in workers so cancellation or the deadline can stop the outer turn;
the backend's active socket is interrupted where supported. An unsupported
tool-call interface returns a clear result. Summaries bound tool names,
durations, argument *names* and redacted snippets; they do not retain argument
values or full tool outputs.

`agent_api.py` connects this loop to the HTTP service's shared model lock,
catalog-selected model and saved chat. A completed bounded result saves a
user turn, assistant turn and compact internal audit marker. A cancelled turn
is not persisted. `http_api.py` moves the audit data into a separate
`agent_audits` field and omits the internal marker from visible transcript
messages. Tk uses `LocalAgent` too, with a short textual audit note saved in
the conversation. Agent mode does not execute arbitrary model-proposed tools.

## HTTP and failure boundaries

The HTTP adapter binds IPv4 loopback only and accepts exact local `Host`
values. Writes require an allowed `Origin`; browser development on
`http://127.0.0.1:5173` and the same production origin are supported. JSON
request bodies, response bodies, chats, histories, model lists, downloads and
concurrent requests are bounded. One chat/agent generation may use the model
at a time. The API selects models only from the catalog and exposes no route
for arbitrary file paths, runtime installation or general-purpose commands.
Static serving confines files to the Angular build, rejects traversal and
hidden paths, and uses SPA fallback only for extensionless app routes. The
server sends no-store/API and browser security headers. Exact routes and
limits live in [local-http-api.md](local-http-api.md) and `http_api.py`.

The Python code distinguishes expected input/precondition failures from
runtime or I/O failures. CLI command errors print to stderr and exit with
status 2. Tk displays errors while keeping its event loop responsive. HTTP
uses structured error responses, 409 for active-turn chat mutations, and
503/504 for unavailable or timed-out local services. A failed Hub transfer
sets a failed job and leaves a validated partial file for a later retry; an
explicit cancellation removes the partial. A failed or cancelled model turn
does not append an incomplete chat exchange.

## Where to extend the backend

- Add a new inference runtime by implementing the `InferenceBackend` contract
  in `runtime.py`, registering it in `RuntimeRegistry`, and checking both Tk
  and HTTP capability/streaming expectations.
- Add a chat setting by updating validation in `conversation.py` (and
  `presets.py` if reusable), then explicitly mapping it to runtime load or
  generation options in the relevant caller. Merely storing a value does not
  make it active.
- Add a local agent tool in `agent_tools.py` only after defining a bounded,
  typed read operation; update `LocalAgent`'s schema/alias handling and the
  audit presentation. Current agent semantics are intentionally read-only.
- Add a browser operation through `http_api.py` with path/body validation,
  loopback/Origin checks, bounded output and a documented contract in
  [local-http-api.md](local-http-api.md).

