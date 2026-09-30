# API, persistence and event contracts

This document proposes additive contracts for the capability/skill orchestration layer. Existing model, runtime, profile and chat APIs remain valid while the new layer is introduced.

## 1. API design goals

The orchestration API should:

- remain loopback-only under the same Host/Origin protections as current HTTP mutations;
- expose typed capabilities and skills without loading models merely for discovery;
- create immutable run plans before execution;
- stream run state over SSE;
- separate binary artifacts from JSON control messages;
- preserve bounded diagnostics and cancellation;
- never expose arbitrary host filesystem paths as a generic browser API.

## 2. Capability registry endpoints

```text
GET /api/capabilities
GET /api/capabilities/<capability-id>
GET /api/capabilities/<capability-id>/routes
GET /api/capability-map
```

Example response:

```json
{
  "data": {
    "capabilities": [
      {
        "id": "vision.understand",
        "status": "ready",
        "routes": 2,
        "preferred_route_id": "route_...",
        "inputs": ["image", "text"],
        "outputs": ["text"]
      }
    ]
  }
}
```

`/api/capability-map` returns a compact UX-oriented summary. It should not duplicate full manifests.

## 3. Model manifest endpoints

```text
GET    /api/model-manifests
GET    /api/model-manifests/<id>
POST   /api/model-manifests/<id>/verify
PATCH  /api/model-manifests/<id>/preferences
```

Local user-created manifests may later support create/update endpoints, but the first implementation can generate manifests from catalog metadata plus bundled/user overlays.

`POST /api/model-manifests/<id>/verify` accepts only `{}`. It delegates startup
and a minimal capability probe to an injected local `ManifestVerifier`; the
request cannot submit evidence or capabilities. The default API has no runtime
probe configured and returns `503` without changing records. Successful typed
results are checked against the manifest, validated as a verified model
profile, persisted, and merged below user-authored metadata. Failed probes are
recorded without promoting a profile or capability claim.

The existing `GET /api/models` continues to return file catalog records. The UI can join records with manifest summaries or the API can add an optional expanded representation later.

## 4. Skill endpoints

```text
GET /api/skills
GET /api/skills/<skill-id>
POST /api/skills/<skill-id>/plan
POST /api/skills/<skill-id>/run
```

Planning request:

```json
{
  "inputs": {
    "question": {"kind": "text", "text": "What is wrong with this UI?"},
    "image": {"artifact_id": "art_..."}
  },
  "parameters": {},
  "selection": {
    "mode": "auto"
  }
}
```

Planning response:

```json
{
  "data": {
    "plan": {
      "id": "plan_...",
      "skill_id": "screen.explain",
      "nodes": [],
      "estimated_resources": {},
      "warnings": []
    }
  }
}
```

A plan request does not perform expensive model inference. Runtime metadata probes may be reused if already available.

## 5. Run endpoints

```text
POST /api/runs
GET  /api/runs/<run-id>
GET  /api/runs/<run-id>/events
POST /api/runs/<run-id>/cancel
GET  /api/runs/<run-id>/artifacts
```

`POST /api/runs` may accept a previously generated plan ID or an inline validated skill request.

Run status:

```json
{
  "data": {
    "run": {
      "id": "run_...",
      "skill_id": "image.edit-from-instruction",
      "skill_version": "1.0.0",
      "plan_id": "plan_...",
      "state": "running",
      "created_at": "...",
      "started_at": "...",
      "completed_at": null,
      "current_nodes": ["editor"],
      "outputs": []
    }
  }
}
```

## 6. SSE run events

Use Server-Sent Events for consistency with current streaming/download behavior.

Example event:

```text
event: node.started
data: {"run_id":"run_...","node_id":"vision","timestamp":"..."}
```

Progress events are bounded and rate-limited. Large logs/output never travel as progress messages.

The client should be able to reconnect and request events after a sequence number:

```text
GET /api/runs/<id>/events?after=42
```

A small bounded event journal is persisted for active/recent runs.

## 7. Artifact endpoints

Browser uploads should create run/session artifacts rather than exposing host paths.

```text
POST   /api/artifacts
GET    /api/artifacts/<id>/metadata
GET    /api/artifacts/<id>/content
DELETE /api/artifacts/<id>
```

Artifact metadata includes lifetime and ownership scope.

For a locally selected file through a native desktop picker, the backend may hold an internal path-backed artifact reference, but browser-facing metadata should not reveal arbitrary host paths unless an explicit local UI contract requires it.

## 8. Resource/scheduler endpoints

```text
GET  /api/resources
GET  /api/models/residency
POST /api/models/residency/actions
```

The residency action accepts exactly a server-discovered `route_id` and one of `pin`, `unpin`, or `unload`. It can only affect an already loaded orchestration-owned resident, requires an idle unpinned model for unload, and never starts a load. Arbitrary model IDs cannot select a runtime target.

Resource snapshot:

```json
{
  "data": {
    "resources": {
      "ram": {"total_bytes": 0, "available_bytes": 0},
      "gpus": [
        {"id": "...", "total_vram_bytes": 0, "free_vram_bytes": 0}
      ],
      "loaded_models": [],
      "pending_reservations": []
    }
  }
}
```

## 9. Preferences

Semantic preferences should have their own store:

```json
{
  "capability_preferences": {
    "text.chat": {"model_id": "...", "profile_id": "..."},
    "code.review": {"model_id": "..."},
    "vision.understand": {"model_id": "..."}
  },
  "selection_defaults": {
    "mode": "auto",
    "prefer_verified": true,
    "prefer_loaded": true,
    "resource_headroom_percent": 10,
    "eviction_policy": "lru",
    "assisted_planner_enabled": false
  }
}
```

`eviction_policy` is `lru` (unload the oldest idle, unpinned resident under memory pressure) or `never` (preserve residents and fail a load that needs implicit eviction). Busy leases and user pins are protected under either policy. A version 1 preferences file without this key reads as `lru` and gains the key on its next write.

`assisted_planner_enabled` is a global explicit opt-in and defaults to `false`. The `/api/skills/{id}/draft` action requires an already loaded local model and generates only after a user request. Its JSON is bounded and validated against the installed skill contract; execution still requires review of the returned draft and resolved plan.

This is separate from low-level runtime defaults.

## 10. Persistence layout

Recommended XDG locations:

```text
$XDG_CONFIG_HOME/ai-dream/
  model-sources.json                  existing
  capability-preferences.json         new
  model-manifests.d/                  user overrides
  skills.d/                           user declarative skills

$XDG_DATA_HOME/ai-dream/
  chats/                              existing
  presets.json                        existing
  model-profiles.json                 existing/current control plane
  verification.json                   new or directory
  benchmarks.json                     existing/future integration
  knowledge/                          existing/future RAG stores
  artifacts/                          explicitly persistent artifacts only

$XDG_STATE_HOME/ai-dream/
  diagnostics.jsonl                   existing diagnostics direction
  runs/                               bounded recent run journals
  cache/                              derived OCR/parse/embedding cache
```

Temporary binary artifacts should use a private runtime/temp directory, not permanent data storage by default.

## 11. Run record schema

A persisted recent run record may contain:

```json
{
  "schema_version": 1,
  "id": "run_...",
  "skill": {"id": "...", "version": "..."},
  "plan_revision": 1,
  "state": "completed",
  "selection_mode": "auto",
  "nodes": [
    {
      "id": "vision",
      "component_id": "...",
      "model_id": "...",
      "profile_id": "...",
      "runtime_id": "...",
      "state": "completed",
      "started_at": "...",
      "completed_at": "..."
    }
  ],
  "outputs": ["art_..."],
  "events_tail": [],
  "incident_ids": []
}
```

Do not persist raw prompts/tool arguments indiscriminately in an operational run journal. Conversation content belongs to chat storage; run state should keep references/metadata and only the minimum needed for reproducibility.

## 12. Skill schema storage

Built-in skills ship inside the application package, for example:

```text
aidream/skills/builtin/<skill-id>/skill.yaml
```

User skills live in the config directory.

At startup, `SkillRegistry`:

```text
loads schemas
validates IDs/versions
rejects duplicates according to precedence rules
validates graph structure
registers only valid skills
records invalid skill diagnostics without crashing the app
```

## 13. Manifest storage

The model catalog remains source-of-truth for local file presence. Manifests reference catalog IDs and semantic model keys.

Bundled model-family templates can live in:

```text
aidream/manifests/builtin/
```

Generated local overlays can live in data/state, while explicit user overrides live under config. This separation prevents generated metadata from overwriting user intent.

## 14. Schema versioning

Every persisted manifest, skill, run record and artifact metadata record has `schema_version`.

Rules:

```text
read old supported versions
migrate in memory
write current version atomically
reject future incompatible versions with clear error
never silently discard unknown user fields during migration unless schema explicitly owns the full document
```

## 15. Atomic writes and permissions

Reuse current storage discipline:

```text
write temporary file in same directory
fsync where appropriate
atomic replace
private permissions for state containing local paths or diagnostics
bounded file sizes
no symlink-following for sensitive stores where practical
```

## 16. API errors

All orchestration errors should use a normalized payload:

```json
{
  "error": {
    "code": "resource_unavailable",
    "message": "Not enough free VRAM for the selected profile",
    "incident_id": "inc_...",
    "details": {
      "required_estimate_bytes": 10000000000,
      "available_estimate_bytes": 6500000000,
      "alternatives": ["profile_low_vram"]
    }
  }
}
```

Keep user-facing messages safe. Runtime stderr remains in bounded local diagnostics.

## 17. Compatibility with current chat APIs

Migration path:

```text
Phase 1: existing /api/chat remains primary; orchestration APIs are additive.
Phase 2: chat can optionally invoke built-in chat skill through RunManager.
Phase 3: orchestration path becomes default, old direct path remains compatibility layer.
```

Saved chat settings continue to work. A chat may additionally store:

```text
skill_id
skill_version
selection mode
capability preferences scoped to chat
run IDs for turns
```

## 18. Testing contracts

Each endpoint gets contract tests for:

```text
schema validation
loopback/Origin enforcement
size/count bounds
unknown IDs
missing capability
permission denial
cancellation
SSE reconnect
artifact lifetime cleanup
concurrent run limits
profile/runtime incompatibility
```

The new layer should preserve AI Dream's current principle: invalid model/tool requests fail at the boundary instead of being passed through to arbitrary local processes.
