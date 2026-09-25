import tempfile
import unittest
from pathlib import Path

from aidream.preset_ui import PresetManagerController
from aidream.presets import PresetStore


class PresetManagerControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = PresetStore(Path(self.temp.name) / "presets.json")
        self.applied = []
        self.current = {"system_prompt": "Be helpful", "temperature": 0.4,
                        "stop_strings": ["END"]}
        self.controller = PresetManagerController(
            self.store,
            get_settings=lambda: self.current,
            on_load=lambda settings: self.applied.append(settings),
        )

    def test_create_list_load_rename_delete_user_flow_without_tk_root(self):
        preset = self.controller.create("Writer")
        self.assertEqual(preset["settings"]["system_prompt"], "Be helpful")
        self.assertEqual([item["id"] for item in self.controller.list_presets()], [preset["id"]])

        loaded = self.controller.load(preset["id"])
        self.assertEqual(loaded["name"], "Writer")
        self.assertEqual(self.applied, [preset["settings"]])
        self.applied[0]["stop_strings"].append("MUTATED")
        self.assertEqual(self.store.load(preset["id"])["settings"]["stop_strings"], ["END"])

        renamed = self.controller.rename(preset["id"], "Editor")
        self.assertEqual(renamed["name"], "Editor")
        self.controller.delete(preset["id"])
        self.assertEqual(self.controller.list_presets(), [])

    def test_store_validation_surfaces_to_dialog_boundary(self):
        with self.assertRaises(ValueError):
            self.controller.create(" ")
        with self.assertRaises(ValueError):
            self.controller.rename("../bad", "Good")

    def test_load_callback_receives_settings_only_and_can_apply_them(self):
        preset = self.store.create("Advanced", {"reasoning": True, "context_size": 8192})
        self.controller.load(preset["id"])
        self.assertEqual(self.applied[0]["reasoning"], True)
        self.assertEqual(self.applied[0]["context_size"], 8192)
        self.assertNotIn("id", self.applied[0])

    def test_bad_settings_provider_is_rejected(self):
        controller = PresetManagerController(self.store, get_settings=lambda: ["not", "settings"])
        with self.assertRaises(ValueError):
            controller.create("Invalid provider")


if __name__ == "__main__":
    unittest.main()
