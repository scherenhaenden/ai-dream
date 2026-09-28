# AI Dream documentation

This directory documents the implemented application. Start with the page that
matches your task. [ROADMAP.md](../ROADMAP.md) records planned work; a roadmap
item is not an available feature until the corresponding implementation exists.

| Task | Document |
|---|---|
| Install, launch, find local data, or diagnose a startup problem | [Operations and local data](operations.md) |
| Understand Python modules and the flow from a prompt to llama.cpp | [Backend architecture](backend-architecture.md) |
| Understand Angular routes, services, state, and build | [Angular frontend](angular-frontend.md) |
| Integrate with the browser-facing HTTP service | [Local HTTP API](local-http-api.md) |
| Understand chat settings and presets | [Per-chat settings](chat-session-settings.md) |
| Understand saved image and document references | [Chat attachment history](chat-attachment-history.md) |
| Use and extend image input | [Image input](image-input.md) |
| Use and extend document input | [Document input](document-input.md) |
| Use offline speech tools | [Voice](voice.md) |
| Interpret local GGUF metadata | [Local model metadata](model-metadata.md) |
| Interpret Hub repository metadata | [Hugging Face metadata](huggingface-metadata.md) |

The Python Tk interface and Angular browser interface share the backend and
local files, but their controls differ. The feature tables in the architecture
guides identify which interface currently exposes each workflow.
