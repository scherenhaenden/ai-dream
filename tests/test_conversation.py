import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aidream.conversation import ChatStore


class ChatStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = ChatStore(self.temp.name)

    def test_round_trip_append_and_derive_title(self):
        session = self.store.create()
        session = self.store.append(session["id"], "user", "First question\ncontinued")
        session = self.store.append(session["id"], "assistant", "Answer")
        loaded = self.store.load(session["id"])
        self.assertEqual(loaded["title"], "First question")
        self.assertEqual([m["role"] for m in loaded["messages"]], ["user", "assistant"])
        self.assertEqual(self.store.list_sessions()[0]["id"], session["id"])

    def test_rename_and_reject_empty_title(self):
        session = self.store.create()
        renamed = self.store.rename(session["id"], "  renamed  ")
        self.assertEqual(renamed["title"], "renamed")
        with self.assertRaises(ValueError):
            self.store.rename(session["id"], "  ")

    def test_delete_removes_only_named_session(self):
        first, second = self.store.create(), self.store.create()
        self.store.delete(first["id"])
        self.assertEqual([item["id"] for item in self.store.list_sessions()], [second["id"]])
        with self.assertRaises(FileNotFoundError):
            self.store.delete(first["id"])

    def test_export_writes_readable_markdown(self):
        session = self.store.create("Local chat")
        self.store.append(session["id"], "user", "Hello")
        self.store.append(session["id"], "assistant", "Hi there")
        destination = Path(self.temp.name) / "exports" / "chat.md"
        self.assertEqual(self.store.export(session["id"], destination), destination.resolve())
        content = destination.read_text(encoding="utf-8")
        self.assertIn("# Local chat", content)
        self.assertIn("## You\n\nHello", content)
        self.assertIn("## Assistant\n\nHi there", content)

    def test_failed_replace_preserves_existing_file_and_cleans_temp(self):
        session = self.store.create()
        path = Path(self.temp.name) / f"{session['id']}.json"
        before = path.read_text(encoding="utf-8")
        with patch("aidream.conversation.os.replace", side_effect=OSError("simulated")):
            with self.assertRaises(OSError):
                self.store.rename(session["id"], "broken update")
        self.assertEqual(path.read_text(encoding="utf-8"), before)
        self.assertEqual(list(Path(self.temp.name).glob(".ai-dream-*.tmp")), [])

    def test_invalid_session_json_is_ignored_by_listing_and_rejected_by_load(self):
        broken_id = "a" * 32
        (Path(self.temp.name) / f"{broken_id}.json").write_text("{", encoding="utf-8")
        self.assertEqual(self.store.list_sessions(), [])
        with self.assertRaises(ValueError):
            self.store.load(broken_id)

    def test_rejects_invalid_ids_and_messages(self):
        for value in ("../outside", "", "a" * 31):
            with self.assertRaises(ValueError):
                self.store.load(value)
        session = self.store.create()
        with self.assertRaises(ValueError):
            self.store.append(session["id"], "tool", "payload")
        with self.assertRaises(ValueError):
            self.store.append(session["id"], "user", " ")

    def test_legacy_session_gets_defaults_without_requiring_settings_key(self):
        session = self.store.create("Legacy")
        path = Path(self.temp.name) / f"{session['id']}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload.pop("settings", None)
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.assertEqual(self.store.list_sessions()[0]["id"], session["id"])
        settings = self.store.get_session_settings(session["id"])
        self.assertEqual(settings["backend_name"], "")
        self.assertEqual(settings["runtime"], {"placement": {}, "load": {}})
        self.assertEqual(settings["generation"]["temperature"], 0.7)
        self.assertIsNone(settings["preset_id"])

    def test_session_settings_partial_nested_update_round_trip(self):
        session = self.store.create()
        updated = self.store.update_session_settings(session["id"], {
            "backend_name": "llama.cpp", "model_id": "repo/model-GGUF",
            "model_path": "/models/model.gguf",
            "runtime": {"placement": {"gpu_layers": 64, "device": "Vulkan0"},
                        "load": {"context_size": 8192, "flash_attention": True}},
            "generation": {"temperature": 0.2, "max_tokens": 400, "stop_strings": ["END"]},
            "preset_id": "a" * 32,
        })
        self.assertEqual(updated["runtime"]["placement"]["gpu_layers"], 64)
        self.assertEqual(updated["runtime"]["load"]["context_size"], 8192)
        self.assertEqual(updated["generation"]["temperature"], 0.2)
        # Nested maps merge, so setting one generation option preserves other defaults.
        self.assertFalse(updated["generation"]["reasoning"])
        loaded = self.store.load(session["id"])
        self.assertEqual(loaded["settings"], updated)

    def test_replace_session_settings_can_clear_prior_placement_and_load_options(self):
        session = self.store.create()
        self.store.update_session_settings(session["id"], {
            "runtime": {"placement": {"gpu_layers": 64, "device": "Vulkan0"},
                        "load": {"context_size": 8192, "threads": 8}},
        })
        replaced = self.store.replace_session_settings(session["id"], {
            "runtime": {"placement": {}, "load": {}},
        })
        self.assertEqual(replaced["runtime"], {"placement": {}, "load": {}})

    def test_session_settings_reject_unknown_or_unsafe_values_without_write(self):
        session = self.store.create()
        before = (Path(self.temp.name) / f"{session['id']}.json").read_text(encoding="utf-8")
        invalid_updates = [
            {"unexpected": True}, {"backend_name": "x\x00y"},
            {"runtime": {"load": {"context_size": True}}},
            {"runtime": {"placement": {"gpu_layers": 2049}}},
            {"generation": {"temperature": float("nan")}},
            {"generation": {"stop_strings": [""]}},
            {"preset_id": "not-an-id"},
        ]
        for invalid in invalid_updates:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.store.update_session_settings(session["id"], invalid)
        after = (Path(self.temp.name) / f"{session['id']}.json").read_text(encoding="utf-8")
        self.assertEqual(after, before)

    def test_failed_settings_replace_preserves_file_and_cleans_temp(self):
        session = self.store.create()
        path = Path(self.temp.name) / f"{session['id']}.json"
        before = path.read_text(encoding="utf-8")
        with patch("aidream.conversation.os.replace", side_effect=OSError("simulated")):
            with self.assertRaises(OSError):
                self.store.update_session_settings(session["id"], {"backend_name": "llama.cpp"})
        self.assertEqual(path.read_text(encoding="utf-8"), before)
        self.assertEqual(list(Path(self.temp.name).glob(".ai-dream-*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
