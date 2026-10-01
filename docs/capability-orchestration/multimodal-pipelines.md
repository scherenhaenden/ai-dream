# Multimodal pipeline patterns

This document turns the capability/skill architecture into concrete local workflows. These examples are deliberately expressed as patterns rather than hard-coded model recommendations. The same skill can use different specialist models depending on what is installed and runnable on the current machine.

## 1. General rule: modalities meet through typed artifacts

A multimodal workflow should not be a chain of ad-hoc prompts. Each boundary has a contract.

Example:

```text
image -> vision.understand -> structured JSON -> text.reason -> text
```

The intermediate structured result can be inspected, validated, cached and reused. This also means a stronger text model can reason over the output of a smaller vision model without forcing one giant multimodal model to do everything.

## 1.1 Current local capability boundaries

AI Dream's image runtime is an injected adapter, not a bundled image model.
It advertises `image.generate` and `image.edit` only when an injected backend
explicitly reports local-only execution, disabled network access, operation
support, and at least one compatible model. Capability probing lists model
identities and estimates without loading weights. Fake backends exercise typed,
signature-checked PNG/JPEG/WebP output and bounded image inputs. A machine with
no qualifying backend must report image generation/editing unavailable; it
must not imply that a model is installed or silently contact a cloud provider.

The current adapter returns image bytes as a typed operation result. A complete
user-facing image workflow still needs a real local backend and an artifact or
canvas consumer that can display/open the produced image. Provider-specific
features such as masks, reference images, compound VAE/text-encoder placement,
and independent generator/editor pinning are not inferred from the base
adapter.

The local voice integration discovers existing executables and
`ggml-*.bin` Whisper models without downloading or loading them during
readiness checks. Transcription requires an installed `whisper-cli` or
`whisper-cpp` executable, an existing GGML model file, and an existing audio
file within the local input bound. Captured transcript output is bounded before
it is returned to the caller. TTS uses an installed `espeak-ng`/`espeak`; push
to talk uses `arecord` with explicit stop/cancel handling. These shell tools are
local alternatives, not neural audio-understanding, diarization, music
analysis, streaming STT, or streaming TTS providers.

For reviewed voice response, the user-facing handoff is explicit:

```text
audio artifact -> voice.transcribe -> editable transcript
                                      -> user submits reviewed text
                                      -> text.chat -> audio.synthesize
```

The direct `voice.conversation` path may compose the same local tools
sequentially when the required executable and Whisper model are present. A
transcript is never forwarded to a response skill merely because transcription
finished; the reviewed text submission is a separate user action.

## 2. Screenshot / UI understanding

Goal: user drops a screenshot and asks what is wrong with an interface.

Preferred route:

```text
image
  -> vision.screen
  -> UI structure / visible text / coordinates
  -> text.reason
  -> explanation
```

Optional enhancement:

```text
image
  -> OCR
  -> visible text ----+
                      +-> text.reason
  -> vision.screen ---+
```

OCR and vision can run in parallel and then be joined. The text model receives both with explicit source labels.

This route is useful when a compact screen/UI model is better at locating controls while a stronger reasoning model is better at diagnosis.

## 3. Image description / question answering

Simple route:

```text
image + question
  -> vision.understand
  -> answer
```

Higher-quality split route:

```text
image
  -> vision.understand with structured extraction
  -> scene JSON
question + scene JSON
  -> text.reason
  -> answer
```

The resolver can choose the one-model route when a capable multimodal model is already loaded, and the split route when specialist models provide a better local tradeoff.

## 4. Image editing from natural language

```text
source image + instruction
  -> vision.understand
  -> structured edit intent
  -> prompt/parameter transform
  -> image.edit
  -> edited image
```

Example structured edit intent:

```json
{
  "preserve": ["person pose", "background perspective"],
  "change": ["jacket color to red"],
  "mask_regions": ["upper-body clothing"],
  "style": "photorealistic"
}
```

If the image editor supports masks but no mask is provided, an optional segmentation skill can create one. That becomes an explicit extra node instead of a hidden behavior.

## 5. Image generation with language-model prompt assistance

```text
user idea
  -> text.generate / prompt-specialist
  -> generation specification
  -> image.generate
  -> image
```

The user should be able to disable the prompt-expansion step and pass the original prompt directly.

A generation specification can contain normalized fields:

```text
prompt
negative_prompt
aspect_ratio
seed
steps
style hints
reference image IDs
```

The runtime adapter maps only supported fields to the selected image backend.

## 6. Voice conversation

```text
microphone audio
  -> audio.transcribe
  -> transcript
  -> text.chat
  -> response text
  -> audio.synthesize
  -> spoken response
```

Useful variations:

- keep the transcript visible and editable before sending;
- stream partial STT later;
- start TTS on complete sentences later;
- use a diarization node for multi-speaker recordings;
- apply a prosody/emotion model only when the selected TTS pipeline supports it.

The first version should favor correctness and cancellation over aggressive real-time overlap.

## 7. Recorded meeting / media summary

```text
audio/video file
  -> extract audio (tool)
  -> audio.transcribe
  -> optional audio.diarize
  -> align transcript + speakers
  -> text.summarize
  -> summary + transcript artifacts
```

For long media, chunking is an explicit transform node with bounded windows. A later map/reduce summarization skill can summarize chunks in parallel and combine them.

## 8. Music analysis

```text
audio
  -> music.understand
  -> structured music analysis
  -> text.generate
  -> human-readable explanation
```

If a music model already produces natural-language output, the second step may be unnecessary. The skill should not force extra LLM usage when it adds no value.

## 9. Document Q&A with RAG

The first local implementation uses a stateless BM25-style lexical score over
bounded chunks. Every returned citation includes the bounded matched query terms
and lexical score so tests and reviewers can inspect why that passage ranked.
This score is a retrieval heuristic, not a probability of relevance. Keep the
ranking deterministic and evaluate it against fixed labeled passages before
claiming broader relevance quality; do not imply embeddings or reranking are
active when those routes are unavailable.

```text
document
  -> document.parse
  -> chunk transform
  -> embedding.create
  -> temporary vector index

question
  -> embedding.create
  -> retrieval.search
  -> rerank.score
  -> text.generate
  -> answer + source references
```

This should support both persistent knowledge bases and temporary one-run indexes. The difference is storage policy, not a completely separate architecture.

A lightweight local stack may omit reranking when no reranker is installed. That is an explicit optional node/fallback.

## 10. Scanned PDF Q&A

```text
PDF
  -> document.parse
     if text present -> chunks
     else -> render pages -> OCR -> chunks
  -> RAG path
```

The router branches based on parse result metadata. This is preferable to treating OCR as a manual separate product feature.

## 11. Document creation and PDF rendering

Creating high-quality documents is not primarily an LLM capability. It is a skill combining language generation with deterministic rendering.

Example:

```text
user request + source notes
  -> text.generate (outline/content)
  -> structured document model
  -> document.render
  -> PDF/DOCX/HTML artifact
```

The structured document model can be JSON containing sections, headings, tables, captions and style tokens. A renderer tool such as an HTML/CSS-to-PDF pipeline or another explicitly integrated document engine produces the final binary.

This is important because "PDF generation model" is usually the wrong abstraction. AI Dream should expose `document.create-pdf` as a skill and allow the text model and renderer to be replaced independently.

## 12. Code review

```text
repository/file selection
  -> filesystem read tool
  -> optional code indexing/chunking
  -> code.review
  -> findings JSON
  -> text.generate
  -> readable review
```

A stronger implementation can add tool calls for symbol search, tests and Git diff inspection while keeping write operations separately permissioned.

The skill can prefer a code-specialist model even if the current chat uses a general model.

## 13. Coding agent with tool use

```text
user task
  -> code agent model
  <-> registered code tools
  -> patch proposal
  -> user approval
  -> write/apply tool
```

This requires a different permission class from read-only analysis. The architecture must not infer write permission from the model's tool-calling ability.

## 14. Data analysis

```text
CSV/JSON/table
  -> deterministic parser
  -> schema/summary artifact
  -> code/data-science model
  -> optional Python sandbox tool
  -> result tables/plots
  -> text explanation
```

Generated code runs only inside an explicitly defined sandbox executor. A generic shell node is not necessary.

## 15. Search + synthesis

Local-first search:

```text
query
  -> local index / configured search tool
  -> retrieved documents
  -> reranker
  -> text.generate
  -> sourced answer
```

Future network search can be another tool capability with explicit network permission. It should not be conflated with the language model.

## 16. Memory-assisted chat

```text
new message
  -> memory.retrieve
  -> relevant memory snippets
  -> text.chat
  -> response
  -> optional memory candidate extraction
  -> user/policy-gated memory.store
```

Retrieval and persistence are separate. A run can use memory without automatically writing new memory.

## 17. Translation pipeline

Simple:

```text
text -> text.translate -> translated text
```

Document-aware:

```text
document -> document.parse -> translate chunks -> preserve structure -> document.render
```

This illustrates why the same capability can appear inside a larger skill without the user manually moving content between screens.

## 18. Domain specialist + general explanation

For medicine, finance, legal or scientific tasks, a domain model can produce a structured specialist result and a general language model can rewrite or summarize it.

```text
input
  -> domain specialist
  -> structured domain result
  -> general language model
  -> user-facing answer
```

The system should preserve provenance so the final result can show which step came from which model.

## 19. Router patterns

Common routers include:

```text
attachment type router
language router
text-PDF vs scanned-PDF router
model availability router
resource fallback router
user manual/auto mode router
```

Routers should use deterministic facts when possible. A model-based classifier is appropriate only when the routing question is semantic and cannot be answered from metadata.

## 20. Fan-out / fan-in patterns

Useful examples:

```text
one document -> summarize chapters in parallel -> final summary
one image -> OCR + vision in parallel -> merged reasoning
one code change -> security review + style review + test-impact review -> combined report
one query -> retrieve from several indexes -> rerank -> answer
```

The join node records all inputs and can apply explicit deduplication or ranking rules.

## 21. Caching

Deterministic or expensive intermediate artifacts can be cached by a content-derived key containing:

```text
input artifact hashes
model/skill version
profile/runtime identity where output may change
relevant parameters
```

Examples: OCR text, document parsing, embeddings and thumbnails are good cache candidates. Conversational generation usually is not unless the user explicitly asks for reproducibility.

## 22. What the user sees

Even complex pipelines should collapse into a simple summary by default:

```text
Edit image
Using: Vision 4B -> FLUX editor
Status: analyzing image ... generating ... done
```

An expandable plan shows the detailed graph, model profiles, timings and intermediate artifacts. Expert visibility should be available without forcing every user to operate the graph manually.
