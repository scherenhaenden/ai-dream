import unittest
from types import SimpleNamespace

from aidream.image_runtime import LocalImageRuntimeAdapter
from aidream.runtime_adapters import RuntimeFailure, RuntimeRequest


PNG = b"\x89PNG\r\n\x1a\nfixture"


class FakeImageBackend:
    local_only = True
    network_access = False
    runtime_id = "fixture-image"

    def __init__(self):
        self.calls = []
        self.model = {"id": "fake-model", "private_path": "/never-serialize/model"}

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


class LocalImageRuntimeTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
