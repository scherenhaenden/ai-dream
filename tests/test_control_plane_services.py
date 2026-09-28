from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from aidream.app_settings import AppSettingsStore
from aidream.conversation import ChatStore
from aidream.http_api import ReadOnlyAPI
from aidream.model_profiles import ModelProfileStore
from aidream.models import ModelCatalog
from aidream.runtime_installations import RuntimeInstallationRegistry


class _Runtime:
    def list_backends(self):
        return []


class _Capabilities:
    available = True
    device_selection = True


class _Backend:
    name = "fixture"
    runtime_id = None
    executable = "/usr/bin/fixture"

    def capabilities(self):
        return _Capabilities()

    def can_load(self, model):
        return model.id == "m1"

    def load(self, model, placement, load):
        self.received = (model.id, placement, load)
        self._loaded_model = model.path

    def effective_command(self, model, placement, load):
        self.received_command = (placement, load)
        return [self.executable, "-m", model.path, "-ngl", str(placement.get("gpu_layers", 0))]

    def restore_history(self, history):
        self.history = history

    def generate_stream(self, prompt, options=None, **kwargs):
        return prompt

    def unload(self):
        self._loaded_model = None


class ControlPlaneServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        root = Path(self.temp.name)
        self.catalog = ModelCatalog(root / "config")
        self.profiles = ModelProfileStore(root / "profiles.json")
        self.settings = AppSettingsStore(root / "settings.json")
        self.api = ReadOnlyAPI(hardware=SimpleNamespace(detect=lambda: {"gpus": []}),
                               catalog=self.catalog, runtimes=_Runtime(),
                               runtime_installations=RuntimeInstallationRegistry(root / "runtimes.json"),
                               profile_store=self.profiles, settings_store=self.settings,
                               download_dir=root / "models")

    def tearDown(self):
        self.temp.cleanup()

    def test_profile_resolution_applies_global_model_chat_and_request_precedence(self):
        profile = self.profiles.create({"name": "model", "model_id": "m1",
                                        "placement": {"gpu_layers": 5},
                                        "load": {"context_size": 2048},
                                        "generation": {"temperature": 0.3}})
        self.settings.patch({"runtime_defaults": {"placement": {"gpu_layers": 2},
                                                   "load": {"threads": 4}}})
        result = self.api._resolve_settings("m1", chat_settings={
            "runtime": {"placement": {"gpu_layers": 7}, "load": {"threads": 8}},
            "generation": {"temperature": 0.8}}, request_settings={
                "placement": {"gpu_layers": 9}, "generation": {"temperature": 0.6}})
        self.assertEqual(result["placement"]["gpu_layers"], 9)
        self.assertEqual(result["load"], {"threads": 8, "context_size": 2048})
        self.assertEqual(result["generation"]["temperature"], 0.6)
        self.assertEqual(self.profiles.get(profile["id"])["name"], "model")

    def test_global_settings_api_view_and_patch_use_persistent_store(self):
        status, response = self.api.get("/api/settings")
        self.assertEqual(status, 200)
        self.assertEqual(response["data"]["settings"]["default_profile_behavior"], "model")
        self.api.settings_store.patch({"keep_last_model_loaded": True})
        self.assertTrue(self.api.get("/api/settings")[1]["data"]["settings"]["keep_last_model_loaded"])

    def test_model_source_registration_returns_opaque_id_and_remove_keeps_directory(self):
        source = Path(self.temp.name) / "source"
        source.mkdir()
        result = self.api.create_model_source(str(source))["data"]["source"]
        self.assertEqual(len(result["id"]), 32)
        self.assertEqual(result["path"], str(source.resolve()))
        self.api.remove_model_source(result["id"])
        self.assertTrue(source.is_dir())
        self.assertEqual(self.catalog.list_sources(), [])

    def test_profile_listing_supports_query_filter_and_rejects_extra_query(self):
        self.profiles.create({"name": "m1", "model_id": "m1"})
        self.profiles.create({"name": "m2", "model_id": "m2"})
        response = self.api.get("/api/model-profiles", "model_id=m1")[1]
        self.assertEqual([item["model_id"] for item in response["data"]["profiles"]], ["m1"])
        with self.assertRaises(ValueError):
            self.api.get("/api/model-profiles", "model_id=m1&bad=1")

    def test_runtime_installation_delete_does_not_touch_executable(self):
        path = Path(self.temp.name) / "llama-server"
        path.write_text("fixture")
        path.chmod(0o755)
        registry = RuntimeInstallationRegistry(Path(self.temp.name) / "registry.json",
            run=lambda args, **kwargs: SimpleNamespace(returncode=0, stdout="llama-server --help\\n", stderr=""))
        item = registry.register(path)
        self.api.runtime_installations = registry
        result = self.api.delete_runtime_installation(item["id"])
        self.assertTrue(result["data"]["deleted"])
        self.assertTrue(path.exists())

    def test_explicit_load_applies_resolved_settings_to_backend(self):
        backend = _Backend()
        self.api.catalog = SimpleNamespace(list_models=lambda: [SimpleNamespace(id="m1", path="/fixture.gguf")])
        self.api.runtimes = SimpleNamespace(list_backends=lambda: [backend])
        self.settings.patch({"runtime_defaults": {"placement": {"gpu_layers": 3},
                                                   "load": {"context_size": 512}}})
        response = self.api.load_model({"model_id": "m1"})
        self.assertEqual(backend.received, ("m1", {"gpu_layers": 3}, {"context_size": 512}))
        self.assertTrue(response["data"]["status"]["loaded"])

    def test_effective_command_returns_shell_text_and_exact_argv_without_loading(self):
        backend = _Backend()
        self.api.catalog = SimpleNamespace(list_models=lambda: [SimpleNamespace(id="m1", path="/fixture.gguf")])
        self.api.runtimes = SimpleNamespace(list_backends=lambda: [backend])
        result = self.api.effective_command({"model_id": "m1", "placement": {"gpu_layers": 2}})["data"]
        self.assertEqual(result["argv"], ["/usr/bin/fixture", "-m", "/fixture.gguf", "-ngl", "2"])
        self.assertIn("-ngl 2", result["command"])
        self.assertIsNone(self.api._active_backend)

    def test_chat_uses_persisted_profile_and_generation_settings(self):
        backend = _Backend()
        model = SimpleNamespace(id="m1", path="/fixture.gguf")
        self.api.catalog = SimpleNamespace(list_models=lambda: [model])
        self.api.runtimes = SimpleNamespace(list_backends=lambda: [backend])
        self.api.chat_store = ChatStore(Path(self.temp.name) / "chats")
        profile = self.profiles.create({"name": "profile", "model_id": "m1",
                                        "placement": {"gpu_layers": 6},
                                        "load": {"context_size": 1024},
                                        "generation": {"temperature": 0.25}})
        session = self.api.chat_store.create()
        self.api.chat_store.update_session_settings(session["id"], {"profile_id": profile["id"],
            "generation": {"temperature": 0.5}})
        run = self.api.prepare_chat(session["id"], "m1", "hello")
        try:
            self.assertEqual(backend.received[1:], ({"gpu_layers": 6}, {"context_size": 1024}))
            self.assertEqual(run.generation["temperature"], 0.5)
        finally:
            run.close()


if __name__ == "__main__":
    unittest.main()
