# Per-chat settings storage

`ChatStore` stores each chat as an atomic JSON file. The settings API is storage-only; callers decide when to apply these values to the active runtime.

```python
settings = store.get_session_settings(session_id)
settings = store.update_session_settings(session_id, {
    "backend_name": "llama.cpp",
    "model_id": "org/model-GGUF",
    "model_path": "/home/user/models/model.gguf",
    "runtime": {
        "placement": {"gpu_layers": 64, "device": "Vulkan0"},
        "load": {"context_size": 8192, "threads": 8},
    },
    "generation": {"temperature": 0.2, "max_tokens": 512},
    "preset_id": None,
})
```

Updates merge recursively into the existing top-level `runtime` and `generation` objects, so callers may save only the fields that changed. The returned value is fully normalized and contains defaults for unset settings.

Schema:

- `backend_name`, `model_id`, and `model_path` identify the selected backend and model.
- `runtime.placement` supports `gpu_layers` (0–2048), a short `device` name, and up to 32 positive `tensor_split` values.
- `runtime.load` supports bounded context, thread, batch, physical batch, and concurrency integers, plus boolean KV-cache, flash-attention, mmap, and model-retention toggles.
- `generation` follows the chat preset settings shape: system prompt, reasoning, temperature, token limit, stop strings, context/thread/batch settings, placement, and an optional bounded JSON structured-output schema.
- `preset_id` is `null` or a 32-character lowercase hexadecimal preset ID.

Old session files without `settings` remain valid and receive defaults on read. Writes validate before atomically replacing the session file. Unknown keys, invalid types, out-of-range values, and oversized text/schema values are rejected.
