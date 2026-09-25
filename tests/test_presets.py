import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aidream.presets import PresetStore, default_presets_path


class PresetStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "nested" / "presets.json"
        self.store = PresetStore(self.path)

    def test_crud_round_trips_validated_preset(self):
        settings = {
            "system_prompt": "Be concise.",
            "reasoning": True,
            "temperature": 0.2,
            "max_tokens": 1024,
            "stop_strings": ["END", "<|stop|>"],
            "context_size": 8192,
            "threads": 8,
            "batch_size": 256,
            "placement": {"gpu_layers": 42, "device": "Vulkan0,Vulkan1", "tensor_split": "1,1"},
            "structured_output": {
                "type": "object",
                "properties": {"answer": {"type": "string", "maxLength": 500}},
                "required": ["answer"],
                "additionalProperties": False,
            },
        }
        created = self.store.create("  Research  ", settings)
        self.assertEqual(created["name"], "Research")
        self.assertEqual(created["settings"]["temperature"], 0.2)
        self.assertEqual(created["settings"]["placement"]["tensor_split"], "1,1")
        self.assertEqual(self.store.load(created["id"]), created)
        self.assertEqual(self.store.list_presets(), [created])

        renamed = self.store.rename(created["id"], "Writing")
        self.assertEqual(renamed["name"], "Writing")
        self.assertEqual(renamed["settings"], created["settings"])
        self.assertEqual(self.store.load(created["id"])["name"], "Writing")
        self.store.delete(created["id"])
        self.assertEqual(self.store.list_presets(), [])

    def test_create_uses_complete_defaults_and_detached_return_values(self):
        preset = self.store.create("Default")
        self.assertEqual(preset["settings"]["temperature"], 0.7)
        self.assertEqual(preset["settings"]["placement"], {})
        preset["settings"]["stop_strings"].append("not persisted")
        self.assertEqual(self.store.load(preset["id"])["settings"]["stop_strings"], [])

    def test_missing_ids_and_invalid_names_are_rejected(self):
        with self.assertRaises(ValueError):
            self.store.load("../presets.json")
        with self.assertRaises(KeyError):
            self.store.load("a" * 32)
        with self.assertRaises(ValueError):
            self.store.create("   ")
        with self.assertRaises(KeyError):
            self.store.rename("a" * 32, "New")
        with self.assertRaises(KeyError):
            self.store.delete("a" * 32)

    def test_rejects_unknown_or_invalid_settings(self):
        invalid = [
            {"temperature": True},
            {"temperature": math.nan},
            {"temperature": 2.1},
            {"reasoning": 1},
            {"max_tokens": 0},
            {"context_size": True},
            {"threads": 0},
            {"batch_size": 65_537},
            {"stop_strings": "STOP"},
            {"stop_strings": [""]},
            {"placement": {"shell": "rm -rf"}},
            {"placement": {"gpu_layers": -1}},
            {"placement": {"device": "../../etc"}},
            {"placement": {"tensor_split": "1,0"}},
            {"structured_output": {"$ref": "https://example.invalid/schema"}},
            {"structured_output": {"type": "object", "properties": {"a": {"type": "magic"}}}},
            {"setting_from_future": True},
        ]
        for settings in invalid:
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                self.store.create("Bad", settings)
        self.assertFalse(self.path.exists())

    def test_xdg_path_is_per_user_data(self):
        with patch.dict("os.environ", {"XDG_DATA_HOME": "/tmp/xdg-data"}):
            self.assertEqual(default_presets_path(), Path("/tmp/xdg-data/ai-dream/presets.json"))

    def test_invalid_existing_json_is_not_overwritten_by_mutation(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text('{broken', encoding="utf-8")
        with self.assertRaises(ValueError):
            self.store.create("Do not overwrite")
        self.assertEqual(self.path.read_text(encoding="utf-8"), "{broken")

    def test_atomic_replace_failure_keeps_previous_store_intact(self):
        original = self.store.create("Original")
        before = self.path.read_bytes()
        with patch("aidream.presets.os.replace", side_effect=OSError("simulated replace failure")):
            with self.assertRaises(OSError):
                self.store.rename(original["id"], "Changed")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.store.load(original["id"])["name"], "Original")
        self.assertEqual(list(self.path.parent.glob("*.tmp")), [])

    def test_load_revalidates_tampered_store(self):
        record = self.store.create("Valid")
        data = json.loads(self.path.read_text(encoding="utf-8"))
        data["presets"][0]["settings"]["placement"] = {"command": "anything"}
        self.path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.store.load(record["id"])


if __name__ == "__main__":
    unittest.main()
