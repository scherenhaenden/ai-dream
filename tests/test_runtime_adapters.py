import unittest
from threading import Event, Thread
from types import SimpleNamespace

from aidream.runtime_adapters import (
    CompatibilityResult,
    FakeRuntimeAdapter,
    HealthState,
    LlamaCppRuntimeAdapter,
    RuntimeErrorCode,
    RuntimeFailure,
    RuntimeAdapter,
    RuntimeRequest,
    VLLMRuntimeAdapter,
)


class RuntimeAdapterContractTest(unittest.TestCase):
    def test_fake_adapter_lifecycle_is_normalized(self):
        adapter = FakeRuntimeAdapter(features={"text.chat"})
        self.assertIsInstance(adapter, RuntimeAdapter)
        self.assertTrue(adapter.probe().available)
        self.assertEqual(adapter.supports({}).features, frozenset({"text.chat"}))
        prepared = adapter.prepare({"model_id": "model"})
        handle = adapter.load(prepared)
        result = adapter.invoke(handle, RuntimeRequest("text.chat", {"prompt": "hello"}, request_id="r1"))
        self.assertEqual(result.value, {"echo": {"prompt": "hello"}})
        self.assertEqual(adapter.health(handle), HealthState(True, True, "Loaded"))
        self.assertFalse(adapter.cancel(handle, "r1"))
        adapter.unload(handle)
        self.assertFalse(adapter.health().loaded)
        self.assertEqual(adapter.calls, ["probe", "supports", "prepare", "load", "invoke",
                                        "health", "cancel", "unload", "health"])

    def test_fake_adapter_reports_incompatibility_and_stale_handles(self):
        adapter = FakeRuntimeAdapter(compatible=False)
        self.assertEqual(adapter.supports({}), CompatibilityResult(False, ("not compatible",), frozenset()))
        with self.assertRaises(RuntimeFailure) as raised:
            adapter.prepare({})
        self.assertEqual(raised.exception.code, RuntimeErrorCode.INCOMPATIBLE)
        adapter.compatible = True
        handle = adapter.load(adapter.prepare({}))
        adapter.unload(handle)
        with self.assertRaises(RuntimeFailure) as raised:
            adapter.invoke(handle, RuntimeRequest("text.generate", {"prompt": "x"}))
        self.assertEqual(raised.exception.code, RuntimeErrorCode.NOT_LOADED)
        replacement = adapter.load(adapter.prepare({}))
        self.assertNotEqual(handle, replacement)
        with self.assertRaises(RuntimeFailure) as raised:
            adapter.health(handle)
        self.assertEqual(raised.exception.code, RuntimeErrorCode.NOT_LOADED)

    def test_llama_and_vllm_adapters_share_boundary_over_fake_engines(self):
        for adapter_type, kind in ((LlamaCppRuntimeAdapter, "llama.cpp"),
                                    (VLLMRuntimeAdapter, "vllm")):
            engine = FakeEngine()
            adapter = adapter_type(engine)
            self.assertIsInstance(adapter, RuntimeAdapter)
            descriptor = adapter.probe()
            self.assertEqual(descriptor.kind, kind)
            self.assertIn("text.chat", descriptor.features)
            prepared = adapter.prepare({"model": "model.gguf"},
                                       {"placement": {"device": "0"}, "load_options": {"context_size": 128}})
            handle = adapter.load(prepared)
            output = adapter.invoke(handle, RuntimeRequest("text.generate", {"prompt": "hello"}))
            self.assertEqual(output.value, "answer")
            self.assertFalse(adapter.cancel(handle, "request"))
            self.assertTrue(adapter.health(handle).loaded)
            adapter.unload(handle)
            self.assertEqual(engine.calls[0], "capabilities")
            self.assertIn("validate_load", engine.calls)
            self.assertEqual(engine.calls[-1], "unload")

    def test_double_load_is_rejected_without_losing_the_active_handle(self):
        engine = FakeEngine()
        engine.max_concurrent = True
        adapter = LlamaCppRuntimeAdapter(engine)
        self.assertNotIn("requests.concurrent", adapter.probe().features)
        prepared = adapter.prepare({"model": "model.gguf"})
        handle = adapter.load(prepared)
        with self.assertRaisesRegex(RuntimeFailure, "already loaded") as raised:
            adapter.load(prepared)
        self.assertEqual(raised.exception.code, RuntimeErrorCode.INVALID_REQUEST)
        self.assertTrue(adapter.health(handle).loaded)
        self.assertEqual(engine.calls.count("load"), 1)
        adapter.unload(handle)

        fake = FakeRuntimeAdapter()
        fake_handle = fake.load(fake.prepare({}))
        with self.assertRaisesRegex(RuntimeFailure, "already loaded"):
            fake.load(fake.prepare({}))
        self.assertTrue(fake.health(fake_handle).loaded)

    def test_global_cancel_is_scoped_to_one_serialized_active_request(self):
        engine = FakeEngine()
        entered_generate = Event()
        release_generate = Event()

        def blocking_generate(prompt, options=None):
            engine.calls.append("generate")
            entered_generate.set()
            if not release_generate.wait(timeout=2):
                raise RuntimeError("test generation timed out")
            return "answer"

        engine.generate = blocking_generate
        adapter = VLLMRuntimeAdapter(engine)
        handle = adapter.load(adapter.prepare({"model": "model.gguf"}))
        failures = []

        def invoke():
            try:
                adapter.invoke(handle, RuntimeRequest("text.chat", {"prompt": "hello"}, request_id="req-1"))
            except Exception as exc:  # surfaced to the test thread below
                failures.append(exc)

        worker = Thread(target=invoke)
        worker.start()
        try:
            self.assertTrue(entered_generate.wait(timeout=1))
            self.assertFalse(adapter.cancel(handle, "req-other"))
            self.assertNotIn("cancel_generation", engine.calls)
            self.assertTrue(adapter.cancel(handle, "req-1"))
            self.assertEqual(engine.calls.count("cancel_generation"), 1)
        finally:
            release_generate.set()
            worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(failures, [])
        self.assertFalse(adapter.cancel(handle, "req-1"))
        adapter.unload(handle)

    def test_backend_adapter_normalizes_invalid_request_and_unavailable_runtime(self):
        adapter = LlamaCppRuntimeAdapter(FakeEngine(available=False))
        with self.assertRaises(RuntimeFailure) as raised:
            adapter.prepare({"model": "x"})
        self.assertEqual(raised.exception.code, RuntimeErrorCode.UNAVAILABLE)

        adapter = VLLMRuntimeAdapter(FakeEngine())
        handle = adapter.load(adapter.prepare({"model": "x"}))
        with self.assertRaises(RuntimeFailure) as raised:
            adapter.invoke(handle, RuntimeRequest("audio.transcribe", {"prompt": "x"}))
        self.assertEqual(raised.exception.code, RuntimeErrorCode.INVALID_REQUEST)
        with self.assertRaises(RuntimeFailure) as raised:
            adapter.invoke(handle, RuntimeRequest("text.chat", {"prompt": " "}))
        self.assertEqual(raised.exception.code, RuntimeErrorCode.INVALID_REQUEST)


class FakeEngine:
    name = "fake-engine"

    def __init__(self, available=True):
        self.available = available
        self.calls = []
        self.loaded = False

    def capabilities(self):
        self.calls.append("capabilities")
        return SimpleNamespace(available=self.available, details="missing" if not self.available else "",
                               chat_completions=True, reasoning=False, continuous_batching=False,
                               device_selection=True, tensor_split=True, context_size=True,
                               max_concurrent=getattr(self, "max_concurrent", False))

    def can_load(self, model):
        self.calls.append("can_load")
        return model == "model.gguf" or model == "x"

    def validate_load(self, model, placement=None, options=None):
        self.calls.append("validate_load")
        if not self.available:
            raise RuntimeError("missing")

    def load(self, model, placement=None, options=None):
        self.calls.append("load")
        self.loaded = True

    def generate(self, prompt, options=None):
        self.calls.append("generate")
        return "answer"

    def cancel_generation(self):
        self.calls.append("cancel_generation")

    def status(self):
        self.calls.append("status")
        return {"loaded": self.loaded}

    def unload(self):
        self.calls.append("unload")
        self.loaded = False


if __name__ == "__main__":
    unittest.main()
