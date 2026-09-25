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
| Hugging Face model downloader | Search public repositories/files, choose a GGUF, show progress, save safely in a registered model directory, then rescan | Cancellation/resume, checksums, model metadata/license display, optional authenticated access |
| Chat | Persistent local conversations, saved-turn context restoration and message history around the existing runtime | Streaming tokens, rename/delete/export conversations, attachments, per-chat model/options |
| Agentic tools | Bounded tool calls in chat over typed, read-only hardware/model/runtime APIs; unknown and mutating calls are rejected | Visible tool results, cancellation, richer plans, audit log and user-approved file actions |
| Voice | Detect optional local speech tools; local speech output and transcription where available | Async push-to-talk UI, streaming STT/TTS, voice selection, interruption and device configuration |
| Other inputs/outputs | Preserve a modality-ready message/attachment contract | Image input, document ingestion, audio attachments, export and accessibility |

## Functional requirements to complete

### Model lifecycle

- [x] Provide llama.cpp install/detect status and an explicit install action through the runtime manager.
- [ ] Explain why a model/runtime/device combination is unavailable before starting a load.
- [x] Scan multiple model folders without moving user files. Filtering/sorting remain pending.
- [x] Download public Hugging Face GGUFs with progress, destination selection and safe filenames.
- [x] Refuse existing destination filenames and publish downloads atomically. Cancellation/resume and proactive disk-space checks remain pending.
- [ ] Surface model metadata (format, quantization, size, source and license when available).

### Chat and generation

- [x] Create, persist and resume the visible chat transcript locally, including restoring old turns into runtime context. Rename, delete and export remain pending.
- [ ] Add streaming generation, stop/cancel, retry and clear error states.
- [x] Support system prompt, temperature, response limit, stop strings and a reasoning toggle. Context policy and reusable presets remain pending.
- [x] Keep conversation history consistent between saved chats and the backend on reload/model change.
- [ ] Add attachment handling for images/documents/audio only when the selected backend supports it.

### Agentic operation

- [x] Make agent mode visible in chat; the initial tools are read-only and need no write permissions.
- [x] Reject arbitrary shell execution and all unregistered or mutating tool names.
- [x] Bound tool calls by time, count and output size. Cancellation and detailed result inspection remain pending.
- [x] Record tool names and stop reason in the local chat transcript. Full tool arguments/results remain pending.

### Voice and accessibility

- [x] Detect local speech recognition and speech synthesis engines without contacting a cloud service.
- [x] Offer basic microphone recording and transcription when local dependencies are present. Device selection, push-to-talk and correction remain pending.
- [x] Speak assistant output locally when a supported TTS engine is present. Stop/interruption and voice configuration remain pending.
- [ ] Add keyboard navigation, readable status announcements and scalable layout.

## Release checks

- [x] Run unit/CLI checks, generate with a real local GGUF, and perform a real local hardware tool call through the agent loop.
- [x] Exercise explicit Vulkan multi-GPU loading, including the `--fit off` workaround. CPU-only real-model exercise remains pending.
- [x] Check build-folder CLI launch and the one-click desktop launcher file.
- [x] Record current limitations and the tested runtime/device/model in build metadata and this checklist.
