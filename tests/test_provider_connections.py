from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from aidream.diagnostics import DiagnosticsLog
from aidream.http_api import ReadOnlyAPI, create_server
from aidream.provider_connections import (
    OSKeyringSecretStore,
    ProviderConnectionError,
    ProviderConnectionStore,
    ProviderConnections,
    ProviderResponse,
    SecretStoreUnavailable,
    validate_base_url,
)


class FakeSecrets:
    def __init__(self, available=True):
        self.enabled = available
        self.values = {}

    def available(self):
        return self.enabled

    def set(self, reference, secret):
        if not self.enabled:
            raise SecretStoreUnavailable("OS secure credential storage is unavailable")
        self.values[reference] = secret

    def get(self, reference):
        if not self.enabled:
            raise SecretStoreUnavailable("OS secure credential storage is unavailable")
        return self.values.get(reference)

    def delete(self, reference):
        if not self.enabled:
            raise SecretStoreUnavailable("OS secure credential storage is unavailable")
        self.values.pop(reference, None)


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.response = ProviderResponse(200, {"data": [{"id": "chat-model"}, {"id": "other"}]})

    def list_models(self, base_url, api_key):
        self.calls.append((base_url, api_key))
        return self.response


class ProviderConnectionServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "connections.json"
        self.store = ProviderConnectionStore(self.path)
        self.secrets = FakeSecrets()
        self.transport = FakeTransport()
        self.service = ProviderConnections(self.store, self.secrets, self.transport)

    def create(self, **changes):
        body = {"name": "Fixture", "base_url": "https://api.example.test/v1",
                "api_key": "secret-token", "enabled": True}
        body.update(changes)
        return self.service.create(body)

    def test_metadata_crud_keeps_secret_only_in_injected_secret_store(self):
        public = self.create()
        encoded = self.path.read_text("utf-8")
        self.assertNotIn("secret-token", encoded)
        self.assertNotIn("api_key", encoded)
        self.assertEqual(public["secret_ref"], next(iter(self.secrets.values)))
        self.assertEqual(public["credential_configured"], True)
        self.assertEqual(self.service.get(public["id"]), public)

        updated = self.service.update(public["id"], {"name": "Renamed", "api_key": "replacement"})
        self.assertEqual(updated["name"], "Renamed")
        self.assertNotIn(public["secret_ref"], self.secrets.values)
        self.assertEqual(self.secrets.values[updated["secret_ref"]], "replacement")
        self.service.update(public["id"], {"clear_api_key": True})
        cleared = self.service.get(public["id"])
        self.assertFalse(cleared["credential_configured"])
        self.assertFalse(cleared["enabled"])
        self.service.delete(public["id"])
        self.assertEqual(self.store.list(), [])
        self.assertEqual(self.secrets.values, {})

    def test_disabled_metadata_may_be_saved_but_enable_requires_secure_secret(self):
        connection = self.service.create({"name": "No secret", "base_url": "https://api.example.test/v1"})
        with self.assertRaises(ProviderConnectionError):
            self.service.update(connection["id"], {"enabled": True})
        unavailable = ProviderConnections(self.store, FakeSecrets(available=False), self.transport)
        with self.assertRaises(SecretStoreUnavailable):
            unavailable.create({"name": "No keyring", "base_url": "https://api.example.test/v1",
                                "api_key": "must-not-fallback"})
        self.assertNotIn("must-not-fallback", self.path.read_text("utf-8"))

    def test_test_and_models_use_fake_transport_and_namespace_ids(self):
        connection = self.create()
        self.assertEqual(self.service.test(connection["id"]),
                         {"connection_id": connection["id"], "connected": True, "model_count": 2})
        models = self.service.models(connection["id"])["models"]
        self.assertEqual(models[0]["id"], f"provider:{connection['id']}:chat-model")
        self.assertEqual(models[0]["provider_model_id"], "chat-model")
        self.assertEqual(len(self.transport.calls), 2)
        self.assertEqual(self.transport.calls[0][1], "secret-token")

    def test_transport_errors_are_generic_and_response_models_are_bounded(self):
        connection = self.create()
        self.transport.response = ProviderResponse(401, {"error": "secret-token denied"})
        with self.assertRaises(ProviderConnectionError) as raised:
            self.service.test(connection["id"])
        self.assertNotIn("secret-token", str(raised.exception))
        self.transport.response = ProviderResponse(200, {"data": "not a list"})
        with self.assertRaises(ProviderConnectionError):
            self.service.models(connection["id"])


class ProviderConnectionSafetyTests(unittest.TestCase):
    def test_base_url_requires_https_except_loopback_and_rejects_local_networks(self):
        self.assertEqual(validate_base_url(" HTTPS://api.example.test/v1/ "), "https://api.example.test/v1")
        self.assertEqual(validate_base_url("http://127.0.0.1:9000/v1"), "http://127.0.0.1:9000/v1")
        self.assertEqual(validate_base_url("https://127.0.0.1/v1"), "https://127.0.0.1/v1")
        for value in (
            "http://api.example.test/v1", "https://user:pass@example.test/v1",
            "https://192.168.1.8/v1",
            "https://169.254.169.254/latest/meta-data", "https://example.test/v1?token=x",
        ):
            with self.subTest(value=value), self.assertRaises(ProviderConnectionError):
                validate_base_url(value)

    def test_default_keyring_absence_is_explicit(self):
        store = OSKeyringSecretStore()
        try:
            import keyring  # noqa: F401
        except ImportError:
            self.assertFalse(store.available())
            with self.assertRaises(SecretStoreUnavailable):
                store.set("ref", "never persisted")


class ProviderConnectionHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        store = ProviderConnectionStore(Path(self.temp.name) / "connections.json")
        self.secrets = FakeSecrets()
        self.transport = FakeTransport()
        self.provider_service = ProviderConnections(store, self.secrets, self.transport)
        self.diagnostics = DiagnosticsLog(Path(self.temp.name) / "diagnostics.jsonl")
        self.local_models = [{"id": "model-1", "path": "/models/a.gguf"}]
        catalog = SimpleNamespace(list_models=lambda: self.local_models)
        api = ReadOnlyAPI(hardware=object(), catalog=catalog, runtimes=object(),
                          diagnostics_log=self.diagnostics, provider_connections=self.provider_service)
        self.server = create_server(0, api=api)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, method="GET", body=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {"Origin": "http://127.0.0.1:5173", "Content-Type": "application/json"}
        return urlopen(Request(self.base + path, method=method, data=data, headers=headers), timeout=3)

    def read_json(self, response):
        return json.loads(response.read())

    def test_connection_routes_redact_credentials_and_leave_local_catalog_untouched(self):
        created = self.read_json(self.request("/api/provider-connections", "POST", {
            "name": "Fixture", "base_url": "https://api.example.test/v1",
            "api_key": "only-in-secret-store", "enabled": True,
        }))
        connection = created["data"]["connection"]
        self.assertNotIn("only-in-secret-store", json.dumps(created))
        connection_id = connection["id"]
        listed = self.read_json(self.request("/api/provider-connections"))["data"]
        self.assertTrue(listed["secure_storage"]["available"])
        self.assertNotIn("only-in-secret-store", json.dumps(listed))
        test_result = self.read_json(self.request(f"/api/provider-connections/{connection_id}/test", "POST", {}))
        self.assertTrue(test_result["data"]["connected"])
        discovered = self.read_json(self.request(f"/api/provider-connections/{connection_id}/models"))
        self.assertTrue(discovered["data"]["models"][0]["id"].startswith(f"provider:{connection_id}:"))
        local = self.read_json(self.request("/api/models"))["data"]["models"]
        self.assertEqual(local, self.local_models)

        updated = self.read_json(self.request(f"/api/provider-connections/{connection_id}", "PATCH", {
            "enabled": False,
        }))
        self.assertFalse(updated["data"]["connection"]["enabled"])
        self.read_json(self.request(f"/api/provider-connections/{connection_id}", "DELETE", {}))
        self.assertEqual(self.provider_service.store.list(), [])

    def test_default_service_reports_missing_host_keyring_without_plaintext_fallback(self):
        self.secrets.enabled = False
        listing = self.read_json(self.request("/api/provider-connections"))["data"]
        self.assertFalse(listing["secure_storage"]["available"])
        with self.assertRaises(HTTPError) as denied:
            self.request("/api/provider-connections", "POST", {
                "name": "No keyring", "base_url": "https://api.example.test/v1", "api_key": "secret",
            })
        self.assertEqual(denied.exception.code, 503)
        error = denied.exception.read().decode()
        denied.exception.close()
        self.assertNotIn("secret", error)
