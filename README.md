# AI Dream

AI Dream is a local-first application for discovering hardware and managing locally stored GGUF models. The first milestone targets Linux and a runnable CLI.

## v0.1 vertical slice

```sh
python3 -m aidream hardware
python3 -m aidream models add ~/Models
python3 -m aidream models scan
python3 -m aidream models list
```

Configuration is stored under `~/.config/ai-dream/`; model directories are indexed in place and are never moved or modified.

## Architecture and contracts

- `aidream.hardware`: `HardwareService.detect() -> HardwareSnapshot`; devices have stable integer index, vendor, name, memory totals/free where known, and supported backends.
- `aidream.models`: `ModelCatalog.add_source(path)`, `list_sources()`, `scan() -> list[ModelRecord]`, `list_models()`; GGUF `ModelRecord` includes stable id, path, size, format and optional metadata. Sources are external and read-only to the catalog.
- `aidream.runtime`: `InferenceBackend` exposes `name`, `capabilities()`, `can_load(model)`, `load(model, placement)`, `generate(prompt)`, and `unload()`. Runtime must report actual placement controls.
- `aidream.cli`: presentation and argument parsing only; delegates to the same services used by any future GUI.
- `aidream.ui`: deferred until the CLI/core vertical slice works.

Milestone sequence: v0.1 hardware + model catalog + CLI, then llama.cpp execution; v0.2 Hugging Face; v0.3 richer placement; v0.4 launch profiles. Avoid future-milestone infrastructure in v0.1.

## Known v0.1 limits

Initial discovery and GGUF catalog are best-effort. Runtime availability depends on a locally installed llama.cpp executable. Device splitting is exposed only when the chosen runtime supports it.
