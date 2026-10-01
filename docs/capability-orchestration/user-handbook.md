# AI Dream capability workspace: user handbook

This handbook explains how to use the capability, skill, model and run
workspaces that are implemented today. Availability depends on the current
machine and its configured local providers. A card or plan can describe a
workflow without proving that a compatible provider is installed or that its
output quality has been verified.

The **Implemented today** notes below describe documented UI or backend
behavior. **Not available or not verified** calls out host limitations and
features that remain aspirational. For the latest command evidence, see
[Testing guide](testing-guide.md) and [Readiness](readiness.md).

## Start here

The application opens in Chat. Use the navigation to move among:

| Area | Route | Use it for |
|---|---|---|
| Chat | `/chat` | Ask a question, choose a routing mode, attach supported files, and hand work to a skill. |
| Skills | `/skills` | Browse task workflows, check readiness, provide typed inputs, preview a plan, and start a run. |
| Capability Map | `/capability-map` | Inspect discovered capability routes, their evidence/status, and linked skills. |
| Model Studio | `/models` | Browse local model entries, their declared roles/capabilities, and model profiles. |
| Resources | `/resources` | Inspect hardware/residency information and manage supported model residency controls. |
| Runs | `/runs` | Follow workflow progress, inspect results and artifacts, cancel active work, and review recovered runs. |
| Canvas | `/canvas` | Inspect supported run/session content and artifact previews. |
| Knowledge | `/knowledge` | Search the app-managed local text index. |

The names above are navigation destinations; they do not imply that every
provider or skill shown in a design proposal is available on this computer.

## Choose a task in Skills

1. Open **Skills** and search by a goal such as “create a PDF report,” or by a
   skill name. The goal search ranks matches from the installed catalog's IDs,
   names, categories, descriptions and declared input/output kinds. It is a
   local metadata search: it does not ask a model, infer a capability, or add a
   skill that the API did not report. Use readiness filters to narrow results.
2. Read the skill card. It describes accepted input types, outputs and whether
   its required local routes are ready.
3. Open **Plan or run** for the task. Enter text or JSON fields, or attach a
   file to a typed input when an upload control is available. The form accepts
   only the artifact kinds and formats declared by that skill.
4. Review any permission requirement shown for the skill. A pending, denied or
   failed permission check can keep the workflow from running. Grant only the
   access needed for the task.
5. Select **Preview plan**. Planning validates the graph, typed connections and
   current routes; it does not start model inference. Inspect the selected
   components, requirements and warnings in the preview.
6. Select **Run skill** only after the plan is ready and its route/inputs look
   right. The app opens the new run in Runs so you can follow it.

The current API also rechecks skill readiness when execution starts. A skill
that became unavailable after preview is rejected before a run is created.
Guided confirmation is bound to the reviewed plan ID: if route resolution
changes, the app asks you to preview and review the plan again.

### Understand readiness labels

| Label | Meaning and next step |
|---|---|
| **Ready** | The app currently found the required route declarations for this skill. This is not a guarantee of model quality or a successful future run. Preview the plan and inspect its selected route. |
| **Not ready** | At least one required local capability or route is missing/unavailable. The card provides a reason and, when possible, a practical alternative. Configure an eligible local provider or use the suggested text-only/other workflow. Run is disabled and the API also refuses execution. |
| **Unknown** | The app could not establish current evidence for a requirement. Treat availability as unconfirmed. Refresh/retry the relevant inventory or inspect the Capability Map and local provider status. |
| **Run failed** | A started workflow encountered an execution/provider/input error. Open the run details and inspect node events and the error; fix the specific input or local service, then submit a new run. |

Readiness discovery is intended to inspect local facts without loading a model
or synthesizing/recording audio. Explicit run, load, verify, or provider
operations may have local side effects described in the provider guide.

## Auto, Guided and Manual selection

These modes control route selection; they do not install missing providers.

- **Auto** asks the resolver to choose among routes that satisfy the skill's
  hard requirements and current resource rules. Open the plan preview or Chat
  plan inspector to see what it selected. Auto does not mean remote fallback.
- **Guided** shows the proposed route and available alternatives where the
  workflow supports replacement. Inspect the plan and any changed route before
  confirming. Confirmation uses the same reviewed plan ID and route pins; a
  stale plan requires a fresh preview.
- **Manual / pinned** is for explicitly choosing a compatible model/profile or
  route. A hard pin is a constraint: if that exact choice is unavailable or
  incompatible, the run fails validation rather than silently selecting a
  different model.

The mode can be selected where the Chat/Skills selection controls are shown.
Exact replaceable nodes depend on the skill; not every workflow exposes a
model/profile chooser. When no valid route exists, changing modes cannot make
the missing provider appear.

### Assisted planner is a separate opt-in

The global **Assisted plan drafts** setting is off by default. Deterministic
route preview remains available while it is off. To request an assisted draft,
enable that setting, open **Plan or run** for an installed skill, enter its
declared inputs and describe the goal. The action requires a local model that
is already loaded in Chat or Runtime. It never loads a model for you and does
not fall back to a hosted service. If no model is loaded, load one explicitly
in Chat or Runtime and return to Skills.

After you request a draft, the API validates its structure against installed
skill/component contracts and resolves a deterministic plan. Before approving,
check that the skill ID and name shown in that resolved plan exactly match the
skill you chose. Do not approve or run a plan if they differ. Deterministic
binding between the selected skill and the assisted draft is still being
verified; this manual comparison is not proof of that binding. Compare the
draft with the resolved routes and requirements. The **I reviewed the
validated draft and resolved plan** checkbox is required before **Run skill**
is enabled. If the route changes after review, the old plan is rejected;
preview and review the current plan again. Drafting is an explicit request and
is separate from starting a workflow.

The current browser smoke uses API fixtures. It verifies goal search against
fixture skill metadata, the opt-in off/on controls, a fixture-reported loaded
model status, and a 390 px layout without horizontal overflow. It also checks
that this smoke makes no model-load or run request. A source-level UX check
verifies that the draft and resolved plan have separate review panels and that
the acknowledgement remains a Run gate. **The browser fixture did not render
the expanded composer’s goal/draft/approval controls**, so the interactive
generate → compare → acknowledge → enable Run sequence and its responsive panel
layout still need dynamic browser verification. The smoke does not use a real
model, and real-model draft quality is not established on this host; see
[Local provider operations](local-provider-operations.md#assisted-planner).

## Use Chat and hand off an attachment

1. Open **Chat**, enter a prompt and optionally attach a supported file.
2. Choose the offered skill suggestion if one matches the attachment and your
   intent. A suggestion does not change the task automatically; confirm the
   target skill and its typed input.
3. Follow the preview/route confirmation when the selected mode requires it.
4. To continue inspecting a workflow result, use its Run link or open the
   artifact in Canvas.

Chat remains useful for text conversations through a compatible local
`text.chat` route. Chat can suggest explicit image/document/audio skills from
attachments. Direct multimodal chat is not implied: a suitable model/runtime
must advertise and support that input type, and a skill handoff may be the
available path.

## Capability Map and Model Studio

### Capability Map

Open **Capability Map** to search and filter discovered capabilities and inspect
their current status/evidence and linked skills. Use it to answer “what route
did this installation discover?” and then open the linked skill to see whether
its complete requirements are ready. A capability declaration is not a
semantic benchmark or a guarantee of output quality. Missing or `unknown`
evidence should be treated as unavailable for the task until resolved.

### Model Studio

Open **Model Studio** to inspect available local model entries, declared
input/output roles, capability information and profiles. A model file being
present does not by itself mean it is compatible, loaded, verified or selected
for a skill. Review the model detail and profile information before loading or
pinning it. The manifest-verification action is unavailable when no supported
runtime-bound verifier has been configured; runtime health or a help command
does not substitute for a semantic capability probe.

Use Runtime/Model Studio controls to load or unload a local model when needed.
Prefer a skill's resolved route for ordinary work; use explicit pins when you
need to retain expert control and accept the compatibility constraint.

## Resources and residency

Open **Resources** from the navigation or the resource indicator. It presents
available hardware/residency facts and supported controls such as the idle
eviction policy, pin/unpin, and unload for eligible residents.

- **LRU idle models** permits eviction of an idle, unpinned model under
  measured memory pressure.
- **Never evict automatically** preserves current residents; a requested model
  may then be unable to fit.
- **Pin** keeps an eligible model resident; **Unpin** restores normal eviction
  eligibility. **Unload** is available for eligible idle models.
- `Unknown` means the host/runtime did not report a measurement. Do not treat
  an unknown VRAM estimate as free capacity.

Residency-changing actions can be refused while Chat or a workflow is using an
active runtime. Wait for the operation to finish or cancel it, then retry. The
resolver may still reject a route if its hard requirements or resource headroom
do not fit.

## Follow a run and keep its results

The **Runs** list shows queued/running/completed/failed/cancelled workflows.
Open a run to inspect its selected plan, node lifecycle events, error details,
outputs and available artifact actions. Cancel is best-effort for active
providers: queued work may be removable, but a provider call already running
may need to finish or cooperate with cancellation.

Run metadata and sanitized events use a bounded local journal. After an
application restart, an interrupted active run is marked failed with a
`process_restarted` reason; it is not resumed. Run output values and artifact
bytes are not durably journaled. Artifacts are temporary and owner-scoped, so
download important output while it is available. If a preview reports an
ownership/availability error, retry from the run that owns the artifact; if it
has expired or the process-local store is gone, rerun the skill to create a new
artifact.

Runs shows typed output and provides the actions supported for each artifact.
Text/JSON can be inspected directly; HTML preview is sandboxed; PDF has open or
download actions; other artifacts may be opened in Canvas where supported.
Canvas keeps result tabs for supported content kinds such as Markdown, JSON,
images, audio, PDFs and text documents. It is an inspection workspace, not a
promise that every arbitrary file or code patch can be rendered.

## Documents, HTML and PDF reports

For document workflows, pick a skill that matches the input: extraction,
summary, temporary document Q&A, or report generation. Upload only the source
file requested by its typed input and check the accepted format and size shown
in the form. The skill planner validates requirements before execution.

For a structured report, provide the declared text/JSON input and use the
report-producing skill available in the catalog. Current report rendering
supports bounded text, bullet-list and table sections. The HTML/PDF renderers
escape content and do not execute user-supplied HTML or arbitrary templates.
Inspect the result in Runs: preview HTML in its sandbox and open/download the
PDF. If line wrapping, table layout or pagination is unsuitable, edit the
source data and create a new report; the current renderer has known table and
template limitations.

### Temporary document RAG versus Knowledge search

These are two different workflows:

- **Knowledge** searches the app-managed local SQLite FTS5 text index. It is
  model-free lexical search that returns bounded snippets and document
  metadata. Select **Add document** to index a local TXT, Markdown, or
  text-based PDF file (up to 5 MiB; 40,000 extracted characters per document,
  80,000 indexed characters total, and 100 documents). Scanned PDFs are not
  OCR-processed. Search accepts up to 256 characters/16 words. You can remove
  an indexed document from its row. It searches the configured index, not an
  arbitrary path or the entire filesystem. If the index is empty, add a
  supported text document first. If it fails to load, use Refresh/retry and
  check the API status before interpreting it as an empty index.
- **Ask a document / temporary document RAG** takes a selected document and a
  question for a single run. Its local lexical retriever returns source
  citations with offsets and exact quotes; inspect the cited source in Runs
  before relying on the answer. It is not an embeddings or reranking service.

The retrieval score is a lexical heuristic, not a calibrated confidence value.
The small regression fixture results do not predict relevance for arbitrary
documents. Broader relevance evaluation, embeddings/reranking and OCR host
verification remain incomplete.

## Image and voice workflows: current boundaries

### Images

Image describe/edit/generate skills are available only when their required
local routes are ready. On the audited host, no ComfyUI service or image model
is configured, so real generation/editing is not available there even though
the bridge and deterministic tests exist. A configured ComfyUI route requires
an explicit loopback `AI_DREAM_COMFYUI_URL` and a compatible service/checkpoint;
provider discovery does not load the checkpoint or verify image quality.

The implemented ComfyUI edit path is whole-image, unmasked img2img. It does not
promise to preserve unaffected regions and does not support mask-based
inpainting in this bridge. Review every generated/edited image and download
important output while its run artifact remains available. See [Local provider
operations](local-provider-operations.md#comfyui-image-generation-and-unmasked-img2img).

### Audio and voice

On the audited host, **text-to-speech generation is available** through
FFmpeg's Flite filter. The TTS skill can return a local PCM WAV artifact; the
Skills shows the currently discovered Flite voices for `voice.respond` and
`voice.conversation`. Select one for a run or keep **Automatic default**;
existing API callers that omit this optional input continue to use the default.
The selected voice is checked against the discovered local list before FFmpeg
starts. The host also has the `spd-say` binary, but AI Dream playback
integration has not been verified; WAV generation does not mean the app can
play the result itself.

**Speech-to-text is not available on the audited host**: no Whisper CLI or
existing GGML model was found. `voice.transcribe` and dependent conversation
flows should show a missing-route reason and cannot produce a real transcript
here. If you already have a transcript and TTS is ready, `voice.respond` is the
explicit reviewed-text path: inspect/edit the text before it is sent to local
chat and synthesized. TTS availability does not imply transcription,
diarization, audio understanding, music analysis, or streaming. Other machines
may have different discovered routes. See [Local provider operations](local-provider-operations.md#local-speech-providers).

## Common problems and recovery

| What you see | What to do |
|---|---|
| Skill says **Not ready** | Read its missing-route reason and alternative. Check Capability Map and provider operations. Use an available alternative; do not keep retrying a route the host does not have. |
| Readiness is **Unknown** or page data fails to load | Refresh/retry the inventory/page. Check that the local API is running and inspect Logs/status. Do not interpret an API error as an empty catalog. |
| **Plan changed after review** | Preview again, inspect the newly resolved route and re-confirm. The server rejects the old reviewed plan before creating a run. |
| Run button remains disabled | Resolve missing typed inputs, permission checks, upload errors, unavailable skill status, or an unresolved/failed plan. The displayed reason indicates which condition to address. |
| Assisted draft is blocked or unavailable | Confirm the global **Assisted plan drafts** setting is enabled and a local model is already loaded in Chat or Runtime. The planner will not load a model automatically. If the goal/draft/review controls do not appear after opening **Plan or run**, use **Preview plan** for deterministic route checking and refresh the Skills page; the dynamic approval sequence is not covered by the current browser fixture. |
| Upload is rejected | Confirm that the field expects that artifact kind and that the selected file uses a listed format and fits the displayed size limit. Remove a failed upload and attach a supported file. |
| Run fails while loading/using a route | Open the run and locate the failed node/error. Check local provider/runtime state, profile compatibility and resource availability. Correct the pin/input or free resources, then create a new run. |
| Preview/download says artifact unavailable | Retry from the owning run. Artifacts are owner-scoped and temporary; once expired or removed, rerun the skill. |
| Active run does not stop immediately | Cancellation may not interrupt a provider call already executing. Wait for its terminal state, then inspect whether the provider still has queued work. Do not assume a running ComfyUI job was interrupted. |
| A run is marked `process_restarted` | It was active when the process restarted. It is not resumed; submit a new run. Any artifact bytes from the earlier process may be unavailable. |
| Output looks wrong or resource estimate is `Unknown` | Treat the result/estimate as unverified. Inspect the selected model/provider and artifact, use a compatible route, and avoid assuming an unreported memory requirement is safe. |

## Implemented versus aspirational

The current UX includes a task catalog with readiness explanations, typed
planning/execution, Auto/Guided/Manual route behavior where supported,
permission gating, run traces, bounded local run metadata/event recovery,
owner-scoped temporary artifacts, Knowledge search, temporary lexical document
RAG, structured HTML/PDF reports, and CPU Flite TTS on the audited host.

The following are not promised as available: local image generation on this
host; Whisper/STT on this host; real-model assisted planning quality; model
semantic verification without a configured verifier; diarization or general
audio/music understanding; embeddings/reranking; automatic remote fallback;
mask-based ComfyUI editing; durable run output/artifact storage; and perfect
visual rendering for every artifact. UX concepts in [UX architecture](ux.md)
that are not identified as implemented in [Readiness](readiness.md) should be
read as design goals, not present buttons or functionality.

## Further reading

- [Local provider operations](local-provider-operations.md): prerequisites,
  side effects, limits and evidence for ComfyUI, speech tools and assisted
  planning.
- [Testing guide](testing-guide.md): actual commands, recorded check results,
  browser fakes and host capabilities that remain unavailable.
- [Readiness](readiness.md): current estimates, evidence, risks and remaining
  implementation/UX work by area and phase.
- [Skills and workflows](skills-and-workflows.md): input/output and workflow
  semantics, including voice, retrieval and report skills.
- [UX architecture](ux.md): intended UX design, including sections that remain
  aspirational.
