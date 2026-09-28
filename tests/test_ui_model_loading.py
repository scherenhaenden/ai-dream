"""Desktop model loading actions tested with fake runtimes, never a real model."""

import unittest
from unittest.mock import patch

from aidream import ui
from aidream.ui import AIDreamWindow


class FakeRoot:
    def __init__(self):
        self.callbacks = []

    def after(self, _delay, callback):
        self.callbacks.append(callback)


class FakeStatus:
    def __init__(self):
        self.text = ""

    def configure(self, *, text):
        self.text = text


class FakeThread:
    """Run the worker synchronously while preserving the Thread API."""

    def __init__(self, *, target, daemon):
        self.target = target
        self.daemon = daemon

    def start(self):
        self.target()


class FakeModel:
    path = "/models/example.gguf"
    id = "example-model"


class FakeBackend:
    name = "fake llama.cpp"

    def __init__(self, events=None):
        self.events = events if events is not None else []

    def can_load(self, _model):
        return True

    def load(self, model, placement, *, options):
        self.events.append(("load", model.path, placement, options))

    def unload(self):
        self.events.append(("unload",))


class DesktopModelLoadingTests(unittest.TestCase):
    def make_window(self):
        window = AIDreamWindow.__new__(AIDreamWindow)
        window.root = FakeRoot()
        window.voice_status = FakeStatus()
        window._runtime_action_busy = False
        window._generation_busy = False
        window.loaded_backend = None
        window.loaded_key = None
        return window

    def configure_selection(self, window, backend):
        model = FakeModel()
        window._selected_runtime_configuration = lambda: (backend, model, {"gpu_layers": 4}, {"context_size": 2048})
        window._save_current_chat_settings = lambda: None
        return model

    def finish_ui_callbacks(self, window):
        callbacks, window.root.callbacks = window.root.callbacks, []
        for callback in callbacks:
            callback()

    def test_load_action_loads_selected_catalog_model_without_a_chat_prompt(self):
        window = self.make_window()
        backend = FakeBackend()
        model = self.configure_selection(window, backend)

        with patch.object(ui.threading, "Thread", FakeThread):
            window.load_selected_model()

        self.assertEqual(backend.events, [("load", model.path, {"gpu_layers": 4}, {"context_size": 2048})])
        self.assertIs(window.loaded_backend, backend)
        self.assertFalse(hasattr(window, "prompt"))
        self.finish_ui_callbacks(window)
        self.assertIn("Loaded", window.voice_status.text)
        self.assertFalse(window._runtime_action_busy)

    def test_reload_is_one_ordered_transaction_after_previous_backend_stops(self):
        window = self.make_window()
        events = []
        previous = FakeBackend(events)
        selected = FakeBackend(events)
        window.loaded_backend = previous
        model = self.configure_selection(window, selected)

        with patch.object(ui.threading, "Thread", FakeThread):
            window.reload_model()

        self.assertEqual(events, [("unload",), ("load", model.path, {"gpu_layers": 4}, {"context_size": 2048})])
        self.assertIs(window.loaded_backend, selected)
        self.finish_ui_callbacks(window)

    def test_unload_action_uses_loaded_backend_and_clears_state_on_success(self):
        window = self.make_window()
        backend = FakeBackend()
        window.loaded_backend = backend
        window.loaded_key = ("loaded",)

        with patch.object(ui.threading, "Thread", FakeThread):
            window.unload_model()

        self.assertEqual(backend.events, [("unload",)])
        self.assertIsNone(window.loaded_backend)
        self.assertIsNone(window.loaded_key)
        self.finish_ui_callbacks(window)
        self.assertEqual(window.voice_status.text, "Model unloaded.")

    def test_add_folder_registers_directory_then_refreshes_catalog(self):
        window = self.make_window()
        registered = []
        refreshed = []
        window.catalog = type("Catalog", (), {"add_source": lambda _self, path: registered.append(path)})()
        window.refresh = lambda: refreshed.append(True)

        with patch.object(ui.filedialog, "askdirectory", return_value="/models"):
            window.add_folder()

        self.assertEqual(registered, ["/models"])
        self.assertEqual(refreshed, [True])


if __name__ == "__main__":
    unittest.main()
