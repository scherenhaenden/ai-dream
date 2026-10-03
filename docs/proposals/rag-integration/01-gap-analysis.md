# ai-dream vs my-rag: gap analysis

> **Status: proposal.** Nothing in this document is implemented unless it says so. It is based on a static reading of the code (no code or tests were run), so statements marked **(verify)** are unconfirmed. See the [index](README.md).


Scope: Python backends in [ai-dream/aidream](../../../aidream) (~21k lines) and my-rag/rag (`my-rag/rag`) (~6k lines). The provider, retrieval, chat and knowledge modules were read in full; the rest was inventoried by function and route lists. The frontends and most of `my-rag/rag/api.py` were not reviewed in detail.

## 1. How LLM providers are used (the pattern being rewritten per program)

Every program needs the same six things:

| # | Need | ai-dream | my-rag |
|---|---|---|---|
| 1 | Provider config (base URL, key, mode) | `ProviderConnections`: OS keyring, SSRF guard, atomic store | `api_key_env` env var and `settings.json` |
| 2 | Model discovery (`/models`) | Yes, but remote providers only | Yes, plus LM Studio native v1 with `llm`/`embedding` type filter |
| 3 | Chat/generate | Local llama.cpp/vLLM only (`runtime.py`) | `generate()`: OpenAI-compatible and LM Studio native |
| 4 | Embeddings | **Missing** | `embed_texts()`: remote, plus local sentence-transformers |
| 5 | Rerank | **Missing** | cross-encoder and LLM-as-reranker |
| 6 | Local runtime lifecycle | Much richer (scheduler, residency, VRAM, adapters) | Basic (`RuntimeManager`, ROCm) |

**Main finding:** ai-dream's remote providers are only listed and tested. `ProviderConnections` stores them and calls `/models`, but nothing sends chat, embedding or rerank requests through them. Searching the code shows `.generate()` is only called on local backends. Its capability map even declares `embedding.create` and `rerank.score` as "No ... configured" ([http_api.py:2442](../../../aidream/http_api.py#L2442)).

So ai-dream has the best provider *management* and my-rag has the only provider *inference clients*. Both halves are needed.

## 2. Functions in my-rag that are NOT in ai-dream

### A. Provider and inference layer (highest value, small, port first)
Source: providers.py (`my-rag/rag/providers.py`) and retrieval.py (`my-rag/rag/retrieval.py`).

- `generate()`: chat via OpenAI-compatible `/chat/completions` or LM Studio native `/api/v1/chat`.
- `_server_root`, `_management_root`, `_api_mode`: normalise endpoint URLs that users paste (`.../v1/chat/completions` becomes the base URL).
- `list_models` / `list_embedding_models`: role-aware discovery (`llm` vs `embedding`).
- `ensure_lmstudio_model_loaded()`: load a model through the LM Studio API, with a lock and a role check. It raises `LMStudioModelRoleError` for the wrong type.
- `_remote_embeddings()` and `embed_texts()`: batch embeddings with validation (count, non-finite and empty vectors rejected).
- `resolve_embedding_config()`: the `same-as-chat` inheritance logic.
- `_local_embedder` / `_cross_encoder`: cached sentence-transformers models.
- `_safe_provider_error()`: redacts bearer tokens, URLs and API keys from error text.
- `_llm_rerank()` / `_parse_ranking()`: LLM reranking with tolerant JSON parsing and a lexical fallback.

### B. Retrieval and RAG pipeline
- `hybrid_search()` / `bm25()`: lexical plus semantic blend, threshold, and `reranker_score`.
- `add_semantic_scores()` with a vector cache and fallback to lexical on provider failure.
- `expand_queries()`: query decomposition.
- `answer_question()` in chat.py (`my-rag/rag/chat.py`):
  - follow-up detection
  - global-question overview with source diversity
  - evidence-cited prompt (`[E1]`)
  - offline grounded fallback
  - trace and debug output
- hierarchical_retrieval.py (`my-rag/rag/hierarchical_retrieval.py`): `split_sections`, `attach_parent_metadata`, `expand_ranked_hits`, `join_overlapping_chunks`.
- analysis.py (`my-rag/rag/analysis.py`): `structured_numeric_analysis` (deterministic calculations).

ai-dream's only retrieval is [document_rag.py](../../../aidream/document_rag.py): lexical BM25 on one document, stateless. It is also [knowledge.py](../../../aidream/knowledge.py): SQLite FTS5, max 100 documents, no vectors. ai-dream does have things my-rag lacks: citation offsets, forged-`[C1]` defence, and hard bounds. Keep those.

### C. Vector storage (nothing equivalent in ai-dream)
- qdrant_adapter.py (`my-rag/rag/qdrant_adapter.py`): `QdrantAdapter` (`ensure_collection`, `upsert_records`, `replace_source`, `search`, `remove_source`, vector-size validation) and `QdrantConfig`.
- sqlite_vectors.py (`my-rag/rag/sqlite_vectors.py`): `index_sqlite_source`, `search_sqlite_source(s)`, with `Embedder` and `VectorStore` protocols.

### D. Ingestion
Source: ingestion.py (`my-rag/rag/ingestion.py`) and ingestion_jobs.py (`my-rag/rag/ingestion_jobs.py`).

- Formats: ai-dream parses TXT, Markdown and PDF. my-rag also does DOCX, PPTX, XLSX, CSV, JSON/JSONL, source code, HTML, XML and extensionless text. It has zip-bomb limits for Office files.
- `IngestionService`: `ingest_path`, `ingest_directory`, `reindex_source`, `delete_source`, chunks with overlap, SHA-256 dedupe.
- `IngestionJobStore`: persistent background queue with progress, retry and history pruning.
- `is_sqlite_file()`: detects SQLite by file signature.

### E. Structured data / SQL (nothing in ai-dream)
- sql_connectors.py (`my-rag/rag/sql_connectors.py`): `ConnectorRegistry`, `test_connection`, `discover_schema` and read-only `query` (SQLAlchemy).
- sqlite_profile.py (`my-rag/rag/sqlite_profile.py`): `inspect_sqlite_database` (column roles, foreign keys, indexes).
- sqlite_metrics.py (`my-rag/rag/sqlite_metrics.py`): `scan_sqlite_metrics`.
- sqlite_query.py (`my-rag/rag/sqlite_query.py`): `detect_sqlite_intent`, `execute_sqlite_question` (NL to bounded read-only SQL, date filters, joins), `filter_sqlite_vector_candidates_by_date`.

### F. Settings and UX
- Draft vs. committed settings (`/api/settings/draft`).
- Provider test and discovery with friendly error mapping (`_provider_discovery_error`).
- Frontend: `provider-settings.js`, `model-discovery.js`, `sources.js`, `sql-connections.js`, `i18n.js` (EN/ES).

### G. Where my-rag is **behind** ai-dream (do not port)
- Runtime layer (runtime/ (`my-rag/rag/runtime`), `runtime_api.py`, `runtime_config.py`): ai-dream's `runtime.py`, `runtime_adapters.py`, `model_scheduler.py`, `vllm_runtime.py` and `runtime_installations.py` cover everything here and more. The only small unique piece is rocm.py (`my-rag/rag/runtime/rocm.py`), `prepare_vllm_env`. Diff it against `hardware.py` and `vllm_runtime.py` before dropping it.
- Secret handling: my-rag reads keys from env vars. ai-dream's keyring store is better.

## 3. Recommended plan: one shared provider core inside ai-dream

Create `aidream/providers/` as a library with no HTTP dependency, so other programs can `import` it. Based on the code reviewed:

```
aidream/providers/
  client.py      # chat(), stream(), tool_chat()   <- from my-rag generate() + ai-dream runtime.py streaming
  embeddings.py  # embed(), resolve_embedding_config(), local ST backend
  rerank.py      # cross-encoder + llm rerank
  discovery.py   # list_models(role=...), url normalisation, LM Studio load
  errors.py      # safe_provider_error()
  connections.py # existing ProviderConnections (keyring + SSRF-safe transport)
```

**Key design decision:** `client.py`, `embeddings.py` and `rerank.py` should resolve credentials through `ProviderConnections` (`provider:<id>:<model>` ids already exist). Reuse its `validate_base_url` and pinned-socket transport for POST too. Today that transport only does GET `/models`. my-rag's `urlopen` calls have no SSRF guard, no response-size cap, and follow redirects.

Migration order, each step independently useful:
1. **Providers:** port client, embeddings, rerank, discovery and error redaction. This also makes the `embedding.create` and `rerank.score` capabilities real.
2. **Retrieval:** port `hybrid_search`, `expand_queries`, `hierarchical_retrieval` and the `answer_question` orchestration as a `rag/` package. Keep the ai-dream citation and bounds code.
3. **Vector store:** port `QdrantAdapter` and `sqlite_vectors` behind the `VectorStore` protocol. This replaces the 100-document FTS5 limit.
4. **Ingestion:** port Office, CSV and JSON parsers into `document_input.py`, plus the job queue (hook into `run_manager.py`).
5. **SQL/SQLite tools:** port as skills in `aidream/skills/`, since ai-dream already has a skills and capabilities system.
6. **Frontend:** the Knowledge and Provider pages already exist in [web/](../../../web). Port only missing pieces such as SQL connections and source management.

## 4. Caveats
- ai-dream's `http_api.py` is a 4,300-line single file. Add new routes as separate modules, as `artifacts/api.py` does, so it doesn't grow further.
- my-rag has no tests for rerank or embedding code in the files reviewed. Port its tests (`test_provider_*`, `test_reranker.py`, `test_lmstudio_model_lifecycle.py`, `test_qdrant_adapter.py`) with the code.
- Both repos contain `data/` and `__pycache__` files. Check whether `data/settings.json` in my-rag holds any real keys before committing anything.
