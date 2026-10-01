# Orchestrator and resource-aware scheduler

The orchestrator turns a skill plus user inputs into a concrete execution plan. The scheduler makes that plan physically possible on the local machine. Keeping those responsibilities separate is essential: planning answers "what must happen?"; scheduling answers "what can run now, where, and with which profile?"

## 1. Core services

Recommended service split:

```text
CapabilityRegistry
ModelManifestStore
SkillRegistry
PlanResolver
ResourceMonitor
ModelScheduler
ArtifactStore
RunManager
RunEventBus
ExecutorRegistry
```

The existing model catalog, runtime registry, runtime installations, model profiles and chat store remain lower-level dependencies.

## 2. Planning pipeline

A deterministic run starts as:

```text
skill + parameters + input artifacts + session policy
                       |
                       v
                 validate skill
                       |
                       v
               expand sub-skills
                       |
                       v
               type-check graph
                       |
                       v
          resolve capability candidates
                       |
                       v
           evaluate hard constraints
                       |
                       v
             rank valid candidates
                       |
                       v
             bind profiles/runtimes
                       |
                       v
              produce RunPlan
```

A `RunPlan` is immutable once execution begins. Dynamic fallback creates a new plan revision rather than silently mutating the original.

## 3. Candidate selection

Selection must be explainable and deterministic enough for debugging.

### Hard filters

Reject a candidate when any of these fail:

```text
required capability missing
input/output artifact mismatch
runtime incompatible
required companion artifact missing
runtime feature missing
permission denied
model/profile unavailable
hard memory/resource bound impossible
user pin conflicts with requirement
verification policy rejects unknown route
```

### Preference ranking

After filtering, rank by weighted preferences such as:

```text
explicit user preference
skill preference
verified route
quality hint/benchmark
speed benchmark
already loaded/resident
startup cost
memory pressure
energy preference
profile priority
```

Weights are configuration, not hidden behavior.

An example transparent score:

```text
score = user_pin_bonus
      + verified_bonus
      + quality_weight * normalized_quality
      + speed_weight * normalized_speed
      + residency_bonus
      - load_cost_penalty
      - memory_pressure_penalty
```

Missing benchmarks should not become fake zeros; they are unknown and handled separately.

## 4. Resource model

The scheduler tracks at least:

```text
system RAM total/available
per-GPU VRAM total/used/free where observable
runtime-native device mapping
loaded model leases
estimated model residency
active requests
CPU thread pressure
optional temporary disk working space
```

Hardware probes are snapshots, not guarantees. The scheduler leaves configurable headroom instead of allocating to the last byte.

## 5. Model lifecycle states

Recommended states:

```text
discovered      artifact exists
configured      manifest/profile available
runnable        compatibility checks pass
loading         runtime startup in progress
ready           model loaded and healthy
busy            active request(s)
idle            loaded, no active request
unloading       teardown in progress
failed          last lifecycle action failed
unavailable     dependency/runtime/artifact currently missing
```

The UI can derive simpler badges from these states.

## 6. Leases, not direct loads

Workflow nodes request a model lease:

```text
LeaseRequest
  capability
  selected/pinned model if any
  selected profile class
  memory/resource constraints
  expected duration
  concurrency requirements
```

The scheduler returns a `ModelLease` referencing a ready runtime handle. Multiple compatible read/inference requests may share a model if the runtime/profile allows concurrency.

A node releases the lease when its work ends. The scheduler decides whether to keep the model resident.

The orchestration boundary marks adapter calls active for their full synchronous
invocation. Releasing a lease, releasing all leases for a run, or unloading a
resident is rejected while an adapter call is active. Cancellation only signals
the adapter: a successful cancel callback does not prove that the invocation
has stopped. The run keeps its leases until every invocation returns and the
normal execution cleanup releases them.

## 7. Residency policy

Loading large local models is expensive. A minimal initial policy can be LRU-like but capability-aware:

The persisted global policy currently supports `lru` and `never`. `lru` unloads the least-recently-used idle, unpinned resident when memory headroom is insufficient. `never` prevents implicit pressure eviction and also refuses an implicit model switch for runtimes that support only one resident. Explicit user unload remains available; neither policy can unload a busy lease or pinned resident.

```text
never evict busy models
prefer keeping user-pinned model loaded
prefer keeping recently used expensive-to-load model
prefer evicting idle optional specialists first
respect keep_last_model_loaded / profile policy
maintain VRAM/RAM headroom
```

Each loaded model gets a residency record:

```json
{
  "model_id": "...",
  "profile_id": "...",
  "runtime_id": "...",
  "state": "idle",
  "leases": 0,
  "loaded_at": "...",
  "last_used_at": "...",
  "estimated_vram_bytes": 7800000000,
  "eviction_priority": 50
}
```

## 8. Multi-model scheduling

A workflow may need several models at once or in sequence.

### Sequential case

For `STT -> LLM -> TTS`, only one model may need to be resident at a time on a constrained GPU. The scheduler can unload between steps when necessary.

### Parallel case

A `parallel` node may request independent models simultaneously. Before starting, the scheduler should perform a coarse reservation check to avoid a deadlock where each branch loads half the required resources.

### Pipeline overlap

Later optimization may overlap CPU transforms with GPU inference, but correctness should not depend on it.

## 9. Resource reservations

Before expensive loads, create a reservation:

```text
reserved VRAM estimate
reserved RAM estimate
runtime slot
expected concurrency slot
```

Reservations are short-lived and released on failure/cancellation.

The first implementation can use conservative estimates from manifests/profiles and observed post-load usage when available.

## 10. Hardware-specific learning

After a successful load, record observations:

```text
load time
observed memory delta
runtime version
profile
hardware signature
successful capability probe
```

These observations may refine future estimates but must never silently rewrite user profiles.

A later `AutoTune` action can explicitly propose a new profile from observations.

## 11. Runtime adapters

The scheduler should not know llama.cpp flags or vLLM CLI syntax. Runtime adapters translate normalized requests into backend operations.

A runtime adapter exposes:

```text
probe
compatibility
estimate (optional)
prepare
load
health
invoke
cancel
unload
metrics (optional)
```

This allows AI Dream to add runtime families for image/audio/video without turning one backend class into a giant switch statement.

## 12. Execution engine

The run executor processes the resolved DAG in dependency order. Every node moves through:

```text
pending -> ready -> waiting_resources -> running -> succeeded
                                      \-> failed
                                      \-> cancelled
                                      \-> skipped
```

Run events are emitted on every transition.

## 13. Event model

Recommended event types:

```text
run.created
plan.resolved
node.ready
resource.waiting
model.load.started
model.load.completed
model.load.failed
node.started
node.progress
artifact.created
node.completed
node.failed
fallback.selected
model.unload.started
model.unload.completed
run.completed
run.failed
run.cancelled
```

The Angular UI can consume these over SSE, reusing the application's current streaming approach.

## 14. Fallbacks

Fallbacks are declared, not improvised.

Examples:

```text
preferred profile -> low-vram profile
preferred model -> alternate model with same capability
vision.understand -> OCR + text.generate, if skill declares that route
GPU runtime -> CPU runtime, only if profile/policy allows it
```

The run trace records the reason.

No fallback should change the semantic task silently. For example an image editing skill cannot fall back to image description and still report success.

## 15. Failure categories

Normalize failure kinds across runtimes:

```text
invalid_input
capability_unavailable
runtime_unavailable
model_unavailable
dependency_missing
resource_unavailable
load_failed
health_failed
invocation_failed
timeout
cancelled
permission_denied
artifact_failed
output_validation_failed
internal_error
```

Backend-specific stderr belongs in bounded diagnostics, while the run receives a safe normalized summary plus incident ID.

## 16. Cancellation and cleanup

Cancellation must be cooperative and layered:

```text
RunManager marks run cancelling
 -> executor stops scheduling new nodes
 -> active node receives cancel
 -> runtime adapter cancels active request
 -> tools receive cancel where supported
 -> temporary artifacts are cleaned according to lifetime
 -> leases are released
 -> scheduler may unload no-longer-needed models
 -> run becomes cancelled
```

A process that refuses graceful cancellation may be terminated by its runtime adapter according to bounded policy.

`RunManager.close(wait=False)` requests cancellation and returns without
releasing a running execution's leases or marking it terminal. The execution
owns cleanup until its runtime callback returns; queued futures cancelled by
pool shutdown are finalized immediately because they never acquired runtime
resources. This prevents shutdown from reporting a stopped run while its
runtime is still using the lease.

## 17. Concurrency

Initial safe policy:

```text
one mutating scheduler operation at a time
runtime-specific request concurrency only when explicitly supported
bounded total active runs
bounded per-run parallel nodes
```

The current application already serializes critical model operations; the orchestration layer should generalize that instead of bypassing it.

## 18. Chat integration

A chat turn can become a run with a simple one-node skill:

```text
chat.general
  input: chat_messages
  node: text.chat
  output: text
```

Multimodal chat can resolve a more specific plan depending on attachments, e.g. image + question may route to a vision-capable model.

The chat UI can remain familiar while internally using the same run/scheduler infrastructure as other skills.

## 19. Planner LLM integration

A future planner model may propose a workflow only after the deterministic system has generated a capability snapshot. Planner output is parsed into the same `RunPlanDraft` schema and validated.

The planner cannot:

```text
invent component IDs
invent tool names
change permissions
bypass memory constraints
execute code directly
start models directly
```

This makes "agentic" behavior an optional planning layer, not the security boundary.

## 20. Scheduler UX contract

Whenever a run waits or fails for resources, the scheduler should provide actionable alternatives:

```text
Need 10.2 GiB estimated free VRAM; 6.8 GiB available.
Options:
- unload Qwen 27B currently idle
- use profile 'low-vram' for Vision 4B
- use CPU-capable OCR route
```

The same explanation data can power both automatic fallback and expert UI decisions.
