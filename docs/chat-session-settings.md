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

## Context window compression

The context-window length controls how much input the runtime can accept for a turn. It is not the chat's storage limit: changing it must never delete, truncate, or rewrite the saved transcript.

The chat UI should offer an explicit per-thread `Compress context` / `Use full context` control beside the context length. Compression is opt-in and applies only to the model's working input. When requested, AI Dream builds a derived context copy containing a concise, model-generated summary of the older conversation plus the most recent verbatim turns that fit within the configured context budget. The original transcript remains visible, exportable, and unchanged; the summary is not inserted as a user or assistant message and is not a second chat.

Required behavior:

- Preserve user decisions, requirements, names, constraints, unresolved questions, and relevant facts; omit repetition and low-value conversational detail.
- Keep the newest turns verbatim and reserve output-token headroom when estimating the context budget. Token estimates are advisory unless the runtime provides an authoritative count.
- Make the active mode visible. Let the user inspect the generated summary and return to full context without losing either transcript or summary.
- Bind a derived summary to the chat and the transcript revision it summarizes. New turns make it stale; refresh it explicitly or regenerate before relying on it. Never silently apply a stale summary.
- If summarization fails, exceeds budget, or is unsupported by the active backend, preserve the full chat and explain the failure; do not send a partial or empty context as a fallback.
- Keep summaries local, subject to the same local data handling as chat history, and avoid storing them in the canonical message list.

This is a product/implementation requirement, not a claim that compression is currently implemented. The backend needs an explicit request contract and tests for transcript immutability, summary provenance/staleness, budget handling, failure fallback, and switching back to full context.
