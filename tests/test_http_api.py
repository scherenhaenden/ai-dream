from __future__ import annotations

from dataclasses import dataclass
import http.client
import json
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from aidream.http_api import MAX_MODELS, ReadOnlyAPI, create_server


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
    def list_models(self):
        return [{"id": "model-1", "path": "/models/a.gguf"}]


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
        with self.assertRaises(HTTPError) as caught:
            self.request("/api/health", headers={"Origin": "https://attacker.example"})
        self.assertEqual(caught.exception.code, 403)
        caught.exception.read()
        caught.exception.close()

    def test_http_mutations_are_rejected_and_body_is_not_consumed(self):
        with self.assertRaises(HTTPError) as caught:
            self.request("/api/models", method="POST", data=b'{"path":"/etc/passwd"}')
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
