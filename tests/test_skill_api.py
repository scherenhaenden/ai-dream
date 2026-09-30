import unittest
import time
import tempfile
from types import SimpleNamespace

from aidream.capabilities import CapabilityPreferenceStore
from aidream.http_api import APINotFound, APIError, ReadOnlyAPI
from aidream.skills import SkillRegistry, builtin_skill_manifests


def manifest(skill_id, capability):
    return {
        "schema_version": 1, "id": skill_id, "name": skill_id.title(), "version": "1.0.0",
        "description": "A declarative task.",
        "inputs": [{"name": "prompt", "artifact": "text", "required": True}],
        "outputs": [{"name": "answer", "artifact": "text", "required": True}],
        "requirements": {"capabilities": [capability]},
        "ui": {"category": "Chat"},
        "graph": [{"id": "answer", "type": "capability", "capability": capability,
                   "in": {"text": "$input.prompt"}, "accepts": {"text": "text"}, "out": {"text": "text"}},
                  {"id": "result", "type": "output", "in": {"answer": "$answer.text"}}],
    }


def api(skills, capabilities):
    service = ReadOnlyAPI.__new__(ReadOnlyAPI)
    service.skill_registry = SkillRegistry(skills)
    service._capability_declarations = lambda: capabilities
    return service


class SkillAPITests(unittest.TestCase):
    def test_catalog_exposes_typed_ports_and_derived_readiness(self):
        service = api([manifest("chat.general", "text.chat"), manifest("image.describe", "vision.understand")], [
            {"id": "text.chat", "status": "supported", "routes": [{"id": "route-a"}],
             "preferred_route_id": "route-a"},
        ])
        status, response = service.get("/api/skills")
        self.assertEqual(status, 200)
        skills = {item["id"]: item for item in response["data"]["skills"]}
        self.assertEqual(skills["chat.general"]["status"], "ready")
        self.assertEqual(skills["chat.general"]["preferred_route_id"], "route-a")
        self.assertEqual(skills["chat.general"]["inputs"], [{"name": "prompt", "artifact": "text", "required": True}])
        self.assertEqual(skills["image.describe"]["status"], "not_ready")
        self.assertEqual(skills["image.describe"]["not_ready_reasons"], ["Missing capability route: vision.understand"])
        self.assertTrue(any("chat.general" in item for item in skills["image.describe"]["alternatives"]))

    def test_image_skill_catalog_explains_absent_local_generator(self):
        detail = "No compatible local image generation runtime and model are configured."
        service = api(builtin_skill_manifests(), [
            {"id": "image.generate", "status": "unavailable", "routes": [],
             "evidence": [{"details": detail}]},
            {"id": "image.edit", "status": "unavailable", "routes": [],
             "evidence": [{"details": "No compatible local image-editing runtime and model are configured."}]},
            {"id": "text.chat", "status": "supported", "routes": [{"id": "chat-route"}]},
        ])
        skills = {item["id"]: item for item in service.get("/api/skills")[1]["data"]["skills"]}
        self.assertEqual(skills["image.generate"]["status"], "not_ready")
        self.assertEqual(skills["image.generate"]["not_ready_reasons"], [detail])
        self.assertTrue(any("text.chat can help refine the prompt" in item
                            for item in skills["image.generate"]["alternatives"]))
        self.assertIn("No compatible local image-editing runtime",
                      skills["image.edit-from-instruction"]["not_ready_reasons"][0])

    def test_skill_detail_and_unknown_or_malformed_ids(self):
        service = api([manifest("chat.general", "text.chat")], [])
        status, detail = service.get("/api/skills/chat.general")
        self.assertEqual(status, 200)
        self.assertEqual(detail["data"]["skill"]["id"], "chat.general")
        with self.assertRaises(APINotFound):
            service.get("/api/skills/missing")
        with self.assertRaises(APIError):
            service.get("/api/skills/chat.general", "x=1")

    def test_plan_and_start_use_injected_planner_and_run_manager(self):
        class Runs:
            def __init__(self): self.created = []
            def create(self, **values):
                self.created.append(values)
                return {"id": "a" * 32, "state": "queued", "plan": values["plan"]}

        service = api([manifest("chat.general", "text.chat")], [])
        service.run_planner = lambda **kwargs: {"plan": {"nodes": ["resolved"]}}
        service.run_manager = Runs()
        request = {"inputs": {"prompt": {"kind": "text", "text": "hi"}},
                   "parameters": {}, "selection": {"mode": "auto"}}
        planned = service.plan_skill("chat.general", request)
        self.assertEqual(planned["data"]["plan"]["nodes"], ["resolved"])
        started = service.start_skill("chat.general", request)
        self.assertEqual(started["data"]["run"]["state"], "queued")
        self.assertEqual(service.run_manager.created[0]["skill_version"], "1.0.0")

    def test_planning_is_unavailable_without_deterministic_planner(self):
        service = api([manifest("chat.general", "text.chat")], [])
        with self.assertRaises(APIError) as missing:
            service.plan_skill("chat.general", {})
        self.assertEqual(missing.exception.status, 503)

    def test_run_bridge_persists_only_safe_fallback_revision_fields(self):
        from aidream.skills.executor import FallbackTrace

        class Scheduler:
            def release_owner(self, _owner): pass
            def residency(self): return ()

        class Service:
            scheduler = Scheduler()
            def execute(self, _plan, _inputs, *, owner_id, event_callback, fallback_callback):
                event_callback("started", "recover")
                fallback_callback(FallbackTrace(
                    event_type="fallback.selected", node_id="recover",
                    base_plan_revision="plan-base", revision_id="revision-safe",
                    attempted_candidates=("primary", "backup"), selected_candidate="backup",
                    failure_kinds=("ValueError",),
                ))
                return {"answer": {"kind": "text", "text": "recovered"}}

        api_service = ReadOnlyAPI.__new__(ReadOnlyAPI)
        api_service._chat_lock = __import__("threading").Lock()
        api_service._unload_active = lambda: None
        api_service._active_backend = None
        api_service._active_binding = None
        emitted = []
        result = api_service._execute_orchestration_run(
            plan={"id": "ignored"},
            cancel_event=None,
            emit=lambda event, data: emitted.append((event, data)),
            context=(Service(), SimpleNamespace(plan_id="plan-base"), {}),
            run_id="run-owner",
        )
        self.assertEqual(result, [{"kind": "text", "text": "recovered"}])
        self.assertEqual(emitted, [
            ("node.started", {"node_id": "recover"}),
            ("plan.revised", {
                "event": "fallback.selected", "node_id": "recover",
                "base_revision": "plan-base", "revision_id": "revision-safe",
                "attempted_candidates": ["primary", "backup"],
                "selected_candidate": "backup", "failure_kinds": ["ValueError"],
            }),
        ])
        self.assertNotIn("private prompt", repr(emitted).casefold())

    def test_default_planner_builds_supported_route_without_loading_runtime(self):
        calls = []

        class Backend:
            name = "fixture-runtime"
            runtime_id = "fixture-runtime"

            def capabilities(self):
                return SimpleNamespace(available=True, chat_completions=True)

            def can_load(self, model):
                calls.append("can_load")
                return True

            def load(self, *args):
                calls.append("load")

        service = api(builtin_skill_manifests(), [])
        service.catalog = SimpleNamespace(list_models=lambda: [SimpleNamespace(id="model-a", path="/tmp/model.gguf")])
        service._all_backends = lambda: [Backend()]
        service.capability_preference_store = CapabilityPreferenceStore()
        service._chat_lock = __import__("threading").Lock()
        service.hardware = SimpleNamespace(detect=lambda: SimpleNamespace(
            ram=SimpleNamespace(total_bytes=None, available_bytes=None), gpus=[]))
        service._orchestration_adapters = {}
        profile = {"id": "a" * 32, "model_id": "model-a", "runtime_id": "fixture-runtime",
                   "placement": {}, "load": {}, "name": "Quality profile"}
        service.profile_store = SimpleNamespace(list_profiles=lambda model_id: [profile] if model_id == "model-a" else [])
        request = {"inputs": {"prompt": {"kind": "text", "text": "hello"}},
                   "parameters": {}, "selection": {"mode": "auto"}}
        plan = service._build_orchestration_plan(
            skill=service.skill_registry.get("chat.general"), request=request)["plan"]
        self.assertEqual(plan["skill"]["id"], "chat.general")
        self.assertEqual(plan["nodes"][0]["selected"]["model_id"], "model-a")
        self.assertEqual(calls, ["can_load"])
        calls.clear()
        pinned = service._build_orchestration_plan(
            skill=service.skill_registry.get("chat.general"), request={
                **request, "selection": {"mode": "manual", "pinned_model_id": "model-a",
                                         "pinned_profile_id": profile["id"]},
            })["plan"]
        self.assertEqual(pinned["nodes"][0]["selected"]["profile_id"], profile["id"])
        self.assertEqual(calls, ["can_load"])

    def test_default_document_extract_skill_executes_from_a_session_artifact(self):
        service = ReadOnlyAPI(
            hardware=SimpleNamespace(detect=lambda: {}),
            catalog=SimpleNamespace(list_models=lambda: []),
            runtimes=SimpleNamespace(list_backends=lambda: []),
        )
        artifact_api = service.get_artifact_api()
        envelope = artifact_api.create(
            b"A small document with useful facts.", kind="document", media_type="text/plain",
            name="notes.txt", owner_type="session", owner_id="test-session", lifetime="session",
        )
        run = service.start_skill("document.extract-text", {"inputs": {"document": envelope}})["data"]["run"]
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            run = service.run_manager.get(run["id"])
            if run["state"] in {"succeeded", "failed", "cancelled"}:
                break
            time.sleep(0.01)
        self.assertEqual(run["state"], "succeeded", run.get("error"))
        self.assertEqual(run["outputs"][0]["text"], "A small document with useful facts.")
        events = service.run_manager.events(run["id"])
        node_events = [(item["type"], item["data"]) for item in events if item["type"].startswith("node.")]
        self.assertEqual([
            ("node.started", {"node_id": "extract"}),
            ("node.completed", {"node_id": "extract"}),
            ("node.started", {"node_id": "result"}),
            ("node.completed", {"node_id": "result"}),
        ], node_events)
        self.assertNotIn("useful facts", repr(node_events))
        service.close()

    def test_default_api_executes_a_typed_tool_only_subskill(self):
        parent = {
            "schema_version": 1, "id": "document.extract-wrapper", "name": "Extract wrapper",
            "version": "1.0.0", "description": "A local tool-only sub-skill composition.",
            "inputs": [{"name": "document", "artifact": "document", "required": True}],
            "outputs": [{"name": "text", "artifact": "text", "required": True}],
            "requirements": {"capabilities": []},
            "policy": {"max_steps": 1},
            "graph": [
                {"id": "extract-child", "type": "skill", "skill_id": "document.extract-text",
                 "skill_version": "1.0.0", "in": {"document": "$input.document"},
                 "accepts": {"document": "document"}, "out": {"text": "text"}},
                {"id": "result", "type": "output", "in": {"text": "$extract-child.text"}},
            ],
        }
        service = ReadOnlyAPI(
            hardware=SimpleNamespace(detect=lambda: {}),
            catalog=SimpleNamespace(list_models=lambda: []),
            runtimes=SimpleNamespace(list_backends=lambda: []),
            skill_registry=SkillRegistry([*builtin_skill_manifests(), parent]),
        )
        try:
            artifact = service.get_artifact_api().create(
                b"Bounded sub-skill test input.", kind="document", media_type="text/plain",
                name="subskill.txt", owner_type="session", owner_id="subskill-test", lifetime="session",
            )
            run = service.start_skill(
                "document.extract-wrapper", {"inputs": {"document": artifact}},
            )["data"]["run"]
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                run = service.run_manager.get(run["id"])
                if run["state"] in {"succeeded", "failed", "cancelled"}:
                    break
                time.sleep(0.01)
            self.assertEqual("succeeded", run["state"], run.get("error"))
            self.assertEqual("Bounded sub-skill test input.", run["outputs"][0]["text"])
            events = [item for item in service.run_manager.events(run["id"])
                      if item["type"].startswith("node.")]
            self.assertEqual([
                ("node.started", {"node_id": "extract-child"}),
                ("node.started", {"node_id": "extract-child/extract"}),
                ("node.completed", {"node_id": "extract-child/extract"}),
                ("node.started", {"node_id": "extract-child/result"}),
                ("node.completed", {"node_id": "extract-child/result"}),
                ("node.completed", {"node_id": "extract-child"}),
                ("node.started", {"node_id": "result"}),
                ("node.completed", {"node_id": "result"}),
            ], [(item["type"], item["data"]) for item in events])
        finally:
            service.close()

    def test_three_skills_run_through_the_default_api_with_a_fake_runtime(self):
        class Model:
            id = "a" * 32
            path = "/fixture/model.gguf"
            metadata = {"general.name": "Fixture model"}

        class Backend:
            name = "fixture-runtime"
            runtime_id = "fixture-runtime"

            def capabilities(self):
                return SimpleNamespace(available=True, chat_completions=True, details="fake runtime")

            def can_load(self, _model): return True
            def load(self, _model, _placement=None, _options=None): pass
            def generate(self, prompt, _options=None): return "fixture response"
            def unload(self): pass

        from aidream.conversation import ChatStore
        chat_temp = tempfile.TemporaryDirectory()
        self.addCleanup(chat_temp.cleanup)
        store = ChatStore(chat_temp.name)
        service = ReadOnlyAPI(
            hardware=SimpleNamespace(detect=lambda: SimpleNamespace(
                ram=SimpleNamespace(total_bytes=None, available_bytes=None), gpus=[])),
            catalog=SimpleNamespace(list_models=lambda: [Model()]),
            runtimes=SimpleNamespace(list_backends=lambda: [Backend()]),
            chat_store=store,
        )

        def await_run(run_id):
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                run = service.run_manager.get(run_id)
                if run["state"] in {"succeeded", "failed", "cancelled"}:
                    return run
                time.sleep(0.005)
            self.fail("run did not finish")

        try:
            session = store.create("Orchestrated chat")
            chat = service.start_skill("chat.general", {
                "inputs": {"prompt": {"kind": "text", "text": "hello"}},
                "chat_id": session["id"],
                "selection": {"mode": "manual", "pinned_model_id": Model.id},
            })["data"]["run"]
            chat_result = await_run(chat["id"])
            self.assertEqual(chat_result["state"], "succeeded", chat_result.get("error"))
            self.assertEqual(chat_result["outputs"][0]["text"], "fixture response")
            transcript = service.get_chat(session["id"])["data"]["chat"]["messages"]
            self.assertEqual([message["role"] for message in transcript], ["user", "assistant"])
            self.assertEqual(transcript[-1]["run_id"], chat["id"])

            api = service.get_artifact_api()
            document = api.create(
                b"A short fixture document.", kind="document", media_type="text/plain",
                name="fixture.txt", owner_type="session", owner_id="normal-path-test", lifetime="session")
            extract = service.start_skill("document.extract-text", {
                "inputs": {"document": document},
            })["data"]["run"]
            summarize = service.start_skill("document.summarize", {
                "inputs": {"document": document},
            })["data"]["run"]
            extract_result = await_run(extract["id"])
            summarize_result = await_run(summarize["id"])
            self.assertEqual(extract_result["state"], "succeeded", extract_result.get("error"))
            self.assertEqual(extract_result["outputs"][0]["text"], "A short fixture document.")
            self.assertEqual(summarize_result["state"], "succeeded", summarize_result.get("error"))
            self.assertEqual(summarize_result["outputs"][0]["text"], "fixture response")
        finally:
            service.close()

    def test_run_outputs_share_owner_scoped_artifact_store_with_api(self):
        import threading
        from aidream.artifacts import ArtifactAPI, ArtifactStore
        from aidream.run_manager import RunManager

        store = ArtifactStore(max_artifact_bytes=1024)
        manager = RunManager(executor=lambda **_kwargs: [{
            "kind": "image", "media_type": "image/png", "name": "generated.png",
            "content_bytes": b"png-bytes", "metadata": {"source": "fixture"},
        }])
        service = api([manifest("chat.general", "text.chat")], [])
        service.run_planner = lambda **_kwargs: {"plan": {"nodes": []}}
        service.run_manager = manager
        service.artifact_api = ArtifactAPI(store)
        service._artifact_lock = threading.Lock()
        service._artifact_io_lock = threading.Lock()
        service._run_artifact_lock = threading.Lock()
        service._run_artifact_store_attached = False
        try:
            started = service.start_skill("chat.general", {
                "inputs": {"prompt": {"kind": "text", "text": "hello"}},
            })["data"]["run"]
            run_id = started["id"]
            deadline = time.monotonic() + 2
            while manager.get(run_id)["state"] not in {"succeeded", "failed", "cancelled"}:
                if time.monotonic() > deadline:
                    self.fail("run did not finish")
                time.sleep(0.005)
            run = manager.get(run_id)
            self.assertEqual(run["state"], "succeeded")
            envelope = run["outputs"][0]["artifact"]
            self.assertEqual(envelope["owner"], {"type": "run", "id": run_id})
            self.assertEqual(service.get_artifact_api().content(
                envelope["id"], owner_type="run", owner_id=run_id)[1], b"png-bytes")
            self.assertFalse(any(item["type"] == "run.completed" and b"png-bytes" in repr(item).encode()
                                 for item in manager.events(run_id)))
        finally:
            manager.close()
            store.close()


if __name__ == "__main__":
    unittest.main()
