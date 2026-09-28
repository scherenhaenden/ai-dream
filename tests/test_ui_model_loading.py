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

    def display_info(self):
        return {"name": "Example model"}


class FakeVariable:
    def __init__(self, value=""):
        self.value = value

    def get(self):
        return self.value

    def set(self, value):
        self.value = value


class FakeProfileStore:
    def __init__(self, profiles=None):
        self.profiles = profiles or []
        self.created = []
        self.updated = []

    def list_profiles(self, model_id=None):
        return [item for item in self.profiles if item.get("model_id") in (None, model_id)]

    def create(self, profile):
        item = {**profile, "id": "a" * 32}
        self.created.append(item)
        self.profiles.append(item)
        return item

    def update(self, profile_id, changes):
        item = next(item for item in self.profiles if item["id"] == profile_id)
        item.update(changes)
        self.updated.append((profile_id, changes))
        return item


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

    def test_model_runtime_settings_are_saved_to_model_profile_store(self):
        window = self.make_window()
        model = FakeModel()
        window.model_list = type("Selection", (), {"curselection": lambda _self: (0,)})()
        window.models = [model]
        window.profile_store = FakeProfileStore()
        window.backend_var = FakeVariable("llama.cpp")
        window.backend_by_name = {"llama.cpp": type("Backend", (), {"name": "llama.cpp", "runtime_id": "runtime-1"})()}

        saved = window._persist_model_profile({
            "backend_name": "llama.cpp",
            "runtime": {"placement": {"gpu_layers": 12}, "load": {"context_size": 8192}},
            "generation": {"temperature": 0.2, "context_size": 1024},
        })

        self.assertEqual(saved["model_id"], "example-model")
        self.assertEqual(saved["runtime_id"], "runtime-1")
        self.assertEqual(saved["placement"], {"gpu_layers": 12})
        self.assertEqual(saved["load"], {"context_size": 8192})
        self.assertEqual(saved["generation"], {"temperature": 0.2})
        self.assertEqual(len(window.profile_store.created), 1)

    def test_selected_model_restores_its_saved_profile_and_runtime(self):
        window = self.make_window()
        model = FakeModel()
        profile = {"id": "b" * 32, "model_id": model.id, "name": "Example profile",
                   "runtime_id": "runtime-1", "backend_name": "Stale display name",
                   "placement": {"gpu_layers": 20, "device": "ROCm0"},
                   "load": {"context_size": 8192, "threads": 8, "flash_attention": True},
                   "generation": {"temperature": 0.3}}
        window.profile_store = FakeProfileStore([profile])
        window.chat_store = type("ChatStore", (), {"get_session_settings": lambda _self, _id: {}})()
        window.chat_session = {"id": "chat-id"}
        window.backends = [type("Backend", (), {"name": "Runtime A", "runtime_id": "runtime-1"})(),
                           type("Backend", (), {"name": "Runtime B", "runtime_id": "runtime-2"})()]
        window.backend_by_name = {backend.name: backend for backend in window.backends}
        window.backend_var = FakeVariable()
        window._update_capabilities = lambda: None
        window.model_profile_status = FakeStatus()
        for name in ("gpu_layers_var", "device_var", "tensor_split_var", "split_mode_var", "main_gpu_var",
                     "context_var", "threads_var", "batch_var", "physical_batch_var", "max_concurrent_var",
                     "system_prompt_var", "temperature_var", "max_tokens_var"):
            setattr(window, name, FakeVariable())
        window._advanced_load_vars = {"flash_attention": FakeVariable(False), "fit": FakeVariable(False)}
        window.reasoning_var = FakeVariable(False)

        window._apply_model_profile(model)

        self.assertEqual(window.backend_var.get(), "Runtime A")
        self.assertEqual(window.context_var.get(), "8192")
        self.assertEqual(window.gpu_layers_var.get(), "20")
        self.assertEqual(window.device_var.get(), "ROCm0")
        self.assertTrue(window._advanced_load_vars["flash_attention"].get())
        self.assertEqual(window.temperature_var.get(), "0.3")
        self.assertEqual(window._active_model_profile["id"], profile["id"])

    def test_desktop_device_choices_use_only_native_runtime_ids(self):
        backend = type("Backend", (), {"list_devices": lambda _self: [
            {"id": "ROCm0", "name": "GPU A"}, {"runtime_id": "Vulkan1", "name": "GPU B"},
            {"name": "Missing ID"}, {"id": "ROCm0", "name": "Duplicate"},
        ]})()

        self.assertEqual(AIDreamWindow._runtime_native_device_ids(backend), ["ROCm0", "Vulkan1"])
        self.assertEqual(AIDreamWindow._runtime_native_device_ids(object()), [])


if __name__ == "__main__":
    unittest.main()
