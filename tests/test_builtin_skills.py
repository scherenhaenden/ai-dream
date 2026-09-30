import unittest

from aidream.skills import SkillExecutionError, SkillExecutor, SkillRegistry, builtin_skill_manifests


class BuiltinSkillTests(unittest.TestCase):
    def test_all_builtins_validate_and_are_discoverable(self):
        manifests = builtin_skill_manifests()
        self.assertEqual(
            {"chat.general", "image.describe", "image.generate", "image.edit-from-instruction", "document.summarize", "document.answer-with-rag", "document.extract-text", "voice.transcribe", "voice.conversation", "voice.respond", "document.create-html", "document.create-pdf", "document.create-report", "document.create-report-pdf"},
            {manifest["id"] for manifest in manifests},
        )
        registry = SkillRegistry(manifests)
        self.assertEqual(14, len(registry.snapshot()))
        self.assertEqual((), registry.invalid_skills())
        self.assertEqual("Audio", registry.get("voice.conversation")["ui"]["category"])
        self.assertEqual(["text.chat", "audio.synthesize"],
                         registry.get("voice.respond")["requirements"]["capabilities"])
        self.assertIn("user-reviewed", registry.get("voice.respond")["description"])
        by_id = {item["id"]: item for item in manifests}
        self.assertEqual(["vision.understand"], by_id["image.describe"]["requirements"]["capabilities"])
        self.assertEqual(["image.generate"], by_id["image.generate"]["requirements"]["capabilities"])
        self.assertEqual(["image.edit"], by_id["image.edit-from-instruction"]["requirements"]["capabilities"])
        self.assertEqual(["text.chat"],
                         by_id["document.summarize"]["requirements"]["capabilities"])

    def test_builtins_are_detached_and_do_not_claim_live_route_support(self):
        manifests = builtin_skill_manifests()
        manifests[0]["ui"]["category"] = "mutated"
        self.assertEqual("Chat", builtin_skill_manifests()[0]["ui"]["category"])
        self.assertTrue(all("requirements" in item and item["graph"] for item in builtin_skill_manifests()))

    def test_builtins_need_real_registered_callbacks_to_execute(self):
        registry = SkillRegistry(builtin_skill_manifests())
        skill = registry.get("chat.general")
        with self.assertRaisesRegex(SkillExecutionError, "no registered capability executor"):
            SkillExecutor().execute(skill, {"prompt": {"kind": "text", "value": "hello"}})

    def test_fakes_execute_each_builtin_graph_without_model_or_runtime(self):
        manifests = builtin_skill_manifests()
        registry = SkillRegistry(manifests)
        called = []

        def fake_for(capability):
            def execute(node, inputs):
                called.append(capability)
                return {
                    port: {"kind": kind, "value": f"fake:{capability}:{port}"}
                    for port, kind in node["out"].items()
                }
            return execute

        capabilities = {
            capability: fake_for(capability)
            for manifest in manifests
            for capability in manifest["requirements"]["capabilities"]
        }
        tools = {
            "document.summarize-prompt": fake_for("document.summarize-prompt"),
            "document.extract-text": fake_for("document.extract-text"),
            "document.render-html": fake_for("document.render-html"),
            "document.render-pdf": fake_for("document.render-pdf"),
            "document.render-report": fake_for("document.render-report"),
            "document.render-report-pdf": fake_for("document.render-report-pdf"),
            "document.retrieve-temporary": fake_for("document.retrieve-temporary"),
            "audio.transcribe": fake_for("audio.transcribe"),
            "audio.synthesize": fake_for("audio.synthesize"),
        }
        executor = SkillExecutor(capabilities=capabilities, tools=tools)
        cases = {
            "chat.general": {"prompt": {"kind": "text", "value": "hello"}},
            "image.describe": {"image": {"kind": "image", "value": "opaque-image-ref"}},
            "image.generate": {"prompt": {"kind": "text", "value": "a small landscape"}},
            "image.edit-from-instruction": {
                "image": {"kind": "image", "value": "opaque-image-ref"},
                "instruction": {"kind": "text", "value": "make it brighter"},
            },
            "document.summarize": {"document": {"kind": "document", "value": "opaque-doc-ref"}},
            "document.extract-text": {"document": {"kind": "document", "value": "opaque-doc-ref"}},
            "voice.transcribe": {"audio": {"kind": "audio", "value": "opaque-audio-ref"}},
            "voice.conversation": {"audio": {"kind": "audio", "value": "opaque-audio-ref"}},
            "voice.respond": {"transcript": {"kind": "text", "value": "reviewed fixture transcript"}},
            "document.create-html": {"text": {"kind": "text", "value": "A report"}},
            "document.create-pdf": {"text": {"kind": "text", "value": "A report"}},
            "document.create-report": {"report": {"kind": "json", "value": {"title": "A report", "sections": [{"heading": "Summary", "body": "Done."}]}}},
            "document.create-report-pdf": {"report": {"kind": "json", "value": {"title": "A report", "sections": [{"heading": "Summary", "body": "Done."}]}}},
            "document.answer-with-rag": {
                "document": {"kind": "document", "value": "opaque-doc-ref"},
                "question": {"kind": "text", "value": "What happened?"},
            },
        }
        for skill_id, inputs in cases.items():
            with self.subTest(skill=skill_id):
                output = executor.execute(registry.get(skill_id), inputs)
                self.assertTrue(output)
                self.assertTrue(all(value["kind"] in {"text", "image", "audio", "document", "json"} for value in output.values()))
        self.assertEqual(19, len(called))


if __name__ == "__main__":
    unittest.main()
