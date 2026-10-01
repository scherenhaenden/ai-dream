from __future__ import annotations

import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from aidream.capabilities import CapabilityRegistry
from aidream.http_api import APIError, APINotFound, ReadOnlyAPI


class _Catalog:
    def __init__(self, models):
        self.models = models

    def list_models(self):
        return self.models


class _Backend:
    name = "fixture-backend"
    runtime_id = "runtime-fixture"

    def __init__(self, *, available=True, chat_completions=True, loadable=True):
        self._capabilities = SimpleNamespace(
            available=available,
            chat_completions=chat_completions,
        )
        self.loadable = loadable

    def capabilities(self):
        return self._capabilities

    def can_load(self, model):
        return self.loadable


def _api(models=(), backends=()):
    # Bypass construction of persistent app services. The endpoint only needs
    # these explicitly mocked inventory views and never starts a runtime.
    api = ReadOnlyAPI.__new__(ReadOnlyAPI)
    api.catalog = _Catalog(list(models))
    api.capability_registry = CapabilityRegistry()
    api._effective_runtime_defaults = lambda: {
        "backend_name": "fixture-backend",
        "runtime_id": "runtime-fixture",
    }
    api._all_backends = lambda: list(backends)
    return api


class CapabilityAPITests(unittest.TestCase):
    def setUp(self):
        self.model = SimpleNamespace(
            id="a" * 24,
            path="/private/models/secret-name.gguf",
        )
        self.backend = _Backend()

    def test_full_map_detail_and_routes_shapes(self):
        api = _api([self.model], [self.backend])

        status, full_response = api.get("/api/capabilities")
        self.assertEqual(status, 200)
        full = {item["id"]: item for item in full_response["data"]["capabilities"]}
        self.assertEqual(set(full), {
            "text.chat", "text.generate", "audio.transcribe", "audio.synthesize",
            "audio.diarize", "audio.understand", "audio.prosody", "music.understand", "music.generate",
            "image.generate", "image.edit", "document.parse", "retrieval.search",
            "embedding.create", "rerank.score",
        })
        self.assertEqual(full["audio.transcribe"]["status"], "unavailable")
        self.assertEqual(full["audio.synthesize"]["status"], "unavailable")
        declaration = full["text.chat"]
        self.assertEqual(declaration["inputs"], [{"kind": "text"}])
        self.assertEqual(declaration["outputs"], [{"kind": "text"}])
        self.assertEqual(declaration["features"], [])
        self.assertEqual(declaration["evidence"][0]["source"], "runtime_probe")
        self.assertEqual(declaration["evidence"][0]["status"], "supported")
        self.assertEqual(declaration["evidence"][0]["confidence"], "medium")
        self.assertEqual(declaration["status"], "supported")
        self.assertEqual(len(declaration["routes"]), 1)
        self.assertEqual(declaration["preferred_route_id"], declaration["routes"][0]["id"])

        status, map_response = api.get("/api/capability-map")
        self.assertEqual(status, 200)
        compact = {item["id"]: item for item in map_response["data"]["capabilities"]}
        self.assertEqual(compact["text.chat"], {
            "id": "text.chat",
            "status": "supported",
            "routes": 1,
            "preferred_route_id": declaration["preferred_route_id"],
            "inputs": ["text"],
            "outputs": ["text"],
            "skills": None,
        })

        status, detail_response = api.get("/api/capabilities/text.chat")
        self.assertEqual(status, 200)
        self.assertEqual(detail_response["data"]["capability"], declaration)
        status, routes_response = api.get("/api/capabilities/text.chat/routes")
        self.assertEqual(status, 200)
        self.assertEqual(routes_response["data"]["routes"], declaration["routes"])

    def test_capability_map_links_only_installed_skills_that_declare_requirement(self):
        from aidream.skills import SkillRegistry, builtin_skill_manifests

        api = _api([self.model], [self.backend])
        api.skill_registry = SkillRegistry(builtin_skill_manifests())
        compact = {item["id"]: item for item in api.get("/api/capability-map")[1]["data"]["capabilities"]}

        text_skills = {item["id"]: item for item in compact["text.chat"]["skills"]}
        self.assertIn("chat.general", text_skills)
        self.assertIn("document.summarize", text_skills)
        self.assertEqual(text_skills["chat.general"]["name"], "General chat")
        self.assertEqual(text_skills["chat.general"]["version"], "1.0.0")
        self.assertEqual(text_skills["chat.general"]["status"], "ready")
        self.assertEqual(text_skills["chat.general"]["category"], "Chat")
        self.assertNotIn("image.describe", text_skills)

        image_skills = {item["id"] for item in compact["image.generate"]["skills"]}
        self.assertEqual(image_skills, {"image.generate"})
        self.assertEqual(compact["music.understand"]["skills"], [])

    def test_invalid_id_is_400_and_unknown_id_is_404(self):
        api = _api([self.model], [self.backend])
        with self.assertRaises(APIError) as invalid:
            api.get("/api/capabilities/Not%20a%20capability")
        self.assertEqual(invalid.exception.status, 400)
        with self.assertRaises(APINotFound) as missing:
            api.get("/api/capabilities/vision.understand")
        self.assertEqual(missing.exception.status, 404)

    def test_no_models_or_runtimes_returns_empty_nonfatal_snapshots(self):
        api = _api()
        full = api.get("/api/capabilities")[1]["data"]["capabilities"]
        compact = api.get("/api/capability-map")[1]["data"]["capabilities"]
        self.assertEqual({item["id"] for item in full}, {
            "audio.transcribe", "audio.synthesize", "audio.diarize", "audio.understand", "audio.prosody",
            "music.understand", "music.generate", "image.generate", "image.edit", "document.parse",
            "retrieval.search", "embedding.create", "rerank.score",
        })
        full_by_id = {item["id"]: item for item in full}
        self.assertEqual(full_by_id["document.parse"]["status"], "supported")
        self.assertIn(full_by_id["retrieval.search"]["status"], {"supported", "unavailable"})
        self.assertEqual(full_by_id["embedding.create"]["status"], "unavailable")
        self.assertEqual(full_by_id["rerank.score"]["status"], "unavailable")
        self.assertTrue(all(item["status"] == "unavailable" for item in full
                            if item["id"].startswith(("audio.", "image.", "music."))))
        self.assertEqual({item["id"] for item in compact}, {
            "audio.transcribe", "audio.synthesize", "audio.diarize", "audio.understand", "audio.prosody",
            "music.understand", "music.generate", "image.generate", "image.edit", "document.parse",
            "retrieval.search", "embedding.create", "rerank.score",
        })

        api = _api([self.model], [])
        full = api.get("/api/capabilities")[1]["data"]["capabilities"]
        self.assertFalse(any(item["id"] == "text.chat" for item in full))
        full_by_id = {item["id"]: item for item in full}
        self.assertEqual(full_by_id["document.parse"]["status"], "supported")
        self.assertIn(full_by_id["retrieval.search"]["status"], {"supported", "unavailable"})
        self.assertTrue(all(item["status"] == "unavailable" for item in full
                            if item["id"].startswith(("audio.", "image.", "music.", "embedding.", "rerank."))))

    def test_supported_route_requires_available_chat_runtime_and_loadable_model(self):
        cases = (
            (_Backend(available=False), False),
            (_Backend(chat_completions=False), False),
            (_Backend(loadable=False), False),
            (_Backend(), True),
        )
        for backend, expected in cases:
            with self.subTest(backend=backend._capabilities, loadable=backend.loadable):
                capabilities = _api([self.model], [backend]).get("/api/capabilities")[1]["data"]["capabilities"]
                text_routes = [item for item in capabilities if item["id"] == "text.chat"]
                self.assertEqual(bool(text_routes), expected)

    def test_local_voice_routes_require_detected_tools_and_installed_model(self):
        from aidream.voice import VoiceCapabilities, VoiceConfiguration

        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "ggml-fixture.bin"
            model.write_bytes(b"synthetic fixture marker")

            class Voice:
                capabilities = VoiceCapabilities("/fake/espeak", None, "/fake/whisper-cli")
                def configuration(self):
                    return VoiceConfiguration(self.capabilities, (model,))

            api = _api()
            api.local_voice = Voice()
            full = api.get("/api/capabilities")[1]["data"]["capabilities"]
            capabilities = {item["id"]: item for item in full}
            self.assertEqual(capabilities["audio.transcribe"]["status"], "supported")
            self.assertEqual(capabilities["audio.synthesize"]["status"], "supported")
            self.assertEqual(capabilities["audio.transcribe"]["routes"][0]["runtime_id"], "local-voice")
            self.assertIn("has not been run", capabilities["audio.transcribe"]["evidence"][0]["details"])

    def test_image_capabilities_are_present_and_truthfully_unavailable(self):
        api = _api()
        full = api.get("/api/capabilities")[1]["data"]["capabilities"]
        capabilities = {item["id"]: item for item in full}
        self.assertEqual(capabilities["image.generate"]["status"], "unavailable")
        self.assertEqual(capabilities["image.generate"]["inputs"], [{"kind": "text"}])
        self.assertEqual(capabilities["image.generate"]["outputs"], [{"kind": "image"}])
        self.assertEqual(capabilities["image.edit"]["inputs"], [{"kind": "image"}, {"kind": "text"}])
        self.assertEqual(capabilities["image.edit"]["outputs"], [{"kind": "image"}])
        self.assertIn("No compatible local image generation runtime",
                      capabilities["image.generate"]["evidence"][0]["details"])

    def test_image_routes_require_explicit_offline_backend_and_serialize_no_paths(self):
        class LocalImageBackend:
            runtime_id = "fixture-image"
            local_only = True
            network_access = False
            def capabilities(self):
                return {"available": True, "image_generation": True, "image_editing": True}
            def list_models(self):
                return [{"id": "fixture-image-model", "path": "/private/weights/model.safetensors"}]
            def can_load(self, _model):
                return True

        api = _api()
        api.image_backends = [LocalImageBackend()]
        capabilities = {item["id"]: item for item in api.get("/api/capabilities")[1]["data"]["capabilities"]}
        for capability_id in ("image.generate", "image.edit"):
            with self.subTest(capability=capability_id):
                item = capabilities[capability_id]
                self.assertEqual(item["status"], "supported")
                self.assertEqual(item["routes"][0]["model_id"], "fixture-image-model")
                self.assertEqual(item["routes"][0]["runtime_id"], "fixture-image")
                self.assertNotIn("/private/weights", json.dumps(item))

        api.image_backends[0].network_access = True
        unavailable = {item["id"]: item for item in api.get("/api/capabilities")[1]["data"]["capabilities"]}
        self.assertEqual(unavailable["image.generate"]["status"], "unavailable")

    def test_advanced_audio_and_music_capabilities_are_unavailable_with_typed_contracts(self):
        api = _api()
        full = api.get("/api/capabilities")[1]["data"]["capabilities"]
        capabilities = {item["id"]: item for item in full}
        contracts = {
            "audio.diarize": ([{"kind": "audio"}], [{"kind": "json"}], "speaker-diarization"),
            "audio.understand": ([{"kind": "audio"}], [{"kind": "json"}], "audio-understanding"),
            "audio.prosody": ([{"kind": "audio"}], [{"kind": "json"}], "prosody-analysis"),
            "music.understand": ([{"kind": "audio"}], [{"kind": "json"}], "music-analysis"),
            "music.generate": ([{"kind": "text"}], [{"kind": "audio"}], "music-generation"),
        }
        for capability_id, (inputs, outputs, reason_part) in contracts.items():
            with self.subTest(capability=capability_id):
                item = capabilities[capability_id]
                self.assertEqual(item["status"], "unavailable")
                self.assertEqual(item["routes"], [])
                self.assertEqual(item["preferred_route_id"], None)
                self.assertEqual(item["inputs"], inputs)
                self.assertEqual(item["outputs"], outputs)
                self.assertIn(reason_part, item["evidence"][0]["details"])

    def test_responses_do_not_expose_local_paths_or_model_names(self):
        api = _api([self.model], [self.backend])
        for path in ("/api/capabilities", "/api/capability-map", "/api/capabilities/text.chat",
                     "/api/capabilities/text.chat/routes"):
            payload = json.dumps(api.get(path)[1])
            self.assertNotIn("/private/models", payload)
            self.assertNotIn("secret-name.gguf", payload)

    def test_capability_endpoints_reject_query_strings(self):
        api = _api([self.model], [self.backend])
        with self.assertRaises(APIError):
            api.get("/api/capabilities/text.chat/routes", "extra=1")

    def test_capability_preferences_get_returns_store_snapshot(self):
        from aidream.capabilities import CapabilityPreferenceStore
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            api = _api()
            api.capability_preference_store = CapabilityPreferenceStore(Path(td) / "prefs.json")
            status, response = api.get("/api/capability-preferences")
            self.assertEqual(status, 200)
            self.assertEqual(response["data"]["selection_defaults"]["mode"], "auto")
            api.capability_preference_store.patch({"capability_preferences": {
                "text.chat": {"model_id": "model-a"},
            }})
            self.assertEqual(api.get("/api/capability-preferences")[1]["data"]["capability_preferences"], {
                "text.chat": {"model_id": "model-a"},
            })


if __name__ == "__main__":
    unittest.main()
