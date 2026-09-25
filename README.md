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

- Hardware and accelerator discovery; scan multiple existing GGUF folders without moving model files.
- Public Hugging Face GGUF search and download with progress, validation and no-overwrite behavior.
- Persistent llama.cpp server with chat completions, runtime capability detection and context/thread/batch/placement settings.
- Explicit multi-GPU tensor splits automatically disable llama.cpp auto-fit by default. This avoids a reproduced server abort in the installed llama.cpp build. Set the `fit` load option explicitly when using the Python API to override it.
- Local JSON conversation history and conversation switching in the UI, with saved turns restored into the runtime when a chat is resumed or the model is reloaded.
- Vision-projector GGUFs remain catalogued but are rejected as standalone chat models.
- Optional offline voice output via `espeak-ng`/`espeak`; recording and transcription via `arecord`, `whisper-cli`/`whisper-cpp`, and a local Whisper model.
- `aidream.agent_tools.AgentToolRegistry` exposes only typed, read-only hardware, model and runtime queries. It does not execute arbitrary commands.

Hugging Face access in this preview covers public repositories only. Voice programs are optional system dependencies; AI Dream does not send microphone audio to a cloud service.

Agent tools currently provide a read-only registry API; the model-driven tool-call loop and UI are pending.

## Storage

Model sources are indexed in place and remain untouched. Chat JSON files live under `$XDG_DATA_HOME/ai-dream/chats`, normally `~/.local/share/ai-dream/chats`.

## More

See [ROADMAP.md](ROADMAP.md) for the implemented and pending functions.
