# AI Dream: implemented work and pending functions

Status snapshot: 25 September 2026. This file is the working checklist for the local-first desktop application.

## Milestone map

- **v0.1 — usable local runtime:** complete. Hardware discovery, multiple GGUF sources, CLI/GUI, explicit runtime/device controls and local generation are present. The tested machine completed real multi-GPU Gemma inference.
- **v0.2 — model hubs:** public Hugging Face search, repository inspection and GGUF download are complete, including progress, cancellation, resume and automatic catalog registration. Checksums and private-repository authentication remain later work.
- **v0.3 — device placement:** explicit GPU layers, runtime device name and tensor split are present when supported, with validation and honest capability reporting. VRAM estimates and an automatic placement proposal remain pending.
- **v0.4 — saved configurations:** reusable validated presets and per-chat model/runtime/generation settings are present. Binding a named launch profile directly to a model as a first-class object remains a follow-up.

This snapshot is the next executable preview after those milestones; features beyond the map are tracked below rather than folded into the v0.1 baseline.

## Current baseline

- [x] Detect CPU, RAM, accelerators, local model directories, GGUF files and llama.cpp availability.
- [x] Install the Debian/Ubuntu llama.cpp package through the explicit runtime-manager action.
- [x] Run a persistent llama.cpp server and send OpenAI-compatible chat-completion requests.
- [x] Expose model placement, context, CPU threads, batch and reasoning settings in the runtime/UI.
- [x] Launch the UI from the repository root with `./open-ai-dream`.
- [x] Work around the reproduced llama.cpp auto-fit abort when an explicit tensor split is selected (`--fit off`).
- [x] Merge the Vulkan/PCI physical-GPU deduplication fix; identical physical cards remain distinct.
- [x] Produce the dated Linux build artifact and exercise its CLI launcher.
- [x] Add public Hugging Face GGUF search/download with progress, destination registration and no-overwrite behavior.
- [x] Persist local chats, restore saved turns into the runtime, and speak/record/transcribe through optional local tools.
- [x] Keep projector GGUFs catalogued but prevent loading them as standalone chat models.
- [x] Add a bounded read-only agent loop in chat, backed by hardware, local model and runtime queries.
- [x] Verify the real Gemma 4 E2B GGUF across Vulkan0 and Vulkan1 through the Python backend with `--fit off` and `--reasoning off`.

## Active parallel work

| Area | First usable slice | Next increments |
|---|---|---|
| Angular web interface | Standalone Angular shell with lazy routes, real hardware/model/runtime data, persistent sessions, streamed chat, Hugging Face search/download, SSE progress that reconnects after refresh, bounded read-only Agent mode, and a loopback production host; the browser launcher is primary | Web chat rename/delete, regenerate and per-chat settings; accessibility polish |
| Hugging Face model downloader | Desktop and Angular search, GGUF repository inspection, managed-directory download, live progress, cancellation, resume, no-overwrite, and catalog registration | File checksums, optional authenticated access, and clearer per-file size estimates |
| Chat | Persistent local history, unchanged attachment references, desktop rename/delete/export, streaming and cancellation; web chat has session selection, stream/stop, Markdown export, response copy and retry after errors | Web rename/delete, regenerate, per-chat settings/presets, attachments, audio attachments |
| Agentic tools | Desktop and Angular bounded read-only hardware/model/runtime calls, cancellation, redacted results and a bounded persistent audit that omits argument values | Richer plans; any file actions require explicit user approval |
| Voice | Detect optional local speech tools; configurable-duration recording, push-to-talk, local audio-file transcription, selectable installed Whisper model and stoppable local TTS | Streaming STT/TTS and speech voice selection |
| Other inputs/outputs | Local PNG/JPEG/WebP images and bounded local TXT/Markdown/text-PDF extraction | Audio attachments, export options and accessibility |

## Functional requirements to complete

### Model lifecycle

- [x] Provide llama.cpp install/detect status and an explicit install action through the runtime manager.
- [x] Prevalidate model files, projector-vs-chat-model status, backend availability and unsupported device/load controls before starting a server.
- [x] Scan multiple model folders without moving user files; filter by model metadata/path and sort by name or size.
- [x] Download public Hugging Face GGUFs with progress, destination selection and safe filenames.
- [x] Refuse existing destination filenames, publish downloads atomically, support cancellation cleanup and check free disk space when the Hub provides a size.
- [x] Resume interrupted public Hub downloads only when repository/file/revision/byte-count/ETag metadata validates; discard stale partial state and preserve atomic publication.
- [x] Surface local model metadata (format, size, quantization, architecture, context, source and license when available). Missing metadata is shown as unknown.
- [x] Inspect public Hugging Face repository license, tags, task, size, last update and popularity before choosing GGUF files.

### Chat and generation

- [x] Create, persist and resume the visible chat transcript locally, including restoring old turns into runtime context; rename, delete and export as Markdown.
- [x] Add streaming generation and stop/cancel; restore the draft and image attachments after cancellation or generation errors. Regenerate completed responses remains pending.
- [x] Support system prompt, temperature, response limit, stop strings, reasoning/context/load options and validated reusable presets.
- [x] Persist backend, model identity/path, placement, load options and generation settings separately for every chat while retaining compatibility with old chat files.
- [x] Keep conversation history consistent between saved chats and the backend on reload/model change.
- [x] Attach bounded local PNG/JPEG/WebP images to normal chat requests. Requires a vision-capable llama.cpp model; agent mode rejects image attachments. Chat history stores bounded local file references and restores unchanged, revalidated images after restart without copying image bytes into the transcript.
- [x] Extract bounded local TXT/Markdown and text-PDF references, with untrusted text delimiters and clear scanned-PDF/optional-dependency errors. Chat history stores local file references and re-reads unchanged documents after restart; extracted text is not copied into the transcript.

### Agentic operation

- [x] Make agent mode visible in chat; the initial tools are read-only and need no write permissions, with bounded redacted result snippets in the transcript.
- [x] Reject arbitrary shell execution and all unregistered or mutating tool names.
- [x] Bound tool calls by time, count and output size; record sequence, duration, redacted result snippet, argument field names (never values), result byte count and stop reason locally.
- [x] Propagate stop/cancel through model calls and read-only tool waits in the agent loop.
- [x] Record tool names, status, redacted result snippets and stop reason in the local chat transcript. Full arguments/results remain intentionally out of the log.

### Voice and accessibility

- [x] Detect local speech recognition and speech synthesis engines without contacting a cloud service.
- [x] Offer background microphone recording and transcription, including press-and-hold push-to-talk with a bounded recording time; released speech is inserted into the draft and is not sent automatically. Device selection and correction remain pending.
- [x] Speak assistant output locally when a supported TTS engine is present.
- [x] Stop local speech output without blocking the chat window; discover already-installed Whisper models without downloading them.
- [x] Select an installed Whisper model, choose microphone recording duration, and transcribe local audio files into the prompt.
- [x] Add push-to-talk with local capture/transcription, bounded duration, and cancellation cleanup.
- [ ] Add streaming STT/TTS plus speech voice selection.
- [x] Add Ctrl+Enter send shortcut and a responsive resizable pane layout.
- [ ] Improve keyboard navigation, readable status announcements and scalable layout.

## Release checks

- [x] Run unit/CLI checks, generate with a real local GGUF, and perform a real local hardware tool call through the agent loop.
- [x] Exercise explicit Vulkan multi-GPU loading, including the `--fit off` workaround. CPU-only real-model exercise remains pending.
- [x] Check build-folder CLI launch and the one-click desktop launcher file.
- [x] Record current limitations and the tested runtime/device/model in build metadata and this checklist.

## Angular interface direction

The supplied `local-ai-studio.zip` is a React demonstration. Use it as a visual reference for a dense dark console layout, persistent navigation/status, and a command palette; implement the product UI in Angular as requested. Treat any fake telemetry, preselected models, and aspirational ModelScope/RAG/API screens in the reference as non-functional mockups. The Angular frontend must render live local data or an explicit unavailable/empty state.

The UI will be served by the local Python process in production so the browser and API share one origin. Local development may use a narrowly allowlisted loopback dev origin. Keep the application loopback-only, lazy-load screen routes, avoid a heavyweight state/chart stack, and use streaming updates for chat and download progress rather than periodic fake telemetry. The current Linux desktop build remains available while the web interface is integrated.
