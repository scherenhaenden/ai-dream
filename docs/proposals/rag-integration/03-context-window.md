# Context window per model, with defaults

> **Status: proposal.** Nothing in this document is implemented unless it says so. It is based on a static reading of the code (no code or tests were run), so statements marked **(verify)** are unconfirmed. See the [index](README.md).


## 1. What exists today

| Area | State |
|---|---|
| **ai-dream, local models** | `context_size` already exists as a *load* option. It is validated 1 to 2,000,000 ([presets.py](../../../aidream/presets.py), [conversation.py](../../../aidream/conversation.py)), and it maps to `--ctx-size` for llama.cpp and `--max-model-len` for vLLM. |
| **Precedence** | [`resolve_effective_settings`](../../../aidream/model_profiles.py#L303-L333) merges **global < model profile < chat < request**, field by field. This is a good base. Extend it; do not replace it. |
| **Global default** | `runtime_defaults.load` in [app_settings.py](../../../aidream/app_settings.py) can hold `context_size`. One value applies to every model. |
| **Model's real maximum** | GGUF metadata exposes `context_length` ([models.py:41](../../../aidream/models.py#L41)) and the desktop UI shows it. It is not used to validate or cap anything. |
| **If left unset** | `context_size` is `None`. The desktop UI falls back to 4096 ([ui.py:829](../../../aidream/ui.py#L829)). What llama.cpp itself does depends on its version **(verify)**. |
| **Remote providers** | **Nothing.** A remote model (`provider:<id>:<model>`) has no profile and no context fields. [`provider_connections.py`](../../../aidream/provider_connections.py) keeps only `id` and `name` from `/models` and discards everything else. |
| **Who uses the window** | **Nobody.** Prompt limits are hardcoded *characters*, unrelated to the model: chat history 32,768 chars, knowledge context 6,000 chars, document prompt 8,000 chars ([http_api.py:44-55](../../../aidream/http_api.py#L44-L55), [document_rag.py](../../../aidream/document_rag.py)). `max_tokens` defaults to `None`, so output space is never reserved. |
| **my-rag** | Provider config has no window. RAG packs a fixed `context_count` of 8 chunks of about 1,200 chars. Local runtime has `context_size` **and** `max_model_len`. |

## 2. Problems

| # | Sev | Problem |
|---|---|---|
| 1 | 🔴 | **One setting does three jobs.** `context_size` is the memory allocated at load time. The model's trained maximum is a different fact. The amount of prompt that can actually be sent (window minus reserved output minus margin) is a third. They need separate names. |
| 2 | 🔴 | **Remote models cannot be configured at all**, so none of the budgeting below can work for them. |
| 3 | 🟠 | **One global default for every model.** A 4k model and a 128k model get the same value. |
| 4 | 🟠 | **No validation against the trained maximum.** You can set 131,072 on a model trained for 8,192 and get silent quality loss, or allocate gigabytes of KV cache for nothing. |
| 5 | 🟠 | **No memory estimate.** ai-dream already has `hardware.py`, `resource_snapshots.py` and `model_scheduler.py` with VRAM estimates. A larger window is the main cost driver of KV cache, and the UI does not warn. |
| 6 | 🟠 | **Prompt limits are in characters, not tokens**, and fixed. Raising the window changes nothing, and a small window can still overflow. |
| 7 | 🟠 | **Embedding and rerank models have an input limit too** (often 512 tokens). my-rag chunks at 1,200 chars regardless, so chunks can be silently truncated by the provider. |
| 8 | 🟡 | **Naming drift in my-rag.** `runtime/vllm.py` checks `config.context_length`, but `RuntimeConfig` defines `context_size` and `max_model_len`. That code path looks like it never applies a window **(verify whether it is dead code)**. |

## 3. Proposed model

Four separate values, each with a clear owner:

| Field | Meaning | Source |
|---|---|---|
| `max_context` | Model's trained or declared maximum. Read-only unless overridden. | GGUF metadata; provider `/models` response; manual entry; small built-in table for well-known models |
| `context_window` | The window we **use**. For local models this is also the load-time `context_size`. | Resolved through the layers below |
| `reserve_output_tokens` | Space kept free for the answer. Doubles as the default `max_tokens`. | Layers below, default for example 1,024 |
| `prompt_budget` | **Derived, never stored:** `context_window - reserve_output_tokens - safety_margin` | Computed |

### Default hierarchy (extends the existing precedence)

```
request  >  chat  >  model profile  >  provider connection  >  global default  >  auto
```

- **Global default:** a number (suggested starting value 8,192) **or** the choice `Model maximum`. It has an upper cap, such as 32,768, applied when "Model maximum" is chosen so a 1M-token model does not try to allocate 1M.
- **Provider-connection default** is new. It is useful for a whole LM Studio or OpenRouter connection.
- **Auto** (when nothing is set) means `min(max_context, global default)`. If `max_context` is unknown, use the global default.
- **Always clamp** the resolved value to `max_context` when known, with a visible warning instead of silently overriding the user.
- **Separate defaults per role:** chat, embedding (`max_input_tokens`) and rerank.

### Where values are stored

- **Local models:** `load.context_size` already exists in the profile store. Add `generation.reserve_output_tokens` (or reuse `max_tokens`). No store rewrite is needed.
- **Remote models:** `ProviderConnectionStore` is strictly versioned (`version == 1`, fixed allowed keys). It needs a **version 2** with a `model_settings` map keyed by provider model ID, holding `{max_context, context_window, reserve_output_tokens}`. Write a migration. Keep the allow-list validation style.
- **Discovery:** parse whatever the provider offers and store it as `declared_max_context`. Field names differ by provider and are untested **(verify per provider)**: `context_length` (OpenRouter-style), `max_context_length` and `loaded_context_length` (LM Studio native), `context_window` (others). The plain OpenAI `/models` response has none of them, so manual entry must always be possible.

### The part that makes it matter: a `ContextBudget` service

One shared function used by every place that builds a prompt:

```python
budget = ContextBudget.for_model(model_id, effective_settings)   # window, reserve, margin
budget.fit(system, history, rag_chunks, tool_results, user_msg)  # returns trimmed prompt + report
```

- **Token counting:**
  - local llama.cpp and vLLM: call the server's tokenize endpoint, which is exact;
  - remote and unknown: estimate (about chars/3.5) with a safety factor of 15 to 20%, and say it is an estimate.
- **Packing priority** (suggested; make configurable): system prompt and latest user message are never dropped, then retrieved evidence by score, then recent history newest-first, then older history summarised or dropped.
- **`overflow_policy`:** `drop_oldest` (default), `summarize`, or `error`. Report what was cut in the run journal / debug trace. This is the same honesty principle as the SQL `coverage` field.
- **Replace the hardcoded character constants** with fractions of `prompt_budget` (for example RAG gets up to 40%, history up to 50%).
- **For RAG specifically:** the number of chunks becomes "as many as fit", not a fixed 8. my-rag's `context_count` becomes a cap, not the target.
- **Embedding models:** `max_input_tokens` caps chunk size at ingest time and sets batch limits. Warn if existing chunks exceed it.

## 4. UI (per model, in Models / Model Studio / Settings)

- **Context window** input, with presets (4k, 8k, 16k, 32k, 64k, 128k, **Max**) and a free number field.
- Caption: *Model maximum: 131,072 (read from GGUF)* or *(declared by provider)* or *(entered by the user)*, so users can see where the number comes from.
- **Source badge:** "Using global default" / "Model profile" / "This chat". A **Reset to default** link that removes the override.
- **Memory estimate** for local models: "≈ 3.2 GB KV cache at this size; fits / does not fit on GPU 0". Reuse the existing VRAM estimation.
- **Warnings:** value above the trained maximum; estimate exceeds free VRAM; reserve output larger than half the window.
- **Reserve output tokens** input beside it, and a read-only "Prompt budget: 6,656 tokens" line.
- **Global default** control in Settings, next to the existing runtime defaults: number or "Model maximum (capped at N)".
- For **remote models**, the same panel, plus a "Fetch from provider" button that re-reads discovery and says plainly when the provider does not report a value.
- Changing the window of a *loaded* local model requires a reload. Show that, and use the existing `load_fingerprint` to detect it.

## 5. Tasks

- [ ] **C1** Add `max_context` detection: GGUF (exists), vLLM model config, provider `/models` parsing. **M**
- [ ] **C2** Provider store **v2** with `model_settings` and migration, plus API to read and update it. **M**
- [ ] **C3** Extend `resolve_effective_settings` with the provider-connection and "auto" layers, clamp-with-warning, and `reserve_output_tokens`. Unit-test the full precedence matrix. **M**
- [ ] **C4** `ContextBudget` and token counting (local exact, remote estimated). **L**
- [ ] **C5** Replace character constants in chat history, knowledge context, document RAG and agent prompts. **M**
- [ ] **C6** Embedding and rerank `max_input_tokens`, with chunk-size capping at ingest. **S-M**
- [ ] **C7** UI: model panel, global default, source badges, memory estimate, warnings. **L**
- [ ] **C8** Fix or remove my-rag's `context_length` / `context_size` / `max_model_len` inconsistency if any of that code is ported. **S**

**Tests:** precedence matrix (every layer unset or set); clamping above `max_context`; unknown `max_context`; migration from provider store v1; a prompt that overflows is trimmed and the trim is reported; estimate-vs-exact token counts stay within the safety factor; changing the window marks a loaded model as needing reload.

## 6. Open decisions

1. **Global default value:** 8,192 as the starting default, with an optional cap for "Model maximum" at 32,768? Or different numbers?
2. **Overflow behaviour:** silent `drop_oldest` with a report in the trace (recommended), or ask the user, or fail the request?
3. **Remote token counting:** is a conservative estimate acceptable, or is an optional `tiktoken`-style dependency for OpenAI-family models wanted?
4. **Scope of "defaults":** just global plus per model, or also per **role** (chat, embedding, rerank) and per **provider connection** as proposed above?
