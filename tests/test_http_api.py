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
            self.assertEqual(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS")
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
