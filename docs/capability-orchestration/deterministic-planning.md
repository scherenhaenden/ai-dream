# Deterministic skill planning service

`aidream.orchestration.OrchestrationService` composes the existing skill,
capability, route-resolution, preference, and model-scheduler boundaries.
Construct it with immutable snapshots supplied by the host:

- a `SkillRegistry` containing validated declarative skills;
- a `CapabilityRegistry` with typed declarations;
- route candidates describing currently known implementations;
- the local `CapabilityPreferenceStore`;
- a `SkillExecutor`, and (for execution) a `ModelScheduler` plus route invokers.

`build_plan()` is read-only. It validates the graph and supplied artifact kinds
before looking up a route, resolves each capability/model node against its
declared typed inputs and outputs, applies preferences and hard model/profile
pins, and returns deterministic selections, alternatives, and rejection
reasons. Missing declarations, unresolved routes, and unavailable routes fail
the plan; they are never replaced silently.

`plan_id` fingerprints the validated graph, policy, permissions, input kinds,
selection preferences, selected routes, alternatives, and route explanations.
The digest is independent of Python mapping insertion order and changes when
execution-relevant workflow policy or route choices change.
The plan exposes the root skill's effective `max_parallel_routes` budget.
Nested route nodes use stable slash-separated node paths so planning and
execution identify the same instance even if one subskill is invoked several
times.

An optional assisted-planner draft gate is available on
`OrchestrationService`, disabled by default. When enabled, the host can pass a
draft naming an installed skill and the exact capability/model components
already declared by that skill. Unknown fields, tools, nodes, permission
requests, and component substitutions are rejected. The method returns the
same deterministic `ExecutionPlan` as `build_plan()` and does not execute it;
the host can show that plan before an explicit run action. This is only a
validator/bridge: it does not call an LLM or generate drafts.

`execute()` is deliberately separate. It rechecks the skill graph and inputs,
preflights all selected route invokers and model manifests, and processes each
ready graph layer in chunks no wider than `policy.max_parallel_nodes`. Before
any route in a chunk is invoked, the service reserves route budget slots and the
chunk's model leases with the scheduler's atomic `acquire_many()` operation.
The inherited route semaphore caps concurrent routes across nested subskills;
waiting for a slot is cancellation-aware. A reservation failure releases
earlier leases and slots and starts no route invocation. All leases and slots
are released after the chunk, including on route failure. A runtime must
advertise request concurrency before the scheduler grants overlapping leases
for the same resident model. Routes that cannot safely coexist fail before
inference; they are not silently serialized under a declared parallel branch.
Each route must provide scheduler metadata (`manifest`; optionally `profile`,
`estimated_ram_bytes`, and `estimated_vram_bytes`). Unknown resource
measurements remain unenforced by the existing scheduler policy.

Resolver v1 exposes an explicit `unknown_resource_policy` on each request:
`allow` preserves compatibility and reports missing estimates in the route's
selection factors; `reject` treats any missing required/available estimate as a
hard `resource_estimate_unknown` rejection. Known estimates still apply the
configured headroom using round-up arithmetic.

Local fallback nodes require an explicit typed trace callback and receive the
plan ID as their base revision. The executor emits a deterministic revision
event only after a later registered transform candidate produces valid typed
outputs. The host must persist that callback into its run event log.

This is a local orchestration boundary, not the runtime integration itself. It
does not build route candidates from installed models, probe adapters, or verify
capability evidence. The application host supplies truthful route snapshots,
runtime invokers, cancellation events, and SSE/run persistence. Assisted draft
generation is hosted separately and remains off by default; this planner only
validates its result. Fakes validate planning, reservation, nested routing, and
lifecycle behavior; runtime execution still depends on compatible installed
adapters and models.
