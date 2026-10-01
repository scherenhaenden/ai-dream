from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import http.client
import json
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from aidream.conversation import ChatStore
from aidream.diagnostics import DiagnosticsLog
from aidream.http_api import APIConflict, APIUnavailable, APINotFound, MAX_MODELS, MAX_REQUEST_BYTES, ReadOnlyAPI, create_server
from aidream.runtime import LlamaCppBackend


@dataclass
class Capabilities:
    available: bool
    executable: str | None = None
    details: str = "test"
    device_selection: bool = False


class FakeBackend:
    name = "fixture"
    def capabilities(self):
        return Capabilities(True, "/usr/bin/fake")


class FakeRuntime:
    def list_backends(self):
        return [FakeBackend()]


class FakeHardware:
    def detect(self):
        return {"cpu": {"name": "test"}, "gpus": []}


class FakeCatalog:
    def __init__(self, models=None):
        self.models = models if models is not None else [{"id": "model-1", "path": "/models/a.gguf"}]
    def list_models(self):
        return self.models
    def add_source(self, path):
        return str(path)


class FakeHub:
    def validate_repo_id(self, repo_id):
        if repo_id != "owner/model":
            raise ValueError("bad repo")
        return repo_id
    def validate_file(self, file_name):
        if file_name != "model.Q4_K_M.gguf":
            raise ValueError("bad file")
        return file_name
    def search(self, query, limit):
        return [SimpleNamespace(repo_id="owner/model", downloads=12, likes=3)]
    def list_gguf_files(self, repo_id, revision):
        return ["model.Q4_K_M.gguf"]
    def repository_details(self, repo_id):
        return SimpleNamespace(repo_id=repo_id, downloads=12)
    def download(self, repo_id, file_name, destination, progress=None, revision="main", cancel_event=None):
        if progress:
            progress(8, 16)
            progress(16, 16)
        return Path(destination) / file_name


class FakeChatBackend(FakeBackend):
    def __init__(self):
        self.loaded = 0
        self.unloaded = 0
        self.history = []
        self.cancelled = threading.Event()
        self.started = threading.Event()
    def can_load(self, model):
        return model.id in {"safe-model", "alt-model"}
    def load(self, model, placement=None, options=None):
        self.loaded += 1
    def restore_history(self, history):
        self.history = history
    def generate_stream(self, prompt, options=None, on_delta=None, cancel_event=None):
        if prompt == "slow":
            self.started.set()
            while not cancel_event.is_set():
                time.sleep(0.01)
            raise RuntimeError("cancelled")
        for delta in ("Hello", " there"):
            if cancel_event.is_set():
                raise RuntimeError("cancelled")
            on_delta(delta)
        return "Hello there"
    def cancel_generation(self):
        self.cancelled.set()
    def unload(self):
        self.unloaded += 1


class FakeAgentBackend(FakeChatBackend):
    def __init__(self):
        super().__init__()
        self.agent_turn = 0
    def chat_with_tools(self, messages, tools, timeout):
        self.agent_turn += 1
        if self.agent_turn == 1:
            return {"role": "assistant", "content": "", "tool_calls": [{
                "id": "call-1", "type": "function",
                "function": {"name": "hardware_status", "arguments": "{}"}}]}
        return {"role": "assistant", "content": "This machine has test hardware."}


class FakeModelCatalog:
    def __init__(self, models=None):
        self.models = models or [SimpleNamespace(id="safe-model", path="/private/models/model.gguf")]
    def list_models(self):
        return self.models


FAKE_LLAMA_SERVER = r'''#!/usr/bin/env python3
import http.server, json, sys
if '--help' in sys.argv:
    print('llama-server chat completions')
    raise SystemExit(0)
port = int(sys.argv[sys.argv.index('--port') + 1])
model = sys.argv[sys.argv.index('-m') + 1]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with open(model + '.requests', 'a') as stream: stream.write(json.dumps(payload) + '\n')
        answer = json.dumps({'choices':[{'delta':{'content':'answer'}}]})
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
        self.wfile.write(('data: ' + answer + '\n\n').encode()); self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
    def log_message(self, *args): pass
http.server.HTTPServer(('127.0.0.1', port), Handler).serve_forever()
'''


class HTTPAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.diagnostics = DiagnosticsLog(Path(self.temp.name) / "diagnostics.jsonl")
        self.server = create_server(0, api=ReadOnlyAPI(
            hardware=FakeHardware(), catalog=FakeCatalog(), runtimes=FakeRuntime(),
            diagnostics_log=self.diagnostics))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, method="GET", headers=None, data=None):
        request = Request(self.base + path, method=method, headers=headers or {}, data=data)
        return urlopen(request, timeout=2)

    def set_chat_services(self, chat_store, backend=None):
        backend = backend or FakeChatBackend()
        api = ReadOnlyAPI(hardware=FakeHardware(), catalog=FakeModelCatalog(),
                          runtimes=FakeRuntime(), chat_store=chat_store,
                          diagnostics_log=self.diagnostics)
        api.runtimes = SimpleNamespace(list_backends=lambda: [backend])
        self.server.services = api
        return backend

    def post_json(self, path, value, *, origin="http://127.0.0.1:5173"):
        return self.request(path, method="POST", headers={
            "Origin": origin, "Content-Type": "application/json"},
            data=json.dumps(value).encode("utf-8"))

    def patch_json(self, path, value, *, origin="http://127.0.0.1:5173"):
        return self.request(path, method="PATCH", headers={
            "Origin": origin, "Content-Type": "application/json"},
            data=json.dumps(value).encode("utf-8"))

    def delete_chat_request(self, path, *, origin="http://127.0.0.1:5173"):
        return self.request(path, method="DELETE", headers={"Origin": origin})

    def test_binds_ipv4_loopback_and_exposes_fixed_json_endpoints(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        expected = {
            "/api/health": {"data": {"status": "ok", "service": "ai-dream"}},
            "/api/hardware": {"data": {"hardware": {"cpu": {"name": "test"}, "gpus": []}}},
            "/api/models": {"data": {"models": [{"id": "model-1", "path": "/models/a.gguf"}]}},
        }
        for path, payload in expected.items():
            with self.subTest(path=path):
                with self.request(path) as response:
                    self.assertEqual(response.headers.get_content_type(), "application/json")
                    self.assertEqual(json.loads(response.read()), payload)
        with self.request("/api/runtime") as response:
            runtime = json.loads(response.read())
        self.assertTrue(runtime["data"]["backends"][0]["available"])
        self.assertEqual(runtime["data"]["backends"][0]["name"], "fixture")

    def test_manifest_verify_endpoint_fails_closed_without_a_local_verifier(self):
        path = "/api/model-manifests/local.aaaaaaaaaaaaaaaaaaaaaaaa/verify"
        with self.assertRaises(HTTPError) as error:
            self.post_json(path, {})
        self.assertEqual(error.exception.code, 503)
        self.assertIn("No local runtime manifest verifier is configured",
                      error.exception.read().decode("utf-8"))

        with self.assertRaises(HTTPError) as invalid:
            self.post_json(path, {"success": True})
        self.assertEqual(invalid.exception.code, 400)
        invalid.exception.read()

    def test_logs_snapshot_accepts_bounded_limit_query(self):
        with self.request("/api/logs?limit=50") as response:
            payload = json.loads(response.read())
        self.assertEqual(payload["data"], {
            "lines": [], "source": None, "supported": False,
            "loaded": False, "limit": 50,
        })

    def test_hub_search_file_listing_and_download_sse_use_managed_directory(self):
        with TemporaryDirectory() as temp:
            api = ReadOnlyAPI(hardware=FakeHardware(), catalog=FakeCatalog(),
                              runtimes=FakeRuntime(), hub=FakeHub(), download_dir=Path(temp) / "models")
            self.server.services = api
            with self.request("/api/hub/search?q=small&limit=5") as response:
                result = json.loads(response.read())
            self.assertEqual(result["data"]["items"][0]["repo_id"], "owner/model")
            with self.request("/api/hub/repos/owner%2Fmodel/files?revision=main") as response:
                result = json.loads(response.read())
            self.assertEqual(result["data"]["repo_id"], "owner/model")
            self.assertEqual(result["data"]["files"], [{"file_name": "model.Q4_K_M.gguf"}])
            with self.post_json("/api/downloads", {"repo_id": "owner/model", "file_name": "model.Q4_K_M.gguf"}) as response:
                self.assertEqual(response.status, 202)
                created = json.loads(response.read())["data"]
            self.assertIn(created["state"], {"queued", "downloading", "complete"})
            with self.request(f"/api/downloads/{created['id']}/events") as response:
                stream = response.read().decode()
            self.assertIn('"state":"complete"', stream)
            self.assertIn('"downloaded_bytes":16', stream)
            self.assertTrue((Path(temp) / "models").is_dir())

    def test_hub_routes_reject_repository_traversal_and_bad_download_body(self):
        with self.assertRaises(HTTPError) as caught:
            self.request("/api/hub/repos/owner%2F..%2Fsecret/files")
        self.assertEqual(caught.exception.code, 400)
        caught.exception.read()
        caught.exception.close()
        with self.assertRaises(HTTPError) as caught:
            self.post_json("/api/downloads", {"repo_id": "owner/model", "file_name": "../bad.gguf"})
        self.assertEqual(caught.exception.code, 400)
        caught.exception.read()
        caught.exception.close()

    def test_run_skill_api_sse_status_and_cancel_routes(self):
        from aidream.run_manager import RunManager

        manager = RunManager(executor=lambda **kwargs: [{"kind": "text", "text": "done"}])
        self.addCleanup(manager.close)
        api = self.server.services
        api.run_manager = manager
        api.run_planner = lambda **kwargs: {"plan": {"id": "plan-test", "nodes": []}}
        with self.post_json("/api/skills/chat.general/run", {
            "inputs": {"prompt": {"kind": "text", "text": "hello"}},
            "parameters": {}, "selection": {"mode": "auto"},
        }) as response:
            self.assertEqual(response.status, 202)
            run = json.loads(response.read())["data"]["run"]
        run_id = run["id"]
        with self.request(f"/api/runs/{run_id}") as response:
            details = json.loads(response.read())["data"]["run"]
        self.assertIn(details["state"], {"queued", "running", "succeeded"})
        with self.request(f"/api/runs/{run_id}/events?after=0") as response:
            stream = response.read().decode()
        self.assertIn("event: plan.resolved", stream)
        self.assertIn("event: run.succeeded", stream)
        with self.request("/api/runs", method="OPTIONS",
                          headers={"Origin": "http://127.0.0.1:5173"}) as response:
            self.assertEqual(response.status, 204)
        with self.post_json(f"/api/runs/{run_id}/cancel", {}) as response:
            self.assertEqual(response.status, 200)

    def test_run_event_stream_reports_when_bounded_history_has_a_gap(self):
        from aidream.run_manager import RunManager

        def execute(*, emit, **kwargs):
            for index in range(10):
                emit("node.progress", {"index": index})
            return [{"kind": "text", "text": "complete"}]

        manager = RunManager(executor=execute, max_events_per_run=4)
        self.addCleanup(manager.close)
        self.server.services.run_manager = manager
        self.server.services.run_planner = lambda **kwargs: {"plan": {"id": "plan-gap", "nodes": []}}
        with self.post_json("/api/skills/chat.general/run", {
            "inputs": {"prompt": {"kind": "text", "text": "hello"}},
            "parameters": {}, "selection": {"mode": "auto"},
        }) as response:
            run = json.loads(response.read())["data"]["run"]
        with self.request(f"/api/runs/{run['id']}/events?after=0") as response:
            stream = response.read().decode()
        self.assertIn("event: run.replay_gap", stream)
        self.assertIn('"missing_from":1', stream)
        self.assertIn("event: run.succeeded", stream)

    def test_run_requires_the_exact_plan_id_after_explicit_review(self):
        from aidream.run_manager import RunManager

        manager = RunManager(executor=lambda **kwargs: [])
        self.addCleanup(manager.close)
        self.server.services.run_manager = manager
        expected = "a" * 24
        self.server.services.run_planner = lambda **kwargs: {"plan": {"plan_id": expected, "nodes": []}}
        request_body = {
            "inputs": {"prompt": {"kind": "text", "text": "hello"}},
            "parameters": {}, "selection": {"mode": "guided"},
            "expected_plan_id": "b" * 24,
        }
        with self.assertRaises(HTTPError) as caught:
            self.post_json("/api/skills/chat.general/run", request_body)
        self.assertEqual(caught.exception.code, 409)
        caught.exception.read()
        caught.exception.close()
        self.assertEqual(manager.list_runs(), [])

        request_body["expected_plan_id"] = expected
        with self.post_json("/api/skills/chat.general/run", request_body) as response:
            self.assertEqual(response.status, 202)
        self.assertEqual(len(manager.list_runs()), 1)

        with self.assertRaises(HTTPError) as caught:
            self.post_json("/api/skills/chat.general/plan", request_body)
        self.assertEqual(caught.exception.code, 400)
        caught.exception.read()
        caught.exception.close()

    def test_artifact_upload_list_content_owner_scope_and_delete(self):
        with self.request("/api/artifacts", method="OPTIONS",
                          headers={"Origin": "http://127.0.0.1:5173"}) as response:
            self.assertEqual(response.status, 204)
            self.assertIn("X-AI-Dream-Artifact-Kind",
                          response.headers.get("Access-Control-Allow-Headers", ""))
        headers = {
            "Origin": "http://127.0.0.1:5173",
            "Content-Type": "image/png",
            "X-AI-Dream-Artifact-Kind": "image",
            "X-AI-Dream-Artifact-Name": "tiny.png",
            "X-AI-Dream-Artifact-Owner-Type": "session",
            "X-AI-Dream-Artifact-Owner-ID": "web-session-123",
            "X-AI-Dream-Artifact-Lifetime": "session",
        }
        payload = b"\x89PNG\r\n\x1a\nfixture"
        with self.request("/api/artifacts", method="POST", headers=headers, data=payload) as response:
            self.assertEqual(response.status, 201)
            artifact = json.loads(response.read())["data"]["artifact"]
        artifact_id = artifact["id"]
        self.assertNotIn("/tmp", json.dumps(artifact))
        owner_query = "owner_type=session&owner_id=web-session-123"
        with self.request(f"/api/artifacts?{owner_query}") as response:
            rows = json.loads(response.read())["data"]["artifacts"]
        self.assertEqual([item["id"] for item in rows], [artifact_id])
        with self.request(f"/api/artifacts/{artifact_id}/metadata?{owner_query}") as response:
            self.assertEqual(json.loads(response.read())["data"]["artifact"]["size_bytes"], len(payload))
        with self.request(f"/api/artifacts/{artifact_id}/content?{owner_query}") as response:
            self.assertEqual(response.read(), payload)
            self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
            self.assertEqual(response.headers.get("Content-Type"), "image/png")
        with self.assertRaises(HTTPError) as caught:
            self.request(f"/api/artifacts/{artifact_id}/metadata?owner_type=session&owner_id=other")
        self.assertEqual(caught.exception.code, 404)
        caught.exception.read()
        caught.exception.close()
        with self.request(f"/api/artifacts/{artifact_id}?{owner_query}", method="DELETE",
                          headers={"Origin": "http://127.0.0.1:5173"}) as response:
            self.assertEqual(json.loads(response.read())["data"]["deleted"], True)

        run_id = "a" * 32
        run_artifact = self.server.services.get_artifact_api().create(
            b"rendered-run-output", kind="image", media_type="image/png", name="output.png",
            owner_type="run", owner_id=run_id, lifetime="session")
        with self.request(f"/api/artifacts/{run_artifact['id']}/content?owner_type=run&owner_id={run_id}") as response:
            self.assertEqual(response.read(), b"rendered-run-output")
        with self.assertRaises(HTTPError) as caught:
            self.request(f"/api/artifacts/{run_artifact['id']}/content?owner_type=run&owner_id={'b' * 32}")
        self.assertEqual(caught.exception.code, 404)
        caught.exception.read()
        caught.exception.close()

    def test_artifact_upload_rejects_oversize_before_reading_body(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=2)
        conn.putrequest("POST", "/api/artifacts")
        conn.putheader("Origin", "http://127.0.0.1:5173")
        conn.putheader("Content-Type", "application/octet-stream")
        conn.putheader("Content-Length", str(32 * 1024 * 1024 + 1))
        conn.putheader("X-AI-Dream-Artifact-Kind", "file_reference")
        conn.putheader("X-AI-Dream-Artifact-Name", "oversize.bin")
        conn.putheader("X-AI-Dream-Artifact-Owner-Type", "session")
        conn.putheader("X-AI-Dream-Artifact-Owner-ID", "web-session-oversize")
        conn.endheaders()
        response = conn.getresponse()
        self.assertEqual(response.status, 413)
        response.read()
        conn.close()

    def test_residency_actions_route_pin_only_allowlisted_existing_residents(self):
        from aidream.model_scheduler import LeaseRequest, ModelScheduler
        from aidream.runtime_adapters import FakeRuntimeAdapter

        api = self.server.services
        adapter = FakeRuntimeAdapter(runtime_id="fixture")
        scheduler = ModelScheduler({"fixture": adapter})
        api._orchestration_scheduler = scheduler
        api._orchestration_route_allowlist = {"route_fixture_chat": ("model-a", "fixture", None)}
        lease = scheduler.acquire(LeaseRequest("model-a", "fixture", {"model_id": "model-a"},
                                               owner_id="run-1", orchestration_owned=True))
        scheduler.release(lease)

        with self.post_json("/api/models/residency/actions", {
            "route_id": "route_fixture_chat", "action": "pin",
        }) as response:
            result = json.loads(response.read())["data"]["residency"]
        self.assertTrue(result["resident"]["pinned"])
        self.assertEqual(adapter.calls.count("load"), 1)
        self.assertEqual(adapter.calls.count("unload"), 0)

        with self.assertRaises(HTTPError) as caught:
            self.post_json("/api/models/residency/actions", {
                "route_id": "model-a", "action": "unload",
            })
        self.assertEqual(caught.exception.code, 404)
        caught.exception.read()
        caught.exception.close()

    def test_capability_preferences_patch_persists_and_updates_scheduler_eviction_policy(self):
        from aidream.model_scheduler import ModelScheduler
        from aidream.capabilities.preferences import CapabilityPreferenceStore

        self.server.services.capability_preference_store = CapabilityPreferenceStore(
            Path(self.temp.name) / "capability-preferences.json")
        scheduler = ModelScheduler({})
        self.server.services._orchestration_scheduler = scheduler
        with self.request("/api/capability-preferences") as response:
            initial = json.loads(response.read())["data"]
        self.assertEqual(initial["selection_defaults"]["eviction_policy"], "lru")
        with self.patch_json("/api/capability-preferences", {
            "selection_defaults": {"eviction_policy": "never"},
        }) as response:
            updated = json.loads(response.read())["data"]
        self.assertEqual(updated["selection_defaults"]["eviction_policy"], "never")
        self.assertEqual(scheduler.eviction_policy, "never")
        with self.request("/api/capability-preferences") as response:
            self.assertEqual(json.loads(response.read())["data"]["selection_defaults"]["eviction_policy"], "never")

    def test_assisted_draft_endpoint_is_explicit_and_off_by_default(self):
        from aidream.capabilities.preferences import CapabilityPreferenceStore

        self.server.services.capability_preference_store = CapabilityPreferenceStore(
            Path(self.temp.name) / "planner-preferences.json")
        with self.assertRaises(HTTPError) as caught:
            self.post_json("/api/skills/chat.general/draft", {"goal": "summarize a local note"})
        self.assertEqual(caught.exception.code, 409)
        self.assertIn("disabled globally", caught.exception.read().decode())
        caught.exception.close()

    def test_assisted_draft_http_rejects_a_different_installed_skill(self):
        from aidream.capabilities.preferences import CapabilityPreferenceStore

        class Backend:
            name = "fake-runtime"
            runtime_id = "fake-runtime"
            _loaded_model = "already-loaded-model"
            def generate(self, _prompt, _options):
                return json.dumps({
                    "skill_id": "document.extract-text",
                    "components": [{"node_id": "parse", "component_id": "document.parse"}],
                })
            def unload(self):
                self._loaded_model = None

        class DraftValidator:
            def __init__(self):
                self.resolve_called = False
            def draft_components(self, _skill_id):
                return [{"node_id": "reply", "component_id": "text.chat"}]
            def resolve_assisted_draft(self, *_args, **_kwargs):
                self.resolve_called = True
                raise AssertionError("cross-skill draft must be rejected before plan resolution")

        service = self.server.services
        service.capability_preference_store = CapabilityPreferenceStore(
            Path(self.temp.name) / "planner-cross-skill-preferences.json")
        service.capability_preference_store.patch({
            "selection_defaults": {"assisted_planner_enabled": True},
        })
        service._active_backend = Backend()
        validator = DraftValidator()
        service.run_planner = lambda **_kwargs: {
            "plan": {"preview": True}, "service": validator,
        }

        with self.assertRaises(HTTPError) as caught:
            self.post_json("/api/skills/chat.general/draft", {"goal": "answer my question"})
        self.assertEqual(caught.exception.code, 400)
        self.assertIn("must match the requested skill", caught.exception.read().decode())
        caught.exception.close()
        self.assertFalse(validator.resolve_called)

    def test_rejects_unknown_routes_query_and_bad_host(self):
        for path in ("/api/unknown", "/api/health?x=1"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                self.request(path)
            self.assertIn(caught.exception.code, (400, 404))
            caught.exception.read()
            caught.exception.close()
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=2)
        conn.putrequest("GET", "/api/health", skip_host=True)
        conn.putheader("Host", "evil.example")
        conn.endheaders()
        response = conn.getresponse()
        self.assertEqual(response.status, 400)
        conn.close()

    def test_cors_allows_only_fixed_vite_dev_origin_and_same_origin(self):
        with self.request("/api/health", headers={"Origin": "http://127.0.0.1:5173"}) as response:
            self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173")
            self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
        with self.request("/api/chat", method="OPTIONS",
                          headers={"Origin": "http://127.0.0.1:5173"}) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers.get("Access-Control-Allow-Methods"), "POST, PATCH, DELETE, OPTIONS")
        with self.assertRaises(HTTPError) as caught:
            self.request("/api/models", method="OPTIONS",
                         headers={"Origin": "http://127.0.0.1:5173"})
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()
        with self.assertRaises(HTTPError) as caught:
            self.request("/api/health", headers={"Origin": "https://attacker.example"})
        self.assertEqual(caught.exception.code, 403)
        caught.exception.read()
        caught.exception.close()

    def test_runtime_actions_allow_browser_preflight(self):
        for path in ("/api/runtime/load", "/api/runtime/unload", "/api/runtime/command", "/api/runtime/chat", "/api/diagnostics", "/api/models/residency/actions"):
            with self.subTest(path=path):
                with self.request(path, method="OPTIONS", headers={
                        "Origin": "http://127.0.0.1:5173",
                        "Access-Control-Request-Method": "POST",
                        "Access-Control-Request-Headers": "content-type"}) as response:
                    self.assertEqual(response.status, 204)
                    self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173")
                    self.assertEqual(response.headers.get("Access-Control-Allow-Headers"), "Content-Type")

    def test_chat_generation_failure_is_persisted_with_root_cause_and_incident_id(self):
        class FailingBackend(FakeChatBackend):
            def generate_stream(self, prompt, options=None, on_delta=None, cancel_event=None):
                raise RuntimeError(f"llama-server generation failed for {prompt}: Vulkan device initialization")

        store = ChatStore(Path(self.temp.name) / "chats")
        self.set_chat_services(store, FailingBackend())
        chat_id = store.create()["id"]
        incident_id = "a" * 32
        prompt = "private prompt text must not be stored"
        with self.post_json("/api/chat", {"chat_id": chat_id, "model_id": "safe-model",
                                           "prompt": prompt, "request_id": incident_id}) as response:
            stream = response.read().decode("utf-8")

        self.assertIn("event: error", stream)
        self.assertIn(incident_id, stream)
        self.assertIn("Local model request failed", stream)
        status, result = self.server.services.get("/api/diagnostics", "limit=100")
        event = result["data"]["events"][0]
        self.assertEqual(status, 200)
        self.assertEqual(event["incident_id"], incident_id)
        self.assertEqual(event["operation"], "chat.generate")
        self.assertEqual(event["error_type"], "RuntimeError")
        self.assertIn("Vulkan device initialization", event["detail"])
        self.assertNotIn(prompt, event["detail"])
        self.assertNotIn(prompt, json.dumps(event))

    def test_chat_contract_reports_missing_fields_and_unexpected_fields_separately(self):
        with self.assertRaises(HTTPError) as missing:
            self.post_json("/api/chat", {"model_id": "safe-model", "prompt": "hello"})
        self.assertEqual(json.loads(missing.exception.read())["error"], "Missing required chat field(s): chat_id")
        missing.exception.close()

        with self.assertRaises(HTTPError) as unexpected:
            self.post_json("/api/chat", {"chat_id": "a" * 32, "model_id": "safe-model",
                                         "prompt": "hello", "surprise": True})
        self.assertEqual(json.loads(unexpected.exception.read())["error"], "Unexpected chat field(s): surprise")
        unexpected.exception.close()

    def test_client_diagnostic_endpoint_accepts_only_bounded_chat_metadata(self):
        event = {"incident_id": "c" * 32, "operation": "chat.client",
                 "error_type": "TypeError", "detail": "Failed to fetch local chat response"}
        with self.post_json("/api/diagnostics", event) as response:
            self.assertEqual(response.status, 201)
            self.assertEqual(json.loads(response.read())["data"]["event"]["incident_id"], "c" * 32)
        with self.assertRaises(HTTPError) as caught:
            self.post_json("/api/diagnostics", {**event, "detail": "x" * 501})
        self.assertEqual(caught.exception.code, 400)
        caught.exception.read()
        caught.exception.close()

    def test_http_mutations_are_rejected_and_body_is_not_consumed(self):
        with self.assertRaises(HTTPError) as caught:
            self.request("/api/models", method="POST", headers={"Origin": "http://127.0.0.1:5173"},
                         data=b'{"path":"/etc/passwd"}')
        caught.exception.read()
        caught.exception.close()
        self.assertEqual(caught.exception.code, 405)
        self.assertIn("GET", caught.exception.headers.get("Allow", ""))

    def test_bounds_catalog_size_and_service_time(self):
        class TooMany:
            def list_models(self):
                return [None] * (MAX_MODELS + 1)
        api = ReadOnlyAPI(hardware=FakeHardware(), catalog=TooMany(), runtimes=FakeRuntime())
        server = create_server(0, api=api)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(f"http://127.0.0.1:{server.server_address[1]}/api/models")
            with self.assertRaises(HTTPError) as caught:
                urlopen(request, timeout=2)
            caught.exception.read()
            caught.exception.close()
            self.assertEqual(caught.exception.code, 413)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


        class SlowHardware:
            def detect(self):
                time.sleep(7)
                return {}
        api = ReadOnlyAPI(hardware=SlowHardware(), catalog=FakeCatalog(), runtimes=FakeRuntime())
        server = create_server(0, api=api)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(f"http://127.0.0.1:{server.server_address[1]}/api/hardware")
            with self.assertRaises(HTTPError) as caught:
                urlopen(request, timeout=7.5)
            caught.exception.read()
            caught.exception.close()
            self.assertEqual(caught.exception.code, 504)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_chat_crud_redacts_attachment_paths_and_settings(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            backend = self.set_chat_services(store)
            with self.post_json("/api/chats", {"title": "Browser chat"}) as response:
                self.assertEqual(response.status, 201)
                created = json.loads(response.read())["data"]["chat"]
            chat_id = created["id"]
            store.replace_session_settings(chat_id, {"model_path": "/private/model.gguf"})
            attachment = {"kind": "image", "path": "/private/photos/secret.png", "name": "secret.png",
                          "size_bytes": 1, "mtime_ns": 0, "sha256": "a" * 64}
            store.append(chat_id, "user", "Describe", [attachment])

            with self.request("/api/chats") as response:
                chats = json.loads(response.read())["data"]["chats"]
            self.assertEqual(chats[0]["id"], chat_id)
            self.assertNotIn("settings", chats[0])

            with self.request(f"/api/chats/{chat_id}") as response:
                transcript = json.loads(response.read())["data"]["chat"]
            self.assertEqual(transcript["messages"][0]["content"], "Describe")
            self.assertEqual(set(transcript["messages"][0]), {"role", "content", "created_at"})
            self.assertNotIn("/private", json.dumps(transcript))
            self.assertNotIn("/private", json.dumps(chats))

            event_body = {"chat_id": chat_id, "model_id": "safe-model", "prompt": "Continue"}
            with self.post_json("/api/chat", event_body) as response:
                self.assertEqual(response.headers.get_content_type(), "text/event-stream")
                stream = response.read().decode("utf-8")
            self.assertIn('event: delta\ndata: {"text":"Hello"}', stream)
            self.assertIn('event: delta\ndata: {"text":" there"}', stream)
            self.assertIn('event: complete\ndata: {"chat_id":', stream)
            self.assertIn('"assistant":"Hello there"', stream)
            self.assertIn('"session_id":"' + chat_id + '"', stream)
            self.assertEqual(backend.history[0]["role"], "user")
            self.assertEqual(backend.history[0]["content"], "Describe")
            self.assertEqual(backend.history[0]["attachments"][0]["path"], "/private/photos/secret.png")
            self.assertEqual(backend.loaded, 1)
            self.assertEqual(backend.unloaded, 0)
            self.assertEqual(self.diagnostics.list(), [])

    def test_chat_rename_delete_and_attachment_files_are_preserved(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            store = ChatStore(root / "chats")
            backend = self.set_chat_services(store)
            chat_id = store.create("Original title")["id"]
            attachment_file = root / "keep-this-image.png"
            attachment_file.write_bytes(b"image bytes")
            import hashlib
            attachment = {"kind": "image", "path": str(attachment_file), "name": attachment_file.name,
                          "size_bytes": attachment_file.stat().st_size,
                          "mtime_ns": attachment_file.stat().st_mtime_ns,
                          "sha256": hashlib.sha256(attachment_file.read_bytes()).hexdigest()}
            store.append(chat_id, "user", "See attached", [attachment])

            with self.patch_json(f"/api/chats/{chat_id}", {"title": "Renamed chat"}) as response:
                self.assertEqual(response.status, 200)
                renamed = json.loads(response.read())["data"]["chat"]
            self.assertEqual(renamed["title"], "Renamed chat")
            self.assertEqual(store.load(chat_id)["messages"][0]["attachments"][0]["path"], str(attachment_file))

            with self.delete_chat_request(f"/api/chats/{chat_id}") as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(json.loads(response.read())["data"]["deleted"])
            self.assertFalse(store._path(chat_id).exists())
            self.assertEqual(attachment_file.read_bytes(), b"image bytes")
            self.assertIsNone(self.server.services._active_binding)

    def test_chat_rename_delete_validate_ids_and_titles(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            self.set_chat_services(store)
            chat_id = store.create()["id"]
            with self.request(f"/api/chats/{chat_id}", method="OPTIONS",
                              headers={"Origin": "http://127.0.0.1:5173"}) as response:
                self.assertEqual(response.status, 204)
                self.assertIn("PATCH", response.headers.get("Access-Control-Allow-Methods", ""))
                self.assertIn("DELETE", response.headers.get("Access-Control-Allow-Methods", ""))
            with self.assertRaises(HTTPError) as caught:
                self.patch_json(f"/api/chats/{chat_id}", {"title": "No origin"}, origin="http://evil.example")
            self.assertEqual(caught.exception.code, 403)
            caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                self.request(f"/api/chats/{chat_id}", method="DELETE", headers={"Host": "evil.example", "Origin": "http://127.0.0.1:5173"})
            self.assertEqual(caught.exception.code, 400)
            caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                self.request(f"/api/chats/{chat_id}", method="DELETE")
            self.assertEqual(caught.exception.code, 403)
            caught.exception.close()
            for title in ("", " " * 3, "x" * 121, None):
                with self.subTest(title=title):
                    with self.assertRaises(HTTPError) as caught:
                        self.patch_json(f"/api/chats/{chat_id}", {"title": title})
                    self.assertEqual(caught.exception.code, 400)
                    caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                self.patch_json("/api/chats/not-a-chat-id", {"title": "Valid"})
            self.assertIn(caught.exception.code, (400, 404, 405))
            caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                self.delete_chat_request("/api/chats/00000000000000000000000000000000")
            self.assertEqual(caught.exception.code, 404)
            caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                self.patch_json(f"/api/chats/{chat_id}", {"title": "Not allowed", "messages": []})
            self.assertEqual(caught.exception.code, 400)
            caught.exception.close()

    def test_chat_mutations_are_rejected_during_active_turn_then_delete_unloads_binding(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            backend = self.set_chat_services(store)
            chat_id = store.create()["id"]
            run = self.server.services.prepare_chat(chat_id, "safe-model", "holding lock")
            for method, path, data in (
                ("PATCH", f"/api/chats/{chat_id}", json.dumps({"title": "blocked"}).encode()),
                ("DELETE", f"/api/chats/{chat_id}", None),
            ):
                with self.subTest(method=method):
                    headers = {"Origin": "http://127.0.0.1:5173"}
                    if data is not None:
                        headers["Content-Type"] = "application/json"
                    with self.assertRaises(HTTPError) as caught:
                        self.request(path, method=method, headers=headers, data=data)
                    self.assertEqual(caught.exception.code, 409)
                    caught.exception.close()
            self.assertTrue(store._path(chat_id).exists())
            run.close()
            with self.delete_chat_request(f"/api/chats/{chat_id}") as response:
                self.assertEqual(response.status, 200)
            self.assertEqual(backend.unloaded, 1)
            self.assertIsNone(self.server.services._active_binding)

    def test_chat_model_id_is_catalog_only_and_browser_write_origin_is_required(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            backend = self.set_chat_services(store)
            chat_id = store.create()["id"]
            with self.assertRaises(HTTPError) as caught:
                self.request("/api/chats", method="POST", headers={"Content-Type": "application/json"},
                             data=b"{}")
            self.assertEqual(caught.exception.code, 403)
            caught.exception.close()

            with self.post_json("/api/chat", {"chat_id": chat_id, "model_id": "/etc/passwd", "prompt": "Hi"}) as response:
                stream = response.read().decode("utf-8")
            self.assertIn("event: error\ndata: ", stream)
            payload = json.loads(stream.split("data: ", 1)[1].strip())
            self.assertEqual(payload["error"], "Model id was not found in the local catalog")
            self.assertRegex(payload["incident_id"], r"^[a-f0-9]{32}$")
            self.assertEqual(backend.loaded, 0)

    def test_agent_endpoint_runs_fixed_read_only_tools_and_persists_chat(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            backend = FakeAgentBackend()
            api = ReadOnlyAPI(hardware=FakeHardware(), catalog=FakeModelCatalog(),
                              runtimes=FakeRuntime(), chat_store=store)
            api.runtimes = SimpleNamespace(list_backends=lambda: [backend])
            self.server.services = api
            chat_id = store.create()["id"]
            with self.post_json("/api/agent", {"chat_id": chat_id, "model_id": "safe-model",
                                                 "prompt": "What hardware is here?"}) as response:
                self.assertEqual(response.headers.get_content_type(), "text/event-stream")
                stream = response.read().decode("utf-8")
            self.assertIn('event: status\ndata:', stream)
            self.assertIn('event: complete\ndata:', stream)
            self.assertIn('"assistant":"This machine has test hardware."', stream)
            self.assertIn('"name":"hardware.status"', stream)
            self.assertIn('"stop_reason":"completed"', stream)
            saved = store.load(chat_id)["messages"]
            self.assertEqual([message["role"] for message in saved], ["user", "assistant", "system"])
            public = ReadOnlyAPI.public_transcript(store.load(chat_id))
            self.assertEqual(len(public["messages"]), 2)
            self.assertEqual(public["agent_audits"][-1]["tools"][0]["name"], "hardware.status")
            self.assertNotIn("AI_DREAM_AGENT_AUDIT", json.dumps(public))
            self.assertEqual(backend.loaded, 1)

    def test_agent_rejects_model_path_and_cors_preflight_is_explicit(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            backend = FakeAgentBackend()
            api = ReadOnlyAPI(hardware=FakeHardware(), catalog=FakeModelCatalog(),
                              runtimes=FakeRuntime(), chat_store=store)
            api.runtimes = SimpleNamespace(list_backends=lambda: [backend])
            self.server.services = api
            chat_id = store.create()["id"]
            with self.post_json("/api/agent", {"chat_id": chat_id, "model_id": "/etc/passwd",
                                                 "prompt": "inspect"}) as response:
                stream = response.read().decode("utf-8")
            self.assertIn("Model id was not found in the local catalog", stream)
            self.assertEqual(backend.loaded, 0)
            with self.request("/api/agent", method="OPTIONS", headers={
                    "Origin": "http://127.0.0.1:5173"}) as response:
                self.assertEqual(response.status, 204)
            invalid = Request(self.base + "/api/agent", method="POST", headers={
                "Origin": "http://127.0.0.1:5173", "Content-Type": "application/json"},
                data=json.dumps({"chat_id": chat_id, "model_id": "safe-model"}).encode())
            with self.assertRaises(HTTPError) as caught:
                urlopen(invalid, timeout=2)
            self.assertEqual(caught.exception.code, 400)
            caught.exception.close()

    def test_chat_body_is_bounded_and_invalid_ids_never_read_paths(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            self.set_chat_services(store)
            payload = b" " * (MAX_REQUEST_BYTES + 1)
            request = Request(self.base + "/api/chats", method="POST",
                              headers={"Origin": "http://127.0.0.1:5173",
                                       "Content-Type": "application/json"}, data=payload)
            with self.assertRaises(HTTPError) as caught:
                urlopen(request, timeout=2)
            self.assertEqual(caught.exception.code, 413)
            caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                self.request("/api/chats/../../etc/passwd")
            self.assertIn(caught.exception.code, (400, 404))
            caught.exception.close()

    def test_chat_runtime_is_reused_and_reloaded_only_for_binding_change(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            backend = FakeChatBackend()
            api = ReadOnlyAPI(hardware=FakeHardware(),
                              catalog=FakeModelCatalog([
                                  SimpleNamespace(id="safe-model", path="/private/a.gguf"),
                                  SimpleNamespace(id="alt-model", path="/private/b.gguf")]),
                              runtimes=FakeRuntime(), chat_store=store)
            api.runtimes = SimpleNamespace(list_backends=lambda: [backend])
            first = store.create()["id"]
            second = store.create()["id"]
            for prompt in ("first", "second"):
                run = api.prepare_chat(first, "safe-model", prompt)
                run.generate(lambda _delta: None, threading.Event())
                run.close()
            self.assertEqual(backend.loaded, 1)
            run = api.prepare_chat(second, "safe-model", "other chat")
            run.generate(lambda _delta: None, threading.Event())
            run.close()
            self.assertEqual(backend.loaded, 2)
            self.assertEqual(backend.unloaded, 1)
            run = api.prepare_chat(second, "alt-model", "other model")
            run.generate(lambda _delta: None, threading.Event())
            run.close()
            self.assertEqual(backend.loaded, 3)
            self.assertEqual(backend.unloaded, 2)
            api.close()
            self.assertEqual(backend.unloaded, 3)

    def test_chat_rehydrates_verified_local_attachment_refs_but_never_returns_paths(self):
        from aidream.conversation import make_attachment_reference
        with TemporaryDirectory() as temp:
            root = Path(temp)
            chats = ChatStore(root / "chats")
            model_path = root / "model.gguf"
            model_path.write_bytes(b"fixture")
            executable = root / "llama-server"
            executable.write_text(FAKE_LLAMA_SERVER)
            executable.chmod(0o755)
            valid_image = root / "photo.png"
            valid_image.write_bytes(b"\x89PNG\r\n\x1a\nimage")
            stale_document = root / "stale.md"
            stale_document.write_text("stale private words", encoding="utf-8")
            refs = [make_attachment_reference("image", valid_image),
                    make_attachment_reference("document", stale_document)]
            stale_document.write_text("changed after save", encoding="utf-8")
            session = chats.create()
            chats.append(session["id"], "user", "Saved turn", refs)
            backend = LlamaCppBackend(str(executable), startup_timeout=3, port=0)
            api = ReadOnlyAPI(hardware=FakeHardware(),
                              catalog=FakeModelCatalog([SimpleNamespace(id="safe-model", path=str(model_path))]),
                              runtimes=SimpleNamespace(list_backends=lambda: [backend]), chat_store=chats)
            run = api.prepare_chat(session["id"], "safe-model", "Continue")
            answer = run.generate(lambda _delta: None, threading.Event())
            run.close()
            self.assertEqual(answer["assistant"], "answer")
            request_payload = json.loads(Path(str(model_path) + ".requests").read_text().splitlines()[0])
            historical = request_payload["messages"][0]
            self.assertEqual(historical["content"][0], {"type": "text", "text": "Saved turn"})
            self.assertTrue(historical["content"][1]["image_url"]["url"].startswith("data:image/png;"))
            self.assertNotIn("changed after save", json.dumps(historical))
            transcript = api.get_chat(session["id"])
            self.assertNotIn(str(valid_image), json.dumps(transcript))
            self.assertNotIn(str(stale_document), json.dumps(transcript))
            api.close()

    def test_chat_sse_cancels_generation_when_client_disconnects(self):
        with TemporaryDirectory() as temp:
            store = ChatStore(Path(temp) / "chats")
            backend = self.set_chat_services(store)
            chat_id = store.create()["id"]
            connection = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=2)
            body = json.dumps({"chat_id": chat_id, "model_id": "safe-model", "prompt": "slow"})
            connection.request("POST", "/api/chat", body=body,
                               headers={"Host": f"127.0.0.1:{self.server.server_address[1]}",
                                        "Origin": "http://127.0.0.1:5173",
                                        "Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertTrue(backend.started.wait(2), f"model did not start; load count {backend.loaded}")
            response.close()
            connection.close()
            self.assertTrue(backend.cancelled.wait(3), f"cancel_generation was not called; loaded={backend.loaded}")
            self.assertEqual(store.load(chat_id)["messages"], [])

    def test_response_payload_limit(self):
        class LargeHardware:
            def detect(self):
                return {"data": "x" * (4 * 1024 * 1024 + 1)}
        api = ReadOnlyAPI(hardware=LargeHardware(), catalog=FakeCatalog(), runtimes=FakeRuntime())
        server = create_server(0, api=api)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(f"http://127.0.0.1:{server.server_address[1]}/api/hardware")
            with self.assertRaises(HTTPError) as caught:
                urlopen(request, timeout=3)
            caught.exception.read()
            caught.exception.close()
            self.assertEqual(caught.exception.code, 413)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class ResourceSnapshotAPIRouteTest(unittest.TestCase):
    def test_resource_routes_use_default_service_or_injected_service(self):
        api = ReadOnlyAPI(hardware=FakeHardware(), catalog=FakeCatalog(), runtimes=FakeRuntime())
        status, resources = api.get("/api/resources")
        self.assertEqual(status, 200)
        self.assertIn(resources["data"]["status"], {"partial", "unknown"})
        status, residency = api.get("/api/models/residency")
        self.assertEqual(status, 200)
        self.assertEqual(residency["data"]["residency"]["items"], [])

        class SnapshotService:
            def resources(self):
                return {"resources": {"ram": {"total_bytes": None, "total_status": "unknown"}},
                        "status": "unknown"}

            def residency(self):
                return {"items": [], "count": 0, "active_lease_count": 0, "status": "observed"}

        api.resource_snapshot_service = SnapshotService()
        status, resources = api.get("/api/resources")
        self.assertEqual(status, 200)
        self.assertEqual(resources["data"]["status"], "unknown")
        self.assertIsNone(resources["data"]["resources"]["ram"]["total_bytes"])
        status, residency = api.get("/api/models/residency")
        self.assertEqual(status, 200)
        self.assertEqual(residency["data"]["residency"]["items"], [])
        self.assertEqual(residency["data"]["residency"]["active_lease_count"], 0)
        with self.assertRaises(ValueError):
            api.get("/api/resources", "bad=1")
        api.close()

    def test_residency_control_api_uses_only_server_allowlisted_existing_resident(self):
        from aidream.model_scheduler import LeaseRequest, ModelScheduler
        from aidream.runtime_adapters import FakeRuntimeAdapter

        api = ReadOnlyAPI(hardware=FakeHardware(), catalog=FakeCatalog(), runtimes=FakeRuntime())
        adapter = FakeRuntimeAdapter(runtime_id="fixture")
        scheduler = ModelScheduler({"fixture": adapter})
        api._orchestration_scheduler = scheduler
        route_id = "route_fixture_chat"
        api._orchestration_route_allowlist = {route_id: ("model-a", "fixture", None)}
        lease = scheduler.acquire(LeaseRequest("model-a", "fixture", {"model_id": "model-a"},
                                               owner_id="run-1", orchestration_owned=True))
        scheduler.release(lease)

        result = api.apply_residency_action(route_id, "pin")
        self.assertTrue(result["data"]["residency"]["resident"]["pinned"])
        self.assertEqual(adapter.calls.count("load"), 1)
        self.assertEqual(adapter.calls.count("unload"), 0)
        with self.assertRaises(APINotFound):
            api.apply_residency_action("caller-supplied-model-id", "unload")
        api.close()

    def test_residency_unload_conflicts_with_an_active_direct_chat_turn(self):
        from aidream.model_scheduler import LeaseRequest, ModelScheduler
        from aidream.runtime_adapters import FakeRuntimeAdapter

        api = ReadOnlyAPI(hardware=FakeHardware(), catalog=FakeCatalog(), runtimes=FakeRuntime())
        adapter = FakeRuntimeAdapter(runtime_id="fixture")
        scheduler = ModelScheduler({"fixture": adapter})
        api._orchestration_scheduler = scheduler
        api._orchestration_route_allowlist = {"route_fixture_chat": ("model-a", "fixture", None)}
        lease = scheduler.acquire(LeaseRequest("model-a", "fixture", {"model_id": "model-a"},
                                               owner_id="run-1", orchestration_owned=True))
        scheduler.release(lease)

        self.assertTrue(api._chat_lock.acquire(blocking=False))
        try:
            with self.assertRaises(APIConflict):
                api.apply_residency_action("route_fixture_chat", "unload")
            self.assertEqual(adapter.calls.count("unload"), 0)
            self.assertEqual(len(scheduler.residency()), 1)
        finally:
            api._chat_lock.release()

        result = api.apply_residency_action("route_fixture_chat", "unload")
        self.assertIsNone(result["data"]["residency"]["resident"])
        self.assertEqual(adapter.calls.count("unload"), 1)
        api.close()


if __name__ == "__main__":
    unittest.main()
