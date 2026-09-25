# AI Dream

AI Dream is a local-first Linux application for discovering hardware, managing GGUF models, downloading public Hugging Face GGUFs, and chatting with a local llama.cpp runtime. It includes local chat history, optional offline voice hooks and a safe read-only agent tool registry.

## Run

From the repository root:

```sh
./open-ai-dream
```

Or use the CLI:

```sh
python3 -m aidream hardware
python3 -m aidream models add ~/Models
python3 -m aidream models scan
python3 -m aidream models list
python3 -m aidream backends
python3 -m aidream run /path/to/model.gguf
```

The current dated Linux test build is generated under `build/linux/25.09.2026/`.

## Features in this preview

- Hardware and accelerator discovery; scan multiple existing GGUF folders without moving model files, then filter by metadata/path or sort by name and file size.
- Public Hugging Face GGUF search and download with repository license/tags/task/size details, progress, cancellation, free-space checks, validation, no-overwrite behavior and HTTP Range resume after interrupted transfers. Resume data is kept in hidden sidecar files and checked against repository, revision, file, byte count and ETag before continuing; explicit cancellation removes those partial files.
- Persistent llama.cpp server with chat completions, runtime capability detection and context/thread/batch/placement settings.
- Live token streaming with a Stop control; incomplete turns are discarded when cancelled.
- Generation errors and cancellation restore the draft prompt and its image attachments for retry; Ctrl+Enter sends the current draft.
- Explicit multi-GPU tensor splits automatically disable llama.cpp auto-fit by default. This avoids a reproduced server abort in the installed llama.cpp build. Set the `fit` load option explicitly when using the Python API to override it.
- Thinking is disabled by default in the GUI because the installed Gemma build otherwise spends a short response budget only in its private reasoning channel; the checkbox exposes the runtime's reasoning on/off setting.
- Local JSON conversation history, resume, rename, delete and Markdown export; saved turns are restored into the runtime when a chat is resumed or the model is reloaded. Each chat remembers its model, backend, placement and generation settings. The Presets dialog saves and applies reusable validated settings.
- Local PNG, JPEG and WebP image attachments (up to 4 images, 8 MiB each and 12 MiB total) are passed to llama.cpp as multimodal content. A vision-capable model is required. Chat history stores bounded file references (path, size, modification time and SHA-256), not image bytes; unchanged files are revalidated and restored when a chat is resumed.
- Local TXT/Markdown and text-based PDF attachments are extracted and inserted as bounded, clearly delimited reference text (5 MiB per file, 40,000 characters per file and 80,000 total). PDF support needs optional `pypdf`; scanned PDFs are reported as unsupported. Chat history stores file references, not extracted text; unchanged files are re-read when a chat is resumed.
- Model selection shows available GGUF metadata such as format, size, quantization, architecture, context, source and license; unknown fields are identified as unknown rather than inferred.
- Vision-projector GGUFs remain catalogued but are rejected as standalone chat models.
- Optional offline voice output via `espeak-ng`/`espeak` with a responsive Stop speaking control; configurable-duration microphone recording, press-and-hold push-to-talk, and local audio-file transcription via `arecord`, `whisper-cli`/`whisper-cpp`, and a selectable local Whisper model.
- The **Read-only agent tools** checkbox uses bounded llama.cpp tool calls backed by typed, local hardware/model/runtime queries. A short redacted result summary is stored in the transcript; arbitrary commands and writes are not exposed.

Hugging Face access in this preview covers public repositories only. Voice programs are optional system dependencies; AI Dream does not send microphone audio to a cloud service. Recording/transcription runs in the background so the chat window stays responsive.

## Storage

Model sources are indexed in place and remain untouched. Chat JSON files live under `$XDG_DATA_HOME/ai-dream/chats`, normally `~/.local/share/ai-dream/chats`.

## More

See [ROADMAP.md](ROADMAP.md) for the implemented and pending functions.

- Optional local API for the browser client: `python3 -m aidream.cli serve` (or `app serve` after installing the package). It binds only to `127.0.0.1` and provides health, hardware, local model catalog, runtime availability, saved chats and streaming local chat. See [docs/local-http-api.md](docs/local-http-api.md).
- Angular browser app: build with `npm --prefix web run build`, then launch with `./open-ai-dream-web` (or install/use `AI Dream Web.desktop`). The production bundle is served with the local API from one loopback origin; see [docs/local-http-api.md](docs/local-http-api.md).
