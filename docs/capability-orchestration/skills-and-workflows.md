# Skills and workflow graphs

A skill is the main user-facing unit of composition. It describes a goal, accepted inputs, produced outputs, required capabilities, execution steps, permissions and UI metadata. Skills make multimodal composition explicit instead of burying orchestration inside prompts or Angular components.

## 1. What a skill is

A skill is not a model preset and not merely a prompt template.

A useful definition is:

```text
Skill = typed task contract + workflow graph + policy + defaults + presentation metadata
```

A one-model task is still a skill if it provides useful reusable behavior. More complex skills can coordinate multiple models and tools.

Examples:

```text
chat.general
code.review
document.summarize
document.answer-with-rag
image.describe
image.edit-from-instruction
voice.conversation
voice.respond
media.transcribe-and-summarize
document.create-pdf
screen.explain
research.local-folder
```

## 2. Skill manifest

Recommended schema:

```yaml
schema_version: 1
id: document.answer-with-rag
name: Ask a document
version: 1.0.0
description: Parse a document, retrieve relevant chunks and answer with citations.

inputs:
  - name: document
    artifact: document
    required: true
  - name: question
    artifact: text
    required: true

outputs:
  - name: answer
    artifact: text
  - name: sources
    artifact: json

requirements:
  capabilities:
    - document.parse
    - embedding.create
    - rerank.score
    - text.generate

permissions:
  filesystem_read: user-selected-only
  filesystem_write: none
  network: none
  desktop_control: none

policy:
  max_steps: 12
  timeout_seconds: 180
  continue_on_optional_failure: false

ui:
  category: Documents
  icon: file-search
  suggested_from:
    - application/pdf
    - text/markdown

graph: []
```

The manifest describes what the skill needs; it does not hard-code a specific model unless the skill genuinely requires one.

## 3. Workflow node types

Keep the initial executor small. Recommended node types:

```text
capability      invoke one resolved AI capability
model           invoke an explicitly pinned model/profile
skill           call another skill as a bounded sub-run
tool            invoke a registered deterministic tool
transform       deterministic local conversion/map/filter/template
router          select one branch from typed conditions
parallel        declare a typed fan-in barrier over independent graph branches
join            combine branch results
loop            bounded iteration with explicit max iterations
input           expose skill input artifact
output          publish a skill output artifact
```

The initial static `parallel` contract uses `in` to map at least two branch
names to outputs of distinct nodes, `accepts` to declare each artifact kind,
and `out` to republish the same names and kinds after the barrier. Branch nodes
that are ready together execute concurrently only when
`policy.max_parallel_nodes` is at least two; the limit is bounded to eight.
The executor emits lifecycle events in stable graph order even when branch
completion timing differs. Every ready route layer is reserved in one atomic
scheduler batch before any branch invokes a model; the batch accepts at most
eight routes, matching the parallel width limit.

A `loop` names one registered transform, one typed input and output of the
same artifact kind, and an integer `max_iterations` from one to eight. Every
iteration receives the prior iteration's output. The worst-case iteration
count contributes to `policy.max_steps`, and registered handlers are checked
for the complete graph before the first handler runs.

An initial `fallback` node may name two to four ordered, distinct registered
transform candidates. Each candidate receives the same typed inputs and must
produce the node's declared output types. The executor tries candidates in
declaration order and stops at the first valid result; manifest data can name
registered transforms but cannot import or construct executable code. A
fallback node requires a typed trace callback. Its `FallbackTrace` contains the
base plan revision, attempted and selected candidate IDs, sanitized failure
class names, and a deterministic revision ID when a later candidate succeeds.
Exhaustion emits a trace event without creating a new plan revision. Callers
should pass the concrete resolved plan ID as `plan_revision`; otherwise the
executor uses a manifest and graph fingerprint as the base revision.
Run cancellation propagates immediately and is never treated as an ordinary
candidate failure, so it cannot silently advance to a fallback branch.

Do not add arbitrary shell/script nodes to the default schema.

## 4. Graph example: voice conversation

```yaml
graph:
  - id: mic_text
    type: capability
    capability: audio.transcribe
    in:
      audio: $input.audio
    out:
      transcript: transcript

  - id: answer
    type: capability
    capability: text.chat
    in:
      text: $mic_text.transcript
    out:
      response: response

  - id: speech
    type: capability
    capability: audio.synthesize
    in:
      text: $answer.response
    out:
      audio: reply_audio

  - id: result
    type: output
    in:
      text: $answer.response
      audio: $speech.reply_audio
```

The resolver selects compatible implementations for the three capability nodes. The skill itself stays portable.

For transcript review, run `voice.transcribe` first, inspect and edit the text
output, then pass the reviewed transcript as the required `transcript` input to
`voice.respond`. That workflow contains only text chat followed by local TTS;
it does not accept audio or automatically reuse an unreviewed transcription.
Its optional `voice` text input can select one of the local Flite voices exposed
by the capability API; `auto` or an omitted input preserves the provider
default, including for legacy API callers. The local callback checks explicit
choices against the current discovered list before synthesis. Its plan is
rejected when the local TTS route is unavailable, while the catalog offers
ordinary text chat as the text-only alternative.

## 5. Graph example: image editing with interpretation

A natural-language image editing task may work better as two specialists:

```text
input image + user instruction
        |
        v
vision model analyzes image/instruction
        |
        v
structured edit specification
        |
        v
image editing model
        |
        v
edited image
```

The graph can explicitly require structured JSON between the models. This is safer than letting one model invent an undocumented prompt format for another.

## 6. Typed edges

Every graph edge is type-checked before execution. A node producing `embedding_batch` cannot be connected directly to a node requiring `image`.

Transform nodes perform explicit conversions such as:

```text
document -> text chunks
image -> normalized image
json -> text template
chat_messages -> text prompt
file_reference -> document
```

A conversion must be registered. There is no implicit "serialize everything to text" escape hatch in normal execution.

## 7. Capability selectors

A capability node may declare constraints and preferences:

```yaml
- id: reasoning
  type: capability
  capability: text.reason
  select:
    required_features: [structured_output]
    max_vram_gib: 12
    prefer:
      quality: 0.6
      speed: 0.2
      already_loaded: 0.2
```

Hard fields filter candidates. Preference fields rank valid candidates.

A node may also specify:

```yaml
profile_class: balanced
fallback_capabilities: [text.generate]
allow_user_pinned_model: true
```

## 8. Explicit model nodes

Expert workflows need pinning:

```yaml
- id: coder
  type: model
  model_id: model_...
  profile_id: profile_...
  operation: text.generate
```

Pinned nodes fail clearly if the selected route is unavailable. They should not silently swap models unless the user enabled a fallback policy.

## 9. Skill parameters

Skills expose their own domain-level parameters rather than leaking raw backend options everywhere.

Example for document summarization:

```yaml
parameters:
  style:
    type: enum
    values: [brief, detailed, study-notes]
    default: detailed
  max_sections:
    type: integer
    min: 1
    max: 30
    default: 8
```

A skill may map those settings onto prompts or generation settings internally. Runtime parameters remain in model/profile controls.

## 10. Permissions

Every skill declares permissions independently from model capabilities.

Initial permission dimensions:

```text
filesystem_read: none | user-selected-only | scoped-paths
filesystem_write: none | user-approved-output | scoped-paths
network: none | specific-hosts | unrestricted
shell: none | registered-command-only
browser_control: none | allowed
computer_control: none | allowed
microphone: none | allowed
camera: none | allowed
clipboard: none | read | write | read-write
```

The first implementation should default almost everything to `none` and reuse the current bounded read-only tool philosophy.

A workflow node cannot elevate the permissions declared by its parent skill/run.

## 11. Skill installation sources

Recommended precedence:

```text
built-in skills
user-installed skill packages
workspace/project skills
user-local overrides
```

Every skill has an ID and semantic version. A chat/session stores the exact skill version used for reproducibility.

Untrusted downloaded skills must never execute arbitrary Python merely because a YAML references it. The safe path is declarative nodes plus a curated executor/plugin interface.

## 12. Built-in versus extension skills

Built-in skills should cover the common local stack and serve as reference implementations. Extension packages may contribute:

```text
skill manifests
model manifests
capability aliases
safe transforms
UI metadata
optional executor plugins through an explicit plugin API
```

The plugin API should be a later phase. The first release can achieve a lot with declarative graphs and registered tools.

## 13. Planning modes

There are two distinct ways a run can obtain a graph.

### Deterministic skill plan

The user selects a skill. AI Dream resolves its static graph to concrete models/tools. This should be the first implementation.

### Assisted plan

A planner LLM receives the list of installed skills/capabilities and may choose a bounded composition. Its output must validate against the same graph schema. Invalid nodes, undeclared tools or unavailable capabilities are rejected.

The planner never receives authority to execute arbitrary code.

## 14. Skill composition

Skills can call other skills. Example:

```text
research.local-folder
  -> document.parse-many
  -> retrieval.index-temporary
  -> question.answer-rag
```

Sub-skills inherit run permissions and resource limits. The run trace should show the hierarchy rather than flattening everything into one opaque list.

The executor supports bounded typed subskill calls. It validates exact child input/output ports,
rejects cycles and nesting deeper than four, charges the child's worst-case
steps to the parent budget, prevents a child from widening the parent's
permissions, and emits hierarchical node events. The planner descends through
installed subskills and names each route with a stable path such as
`summarize/extract/chat`; that same path ties the selected route and lease to
the executing child node, including when a skill is called more than once.
`ExecutionPlan.resource_budget.max_parallel_routes` exposes the root skill's
bounded route-concurrency budget. A shared, cancellation-aware semaphore applies
that cap across all nested branches, while each child's `max_parallel_nodes`
continues to cap its local DAG batches. Each route layer reserves its leases as
one scheduler batch before invoking any branch; failed reservations roll back
acquired leases and release route slots, and layer cleanup attempts every lease
even if one release fails. Unknown RAM/VRAM estimates remain unenforced by the
scheduler. The assisted-planner draft gate can only select an already installed
skill and must match its declared capability/model nodes; it cannot synthesize
a sub-skill graph.

## 15. State and memory

Skill execution state is distinct from conversational memory.

A run stores:

```text
plan
resolved component IDs
artifacts
node states
timing/resource observations
events/errors
output references
```

A conversation may reference one or more runs. This avoids stuffing every intermediate artifact into chat history.

A future memory skill can explicitly persist selected facts into a memory store. That is different from the workflow engine retaining operational state.

## 16. Cancellation

Cancellation is propagated from the run to active nodes:

```text
run cancel
 -> capability invocation cancel
 -> runtime request cancel
 -> optional model lease release
 -> temporary artifact cleanup
```

Parallel branches receive cancellation together. Nodes should have explicit cleanup semantics.

## 17. Failure semantics

Node failures are structured:

```json
{
  "node_id": "vision",
  "kind": "resource_unavailable",
  "message": "Required profile needs 9.8 GiB free VRAM; 6.1 GiB is available",
  "retryable": true,
  "candidates": ["low-vram-profile"]
}
```

The workflow policy decides whether an optional branch can be skipped. Required node failures stop the run unless a declared fallback exists.

## 18. Why skills matter for UX

Without skills, users must understand model families, runtime flags and how to manually transfer output between models. With skills, they can ask for "Edit this image", "Review this repository" or "Create a PDF from these notes" while still being able to open the plan and see exactly which components are used.

This makes a large local model collection coherent instead of turning AI Dream into a launcher with dozens of unrelated buttons.

## 19. Deterministic report sections

`document.create-report` accepts structured JSON and renders a safe HTML
document. `document.create-report-pdf` accepts the same input and renders a
paginated PDF. Each section has a required heading and an explicit renderer
kind; the existing `{heading, body}` text shape remains valid for compatibility:

```json
{
  "title": "Release status",
  "summary": "Prepared from verified run outputs.",
  "sections": [
    {"heading": "Overview", "kind": "text", "body": "The release is ready."},
    {"heading": "Actions", "kind": "bullets", "items": ["Publish", "Notify support"]},
    {"heading": "Checks", "kind": "table", "columns": ["Check", "State"],
     "rows": [["Tests", "Passed"], ["Review", "Complete"]]}
  ]
}
```

Both renderers accept only `text`, `bullets`, and `table` sections, escape HTML
cells, and do not accept HTML or arbitrary template code. PDF tables use
labeled pipe-separated rows to keep each value associated with its column in
the paginated text flow. Limits are 32 sections, 100 list items or rows per
section, 12 table columns, 8,000 characters per table cell and 256,000 total
report characters. HTML layout and PDF pagination remain deterministic and
model-independent.

## 20. Search the app-managed knowledge index

`knowledge.search` is a model-free built-in workflow backed by the same local
SQLite FTS5 index as `/api/knowledge/search`. It accepts one text query and
returns JSON containing at most ten bounded snippets and document metadata.
The handler reads only the configured app-managed index; the query cannot name
paths, retrieve source files, or select another owner. This index is local to
the AI Dream installation and is not a per-chat or multi-user collection.
The skill declares scoped filesystem read, no filesystem write and no network
access. It is a tool-backed workflow; the regular capability planner does not
load a model for it. Temporary single-document Q&A remains `document.answer-with-rag`
and keeps its separate source-offset citation contract.
