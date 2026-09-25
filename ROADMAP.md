# AI Dream: implemented work and pending functions

Status snapshot: 25 September 2026. This file is the working checklist for the local-first desktop application.

## Current baseline

- [x] Detect CPU, RAM, accelerators, local model directories, GGUF files and llama.cpp availability.
- [x] Install the Debian/Ubuntu llama.cpp package through the explicit runtime-manager action.
- [x] Run a persistent llama.cpp server and send OpenAI-compatible chat-completion requests.
- [x] Expose model placement, context, CPU threads and batch settings in the runtime/UI.
- [x] Launch the UI from the repository root with `./open-ai-dream`.
- [x] Work around the reproduced llama.cpp auto-fit abort when an explicit tensor split is selected (`--fit off`).
- [ ] Merge and ship the pending Vulkan/PCI physical-GPU deduplication fix.
- [ ] Produce and manually exercise the dated Linux build artifact.

## Active parallel work

| Area | First usable slice | Next increments |
|---|---|---|
| Hugging Face model downloader | Search public repositories/files, choose a GGUF, show progress, save safely in a registered model directory, then rescan | Cancellation/resume, checksums, model metadata/license display, optional authenticated access |
| Chat | Persistent local conversations and message history around the existing runtime | Streaming tokens, rename/delete/export conversations, attachments, per-chat model/options |
| Agentic tools | Typed allow-listed read-only tools for hardware, models and runtime status | User-approved file actions, bounded plans, tool call/result UI, audit log, cancellation and budgets |
| Voice | Detect optional local speech tools; local speech output and transcription where available | Push-to-talk UI, streaming STT/TTS, voice selection, interruption and device configuration |
| Other inputs/outputs | Preserve a modality-ready message/attachment contract | Image input, document ingestion, audio attachments, export and accessibility |

## Functional requirements to complete

### Model lifecycle

- [ ] Show install/detect state for llama.cpp, offer an actionable install button, and re-check capabilities after install.
- [ ] Explain why a model/runtime/device combination is unavailable before starting a load.
- [ ] Scan, filter, sort and refresh multiple model folders without moving user files.
- [ ] Download Hugging Face GGUFs with progress, destination selection, disk-space checks, cancel support and safe filenames.
- [ ] Handle existing files without overwriting, and verify downloaded file size before cataloguing.
- [ ] Surface model metadata (format, quantization, size, source and license when available).

### Chat and generation

- [ ] Create, persist, resume, rename, delete and export conversations locally.
- [ ] Add streaming generation, stop/cancel, retry and clear error states.
- [ ] Support system prompt, temperature, response limit, stop strings, context policy and reusable presets.
- [ ] Keep conversation history consistent between saved chats and the backend on reload/model change.
- [ ] Add attachment handling for images/documents/audio only when the selected backend supports it.

### Agentic operation

- [ ] Make tool availability and required permissions visible to the user.
- [ ] Start with read-only tools; never expose arbitrary shell execution to model output.
- [ ] Require an explicit user decision before a tool writes/deletes files, downloads a model or changes system state.
- [ ] Bound tool calls by time, count and output size; provide cancel and inspectable tool results.
- [ ] Record a local audit trail of tool requests, approvals, results and failures.

### Voice and accessibility

- [ ] Detect local speech recognition and speech synthesis engines without contacting a cloud service.
- [ ] Offer microphone selection, push-to-talk, recording feedback and transcription correction.
- [ ] Speak assistant output locally, with stop/interruption controls and configurable voice/rate.
- [ ] Add keyboard navigation, readable status announcements and scalable layout.

## Release checks

- [ ] Run unit and CLI checks, then load a real local GGUF and generate a response.
- [ ] Exercise CPU-only and explicit Vulkan multi-GPU loading, including the `--fit off` workaround.
- [ ] Check clean install/launch instructions and the one-click launcher in the dated build folder.
- [ ] Record known limitations and exact tested runtime/device/model in the build README.
