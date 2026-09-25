from dataclasses import dataclass
import unittest

from aidream.agent_tools import AgentToolRegistry
from aidream.models import ModelRecord


class FakeHardware:
    def detect(self):
        return {"cpu": "local"}


class FakeModels:
    def __init__(self):
        self.records = [ModelRecord("abc123", "/models/demo.gguf", 42)]

    def list_models(self):
        return list(self.records)


@dataclass
class FakeStatus:
    installed: bool = True


class FakeManager:
    def status(self):
        return FakeStatus()


class FakeBackend:
    name = "fixture"

    def capabilities(self):
        return {"available": True}


class FakeRuntime:
    def list_backends(self):
        return [FakeBackend()]


class AgentToolRegistryTests(unittest.TestCase):
    def setUp(self):
        self.tools = AgentToolRegistry(hardware=FakeHardware(), models=FakeModels(),
                                       runtime=FakeRuntime(), runtime_manager=FakeManager())

    def test_only_fixed_read_only_tools_are_registered(self):
        specs = self.tools.list_tools()
        self.assertEqual({spec.name for spec in specs}, {
            "hardware.status", "models.list", "models.info", "runtime.status"
        })
        self.assertTrue(all(spec.read_only for spec in specs))
        self.assertEqual(self.tools.invoke("hardware.status"), {"cpu": "local"})

    def test_local_catalog_queries(self):
        self.assertEqual([item.id for item in self.tools.invoke("models.list")], ["abc123"])
        self.assertEqual(self.tools.invoke("models.info", {"model_id": "abc123"}).path,
                         "/models/demo.gguf")
        self.assertEqual(self.tools.invoke("runtime.status")["backends"][0]["name"], "fixture")

    def test_unknown_or_mutating_calls_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown agent tool"):
            self.tools.invoke("shell.exec", {"command": "touch /tmp/no"})
        with self.assertRaisesRegex(ValueError, "Unsupported argument"):
            self.tools.invoke("hardware.status", {"write": True})
        with self.assertRaisesRegex(ValueError, "not present"):
            self.tools.invoke("models.info", {"model_id": "not-local"})

    def test_tool_arguments_are_validated(self):
        with self.assertRaisesRegex(ValueError, "Missing argument"):
            self.tools.invoke("models.info")
        with self.assertRaisesRegex(ValueError, "non-empty string"):
            self.tools.invoke("models.info", {"model_id": " "})


if __name__ == "__main__":
    unittest.main()
