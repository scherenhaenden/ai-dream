# UX architecture for capabilities, skills and model loading

The technical architecture only succeeds if users can understand and control it. A workstation with forty specialist capabilities can easily become unusable if the interface exposes every runtime knob at the same level.

The UX should separate **what the user wants to do** from **how a specific model is loaded**, while keeping both directly reachable.

## 1. Three operating modes

AI Dream should support three interaction styles in the same UI.

### Auto

The user chooses a task or simply provides inputs. AI Dream selects a valid skill, model(s), runtime(s) and profiles. The selected plan is visible but does not require confirmation for normal read-only/local inference.

### Guided

AI Dream proposes a plan and exposes replaceable nodes. The user can swap the vision model, choose another TTS voice/model or select a low-VRAM profile before starting.

### Manual / pinned

The user chooses the exact model, profile and runtime. AI Dream validates compatibility and resources but does not silently substitute another route.

This avoids the false choice between an opaque assistant and a low-level model launcher.

## 2. Model library cards

Model cards should show the semantic information needed for orchestration, not only filename/size/quantization.

Recommended compact card fields:

```text
Model name
status badge: Present / Runnable / Verified / Loaded / Error
input chips: Text, Image, Audio, Video, Document
output chips: Text, Image, Audio, Embeddings, JSON, ...
role chips: Chat, Reasoning, Coding, OCR, TTS, Image Edit, ...
runtime badge(s): llama.cpp / vLLM / ...
active/default profile
memory estimate
verification/evidence indicator
```

A compact card should answer "what is this useful for?" in two seconds.

## 3. Model details are also the configuration screen

Selecting a model should open a detail panel/page containing its launch configuration. Do not force the user through unrelated settings screens.

Recommended sections:

```text
Overview
Capabilities
Inputs / outputs
Artifacts / dependencies
Runtime compatibility
Profiles
Current load state
Benchmarks / verification
Advanced metadata
```

Primary actions:

```text
Use
Load
Unload
Verify
Create profile
Edit profile
Set as preferred for capability
```

The current control-plane profile work fits naturally here.

`Verify` must explain that it starts the selected local runtime and performs a
bounded capability probe. Show the action only when that runtime probe is
configured; otherwise show the exact unavailable reason. A profile or claim
becomes verified only from the typed successful probe result, never from user
metadata.

## 4. Profiles in context

Profiles should appear under the model they belong to and show purpose clearly:

```text
Balanced — verified on this machine
Low VRAM — 16k context, partial offload
2x GPU — tensor split 55/45
Max context — 64k, slower
Vision — binds projector X
```

Advanced runtime fields can remain collapsible. The user should first see the semantic result of the profile, not an uninterrupted wall of flags.

## 5. Skills as the primary task catalog

Add a Skills area grouped by user goal rather than model family.

Possible categories:

```text
Chat & Reasoning
Coding
Images
Documents
Audio & Voice
Video
Knowledge & Retrieval
Automation / Agents
Data & Analysis
```

Skill cards show:

```text
name
description
accepted input types
output type
ready/not-ready state
required missing capabilities if not ready
current preferred route
```

Example:

```text
Create PDF
Text / documents -> PDF
Ready
Route: Gemma 12B + HTML/PDF renderer
```

## 6. Composer-driven suggestions

The chat/workspace composer can infer obvious modality from attachments without using an LLM.

Examples:

```text
attach image -> suggest Describe image / Edit image / OCR
attach PDF -> suggest Summarize / Ask document / Translate
attach audio -> suggest Transcribe / Voice conversation
attach code folder/diff -> suggest Review code
```

These are suggestions, not automatic task changes.

Voice conversation is a sequential STT → text chat → TTS workflow and is offered
as a selectable skill, not an automatic change to chat. Its readiness must show
missing local routes (including the whisper model or speech synthesizer); when
unavailable, the catalog should point to transcript-only or text-chat alternatives.
Do not label diarization, general audio understanding, or music analysis as
available unless a compatible local route is discovered.

A user can still send an image to normal multimodal chat if the selected model supports it.

## 7. Plan strip inside chat/workspace

When a turn uses orchestration, show a small execution strip:

```text
Using: OCR -> Gemma 12B
```

or:

```text
Using: Qwen Vision 4B -> FLUX Editor
```

Clicking it opens the plan inspector.

During execution:

```text
Analyzing image ...
Loading image editor ...
Generating ...
```

Avoid pretending that one model is doing everything when the system is switching specialists.

## 8. Plan inspector

The plan inspector is the expert bridge between automatic orchestration and manual control.

For each node show:

```text
step name
capability
selected component/model
profile/runtime
input/output types
status
timing
resource estimate/observation
selection reason
alternatives
```

A replace action lets the user choose another compatible model without editing YAML.

If the user pins a replacement, that choice can apply to:

```text
this run only
this chat/workspace
this skill
always for this capability
```

The scope must be explicit.

## 9. Resource dashboard

A multi-model application needs a persistent but non-intrusive load view.

Recommended top-level indicator:

```text
GPU0: 10.2 / 16 GiB
GPU1: 7.4 / 16 GiB
RAM: 23 / 32 GiB
Loaded: 2 models
```

Keep a compact version in the global header. Show free/total VRAM for each reported GPU, available RAM and loaded model count; use `Unknown` when an observation is missing. Link the indicator directly to Resources.

Clicking opens the model residency drawer:

```text
Gemma 12B     loaded / idle     7.3 GiB   pinned
Qwen Vision   loaded / busy     3.1 GiB   skill: image.describe
FLUX Editor   waiting           needs 5.8 GiB
```

Actions:

```text
Unload idle model
Pin / unpin residency
Change default eviction policy
Open model profile
```

The initial policy control offers `LRU idle models` and `Never evict automatically`. LRU may unload only the oldest idle, unpinned resident under measured memory pressure. Never preserves existing residents and explains when a requested route cannot fit.

## 10. Explain why something cannot run

Avoid generic disabled buttons. A skill/model can be unavailable for different reasons:

```text
model artifact missing
runtime missing
companion projector missing
profile invalid for runtime
insufficient estimated VRAM
permission not granted
capability only inferred, verification required by policy
```

Show the exact reason and the shortest repair action.

Example:

```text
Image Edit is not ready.
FLUX editor is installed, but no compatible image runtime is configured.
[Configure runtime]
```

## 11. Auto selection explanation

Auto mode should provide a compact rationale:

```text
Selected Qwen Vision 4B because:
- supports screen understanding
- verified with current runtime
- already loaded
- fits current VRAM budget
```

Do not expose a meaningless numeric score by default. The underlying ranking components can be shown in advanced details.

## 12. Output-aware workspace

Not every skill output belongs as plain chat text.

The workspace should render artifacts by type:

```text
text -> Markdown response
image -> image preview + save/open actions
audio -> player
document/PDF -> preview/download/open
JSON -> structured viewer
table -> table view
code patch -> diff view
```

A run can produce several artifacts. Chat text can summarize them while artifact cards remain first-class.

## 13. Canvas integration

The existing canvas concept should become an artifact/view surface rather than "the last code block".

Each generated artifact/code block gets a stable ID and an **Open in Canvas** action. Canvas tabs can contain:

```text
HTML preview + source
Markdown source + rendered view
code editor
JSON viewer
image result
PDF/document preview
workflow plan visualization later
```

New outputs should not replace the user's currently opened canvas unless the user explicitly chooses that behavior.

This also creates a natural surface for skills such as HTML generation, document creation and image editing.

## 14. Capability-aware model selector

When the user is inside a skill/node, the model selector should filter to compatible choices.

Example inside `image.edit`:

```text
show image-editing models first
hide pure text models from default list
allow 'show incompatible' for debugging
```

Incompatible entries may remain visible with explanations when expert mode is enabled.

## 15. Default preferences

Preferences should be semantic:

```text
Preferred general chat model
Preferred coding model
Preferred vision model
Preferred embedding model
Preferred TTS stack
Preferred image generator
Preferred image editor
```

These map capability groups to model/profile choices. Users should not need a giant global settings form with runtime IDs unless they want advanced control.

## 16. Setup assistant

A future first-run/setup assistant can scan the current local stack and produce a capability map:

```text
Chat              ready
Reasoning         ready
Coding            ready
Vision            ready
OCR               ready
Speech-to-text    missing model
TTS               ready
Image generation  runtime missing
Image editing     not configured
RAG               embedding ready, reranker missing
```

Each row links to a concrete setup action.

This provides the product equivalent of the capability map image: not a static poster, but a live map of this computer.

## 17. Capability map screen

A dedicated capability map can show all categories with status:

```text
Ready
Available but unverified
Partial / fallback route
Missing dependency
Not installed
```

Clicking a capability shows:

```text
registered models/tools
preferred route
skills using it
verification records
missing dependencies
```

This becomes AI Dream's "what can my machine do?" screen.

## 18. Avoiding UI explosion

Do not create one major navigation page per capability. Most users need:

```text
Chat / Workspace
Skills
Models
Capability Map
Runtime / Resources
Settings
```

Specialist experiences can open as contextual panels or skill views.

## 19. Safety/permission UX

Read-only local inference should be frictionless. Operations with side effects get clear approval boundaries.

Examples:

```text
Read selected file: implicit from file selection
Save generated PDF: user chooses destination
Modify repository: explicit approval
Control desktop: explicit enablement and visible active state
Network search: visible network capability and configured scope
```

The user should be able to see permissions before running a skill.

## 20. Success criterion

A user with twenty local specialist models should be able to open AI Dream and understand:

```text
what each model does
which models are actually runnable
which tasks the whole system can perform
which components a task will use
why a component was selected
how much memory is occupied
how to override the automatic choice
```

If those answers require reading runtime logs or moving between unrelated configuration screens, the UX has failed even if the underlying orchestrator works.

## Assisted plan drafts (Phase 15)

The global assisted-planner opt-in is off by default. When enabled, the user must request a draft explicitly; generation can use only a model already loaded in Chat or Runtime and must explain when none is loaded. Never load a model just to draft a plan.

Show the generated JSON draft beside its deterministically resolved plan. Validate the draft against the installed skill and reject extra nodes, tools, fields or permissions. Require an explicit review acknowledgement before enabling Run. A normal deterministic plan preview remains available while assisted drafting is off.
