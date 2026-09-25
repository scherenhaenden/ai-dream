# AI Dream: implemented work and pending functions

Status snapshot: 25 September 2026. This file is the working checklist for the local-first desktop application.

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
| Hugging Face model downloader | Search public repositories/files, choose a GGUF, show progress, cancel safely, check known file size, resume with validated Range/ETag, save without overwrite and rescan | Checksums, richer Hub metadata, optional authenticated access |
| Chat | Persistent local history, restore text turns, rename/delete/export, streaming, stop/cancel, validated presets and per-chat model/backend/placement/generation settings, images for vision-capable models, bounded local document attachments | Retry/regenerate, persist and restore attachment references, audio attachments |
| Agentic tools | Bounded read-only hardware/model/runtime calls, cancellation, redacted results and a bounded audit that omits argument values | Richer plans; any file actions require explicit user approval |
| Voice | Detect optional local speech tools; configurable-duration recording, local audio-file transcription, selectable installed Whisper model and stoppable local TTS | Push-to-talk UI, streaming STT/TTS and speech voice selection |
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

### Chat and generation

- [x] Create, persist and resume the visible chat transcript locally, including restoring old turns into runtime context; rename, delete and export as Markdown.
- [x] Add streaming generation and stop/cancel; restore the draft and image attachments after cancellation or generation errors. Regenerate completed responses remains pending.
- [x] Support system prompt, temperature, response limit, stop strings, reasoning/context/load options and validated reusable presets.
- [x] Persist backend, model identity/path, placement, load options and generation settings separately for every chat while retaining compatibility with old chat files.
- [x] Keep conversation history consistent between saved chats and the backend on reload/model change.
- [x] Attach bounded local PNG/JPEG/WebP images to normal chat requests. Requires a vision-capable llama.cpp model; agent mode rejects image attachments. Image bytes are not restored from chat history after restart.
- [x] Extract bounded local TXT/Markdown and text-PDF references, with untrusted text delimiters and clear scanned-PDF/optional-dependency errors. Extracted contents are not persisted in chat history after restart.

### Agentic operation

- [x] Make agent mode visible in chat; the initial tools are read-only and need no write permissions, with bounded redacted result snippets in the transcript.
- [x] Reject arbitrary shell execution and all unregistered or mutating tool names.
- [x] Bound tool calls by time, count and output size; record sequence, duration, redacted result snippet, argument field names (never values), result byte count and stop reason locally.
- [x] Propagate stop/cancel through model calls and read-only tool waits in the agent loop.
- [x] Record tool names, status, redacted result snippets and stop reason in the local chat transcript. Full arguments/results remain intentionally out of the log.

### Voice and accessibility

- [x] Detect local speech recognition and speech synthesis engines without contacting a cloud service.
- [x] Offer basic background microphone recording and transcription when local dependencies are present. Device selection, push-to-talk and correction remain pending.
- [x] Speak assistant output locally when a supported TTS engine is present.
- [x] Stop local speech output without blocking the chat window; discover already-installed Whisper models without downloading them.
- [x] Select an installed Whisper model, choose microphone recording duration, and transcribe local audio files into the prompt.
- [ ] Add push-to-talk and streaming STT/TTS plus speech voice selection.
- [x] Add Ctrl+Enter send shortcut and a responsive resizable pane layout.
- [ ] Improve keyboard navigation, readable status announcements and scalable layout.

## Release checks

- [x] Run unit/CLI checks, generate with a real local GGUF, and perform a real local hardware tool call through the agent loop.
- [x] Exercise explicit Vulkan multi-GPU loading, including the `--fit off` workaround. CPU-only real-model exercise remains pending.
- [x] Check build-folder CLI launch and the one-click desktop launcher file.
- [x] Record current limitations and the tested runtime/device/model in build metadata and this checklist.
