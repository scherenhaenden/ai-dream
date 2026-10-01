import unittest
import hashlib
from threading import Barrier, Event, Lock

from aidream.run_manager import RunCancelled
from aidream.skills import SkillContractError, SkillExecutionError, SkillExecutor, SkillRegistry


def manifest(graph=None):
    return {
        "schema_version": 1,
        "id": "chat.general",
        "name": "General chat",
        "version": "1.0.0",
        "description": "A minimal declarative workflow",
        "inputs": [{"name": "prompt", "artifact": "text", "required": True}],
        "outputs": [{"name": "answer", "artifact": "text", "required": True}],
        "requirements": {"capabilities": ["text.chat"]},
        "graph": graph if graph is not None else [
            {"id": "chat", "type": "capability", "capability": "text.chat",
             "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
             "out": {"answer": "text"}},
            {"id": "result", "type": "output", "in": {"answer": "$chat.answer"}},
        ],
    }


def artifact(kind, value):
    return {"kind": kind, "value": value}


class SkillRegistryTests(unittest.TestCase):
    def test_registry_keeps_valid_skills_when_an_installed_one_is_invalid(self):
        invalid = manifest()
        invalid["graph"] = [{"id": "bad", "type": "shell", "command": "echo unsafe"}]
        registry = SkillRegistry([invalid, manifest()])
        self.assertEqual(["chat.general"], [item["id"] for item in registry.snapshot()])
        self.assertEqual(1, len(registry.invalid_skills()))
        self.assertIsNotNone(registry.get("chat.general", "1.0.0"))

    def test_duplicate_versions_are_reported_without_crashing_registry(self):
        registry = SkillRegistry([manifest(), manifest()])
        self.assertEqual(1, len(registry.snapshot()))
        self.assertEqual(1, len(registry.invalid_skills()))


class SkillExecutorTests(unittest.TestCase):
    def test_cooperative_cancel_event_stops_before_next_side_effecting_node(self):
        cancel_event = Event()
        calls = []

        def stop_after_first(_node, values):
            calls.append("first")
            cancel_event.set()
            return {"value": artifact("text", values["value"]["value"])}

        def should_not_run(_node, values):
            calls.append("second")
            return {"answer": values["value"]}

        graph = [
            {"id": "first", "type": "transform", "transform_id": "first",
             "in": {"value": "$input.prompt"}, "accepts": {"value": "text"},
             "out": {"value": "text"}},
            {"id": "second", "type": "transform", "transform_id": "second",
             "in": {"value": "$first.value"}, "accepts": {"value": "text"},
             "out": {"answer": "text"}},
            {"id": "result", "type": "output", "in": {"answer": "$second.answer"}},
        ]
        executor = SkillExecutor(transforms={"first": stop_after_first, "second": should_not_run})
        with self.assertRaisesRegex(RunCancelled, "run cancelled"):
            executor.execute(manifest(graph), {"prompt": artifact("text", "start")},
                             cancel_event=cancel_event)
        self.assertEqual(["first"], calls)

    @staticmethod
    def child_skill(skill_id="text.child"):
        return {
            "schema_version": 1, "id": skill_id, "name": "Child", "version": "1.0.0",
            "description": "A typed local sub-skill", "inputs": [
                {"name": "prompt", "artifact": "text", "required": True}],
            "outputs": [{"name": "answer", "artifact": "text", "required": True}],
            "requirements": {"capabilities": []},
            "graph": [
                {"id": "work", "type": "transform", "transform_id": "echo",
                 "in": {"value": "$input.prompt"}, "accepts": {"value": "text"},
                 "out": {"answer": "text"}},
                {"id": "result", "type": "output", "in": {"answer": "$work.answer"}},
            ],
        }

    @staticmethod
    def parent_with_subskill(skill_id="text.child"):
        return manifest([
            {"id": "nested", "type": "skill", "skill_id": skill_id,
             "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
             "out": {"answer": "text"}},
            {"id": "result", "type": "output", "in": {"answer": "$nested.answer"}},
        ])

    def test_subskill_executes_registered_typed_graph_and_emits_hierarchical_trace(self):
        calls, events = [], []
        def echo(_node, values):
            calls.append(values["value"]["value"])
            return {"answer": artifact("text", values["value"]["value"] + "!")}
        executor = SkillExecutor(transforms={"echo": echo}, subskills={"text.child": self.child_skill()})
        result = executor.execute(self.parent_with_subskill(), {"prompt": artifact("text", "hi")},
                                  event_callback=lambda state, node: events.append((state, node)))
        self.assertEqual(["hi"], calls)
        self.assertEqual(artifact("text", "hi!"), result["answer"])
        self.assertEqual([
            ("started", "nested"),
            ("started", "nested/work"), ("completed", "nested/work"),
            ("started", "nested/result"), ("completed", "nested/result"),
            ("completed", "nested"),
            ("started", "result"), ("completed", "result"),
        ], events)

    def test_subskill_cancellation_propagates_and_emits_hierarchical_failure_trace(self):
        class RunCancelled(Exception):
            pass

        def cancel(*_):
            raise RunCancelled("cancelled")

        events = []
        executor = SkillExecutor(transforms={"echo": cancel}, subskills={"text.child": self.child_skill()})
        with self.assertRaisesRegex(RunCancelled, "cancelled"):
            executor.execute(self.parent_with_subskill(), {"prompt": artifact("text", "hi")},
                             event_callback=lambda state, node: events.append((state, node)))
        self.assertEqual([("started", "nested"), ("started", "nested/work"),
                          ("failed", "nested/work"), ("failed", "nested")], events)

    def test_subskill_contract_rejects_missing_registry_and_bad_ports_but_allows_nested_routes(self):
        parent = self.parent_with_subskill()
        with self.assertRaisesRegex(SkillContractError, "not registered"):
            SkillExecutor().type_check(parent)
        child = self.child_skill()
        parent["graph"][0]["accepts"]["prompt"] = "json"
        with self.assertRaisesRegex(SkillContractError, "expected child input kind"):
            SkillExecutor(subskills={"text.child": child}).type_check(parent)

        child = self.child_skill()
        child["graph"].insert(0, {"id": "route", "type": "capability", "capability": "text.chat",
                                  "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
                                  "out": {"answer": "text"}})
        checked = SkillExecutor(subskills={"text.child": child}).type_check(self.parent_with_subskill())
        self.assertEqual("chat.general", checked["id"])

    def test_subskill_cannot_widen_parent_permissions(self):
        child = self.child_skill()
        child["permissions"] = {"filesystem_read": "user-selected-only"}
        executor = SkillExecutor(subskills={"text.child": child})
        with self.assertRaisesRegex(SkillContractError, "widens inherited permissions.*filesystem_read"):
            executor.type_check(self.parent_with_subskill())
        parent = self.parent_with_subskill()
        parent["permissions"] = {"filesystem_read": "user-selected-only"}
        executor.type_check(parent)

    def test_subskill_cycles_and_depth_are_rejected_during_type_check(self):
        a = self.child_skill("text.a")
        b = self.child_skill("text.b")
        a["graph"].insert(0, {"id": "nested", "type": "skill", "skill_id": "text.b",
                              "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
                              "out": {"answer": "text"}})
        b["graph"].insert(0, {"id": "nested", "type": "skill", "skill_id": "text.a",
                              "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
                              "out": {"answer": "text"}})
        with self.assertRaisesRegex(SkillContractError, "sub-skill cycle"):
            SkillExecutor(subskills={"text.a": a, "text.b": b}).type_check(self.parent_with_subskill("text.a"))

        chain = {}
        for index in range(5, 0, -1):
            skill_id = f"text.level{index}"
            child = self.child_skill(skill_id)
            if index < 5:
                next_id = f"text.level{index + 1}"
                child["graph"] = [
                    {"id": "nested", "type": "skill", "skill_id": next_id,
                     "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
                     "out": {"answer": "text"}},
                    {"id": "result", "type": "output", "in": {"answer": "$nested.answer"}},
                ]
            chain[skill_id] = child
        with self.assertRaisesRegex(SkillContractError, "nesting exceeds depth 4"):
            SkillExecutor(subskills=chain).type_check(self.parent_with_subskill("text.level1"))

    def test_subskill_invocations_count_child_worst_case_steps(self):
        parent = self.parent_with_subskill()
        parent["policy"] = {"max_steps": 1}
        child = self.child_skill()
        child["graph"].insert(1, {
            "id": "second", "type": "transform", "transform_id": "echo",
            "in": {"value": "$work.answer"}, "accepts": {"value": "text"},
            "out": {"answer": "text"},
        })
        child["graph"][-1]["in"]["answer"] = "$second.answer"
        executor = SkillExecutor(subskills={"text.child": child})
        with self.assertRaisesRegex(SkillContractError, "requires 2 steps, limit is 1"):
            executor.type_check(parent)

    def test_parallel_branches_join_with_typed_output_and_stable_trace(self):
        graph = [
            {"id": "result", "type": "output", "in": {"answer": "$merge.value"}},
            {"id": "merge", "type": "join", "in": {"left": "$fanout.left", "right": "$fanout.right"},
             "accepts": {"left": "text", "right": "text"}, "out": {"value": "json"}},
            {"id": "fanout", "type": "parallel", "in": {"left": "$left.value", "right": "$right.value"},
             "accepts": {"left": "text", "right": "text"}, "out": {"left": "text", "right": "text"}},
            {"id": "left", "type": "tool", "tool_id": "left", "in": {"prompt": "$input.prompt"},
             "accepts": {"prompt": "text"}, "out": {"value": "text"}},
            {"id": "right", "type": "tool", "tool_id": "right", "in": {"prompt": "$input.prompt"},
             "accepts": {"prompt": "text"}, "out": {"value": "text"}},
        ]
        skill = manifest(graph)
        skill["outputs"] = [{"name": "answer", "artifact": "json", "required": True}]
        skill["policy"] = {"max_parallel_nodes": 2}
        barrier = Barrier(2)
        active_lock = Lock()
        active = 0
        peak = 0
        def branch(name):
            def execute(*_):
                nonlocal active, peak
                with active_lock:
                    active += 1
                    peak = max(peak, active)
                barrier.wait(timeout=2)
                with active_lock:
                    active -= 1
                return {"value": artifact("text", name)}
            return execute
        events = []
        executor = SkillExecutor(tools={"left": branch("L"), "right": branch("R")})
        result = executor.execute(skill, {"prompt": artifact("text", "go")},
                                  event_callback=lambda state, node: events.append((state, node)))
        self.assertEqual(2, peak)
        self.assertEqual({"kind": "json", "value": {
            "left": artifact("text", "L"), "right": artifact("text", "R")}}, result["answer"])
        self.assertEqual([("started", "left"), ("started", "right"),
                          ("completed", "left"), ("completed", "right"),
                          ("started", "fanout"), ("completed", "fanout"),
                          ("started", "merge"), ("completed", "merge"),
                          ("started", "result"), ("completed", "result")], events)

    def test_parallel_cancellation_signals_siblings_and_wins_over_regular_failure(self):
        graph = [
            {"id": "left", "type": "tool", "tool_id": "left", "in": {"prompt": "$input.prompt"},
             "accepts": {"prompt": "text"}, "out": {"value": "text"}},
            {"id": "right", "type": "tool", "tool_id": "right", "in": {"prompt": "$input.prompt"},
             "accepts": {"prompt": "text"}, "out": {"value": "text"}},
            {"id": "fanout", "type": "parallel", "in": {"left": "$left.value", "right": "$right.value"},
             "accepts": {"left": "text", "right": "text"}, "out": {"left": "text", "right": "text"}},
            {"id": "merge", "type": "join", "in": {"left": "$fanout.left", "right": "$fanout.right"},
             "accepts": {"left": "text", "right": "text"}, "out": {"value": "json"}},
            {"id": "result", "type": "output", "in": {"answer": "$merge.value"}},
        ]
        skill = manifest(graph)
        skill["outputs"] = [{"name": "answer", "artifact": "json", "required": True}]
        skill["policy"] = {"max_parallel_nodes": 2}
        cancel_event = Event()
        sibling_observed_cancel = Event()
        branches_entered = Barrier(2)

        def ordinary_failure_after_cancel(*_):
            branches_entered.wait(timeout=2)
            if cancel_event.wait(1):
                sibling_observed_cancel.set()
                raise RuntimeError("ordinary sibling failure")
            raise RuntimeError("cancellation was not propagated")

        def cancel_branch(*_):
            branches_entered.wait(timeout=2)
            raise RunCancelled("nested branch cancelled")

        executor = SkillExecutor(tools={"left": ordinary_failure_after_cancel, "right": cancel_branch})
        with self.assertRaisesRegex(RunCancelled, "nested branch cancelled"):
            executor.execute(skill, {"prompt": artifact("text", "go")}, cancel_event=cancel_event)

        self.assertTrue(cancel_event.is_set())
        self.assertTrue(sibling_observed_cancel.is_set())

    def test_parallel_contract_requires_distinct_static_typed_branches_and_parallel_budget(self):
        graph = [
            {"id": "left", "type": "tool", "tool_id": "identity", "in": {"value": "$input.prompt"},
             "accepts": {"value": "text"}, "out": {"value": "text"}},
            {"id": "right", "type": "tool", "tool_id": "identity", "in": {"value": "$input.prompt"},
             "accepts": {"value": "text"}, "out": {"value": "text"}},
            {"id": "fanout", "type": "parallel", "in": {"left": "$left.value", "right": "$right.value"},
             "accepts": {"left": "text", "right": "text"}, "out": {"left": "text", "right": "text"}},
            {"id": "result", "type": "output", "in": {"answer": "$fanout.left"}},
        ]
        skill = manifest(graph)
        with self.assertRaisesRegex(SkillContractError, "require a concurrency limit of at least 2"):
            SkillExecutor().type_check(skill)
        skill["policy"] = {"max_parallel_nodes": 2}
        SkillExecutor().type_check(skill)
        graph[2]["in"]["right"] = "$left.value"
        invalid = manifest(graph)
        invalid["policy"] = {"max_parallel_nodes": 2}
        with self.assertRaisesRegex(SkillContractError, "distinct producer"):
            SkillExecutor().type_check(invalid)
        graph[2]["in"]["right"] = "$input.prompt"
        invalid = manifest(graph)
        invalid["policy"] = {"max_parallel_nodes": 2}
        with self.assertRaisesRegex(SkillContractError, "node outputs"):
            SkillExecutor().type_check(invalid)
        graph[2]["in"]["right"] = "$right.value"
        graph[1]["in"]["value"] = "$left.value"
        graph[1]["out"] = {"value": "text"}
        graph[2]["accepts"]["right"] = "text"
        graph[2]["out"]["right"] = "text"
        invalid = manifest(graph)
        invalid["policy"] = {"max_parallel_nodes": 2}
        with self.assertRaisesRegex(SkillContractError, "dependency-linked"):
            SkillExecutor().type_check(invalid)

    def test_join_requires_declared_json_result_and_nonempty_typed_inputs(self):
        graph = [
            {"id": "merge", "type": "join", "in": {"item": "$chat.answer"},
             "accepts": {"item": "text"}, "out": {"value": "text"}},
            *manifest()["graph"],
        ]
        with self.assertRaisesRegex(SkillContractError, "join must declare exactly"):
            SkillExecutor().type_check(manifest(graph))

    def test_join_rejects_untyped_literal_branches(self):
        graph = [{"id": "merge", "type": "join", "in": {"item": "not-a-reference"},
                  "accepts": {"item": "text"}, "out": {"value": "json"}}]
        with self.assertRaisesRegex(SkillContractError, "typed graph outputs"):
            SkillExecutor().type_check(manifest(graph))

    def test_parallelism_limit_is_bounded_and_strictly_typed(self):
        skill = manifest()
        skill["policy"] = {"max_parallel_nodes": True}
        with self.assertRaisesRegex(SkillContractError, "integer from 1 to 8"):
            SkillExecutor().type_check(skill)

    def test_loop_is_bounded_and_threads_typed_artifact_between_iterations(self):
        graph = [
            {"id": "result", "type": "output", "in": {"answer": "$repeat.value"}},
            {"id": "repeat", "type": "loop", "transform_id": "append", "max_iterations": 3,
             "in": {"value": "$input.prompt"}, "accepts": {"value": "text"}, "out": {"value": "text"}},
        ]
        calls = []
        def append(_node, values):
            calls.append(values["value"]["value"])
            return {"value": artifact("text", values["value"]["value"] + "!")}
        executor = SkillExecutor(transforms={"append": append})
        result = executor.execute(manifest(graph), {"prompt": artifact("text", "x")})
        self.assertEqual(["x", "x!", "x!!"], calls)
        self.assertEqual("x!!!", result["answer"]["value"])

    def test_loop_iteration_bound_rejects_unbounded_or_boolean_counts(self):
        graph = [{"id": "repeat", "type": "loop", "transform_id": "append", "max_iterations": 9,
                  "in": {"value": "$input.prompt"}, "accepts": {"value": "text"}, "out": {"value": "text"}}]
        with self.assertRaisesRegex(SkillContractError, "max_iterations"):
            SkillExecutor().type_check(manifest(graph))
        graph[0]["max_iterations"] = True
        with self.assertRaisesRegex(SkillContractError, "max_iterations"):
            SkillExecutor().type_check(manifest(graph))

    def test_loop_iterations_count_toward_max_steps_before_any_handler_runs(self):
        graph = [{"id": "repeat", "type": "loop", "transform_id": "append", "max_iterations": 3,
                  "in": {"value": "$input.prompt"}, "accepts": {"value": "text"}, "out": {"value": "text"}}]
        calls = []
        skill = manifest(graph)
        skill["policy"] = {"max_steps": 2}
        executor = SkillExecutor(transforms={"append": lambda *_: calls.append(True) or {"value": artifact("text", "x")}})
        with self.assertRaisesRegex(SkillContractError, "requires 3 steps, limit is 2"):
            executor.execute(skill, {"prompt": artifact("text", "x")})
        self.assertEqual([], calls)

    def test_missing_loop_handler_is_preflighted_before_earlier_tool_side_effect(self):
        graph = [
            {"id": "first", "type": "tool", "tool_id": "touch", "in": {"value": "$input.prompt"},
             "accepts": {"value": "text"}, "out": {"value": "text"}},
            {"id": "repeat", "type": "loop", "transform_id": "missing", "max_iterations": 2,
             "in": {"value": "$first.value"}, "accepts": {"value": "text"}, "out": {"value": "text"}},
            {"id": "result", "type": "output", "in": {"answer": "$repeat.value"}},
        ]
        called = []
        executor = SkillExecutor(tools={"touch": lambda *_: called.append(True) or {"value": artifact("text", "x")}})
        with self.assertRaisesRegex(SkillExecutionError, "no registered transform executor"):
            executor.execute(manifest(graph), {"prompt": artifact("text", "go")})
        self.assertEqual([], called)

    def test_fallback_does_not_treat_run_cancellation_as_a_candidate_failure(self):
        graph = [{"id": "recover", "type": "fallback", "in": {"prompt": "$input.prompt"},
                  "accepts": {"prompt": "text"}, "out": {"answer": "text"},
                  "fallbacks": [{"id": "primary", "transform_id": "primary"},
                                {"id": "backup", "transform_id": "backup"}]},
                 {"id": "result", "type": "output", "in": {"answer": "$recover.answer"}}]
        called = []

        def cancel(*_):
            called.append("primary")
            raise RunCancelled("cancel requested")

        executor = SkillExecutor(transforms={
            "primary": cancel,
            "backup": lambda *_: called.append("backup") or {"answer": artifact("text", "recovered")},
        })
        with self.assertRaisesRegex(RunCancelled, "cancel requested"):
            executor.execute(manifest(graph), {"prompt": artifact("text", "go")},
                             plan_revision="plan", fallback_callback=lambda _trace: None)
        self.assertEqual(["primary"], called)

    def test_fallback_selects_first_valid_registered_transform_and_emits_revision_trace(self):
        graph = [
            {"id": "recover", "type": "fallback", "in": {"prompt": "$input.prompt"},
             "accepts": {"prompt": "text"}, "out": {"answer": "text"},
             "fallbacks": [
                 {"id": "primary", "transform_id": "primary-transform"},
                 {"id": "backup", "transform_id": "backup-transform"},
                 {"id": "last-resort", "transform_id": "last-transform"},
             ]},
            {"id": "result", "type": "output", "in": {"answer": "$recover.answer"}},
        ]
        calls = []
        def primary(*_):
            calls.append("primary")
            raise ValueError("private prompt text")
        def backup(*_):
            calls.append("backup")
            return {"answer": artifact("text", "recovered")}
        def last(*_):
            calls.append("last")
            return {"answer": artifact("text", "should not run")}
        traces = []
        executor = SkillExecutor(transforms={"primary-transform": primary,
                                             "backup-transform": backup,
                                             "last-transform": last})
        result = executor.execute(manifest(graph), {"prompt": artifact("text", "go")},
                                  plan_revision="plan-123", fallback_callback=traces.append)
        self.assertEqual("recovered", result["answer"]["value"])
        self.assertEqual(["primary", "backup"], calls)
        self.assertEqual(1, len(traces))
        trace = traces[0]
        self.assertEqual("fallback.selected", trace.event_type)
        self.assertEqual("recover", trace.node_id)
        self.assertEqual("plan-123", trace.base_plan_revision)
        self.assertEqual(("primary", "backup"), trace.attempted_candidates)
        self.assertEqual("backup", trace.selected_candidate)
        self.assertEqual(("ValueError",), trace.failure_kinds)
        self.assertEqual(hashlib.sha256(b"plan-123\0recover\0backup").hexdigest()[:24], trace.revision_id)
        self.assertNotIn("private", repr(trace))

    def test_fallback_requires_callback_and_all_candidates_registered_before_side_effects(self):
        graph = [{"id": "recover", "type": "fallback", "in": {"prompt": "$input.prompt"},
                  "accepts": {"prompt": "text"}, "out": {"answer": "text"},
                  "fallbacks": [{"id": "primary", "transform_id": "p"},
                                {"id": "backup", "transform_id": "missing"}]},
                 {"id": "result", "type": "output", "in": {"answer": "$recover.answer"}}]
        called = []
        executor = SkillExecutor(transforms={"p": lambda *_: called.append("p") or {"answer": artifact("text", "x")}})
        with self.assertRaisesRegex(SkillExecutionError, "trace callback"):
            executor.execute(manifest(graph), {"prompt": artifact("text", "go")})
        with self.assertRaisesRegex(SkillExecutionError, "unregistered fallback transform.*missing"):
            executor.execute(manifest(graph), {"prompt": artifact("text", "go")}, fallback_callback=lambda _: None)
        self.assertEqual([], called)

    def test_fallback_contract_requires_ordered_distinct_candidates_and_bounded_steps(self):
        graph = [{"id": "recover", "type": "fallback", "in": {"prompt": "$input.prompt"},
                  "accepts": {"prompt": "text"}, "out": {"answer": "text"},
                  "fallbacks": [{"id": "primary", "transform_id": "p"},
                                {"id": "backup", "transform_id": "b"}]},
                 {"id": "result", "type": "output", "in": {"answer": "$recover.answer"}}]
        skill = manifest(graph)
        skill["policy"] = {"max_steps": 1}
        with self.assertRaisesRegex(SkillContractError, "requires 2 steps, limit is 1"):
            SkillExecutor().type_check(skill)
        skill["policy"] = {"max_steps": 2}
        graph[0]["fallbacks"][1]["id"] = "primary"
        with self.assertRaisesRegex(SkillContractError, "unique simple candidate ID"):
            SkillExecutor().type_check(skill)

    def test_exhausted_fallback_emits_sanitized_trace_then_fails(self):
        graph = [{"id": "recover", "type": "fallback", "in": {"prompt": "$input.prompt"},
                  "accepts": {"prompt": "text"}, "out": {"answer": "text"},
                  "fallbacks": [{"id": "first", "transform_id": "a"},
                                {"id": "second", "transform_id": "b"}]},
                 {"id": "result", "type": "output", "in": {"answer": "$recover.answer"}}]
        executor = SkillExecutor(transforms={
            "a": lambda *_: (_ for _ in ()).throw(ValueError("secret")),
            "b": lambda *_: (_ for _ in ()).throw(RuntimeError("also secret")),
        })
        traces = []
        with self.assertRaisesRegex(SkillExecutionError, "all fallback candidates failed") as raised:
            executor.execute(manifest(graph), {"prompt": artifact("text", "go")},
                             plan_revision="base", fallback_callback=traces.append)
        self.assertNotIn("secret", str(raised.exception))
        self.assertEqual(1, len(traces))
        self.assertEqual("fallback.exhausted", traces[0].event_type)
        self.assertIsNone(traces[0].revision_id)
        self.assertIsNone(traces[0].selected_candidate)
        self.assertEqual(("ValueError", "RuntimeError"), traces[0].failure_kinds)

    def test_emits_sanitized_node_lifecycle_events_in_execution_order(self):
        events = []
        executor = SkillExecutor(capabilities={
            "text.chat": lambda *_: {"answer": artifact("text", "secret output")},
        })
        result = executor.execute(
            manifest(), {"prompt": artifact("text", "secret input")},
            event_callback=lambda state, node_id: events.append((state, node_id)),
        )
        self.assertEqual("secret output", result["answer"]["value"])
        self.assertEqual([
            ("started", "chat"), ("completed", "chat"),
            ("started", "result"), ("completed", "result"),
        ], events)
        self.assertNotIn("secret", repr(events))

    def test_emits_failed_node_without_exposing_exception_or_payload(self):
        events = []
        def fail(*_):
            raise RuntimeError("private prompt text")
        executor = SkillExecutor(capabilities={"text.chat": fail})
        with self.assertRaisesRegex(RuntimeError, "private prompt text"):
            executor.execute(manifest(), {"prompt": artifact("text", "private input")},
                             event_callback=lambda state, node_id: events.append((state, node_id)))
        self.assertEqual([("started", "chat"), ("failed", "chat")], events)
        self.assertNotIn("private", repr(events))

    def test_type_checks_then_executes_only_explicitly_registered_handler(self):
        seen = []

        def chat(node, inputs):
            seen.append(inputs["prompt"]["value"])
            return {"answer": artifact("text", "hello")}

        executor = SkillExecutor(capabilities={"text.chat": chat})
        result = executor.execute(manifest(), {"prompt": artifact("text", "hi")})
        self.assertEqual("hello", result["answer"]["value"])
        self.assertEqual(["hi"], seen)

    def test_forward_references_execute_in_stable_dependency_order(self):
        graph = [
            {"id": "result", "type": "output", "in": {"answer": "$chat.answer"}},
            {"id": "chat", "type": "capability", "capability": "text.chat",
             "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
             "out": {"answer": "text"}},
        ]
        executor = SkillExecutor(capabilities={"text.chat": lambda *_: {"answer": artifact("text", "ok")}})
        self.assertEqual("ok", executor.execute(manifest(graph), {"prompt": artifact("text", "go")})["answer"]["value"])

    def test_mismatched_edge_type_fails_before_callback(self):
        called = []
        graph = manifest()["graph"]
        graph[0]["accepts"]["prompt"] = "image"
        executor = SkillExecutor(capabilities={"text.chat": lambda *_: called.append(True) or {"answer": artifact("text", "x")}})
        with self.assertRaises(SkillContractError):
            executor.execute(manifest(graph), {"prompt": artifact("text", "hi")})
        self.assertEqual([], called)

    def test_missing_optional_input_referenced_by_later_node_fails_before_side_effects(self):
        graph = [
            {"id": "chat", "type": "capability", "capability": "text.chat",
             "in": {"prompt": "$input.prompt"}, "accepts": {"prompt": "text"},
             "out": {"answer": "text"}},
            {"id": "late", "type": "tool", "tool_id": "combine",
             "in": {"answer": "$chat.answer", "option": "$input.option"},
             "accepts": {"answer": "text", "option": "text"}, "out": {"answer": "text"}},
            {"id": "result", "type": "output", "in": {"answer": "$late.answer"}},
        ]
        skill = manifest(graph)
        skill["inputs"].append({"name": "option", "artifact": "text", "required": False})
        called = []
        executor = SkillExecutor(
            capabilities={"text.chat": lambda *_: called.append("chat") or {"answer": artifact("text", "ok")}},
            tools={"combine": lambda *_: called.append("combine") or {"answer": artifact("text", "ok")}},
        )
        with self.assertRaisesRegex(SkillExecutionError, "references missing input.*option"):
            executor.execute(skill, {"prompt": artifact("text", "hello")})
        self.assertEqual([], called)

    def test_missing_handler_is_clear_and_never_imported_from_manifest(self):
        executor = SkillExecutor()
        with self.assertRaisesRegex(SkillExecutionError, "no registered capability executor"):
            executor.execute(manifest(), {"prompt": artifact("text", "hi")})

    def test_inputs_and_handler_outputs_are_kind_checked(self):
        executor = SkillExecutor(capabilities={"text.chat": lambda *_: {"answer": artifact("json", {})}})
        with self.assertRaisesRegex(SkillExecutionError, "artifact kind 'text'"):
            executor.execute(manifest(), {"prompt": artifact("text", "hi")})
        executor = SkillExecutor(capabilities={"text.chat": lambda *_: {"answer": artifact("text", "hello")}})
        with self.assertRaisesRegex(SkillExecutionError, "artifact kind 'text'"):
            executor.execute(manifest(), {"prompt": artifact("image", "hi")})

    def test_only_initial_node_types_are_executable(self):
        graph = manifest()["graph"]
        graph[0]["type"] = "shell"
        with self.assertRaisesRegex(SkillContractError, "not supported by this executor"):
            SkillExecutor().type_check(manifest(graph))


if __name__ == "__main__":
    unittest.main()
