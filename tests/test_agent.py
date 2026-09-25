import json
import time
import unittest

from aidream.agent import AgentResult, LocalAgent, ToolCallSummary
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
        self.assertEqual(result.tool_summaries[0].status, "success")
        self.assertEqual(result.tool_summaries[0].name, "hardware.status")
        self.assertIn('"gpu":"local"', result.tool_summaries[0].result_snippet)
        self.assertEqual(result.summary()["tools"][0]["status"], "success")
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
        self.assertEqual(result.tools_called, ("unregistered",))
        self.assertEqual(result.tool_summaries[0].status, "rejected")
        self.assertEqual(json.loads(backend.requests[1][0][-1]["content"]),
                         {"error": "Rejected unregistered tool: shell_exec"})

    def test_summary_redacts_secret_fields_and_only_keeps_a_short_snippet(self):
        class SensitiveRegistry:
            def list_tools(self):
                return make_registry().list_tools()

            def invoke(self, name, args):
                return {"access_token": "should-not-appear", "details": "x" * 800}

        backend = FakeToolBackend([
            {"role": "assistant", "content": "", "tool_calls": [function_call("hardware_status")]},
            {"role": "assistant", "content": "Done."},
        ])
        result = LocalAgent(backend, SensitiveRegistry()).run("status")
        summary = result.summary()
        serialized = json.dumps(summary)
        self.assertNotIn("should-not-appear", serialized)
        self.assertIn("[redacted]", serialized)
        self.assertLessEqual(len(result.tool_summaries[0].result_snippet), 240)
        self.assertNotIn("access_token", summary["tools"][0]["result_snippet"])

    def test_summary_distinguishes_timed_out_tool(self):
        class TimeoutRegistry:
            def list_tools(self):
                return make_registry().list_tools()

            def invoke(self, name, args):
                raise TimeoutError("private timeout detail")

        backend = FakeToolBackend([
            {"role": "assistant", "content": "", "tool_calls": [function_call("hardware_status")]},
            {"role": "assistant", "content": "It timed out."},
        ])
        result = LocalAgent(backend, TimeoutRegistry()).run("status")
        self.assertEqual(result.tool_summaries[0].status, "timed_out")
        self.assertNotIn("private timeout detail", result.summary()["tools"][0]["result_snippet"])

    def test_summary_api_clamps_external_records_to_documented_limits(self):
        result = AgentResult(
            "x" * 70_000,
            (),
            99,
            500,
            "r" * 100,
            True,
            tuple(ToolCallSummary("n" * 100, "s" * 40, "z" * 300) for _ in range(20)),
        ).summary()
        self.assertEqual(len(result["text"]), 64_000)
        self.assertEqual(result["tool_call_count"], 12)
        self.assertEqual(len(result["tools"]), 12)
        self.assertEqual(len(result["tools"][0]["name"]), 80)
        self.assertEqual(len(result["tools"][0]["result_snippet"]), 240)
        self.assertEqual(result["elapsed_seconds"], 120.0)

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

    def test_includes_bounded_saved_chat_history(self):
        backend = FakeToolBackend([{"role": "assistant", "content": "Follow-up answer."}])
        LocalAgent(backend, make_registry()).run(
            "And the runtime?", history=[
                {"role": "user", "content": "Show my GPU."},
                {"role": "assistant", "content": "You have two GPUs."},
            ])
        messages = backend.requests[0][0]
        self.assertEqual([item["role"] for item in messages], ["system", "user", "assistant", "user"])
        self.assertEqual(messages[1]["content"], "Show my GPU.")

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
