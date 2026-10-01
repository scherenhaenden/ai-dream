import unittest
from types import SimpleNamespace

from aidream.image_runtime import LocalImageModel, LocalImageRuntimeAdapter
from aidream.runtime_adapters import RuntimeFailure, RuntimeRequest


PNG = b"\x89PNG\r\n\x1a\nfixture"


class FakeImageBackend:
    local_only = True
    network_access = False
    runtime_id = "fixture-image"

    def __init__(self):
        self.calls = []
        self.model = {"id": "fake-model", "private_path": "/never-serialize/model"}
        self.cancel_result = False

    def capabilities(self):
        self.calls.append("probe")
        return {"available": True, "image_generation": True, "image_editing": True}

    def list_models(self):
        self.calls.append("list_models")
        return [self.model]

    def can_load(self, model):
        self.calls.append("can_load")
        return model is self.model

    def load(self, model, placement=None, options=None):
        self.calls.append("load")

    def generate_image(self, prompt, options=None):
        self.calls.append(("generate", prompt))
        return {"content_bytes": PNG, "media_type": "image/png", "name": "created.png"}

    def edit_image(self, image, instruction, options=None):
        self.calls.append(("edit", instruction, image))
        return PNG

    def unload(self):
        self.calls.append("unload")

    def cancel_generation(self):
        return self.cancel_result


class LocalImageRuntimeTest(unittest.TestCase):
    def test_cancel_reports_only_confirmed_backend_cancellation(self):
        backend = FakeImageBackend()
        adapter = LocalImageRuntimeAdapter(backend)
        model = adapter.list_models()[0]
        handle = adapter.load(adapter.prepare({"model": model,
                                               "required_capability": "image.generate"}))
        self.assertFalse(adapter.cancel(handle))
        backend.cancel_result = True
        self.assertTrue(adapter.cancel(handle))

    def test_probe_lists_compatible_models_without_loading(self):
        backend = FakeImageBackend()
        adapter = LocalImageRuntimeAdapter(backend)
        descriptor = adapter.probe()
        self.assertTrue(descriptor.available)
        self.assertEqual(descriptor.features, frozenset({"image.generate", "image.edit"}))
        self.assertEqual(backend.calls.count("load"), 0)
        models = adapter.list_models()
        self.assertEqual([item.id for item in models], ["fake-model"])
        self.assertNotIn("/never-serialize/model", repr(models))

    def test_generate_and_edit_return_bounded_typed_image(self):
        backend = FakeImageBackend()
        adapter = LocalImageRuntimeAdapter(backend)
        model = adapter.list_models()[0]
        handle = adapter.load(adapter.prepare({"model": model,
                                               "required_capability": "image.generate"}))
        generated = adapter.invoke(handle, RuntimeRequest("image.generate", {"prompt": "a tree"}))
        self.assertEqual(generated.value["kind"], "image")
        self.assertEqual(generated.value["content_bytes"], PNG)
        edited = adapter.invoke(handle, RuntimeRequest("image.edit", {
            "image": PNG, "media_type": "image/png", "instruction": "make it blue"}))
        self.assertEqual(edited.value["media_type"], "image/png")
        adapter.unload(handle)
        self.assertIn("unload", backend.calls)

    def test_refuses_backend_without_explicit_offline_local_contract(self):
        backend = FakeImageBackend()
        backend.local_only = False
        adapter = LocalImageRuntimeAdapter(backend)
        self.assertFalse(adapter.probe().available)
        self.assertEqual(adapter.list_models(), ())

    def test_invalid_image_or_oversized_prompt_is_rejected(self):
        backend = FakeImageBackend()
        adapter = LocalImageRuntimeAdapter(backend)
        model = adapter.list_models()[0]
        handle = adapter.load(adapter.prepare({"model": model,
                                               "required_capability": "image.generate"}))
        with self.assertRaises(RuntimeFailure):
            adapter.invoke(handle, RuntimeRequest("image.edit", {
                "image": b"not an image", "media_type": "image/png", "instruction": "edit"}))
        with self.assertRaises(RuntimeFailure):
            adapter.invoke(handle, RuntimeRequest("image.generate", {"prompt": "x" * 8001}))

    def test_backend_output_must_match_a_supported_image_signature(self):
        backend = FakeImageBackend()
        backend.generate_image = lambda _prompt, options=None: {
            "content_bytes": b"not really a PNG", "media_type": "image/png"}
        adapter = LocalImageRuntimeAdapter(backend)
        model = adapter.list_models()[0]
        handle = adapter.load(adapter.prepare({"model": model,
                                               "required_capability": "image.generate"}))
        with self.assertRaisesRegex(RuntimeFailure, "operation failed"):
            adapter.invoke(handle, RuntimeRequest("image.generate", {"prompt": "a tree"}))

    def test_resource_estimates_are_read_only_and_ignore_invalid_hints(self):
        model = SimpleNamespace(id="fixture", estimated_ram_bytes=1024,
                                resource_hints={"vram_bytes_estimate": 2048,
                                                "ram_bytes_estimate": True})
        self.assertEqual(LocalImageRuntimeAdapter.resource_estimates(
            LocalImageModel("fixture", model)), (1024, 2048))


if __name__ == "__main__":
    unittest.main()
