# UX information architecture: progressive disclosure

Status: proposed UX direction for the Angular application.

This document describes how AI Dream can keep its growing local-AI capabilities without making every subsystem permanently visible in the main interface. It is intentionally an information-architecture proposal first: the goal is to simplify how the product is perceived and navigated before changing visual styling or removing any capability.

The central principle is:

> Show the user what they want to do. Reveal how AI Dream does it only when that information is useful.

AI Dream is becoming both an everyday AI application and a local inference workstation. Those are compatible goals, but they should not share the same visual priority at all times.

## 1. Current UX problem

The current Angular shell exposes many routes as primary navigation destinations. At the time of writing, the sidebar includes Chat, Agent, Models, Capability Map, Setup Assistant, Skills, Runs, Model Hubs, Knowledge, Resources, Hardware, Load Model, Runtime Manager, Downloads, Local API, Tools & Permissions, Logs & Traces and Settings.

This is functionally rich, but the navigation hierarchy gives everyday workflows and low-frequency infrastructure controls nearly the same visual weight.

The result is cognitive clutter rather than missing functionality. A user who wants to chat with a model still has to visually parse concepts such as runtime management, placement, API state, traces and capability topology. An advanced user benefits from those controls, but does not need all of them occupying persistent space during normal use.

The shell also repeats some system state in multiple places. Local API connectivity, for example, is represented in the sidebar, top bar and status bar. Resource information is similarly promoted to the global shell even when the current task does not require it.

This proposal therefore focuses on four changes:

1. Reduce the permanent navigation surface.
2. Move configuration next to the object it configures whenever possible.
3. Consolidate global configuration and external API/provider setup under Settings.
4. Use progressive disclosure for advanced workstation and diagnostic features.

No capability needs to be deleted to achieve this.

## 2. Product model

The interface should distinguish three conceptual layers.

### 2.1 Work

These are the things users open AI Dream to do repeatedly:

- Chat or interact with a model.
- Find, inspect and use models.
- Run skills/capabilities that produce useful artifacts or actions.
- Work with knowledge/RAG sources.
- Inspect active or recent downloads when necessary.

These deserve primary navigation.

### 2.2 Configure

These are settings that influence how work is performed:

- Model-specific runtime and placement settings.
- Model sources and storage locations.
- Runtime defaults.
- Cloud/API provider connections.
- Local AI Dream API connection settings.
- Application behavior and appearance.

Configuration should not compete with primary workflows for persistent navigation space.

### 2.3 Inspect and diagnose

These are valuable workstation features, but usually contextual or infrequent:

- Hardware topology and detailed resource use.
- Runtime installation management.
- Local API server details.
- Tools and permissions.
- Logs and traces.
- Capability topology and planner internals.

They should remain accessible, but under Advanced/Developer surfaces or contextual entry points.

## 3. Proposed default navigation

The default sidebar should be intentionally small.

```text
AI Dream

Chat
Models
Create / Skills
Knowledge

────────────
Downloads

────────────
Settings
```

The exact names can evolve, but the hierarchy should stay small enough that a user can understand the whole product at a glance.

### Chat

Primary conversational workspace. Model selection belongs here, but infrastructure configuration does not.

### Models

One home for local and remote model discovery, configuration and activation.

Models should absorb several concepts that are currently separated into independent destinations:

- Local model library.
- Model Hub discovery.
- Per-model load/placement configuration.
- Per-model runtime/profile selection.
- Model capability/type metadata.

A model is the object the user understands. Backend, placement and runtime settings are properties of using that model.

### Create / Skills

The current Skills, capability-driven workflows and other artifact-producing modes should converge into a user-facing task area rather than exposing orchestration internals as the first concept.

The user should primarily answer “what do I want to do?” rather than “which orchestration subsystem do I want to open?”.

### Knowledge

Knowledge/RAG remains a coherent primary workflow and should remain directly reachable.

### Downloads

Downloads are operational, but they represent an active user task with progress and cancellation. Keeping Downloads directly accessible is reasonable, while avoiding promotion of unrelated infrastructure pages.

### Settings

Settings becomes the global configuration center and the doorway into advanced administration.

## 4. Route consolidation

The current routes do not have to disappear immediately. Navigation can be simplified first while maintaining routes for deep links, compatibility and incremental migration.

| Current destination | Proposed UX home | Rationale |
|---|---|---|
| Chat | Chat | Core workflow. |
| Agent | Chat mode / Skills, depending on final agent semantics | Agent behavior is a way of working, not necessarily a permanent top-level place. |
| Models | Models | Core workflow. |
| Model Hubs | Models > Discover | Discovery is part of the model lifecycle. |
| Load Model (Placement) | Models > selected model > Configure / Load | Placement belongs to a model instance/profile. |
| Capability Map | Settings > Advanced > Capabilities, with contextual links from Skills | Useful for inspection, not required for routine task selection. |
| Setup Assistant | First-run/on-demand setup flow | It should become unobtrusive after setup is complete. |
| Skills | Create / Skills | Core capability-driven task surface. |
| Runs | Create / Skills > Runs/History | Runs are the history/execution view of skills. |
| Knowledge | Knowledge | Core workflow. |
| Resources | Advanced resource drawer/dashboard | Resource state should be accessible without permanent full-page prominence. |
| Hardware | Settings > Advanced > Hardware & Resources | Hardware configuration/inspection is advanced administration. |
| Runtime Manager | Settings > Runtimes / Advanced | Runtime installation is configuration. |
| Downloads | Downloads | Active operational task. |
| Local API | Settings > Connections > Local API / Advanced | Server details are configuration/diagnostics. |
| Tools & Permissions | Settings > Advanced > Tools & Permissions | Security/agent administration. |
| Logs & Traces | Settings > Advanced > Diagnostics | Diagnostic surface. |
| Settings | Settings | Global configuration center. |

This consolidation should not be implemented as route deletion first. Existing URLs can remain valid while the visible navigation changes.

## 5. Settings as the configuration center

Settings should grow from a small preferences page into a coherent configuration center.

Suggested categories:

```text
Settings

General
Models & Storage
Runtimes
Connections
Appearance
Advanced
```

### General

Application-level behavior such as profile preference behavior, startup behavior and persistence choices.

### Models & Storage

Managed model directory, additional indexed model directories, download location and model-source behavior.

This is also the appropriate place for source-level settings that do not belong to one particular model.

### Runtimes

Global runtime defaults and installed runtime management.

Per-model overrides should remain in the selected model's configuration. The Settings page defines defaults, not the normal workflow for loading a specific model.

### Connections

Connections should become the single home for local and remote APIs/providers.

Example:

```text
Connections

Local AI Dream API                 Connected

Cloud providers
OpenAI                             Not configured    [Add]
OpenRouter                         Not configured    [Add]
Anthropic                          Not configured    [Add]
Google Gemini                      Not configured    [Add]
Mistral                            Not configured    [Add]

Custom OpenAI-compatible API                         [+ Add connection]
```

A connection editor should support, as applicable:

- Display name.
- Provider type.
- Base URL.
- API key/credential reference.
- Connection test.
- Optional model discovery.
- Optional manually declared models when discovery is unavailable.
- Enable/disable state.

Credentials must not be exposed in normal model cards, logs or status text.

Remote models should then appear to the rest of the product as model sources, rather than forcing the user to think about provider configuration during every chat.

### Appearance

Theme and UI-density preferences belong here rather than increasing shell complexity.

### Advanced

Advanced should collect infrastructure and diagnostic concepts:

- Hardware & Resources.
- Runtime installations/details when more technical than the regular Runtimes page.
- Capability Map.
- Local API diagnostics/server details.
- Tools & Permissions.
- Logs & Traces.
- Developer/debug options.

## 6. Standard and Advanced interface modes

AI Dream should consider an interface visibility preference:

```text
Interface mode

Standard
Advanced
```

This preference controls navigation visibility and detail level, not capability availability or model quality.

### Standard

The default experience exposes the small navigation described above. Advanced controls remain reachable through Settings, contextual links and search/command palette.

### Advanced

Advanced mode may expose selected workstation pages directly in navigation, for users who routinely inspect hardware, runtimes, APIs or traces.

The key rule is that Advanced must be an additive view. Switching back to Standard must not reset configuration or disable advanced functionality.

This mechanism provides progressive disclosure without creating separate products or a simplified “beginner backend”.

## 7. Top bar simplification

The current top bar combines navigation/search, orchestration mode, resource state, model navigation and API connectivity. The goal should be to preserve fast access while reducing continuous visual noise.

A calmer default shell could be conceptually similar to:

```text
Studio / Chat       Qwen… ▼                 Search   Resources   Settings
```

The exact visual treatment is open, but the following rules are recommended:

- Keep current model/session context visible.
- Keep search/command palette easy to access.
- Represent resources compactly; expand details on demand.
- Show API connectivity prominently only when degraded or actionable.
- Do not repeat the same Local API state in the sidebar, top bar and footer.
- Avoid persistent raw endpoint text during normal use.

Healthy infrastructure should be quiet. Problems should become visible when they need attention.

## 8. Resource and API status behavior

AI Dream is local-first, so runtime health matters. Hiding system information completely would be a mistake. The proposal is to change its presentation from permanent telemetry to status-on-demand.

A compact resource indicator can open a drawer/popover containing:

- Loaded models.
- GPU VRAM totals and free/used memory.
- RAM state.
- Active runtime/backend.
- Current placement.
- Links to Hardware & Resources and diagnostics.

The indicator can change emphasis when thresholds or failures make the state actionable.

Likewise, Local API state can be represented by a small status indicator or only surfaced when disconnected. The full base URL, health probe and server controls belong under Settings/Connections or Advanced diagnostics.

## 9. Contextual configuration

A major UX rule for AI Dream should be:

> Configure an object where the object is selected.

Examples:

A user should select a model and then see its runtime, context, GPU placement, tensor split, multimodal projector and profile controls. They should not need to navigate away to a separate Load Model page and mentally reconnect that configuration to the model.

A user configuring a skill should see required capabilities and compatible model choices from that skill.

A user inspecting a run should be able to follow links to the model/runtime used by that run.

Global Settings should define defaults; contextual surfaces define overrides.

## 10. Search and command palette

The existing command/search palette becomes more important after simplifying navigation.

Removing a route from the permanent sidebar must not make it difficult for an advanced user to reach. Search should index both primary and advanced pages.

For example, typing `logs`, `runtime`, `hardware`, `api`, `capabilities` or `permissions` should still provide direct navigation even in Standard interface mode.

This creates a small visible information architecture without sacrificing keyboard-driven expert access.

## 11. First-run setup behavior

Setup Assistant should be treated primarily as a workflow state, not a permanent destination.

Recommended behavior:

- Show setup prominently when required configuration is incomplete.
- Allow it to be reopened from Settings.
- Once core setup is complete, remove it from the normal sidebar.
- Surface individual incomplete requirements contextually instead of forcing the whole assistant to stay permanently visible.

Examples include no model source, no usable runtime or an explicitly requested cloud provider without credentials.

## 12. Implementation stages

The UX change should be incremental.

### Stage 1: navigation-only simplification

Change visible navigation grouping without deleting routes or backend behavior.

Acceptance criteria:

- Standard navigation contains only the primary task surfaces plus Settings.
- Every currently implemented route remains reachable through Settings, contextual links or command palette.
- Existing deep links continue to work.

### Stage 2: Settings consolidation

Create the Settings categories and move global runtime/API/system configuration into them.

Acceptance criteria:

- Local API connection configuration has one authoritative home.
- Runtime defaults and runtime installation management have a coherent relationship.
- Advanced infrastructure pages are discoverable from Settings.

### Stage 3: model-centered configuration

Move model-specific placement/load controls into the selected model workflow.

Acceptance criteria:

- A user can discover/select a model, configure it and load/use it without visiting an unrelated top-level route.
- Global runtime defaults remain available separately.
- Existing saved profiles remain usable.

### Stage 4: provider connections

Add a provider-connection abstraction and UI for external APIs.

Acceptance criteria:

- Connections can be added, tested, disabled and edited from Settings.
- Provider credentials are stored through the application's chosen secure credential strategy and are not rendered back as plaintext after save.
- Remote model discovery can feed the shared model-selection UX.
- Custom OpenAI-compatible endpoints are supported as a generic connection type when technically available.

### Stage 5: telemetry de-duplication

Reduce persistent shell telemetry and replace it with compact status surfaces.

Acceptance criteria:

- Local API status is not repeated in three persistent locations.
- Detailed resources are one interaction away.
- Connectivity/resource failures remain obvious and actionable.

### Stage 6: Standard/Advanced visibility preference

Add the interface visibility preference after the navigation structure is stable.

Acceptance criteria:

- Standard is uncluttered by default.
- Advanced can expose workstation destinations directly.
- Changing visibility mode does not alter runtime/model/provider configuration.

## 13. Non-goals

This proposal does not require:

- Removing advanced functionality.
- Removing CLI or HTTP API capabilities.
- Hiding errors or resource exhaustion.
- Rewriting the visual design system.
- Replacing the current router in one large migration.
- Forcing cloud providers into a local-first installation.
- Making Standard mode technically less capable.

The desired result is the same capable workstation with a quieter default mental model.

## 14. Design rules for future features

As AI Dream grows, new features should not automatically receive a top-level navigation item.

Before adding a permanent destination, ask:

1. Is this a frequent user goal or an implementation concept?
2. Does it belong to an existing object such as a model, skill, knowledge source or connection?
3. Is it configuration, inspection or actual work?
4. Can it be reached contextually and through search instead?
5. Does it need to be visible when healthy and inactive?

A new subsystem can be important without being permanently visible.

## 15. Target outcome

AI Dream should feel simple when doing simple things and deep when the user asks for depth.

A user who only wants local chat should not need to understand the control plane. A user tuning two GPUs should still have access to every relevant placement and runtime control. A developer debugging a failed skill should still have logs, traces and capability state.

The difference is when those concepts enter the interface.

The target is not fewer capabilities. It is less simultaneous cognitive load.