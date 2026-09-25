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
from aidream.http_api import MAX_MODELS, MAX_REQUEST_BYTES, ReadOnlyAPI, create_server
from aidream.runtime import LlamaCppBackend


@dataclass
class Capabilities:
    available: bool
    executable: str | None = None
    details: str = "test"


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
    def load(self, model):
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
        self.server = create_server(0, api=ReadOnlyAPI(
            hardware=FakeHardware(), catalog=FakeCatalog(), runtimes=FakeRuntime()))
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
                          runtimes=FakeRuntime(), chat_store=chat_store)
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
            self.assertIn('event: error\ndata: {"error":"Model id was not found in the local catalog"}', stream)
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


if __name__ == "__main__":
    unittest.main()
