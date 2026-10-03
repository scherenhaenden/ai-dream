# Agile RAG Implementation Plan & Priorities (Database & Qdrant Focus)

> **Status: Active Implementation Plan.** Focused on the primary objective: **Accept SQLite files, dynamically inspect and index database objects into Qdrant, configure rankers, embeddings & chat models, and enable grounded Chat with Your Database.**
> Every round delivers concrete, user-visible improvements and end-to-end functionality.

---

## Priority Matrix Overview

| Round | Focus Area | User-Facing Value Delivered | Key Verification / Acceptance Gate |
|---|---|---|---|
| **Round 1** | **Provider Core: Embeddings, Rankers & Chat Models** | Configure and use **Embeddings** (SentenceTransformers / remote API), **Rankers** (Cross-Encoder / LLM rerank), and **Chat models**. Secure credential handling (keyring) and SSRF-safe outbound transport. | In UI / API, test embedding generation (`embed_texts`), test reranking (`rerank.score`), and verify remote/local model inference. |
| **Round 2** | **SQLite Dynamic Object Inspection & Schema Profiler** | Upload / supply `.db`, `.sqlite`, `.sqlite3` files (up to 512 MiB). Backend dynamically discovers tables, columns, types, foreign keys, row counts, and data samples in read-only mode (`mode=ro`, step budgets). | Upload `.db`; UI displays database schema and object tree; chat can answer structural questions about tables and columns. |
| **Round 3** | **Qdrant Vector Store & Dynamic Object Indexing** | Local/remote Qdrant integration. Dynamically vectorize and index SQLite database objects and rows into Qdrant using the embedding models from Round 1, with batch progress and change fingerprinting. | Ingest SQLite file; rows/objects are embedded into Qdrant; perform direct semantic similarity search returning top-k rows with scores. |
| **Round 4** | **Reranker Pipeline & Hybrid Database Search** | Combine lexical matching and Qdrant semantic scores, filtered through the configured ranker (Cross-Encoder or LLM reranker) to select the most relevant rows/records. | Ask semantic questions across database text columns (e.g. "Find delivery complaints"); reranker scores and surfaces the most relevant records. |
| **Round 5** | **Chat With Your Database (Safe SQL + Qdrant Evidence + Grounded Chat)** | **End-to-End Chat with Database:** Ask natural language questions over the SQLite database. Dual-path grounding handles exact aggregates via audited read-only SQL (`sqlite.query`) and semantic queries via Qdrant + Ranker, with clickable `[E1]` citations and query audit. | "How many orders were placed?" runs audited SQL and returns exact count; "What issues did customers report?" retrieves Qdrant evidence with citations. |
| **Round 6** | **Context Window & Prompt Budget Optimization** | Dynamic token budgeting (`ContextBudget`) packs schema cards, retrieved database rows, and history into the chat model's context window. UI displays per-model context controls and VRAM estimates. | Model uses full context window (up to 32k/128k) without hardcoded character clipping; evidence fits cleanly into prompt budget. |
| **Round 7** | **Drag-and-Drop UI & Multi-Format Ingestion** | Drag and drop `.db`, `.sqlite`, and tabular files (CSV, XLSX) anywhere onto the web app with upload progress. Expand vectorization to spreadsheets. | Drag a SQLite file or spreadsheet onto the window; see upload progress and immediate availability for chat. |

---

## Detailed Round-by-Round Breakdown

### Round 1: Provider Core for Embeddings, Rankers & Chat Models
- **Objective:** Provide the necessary foundation that unblocks Qdrant vectorization, reranking, and remote/local inference.
- **Deliverables:**
  1. **`aidream/providers/` Package:**
     - `client.py`: chat completion, streaming, and tool calls.
     - `embeddings.py`: remote `/embeddings` and local SentenceTransformers backend with batching, validation, and dimension checking.
     - `rerank.py`: Cross-Encoder and LLM-as-reranker with fallback scoring.
     - `discovery.py`: model discovery by role (`llm`, `embedding`, `rerank`).
     - `errors.py`: safe provider error formatting (redacting API keys, bearer tokens, internal URLs).
  2. **Security & Transport:** Leverage `ProviderConnections` keyring secrets and SSRF-safe pinned sockets for all provider calls.
  3. **Capability Activation:** Bind `embedding.create` and `rerank.score` in the capability resolver.
- **User Outcome:** The user can configure their preferred embedding models, ranker models, and chat models, verify them, and generate embeddings.

---

### Round 2: SQLite Dynamic Object Inspection & Schema Profiler
- **Objective:** Enable the application to accept SQLite files and dynamically read all database objects safely.
- **Deliverables:**
  1. **SQLite Source Ingestion:** Detect SQLite files via magic header (`SQLite format 3\000`), supporting `.db`, `.sqlite`, `.sqlite3` up to 512 MiB with streaming storage.
  2. **Safe Profiler Engine:** Open database read-only (`mode=ro`, `PRAGMA query_only=ON`, `trusted_schema=OFF`, VM-step budget) and dynamically inspect:
     - Table names and views (filtering internal FTS shadow tables).
     - Column definitions, data types, nullable constraints.
     - Primary keys, foreign key relationships, indices.
     - Row counts (bounded) and non-empty sample rows per column.
  3. **Schema Cards:** Automatically generate structured schema documentation for the database and register it into the knowledge index.
- **User Outcome:** The user can supply any SQLite file, view its dynamic object catalog (tables, columns, relations), and ask structural questions.

---

### Round 3: Qdrant Vector Store & Dynamic Object Indexing
- **Objective:** Connect Qdrant and index database objects and rows into vector collections.
- **Deliverables:**
  1. **Qdrant Adapter (`aidream/knowledge/qdrant_adapter.py`):**
     - Collection lifecycle (`ensure_collection`, vector dimension validation).
     - Record upsert, batching, search, and deletion by source ID.
     - Support local embedded Qdrant or HTTP Qdrant instance.
  2. **Dynamic Database Object & Row Indexer:**
     - Chunk/format database rows into textual representations preserving column semantics (`col: value`).
     - Embed rows in batches via the configured embedding model from Round 1.
     - Upsert vectors into Qdrant collections with metadata payloads (table name, primary key, row identifier).
     - Source SHA-256 fingerprinting to track index freshness.
- **User Outcome:** Database records are semantically vectorized in Qdrant, enabling similarity search over database rows.

---

### Round 4: Reranker Pipeline & Hybrid Database Search
- **Objective:** Combine lexical search and Qdrant semantic search, filtered through rankers for maximum precision.
- **Deliverables:**
  1. **Hybrid Retrieval:**
     - Query Qdrant for semantic vector nearest neighbors.
     - Query lexical index for keyword matches.
     - Merge candidate records using reciprocal rank fusion (RRF) or weighted score blending.
  2. **Reranker Scoring:**
     - Pass top candidates through the configured ranker (Cross-Encoder or LLM reranker).
     - Filter out low-confidence hits below a configurable threshold.
  3. **Structured Attribute Filtering:** Support date and numeric candidate filtering alongside semantic matching.
- **User Outcome:** Natural language queries over unstructured text columns in the database surface the exact right rows with high precision.

---

### Round 5: Chat With Your Database (Safe SQL + Qdrant Evidence + Grounded Chat)
- **Objective:** The core user experience: chat naturally with the database, combining exact SQL analytics with semantic row evidence.
- **Deliverables:**
  1. **Dual-Path Routing:**
     - **Aggregate / Analytical questions** ("How many...", "Total sales...", "Latest entries"): Routed to safe read-only SQL (`sqlite.query`).
     - **Semantic / Search questions** ("Which users reported...", "Find discussions on..."): Routed to Qdrant vector retrieval + Reranker.
  2. **Guarded SQL Tooling:**
     - SQLite authorizer callback restricting execution to `SQLITE_SELECT`, `SQLITE_READ`, and allowlisted functions.
     - Absolute immutability: Original database SHA-256 is guaranteed unchanged.
     - Step budgets and row limits prevent runaway queries.
  3. **Grounded Answer Generation & Citations:**
     - Prompt template injecting structured schema cards, SQL query results, and Qdrant row evidence.
     - Citation markers `[E1]`, `[E2]` linked to specific rows or queries.
     - Evidence drawer in the response returning executed SQL, row counts, and similarity scores.
     - Honest zero-evidence handling (no hallucinated database values).
- **User Outcome:** The user chats directly with their database, receiving exact numbers for calculations and relevant records for semantic searches, all fully cited.

---

### Round 6: Context Window & Prompt Budget Optimization
- **Objective:** Ensure database schemas, retrieved rows, and multi-turn conversations fit comfortably into any model's context window.
- **Deliverables:**
  1. **Four-Tier Context Model:** `max_context`, `context_window`, `reserve_output_tokens`, and computed `prompt_budget`.
  2. **`ContextBudget` Engine:** Dynamically allocates token budget between system instructions, chat history, database schema cards, and retrieved row evidence.
  3. **UI Context Settings:** Configure context window per model/provider with KV-cache VRAM estimation and warnings.
- **User Outcome:** Models with 8k, 32k, or 128k context windows are used to their full potential without arbitrary character truncation.

---

### Round 7: Drag-and-Drop UI & Multi-Format Tabular Expansion
- **Objective:** Streamlined UI experience and support for broader tabular data sources.
- **Deliverables:**
  1. **Global Drag-and-Drop:** Drop `.db` files or folders directly onto the application.
  2. **Upload Queue:** Visual upload and indexing progress bars in the UI.
  3. **Tabular File Ingestion:** Ingest CSV, XLSX, and JSON datasets into the same profiler, SQL, and Qdrant vector indexing pipeline.
- **User Outcome:** Seamless drag-and-drop workflow across SQLite databases and spreadsheets.
