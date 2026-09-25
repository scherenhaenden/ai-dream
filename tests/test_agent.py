import json
import time
import unittest

from aidream.agent import LocalAgent
from aidream.agent_tools import AgentToolRegistry
from aidream.models import ModelRecord
from aidream.runtime import ToolCallsUnsupported


class FakeHardware:
    def detect(self):
        return {"gpu": "local"}


class FakeModels:
    def list_models(self):
        return [ModelRecord("m1", "/models/one.gguf", 12)]


class FakeRuntimeManager:
    def status(self):
        return {"installed": True}


class FakeRuntime:
    def list_backends(self):
        return []


def make_registry():
    return AgentToolRegistry(hardware=FakeHardware(), models=FakeModels(),
                             runtime=FakeRuntime(), runtime_manager=FakeRuntimeManager())


def function_call(name, arguments="{}", call_id="call-1"):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}


class FakeToolBackend:
    def __init__(self, messages):
        self.messages = iter(messages)
        self.requests = []

    def chat_with_tools(self, messages, tools, timeout):
        self.requests.append((messages, tools, timeout))
        return next(self.messages)


class LocalAgentTests(unittest.TestCase):
    def test_executes_allow_listed_read_and_returns_follow_up_answer(self):
        backend = FakeToolBackend([
            {"role": "assistant", "content": None,
             "tool_calls": [function_call("hardware_status")]},
            {"role": "assistant", "content": "Tu GPU es local."},
        ])
        result = LocalAgent(backend, make_registry()).run("¿Qué GPU tengo?")
        self.assertEqual(result.text, "Tu GPU es local.")
        self.assertEqual(result.tools_called, ("hardware.status",))
        self.assertEqual(result.tool_call_count, 1)
        self.assertTrue(result.tool_calls_supported)
        tool_message = backend.requests[1][0][-1]
        self.assertEqual(tool_message["role"], "tool")
        self.assertEqual(json.loads(tool_message["content"]), {"gpu": "local"})
        self.assertLessEqual(backend.requests[0][2], 45.0)

    def test_rejects_unknown_function_without_invoking_it(self):
        backend = FakeToolBackend([
            {"role": "assistant", "content": "", "tool_calls": [function_call("shell_exec", '{"command":"id"}') ]},
            {"role": "assistant", "content": "No puedo ejecutar comandos."},
        ])
        result = LocalAgent(backend, make_registry()).run("Ejecuta id")
        self.assertEqual(result.tools_called, ("shell_exec",))
        self.assertEqual(json.loads(backend.requests[1][0][-1]["content"]),
                         {"error": "Rejected unregistered tool: shell_exec"})

    def test_stops_before_exceeding_tool_call_limit(self):
        backend = FakeToolBackend([
            {"role": "assistant", "content": "", "tool_calls": [
                function_call("hardware_status", call_id="a"),
                function_call("runtime_status", call_id="b"),
            ]},
        ])
        result = LocalAgent(backend, make_registry(), max_tool_calls=1).run("status")
        self.assertEqual(result.tool_call_count, 0)
        self.assertEqual(result.stop_reason, "tool_call_limit")

    def test_gracefully_degrades_when_backend_has_no_tool_api(self):
        class PlainBackend:
            def generate(self, prompt):
                raise AssertionError("must not attempt tools or unbounded fallback generation")

        result = LocalAgent(PlainBackend(), make_registry()).run("status")
        self.assertFalse(result.tool_calls_supported)
        self.assertEqual(result.stop_reason, "tool_calls_unsupported")
        self.assertIn("ordinary chat", result.text.lower())

    def test_gracefully_degrades_when_server_rejects_tools(self):
        class UnsupportedBackend:
            def chat_with_tools(self, messages, tools, timeout):
                raise ToolCallsUnsupported("old server")

        result = LocalAgent(UnsupportedBackend(), make_registry()).run("status")
        self.assertFalse(result.tool_calls_supported)
        self.assertEqual(result.stop_reason, "tool_calls_unsupported")

    def test_bounds_and_prompt_validation(self):
        with self.assertRaises(ValueError):
            LocalAgent(object(), max_tool_calls=13)
        with self.assertRaises(ValueError):
            LocalAgent(object(), max_seconds=121)
        with self.assertRaises(ValueError):
            LocalAgent(object()).run("  ")

    def test_enforces_wall_clock_limit_around_slow_read_only_tools(self):
        class SlowRegistry:
            def list_tools(self):
                return make_registry().list_tools()

            def invoke(self, name, args):
                time.sleep(0.4)
                return {"finished": True}

        backend = FakeToolBackend([
            {"role": "assistant", "content": "", "tool_calls": [function_call("hardware_status")]},
        ])
        started = time.monotonic()
        result = LocalAgent(backend, SlowRegistry(), max_seconds=0.2).run("status")
        self.assertLess(time.monotonic() - started, 0.35)
        self.assertEqual(result.stop_reason, "time_limit")

    def test_caps_oversized_model_output(self):
        backend = FakeToolBackend([{"role": "assistant", "content": "x" * 500}])
        result = LocalAgent(backend, make_registry(), max_output_chars=128).run("status")
        self.assertEqual(result.stop_reason, "output_limit")
        self.assertLessEqual(len(result.text), 128)


if __name__ == "__main__":
    unittest.main()
