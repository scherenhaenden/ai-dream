import tempfile
import unittest
from pathlib import Path

from aidream.capabilities import (
    ArtifactKind, ArtifactType, CapabilityDeclaration, CapabilityRegistry,
    CapabilityPreferenceStore, Evidence, RouteCandidate,
)
from aidream.orchestration import OrchestrationService, PlanDraftError, PlanResolutionError
from aidream.skills import SkillExecutionError, SkillExecutor, SkillRegistry


def chat_skill(*, model_node=False):
    step = {"id": "reply", "type": "model" if model_node else "capability",
            "operation": "text.chat", "capability": "text.chat",
            "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
            "out": {"response": "text"}}
    if model_node:
        step.update({"model_id": "model-b"})
    return {
        "schema_version": 1, "id": "chat.general", "name": "Chat",
        "version": "1.0.0", "description": "Chat", "inputs": [
            {"name": "prompt", "artifact": "text", "required": True}],
        "outputs": [{"name": "response", "artifact": "text", "required": True}],
        "requirements": {"capabilities": ["text.chat"]},
        "graph": [step, {"id": "result", "type": "output", "in": {"response": "$reply.response"}}],
    }


def candidate(route_id, model_id, *, available=True, loaded=False, profile_id=None):
    return RouteCandidate(
        id=route_id, capability_id="text.chat", model_id=model_id, runtime_id="fake",
        inputs=(ArtifactType(ArtifactKind.TEXT),), outputs=(ArtifactType(ArtifactKind.TEXT),),
        profile_id=profile_id, available=available, loaded=loaded,
        metadata={"manifest": {"model_id": model_id}},
    )


class FakeScheduler:
    def __init__(self):
        self.acquired = []
        self.released = []

    def acquire(self, request):
        lease = {"model": request.model_id}
        self.acquired.append(request)
        return lease

    def release(self, lease):
        self.released.append(lease)


class OrchestrationServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.preferences = CapabilityPreferenceStore(Path(self.temp.name) / "preferences.json")
        self.declarations = CapabilityRegistry([CapabilityDeclaration(
            id="text.chat", inputs=(ArtifactType(ArtifactKind.TEXT),),
            outputs=(ArtifactType(ArtifactKind.TEXT),),
            evidence=Evidence(source="bundled_manifest", status="supported"),
        )])
        self.inputs = {"prompt": {"kind": "text", "value": "hello"}}

    def tearDown(self):
        self.temp.cleanup()

    def service(self, skill=None, routes=None, **kwargs):
        return OrchestrationService(
            skills=SkillRegistry([skill or chat_skill()]), executor=SkillExecutor(),
            capabilities=self.declarations, routes=routes if routes is not None else [
                candidate("route-a", "model-a"), candidate("route-b", "model-b")],
            preferences=self.preferences, **kwargs,
        )

    def test_plan_is_stable_across_candidate_order_and_honors_soft_preference(self):
        self.preferences.set_capability_preference("text.chat", {"model_id": "model-b"})
        first = self.service().build_plan("chat.general", self.inputs)
        second = self.service(routes=list(reversed([candidate("route-a", "model-a"),
                                                    candidate("route-b", "model-b")]))).build_plan(
                                                        "chat.general", self.inputs)
        self.assertEqual(first.plan_id, second.plan_id)
        self.assertEqual("model-b", first.resolved_nodes[0].route.model_id)
        self.assertTrue(first.resolved_nodes[0].why)

    def test_plan_revision_hash_covers_workflow_policy_and_rejected_alternatives(self):
        base = self.service().build_plan("chat.general", self.inputs)
        changed_policy_skill = chat_skill()
        changed_policy_skill["policy"] = {"timeout_seconds": 60}
        changed_policy = self.service(skill=changed_policy_skill).build_plan("chat.general", self.inputs)
        fewer_routes = self.service(routes=[candidate("route-a", "model-a")]).build_plan(
            "chat.general", self.inputs)
        self.assertNotEqual(base.plan_id, changed_policy.plan_id)
        self.assertNotEqual(base.plan_id, fewer_routes.plan_id)

    def test_assisted_draft_gate_rejects_invented_components_and_permission_fields(self):
        disabled = self.service()
        with self.assertRaisesRegex(PlanDraftError, "disabled"):
            disabled.resolve_assisted_draft(
                {"skill_id": "chat.general", "components": [{"node_id": "reply", "component_id": "text.chat"}]},
                self.inputs)
        enabled = self.service(assisted_planner_enabled=True)
        valid = {"skill_id": "chat.general", "components": [
            {"node_id": "reply", "component_id": "text.chat"}]}
        base = enabled.build_plan("chat.general", self.inputs)
        self.assertEqual(base.plan_id, enabled.resolve_assisted_draft(valid, self.inputs).plan_id)
        with self.assertRaisesRegex(PlanDraftError, "unsupported field.*permissions"):
            enabled.resolve_assisted_draft({**valid, "permissions": {"network": "unrestricted"}}, self.inputs)
        with self.assertRaisesRegex(PlanDraftError, "unsupported field.*tool"):
            enabled.resolve_assisted_draft({**valid, "tool": "shell"}, self.inputs)
        with self.assertRaisesRegex(PlanDraftError, "components do not match"):
            enabled.resolve_assisted_draft({"skill_id": "chat.general", "components": [
                {"node_id": "reply", "component_id": "shell.exec"}]}, self.inputs)

    def test_explicit_model_node_pin_is_hard(self):
        plan = self.service(skill=chat_skill(model_node=True)).build_plan("chat.general", self.inputs)
        self.assertEqual("model-b", plan.resolved_nodes[0].route.model_id)

    def test_request_level_chat_model_and_profile_pins_are_hard(self):
        routes = [candidate("plain", "model-a"), candidate("profile-a", "model-a", profile_id="a" * 32),
                  candidate("profile-b", "model-b", profile_id="b" * 32)]
        plan = self.service(routes=routes).build_plan(
            "chat.general", self.inputs, mode="manual",
            pinned_model_id="model-b", pinned_profile_id="b" * 32)
        self.assertEqual("profile-b", plan.resolved_nodes[0].route.id)
        with self.assertRaises(PlanResolutionError):
            self.service(routes=routes).build_plan(
                "chat.general", self.inputs, mode="manual",
                pinned_model_id="model-a", pinned_profile_id="b" * 32)

    def test_manual_mode_requires_a_preference_pin_and_never_falls_back(self):
        service = self.service()
        with self.assertRaises(PlanResolutionError) as raised:
            service.build_plan("chat.general", self.inputs, mode="manual")
        self.assertEqual("manual_mode_requires_model_pin", raised.exception.why[0]["reason"])
        self.preferences.set_capability_preference("text.chat", {"model_id": "model-b"})
        pinned = service.build_plan("chat.general", self.inputs, mode="manual")
        self.assertEqual("model-b", pinned.resolved_nodes[0].route.model_id)
        with self.assertRaises(PlanResolutionError):
            self.service(routes=[candidate("only-a", "model-a")]).build_plan(
                "chat.general", self.inputs, mode="manual")

    def test_unavailable_or_missing_routes_reject_the_plan_with_reasons(self):
        with self.assertRaises(PlanResolutionError) as raised:
            self.service(routes=[candidate("route-a", "model-a", available=False)]).build_plan(
                "chat.general", self.inputs)
        self.assertEqual("no_compatible_available_route", raised.exception.why[0]["reason"])
        self.assertIn("route_unavailable", raised.exception.why[0]["routes"][0]["reasons"])

    def test_input_type_check_precedes_route_resolution_and_scheduler_side_effects(self):
        scheduler = FakeScheduler()
        called = []
        service = self.service(scheduler=scheduler, route_invokers={"route-a": lambda *_: called.append(1)})
        with self.assertRaisesRegex(ValueError, "expected artifact kind"):
            service.build_plan("chat.general", {"prompt": {"kind": "image"}})
        self.assertEqual([], scheduler.acquired)
        self.assertEqual([], called)

    def test_execution_acquires_and_releases_model_lease_around_route_call(self):
        scheduler = FakeScheduler()
        seen = []

        def invoke(route, node, node_inputs):
            seen.append((route.id, node_inputs["prompt"]["value"]))
            return {"response": {"kind": "text", "value": "fake response"}}

        service = self.service(scheduler=scheduler, route_invokers={"route-a": invoke, "route-b": invoke})
        plan = service.build_plan("chat.general", self.inputs)
        result = service.execute(plan, self.inputs)
        self.assertEqual("fake response", result["response"]["value"])
        self.assertEqual([(plan.resolved_nodes[0].route.id, "hello")], seen)
        self.assertEqual(1, len(scheduler.acquired))
        self.assertEqual(1, len(scheduler.released))

    def parallel_skill(self):
        return {
            "schema_version": 1, "id": "text.parallel", "name": "Parallel", "version": "1.0.0",
            "description": "Two independent chat routes", "inputs": [
                {"name": "prompt", "artifact": "text", "required": True}],
            "outputs": [{"name": "answer", "artifact": "json", "required": True}],
            "requirements": {"capabilities": ["text.chat"]},
            "policy": {"max_steps": 5, "max_parallel_nodes": 2},
            "graph": [
                {"id": "left", "type": "capability", "capability": "text.chat",
                 "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"}, "out": {"text": "text"}},
                {"id": "right", "type": "capability", "capability": "text.chat",
                 "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"}, "out": {"text": "text"}},
                {"id": "branches", "type": "parallel", "in": {"left": "$left.text", "right": "$right.text"},
                 "accepts": {"left": "text", "right": "text"}, "out": {"left": "text", "right": "text"}},
                {"id": "merge", "type": "join", "in": {"left": "$branches.left", "right": "$branches.right"},
                 "accepts": {"left": "text", "right": "text"}, "out": {"value": "json"}},
                {"id": "result", "type": "output", "in": {"answer": "$merge.value"}},
            ],
        }

    def test_parallel_route_layer_reserves_every_lease_before_invoking_any_branch(self):
        scheduler = FakeScheduler()
        invocations = []
        def invoke(route, node, _inputs):
            self.assertEqual(2, len(scheduler.acquired))
            invocations.append(node["id"])
            return {"text": {"kind": "text", "value": node["id"]}}
        service = self.service(skill=self.parallel_skill(), scheduler=scheduler,
                               route_invokers={"route-a": invoke, "route-b": invoke})
        plan = service.build_plan("text.parallel", self.inputs)
        result = service.execute(plan, self.inputs)
        self.assertEqual({"left": {"kind": "text", "value": "left"},
                          "right": {"kind": "text", "value": "right"}},
                         result["answer"]["value"])
        self.assertCountEqual(["left", "right"], invocations)
        self.assertEqual(2, len(scheduler.acquired))
        self.assertEqual(2, len(scheduler.released))

    def test_parallel_route_reservation_failure_runs_no_branch_and_releases_partial_batch(self):
        class FailingScheduler(FakeScheduler):
            def acquire(self, request):
                if len(self.acquired) == 1:
                    raise RuntimeError("capacity unavailable")
                return super().acquire(request)
        scheduler = FailingScheduler()
        invocations = []
        service = self.service(skill=self.parallel_skill(), scheduler=scheduler,
                               route_invokers={"route-a": lambda *_: invocations.append(True)})
        plan = service.build_plan("text.parallel", self.inputs)
        with self.assertRaisesRegex(RuntimeError, "capacity unavailable"):
            service.execute(plan, self.inputs)
        self.assertEqual([], invocations)
        self.assertEqual(1, len(scheduler.acquired))
        self.assertEqual(1, len(scheduler.released))

    def test_route_failure_still_releases_lease(self):
        scheduler = FakeScheduler()
        service = self.service(scheduler=scheduler, route_invokers={
            "route-a": lambda *_: (_ for _ in ()).throw(RuntimeError("fake failure")),
            "route-b": lambda *_: (_ for _ in ()).throw(RuntimeError("fake failure")),
        })
        plan = service.build_plan("chat.general", self.inputs)
        with self.assertRaisesRegex(RuntimeError, "fake failure"):
            service.execute(plan, self.inputs)
        self.assertEqual(1, len(scheduler.acquired))
        self.assertEqual(1, len(scheduler.released))

    def test_local_fallback_plan_executes_and_bridges_revision_trace_without_model_scheduler(self):
        skill = {
            "schema_version": 1, "id": "text.fallback", "name": "Fallback", "version": "1.0.0",
            "description": "Deterministic local fallback", "inputs": [
                {"name": "prompt", "artifact": "text", "required": True}],
            "outputs": [{"name": "response", "artifact": "text", "required": True}],
            "requirements": {"capabilities": []},
            "graph": [
                {"id": "recover", "type": "fallback", "in": {"prompt": "$input.prompt"},
                 "accepts": {"prompt": "text"}, "out": {"response": "text"},
                 "fallbacks": [{"id": "preferred", "transform_id": "preferred"},
                               {"id": "backup", "transform_id": "backup"}]},
                {"id": "result", "type": "output", "in": {"response": "$recover.response"}},
            ],
        }
        executor = SkillExecutor(transforms={
            "preferred": lambda *_: (_ for _ in ()).throw(ValueError("private failure")),
            "backup": lambda _node, _inputs: {"response": {"kind": "text", "value": "backup answer"}},
        })
        service = OrchestrationService(
            skills=SkillRegistry([skill]), executor=executor, capabilities=self.declarations,
            routes=(), preferences=self.preferences, scheduler=None,
        )
        plan = service.build_plan("text.fallback", self.inputs)
        traces = []
        result = service.execute(plan, self.inputs, fallback_callback=traces.append)
        self.assertEqual("backup answer", result["response"]["value"])
        self.assertEqual(plan.plan_id, traces[0].base_plan_revision)
        self.assertEqual("fallback.selected", traces[0].event_type)
        self.assertEqual("backup", traces[0].selected_candidate)
        with self.assertRaisesRegex(SkillExecutionError, "trace callback"):
            service.execute(plan, self.inputs)


if __name__ == "__main__":
    unittest.main()
