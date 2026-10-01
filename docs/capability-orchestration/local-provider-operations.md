# Local provider operations

This is an implementation reference for operators and integrators. It records
which local provider operations exist, their preconditions and side effects,
and the limits of current evidence. It is not a setup walkthrough or a claim
that a provider works on every host. Code and tests are authoritative when this
file becomes stale.

## ComfyUI image generation and unmasked img2img

### Activation and discovery

- AI Dream adds the ComfyUI adapter only when `AI_DREAM_COMFYUI_URL` is set to
  an explicit HTTP(S) origin. The value may be a numeric loopback address or
  `localhost`; `localhost` is normalized to `127.0.0.1`. Credentials, paths,
  query strings, fragments, non-loopback hosts, invalid ports, and redirects
  are rejected. The HTTP client disables proxy use.
- Without this variable, AI Dream does not discover or contact a ComfyUI
  service. On the audited host it is unset, and no ComfyUI/image model provider
  is configured. No local inference has been established there.
- A capability status check sends read-only `GET /system_stats` and
  `GET /object_info/CheckpointLoaderSimple` requests. Listed checkpoint names
  are metadata only. Discovery does not load a checkpoint, upload an image, or
  submit a workflow; it cannot verify semantic image quality or resource use.
- The service must be reachable at the configured loopback origin and list a
  safe checkpoint name. AI Dream's `load()` binds that listed checkpoint to a
  scheduler lease; ComfyUI loads model weights when an explicit workflow is
  submitted, not during discovery or `load()`.

### Operations, input limits, and local side effects

- `image.generate` submits a bounded core ComfyUI graph only when a user starts
  the generation skill. Prompt text is 1–8,000 characters. Supported options
  are width/height (multiples of 8 from 256 to 1,024), steps (1–40), CFG (0–30),
  seed (0–2^53−1), and negative prompt (up to 8,000 characters). Defaults are
  512×512, 20 steps, CFG 7, and a random seed. The shared option validator
  also accepts `denoise`, but generation ignores its value and fixes the graph
  at 1.0; `denoise` currently has an effect only for editing.
- `image.edit` accepts input bytes with a PNG or JPEG signature, up to 32 MiB,
  and an instruction of 1–8,000 characters. It uploads the bytes by multipart
  `POST /upload/image` with `type=input` and `overwrite=false`, validates the
  returned filename/subfolder/type, then queues
  `LoadImage -> VAEEncode -> KSampler -> VAEDecode -> SaveImage` against the
  selected checkpoint. The edit graph uses the input image's dimensions;
  width/height options do not currently resize it. Edit uses the same steps,
  CFG, seed, and negative-prompt limits as generation, plus denoise (default
  0.65). The source upload is written to ComfyUI's input area; AI Dream does
  not currently delete it after the operation.
- This is unmasked img2img editing. It applies the instruction to the image as
  a whole; it does not accept a mask or promise preservation of unaffected
  regions. Mask-based inpainting and provider-specific reference-image features
  are not implemented by this bridge.
- Both operations submit `POST /prompt`, poll `GET /history/{prompt_id}`, and
  fetch the output through `GET /view`. The workflow deadline defaults to 180
  seconds and is capped at 300 seconds; JSON responses are capped at 4 MiB and
  output image data at 32 MiB. AI Dream accepts PNG output and returns it as a
  typed image result for the run/artifact path.
- The operation may load/use the selected local checkpoint and GPU through the
  configured ComfyUI process. Checkpoint metadata is not a VRAM estimate; if
  the provider supplies none, resource requirements remain unknown. Output
  compatibility and visual quality remain unverified until a real run is
  reviewed. Canvas/browser presentation is also not verified on this host.

### Cancellation

- AI Dream can remove its own prompt only while ComfyUI reports it pending. It
  posts `{"delete":[prompt_id]}` to `/queue` and confirms with a fresh queue and
  history read. A successful ComfyUI delete may have an empty HTTP 200 body;
  AI Dream does not depend on a JSON response body.
- If the prompt is running, has left the pending queue, or races into the
  running queue while deletion occurs, cancellation returns false. AI Dream
  never calls `/interrupt`: that endpoint has version-dependent semantics and
  may disrupt unrelated work. An active generation or edit may therefore
  continue after the run enters cancelling state.

### Evidence

- Fake/local-response tests: `tests.test_comfyui_image`,
  `tests.test_image_runtime`, `tests.test_capability_api`, and the image paths in
  `tests.test_skill_api`. These cover explicit configuration, loopback/redirect
  rejection, read-only discovery, bounded upload, graph submission, output
  typing, and queue-only cancellation behavior. They do not prove a real
  ComfyUI installation accepts the graph or produces a useful image.
- No ComfyUI service/model is configured on the audited host; generation,
  editing, GPU/VRAM behavior, and rendered Canvas/browser output have not been
  verified there.

## Local speech providers

### FFmpeg with Flite text-to-speech

- Discovery checks for `ffmpeg` on `PATH` and invokes its bounded Flite
  `list_voices` filter to enumerate voices; listing voices does not synthesize
  speech. Flite is available only when the FFmpeg build includes that filter.
- For orchestration TTS, an installed `espeak-ng`/`espeak` route is preferred.
  Otherwise AI Dream uses discovered FFmpeg Flite voices. The current callback
  selects `kal` when available, or the first discovered voice by default. The
  Skills composer exposes an optional per-run picker for discovered Flite voices
  in `voice.respond` and `voice.conversation`; choosing Automatic leaves the
  provider default in control. The selected value is checked against the current
  API-discovered list before synthesis. Existing API callers that omit the new
  optional voice input are normalized to Automatic. `espeak` currently has no
  voice picker.
- Explicit `audio.synthesize` accepts 1–4,000 characters. The Flite route
  writes text to a private temporary directory/file, asks FFmpeg to generate
  at most 30 seconds of mono 22,050 Hz PCM signed-16 WAV, has a 30-second
  subprocess timeout, and rejects outputs over 16 MiB or without a RIFF/WAVE
  signature. The result is a typed `audio/wav` artifact. No neural model or GPU
  is required by this route.
- A CPU-only real smoke exists as `python3 tests/smoke_flite_tts.py`; it
  synthesizes a short phrase and checks the WAV stream with `ffprobe`. The
  integrated host smoke recorded a valid 22,050 Hz mono PCM WAV. Unit/API tests
  use fake process responses and test bounded typed output separately.

### whisper.cpp speech-to-text

- STT discovery requires `whisper-cli` or `whisper-cpp` on `PATH` and an
  already-installed nonempty model file named `ggml-*.bin`. AI Dream searches
  `AI_DREAM_WHISPER_MODEL` (a direct file or directory),
  `$XDG_DATA_HOME/ai-dream/whisper`, `~/.cache/whisper`, and
  `/usr/share/whisper.cpp`. The configured model must be among discovered local
  files; no model download occurs.
- A user-started transcription requires a selected, owner-readable typed audio
  artifact with a supported media type (WAV, MP3, OGG, WebM, FLAC, or M4A),
  from 1 byte to 32 MiB. Input is copied into a private temporary directory,
  passed to whisper.cpp without timestamps, and removed afterward. Processing
  is bounded to 180 seconds; retained diagnostics are capped at 8 KiB, raw
  transcript output at 64 KiB, and the exposed transcript at 16,000 characters.
- Readiness checks inspect executable/model presence but do not transcribe.
  Actual transcription requires both executable and model. The audited host
  had no Whisper CLI or GGML model, so local STT was unavailable and no
  transcription capability was verified.
- Relevant tests: `tests.test_voice`, `tests.test_voice_orchestration`,
  `tests.test_capability_api`, and `tests.test_skill_api`. They cover discovery,
  model-file selection/validation, input ownership/size, fake transcription,
  typed transcript output, and truthful unavailable states; they are not a real
  Whisper accuracy test.

## Assisted planner

- The global preference `selection_defaults.assisted_planner_enabled` defaults
  to `false`. The Skills UI/API must explicitly enable it before a draft can be
  requested. The endpoint accepts only `goal`, `inputs`, and `selection`; goal
  text is limited to 4,000 characters.
- Drafting requires an already-loaded local text model with a `generate`
  method. It does not load a model or fall back to a remote provider. It uses
  that model under the shared chat lock, requests at most 256 generated tokens,
  and accepts at most 32,000 characters of JSON output. It restores prior chat
  history when the active backend exposes its mutable message list.
- The validator requires `draft.skill_id` to name an installed skill and checks
  that the submitted component IDs exactly match that skill's installed
  definition. However, the current endpoint does not deterministically require
  this ID to equal the `skill_id` requested in the endpoint path; the generated
  prompt asks for the requested skill, but that alone is not an enforcement
  boundary. Review the resolved plan and confirm its skill matches the one
  requested before accepting it. Exact requested-skill binding remains
  pending. The validator rejects extra fields, tools, nodes, permissions, or
  altered components, then resolves the plan normally. Drafting only returns a
  provisional draft and resolved plan; it does not execute the workflow. Run
  is bound to the reviewed `plan_id`; stale plans require a fresh review.
- Fake-loaded-model coverage exists in `tests.test_skill_api`,
  `tests.test_http_api`, and `tests.test_orchestration`. Real planner generation
  was not run on the audited host; output quality and review UX remain
  unverified against an actual loaded model.

## Runtime-bound manifest verifier

- AI Dream defines a typed verifier contract and `RuntimeBoundManifestVerifier`
  integration wrapper; it does not provide a generic semantic probe for
  arbitrary model families. The application must explicitly inject a verifier
  bound to a local runtime and a bounded probe callback. Constructor/runtime
  `probe()` checks must be read-only; the callback is called only after an
  explicit request to verify a manifest.
- The runtime ID must correspond to a registered, enabled, available local
  runtime. The API rejects a missing verifier or unavailable/unregistered
  runtime before invoking the callback. There is no built-in host verifier
  configured on this installation, so the UI/API reports verification as
  unavailable. Runtime availability/help output alone cannot establish model
  capabilities.
- Successful callbacks must return a typed `ManifestVerificationResult` for
  the requested manifest and same runtime. Every promoted capability needs
  `verified_run` evidence with a matching timestamp; a verified profile must
  match runtime and capabilities. API persistence stores typed success/failure
  diagnostics and creates a profile/overlay only for successful results.
- Relevant tests: `tests.test_manifest_verification`,
  `tests.test_manifest_verification_api`, and manifest verification coverage in
  `tests.test_http_api`. They use fake runtime adapters and probe callbacks;
  they validate binding, fail-closed behavior and persistence, not semantic
  capability verification of a real model.

## Focused verification commands

These commands exercise the deterministic provider contracts described above;
they do not start an LLM/GPU workload:

```sh
python3 -m unittest tests.test_comfyui_image tests.test_image_runtime tests.test_capability_api tests.test_skill_api -q
python3 -m unittest tests.test_voice tests.test_voice_orchestration tests.test_http_api -q
python3 -m unittest tests.test_manifest_verification tests.test_manifest_verification_api tests.test_http_api -q
```

The separate `tests/smoke_flite_tts.py` command is a real local CPU speech smoke,
not a fake-only unit test. The current integrated backend suite passed 552
tests, but that does not change the host limitations stated above.
