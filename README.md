# AI Dream

AI Dream is a local-first application for discovering hardware and managing locally stored GGUF models. v0.1 targets Linux and provides a CLI plus a small Tk GUI over shared local services.

## Run the v0.1 vertical slice

```sh
python3 -m pip install -e .
app hardware
app models add ~/Models
app models add /mnt/ssd/models
app models scan
app models list
app backends
app-gui
```

To chat with an existing indexed model or a direct GGUF path, install a compatible llama.cpp runtime and run:

```sh
app run /path/to/model.gguf --backend auto
app run /path/to/model.gguf --backend llama.cpp --device <runtime-device-name>
```

The CLI also accepts `--gpu-layers N` and `--tensor-split 60,40` when the installed runtime advertises those controls. `app backends` reports available controls. A backend-specific device name is not a hardware discovery index; AI Dream does not guess that mapping.

Configuration is stored under `~/.config/ai-dream/`. Model directories are indexed in place; files are not moved, renamed or modified.

## Architecture

- `aidream.hardware`: `HardwareService.detect() -> HardwareSnapshot`, including all detected devices and best-effort vendor, model, memory and backend information.
- `aidream.models`: `ModelCatalog.add_source(path)`, `list_sources()`, `scan()` and `list_models()`. GGUF records include stable ID, path, size and best-effort metadata.
- `aidream.runtime`: `InferenceBackend` exposes capabilities, model validation, load, generation and unload. It reports only controls available in the installed runtime.
- `aidream.cli`: command parsing and presentation; delegates to domain services.
- `aidream.ui`: `app-gui`, a minimal Tk interface for hardware, model directories, catalog, runtime selection and prompts.

## Milestones

v0.1: hardware + GGUF catalog + CLI/GUI + local inference. v0.2: Hugging Face search and download. v0.3: placement estimates and controls. v0.4: launch profiles. Do not add later milestone features to v0.1.

## Known v0.1 limits

Hardware discovery and GGUF metadata are best-effort. GPU names and controls vary by vendor tools and llama.cpp build. Device selection accepts a runtime-native name only when the runtime exposes it; hardware index mapping is not implemented. Real inference requires a compatible llama.cpp executable installed locally.
