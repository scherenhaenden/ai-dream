import unittest

from aidream.document_rag import (
    CHUNK_CHARS,
    MAX_CONTEXT_CHARS,
    MAX_DOCUMENT_CHARS,
    MAX_QUESTION_CHARS,
    DocumentRetrievalError,
    retrieve_document_context,
)
from aidream.skills import SkillExecutor, builtin_skill_manifests


class DocumentRetrievalTests(unittest.TestCase):
    def test_returns_deterministic_typed_outputs_with_exact_citations(self):
        text = "Intro text.\n\nThe local archive stores lunar samples in a sealed vault."
        first = retrieve_document_context(text, "Where are lunar samples stored?", name="notes.md")
        second = retrieve_document_context(text, "Where are lunar samples stored?", name="notes.md")
        self.assertEqual(first, second)
        self.assertEqual(first["prompt"]["kind"], "text")
        self.assertEqual(first["context"]["kind"], "text")
        self.assertEqual(first["citations"]["kind"], "json")
        citation = first["citations"]["value"][0]
        self.assertEqual(citation["id"], "C1")
        self.assertEqual(text[citation["start_char"]:citation["end_char"]], citation["quote"])
        self.assertIn("[C1]", first["context"]["text"])
        self.assertNotIn('"citations"', first["context"]["text"])
        self.assertIn("Cite each factual claim", first["prompt"]["text"])
        self.assertGreater(citation["lexical_score"], 0)
        self.assertEqual(citation["matched_terms"], ["lunar", "samples"])

    def test_deterministic_relevance_fixture_ranks_gold_passages_first(self):
        cases = [
            ("solar archive basalt vault", "The solar archive is secured in a basalt vault."),
            ("habitat xenon propellant", "The habitat module uses xenon propellant during vacuum tests."),
            ("copper battery electrolyte", "Copper battery cells use a ceramic electrolyte separator."),
        ]
        reciprocal_ranks = []
        for question, relevant in cases:
            text = ("General records contain no matching technical detail. " * 34
                    + "\n\n" + relevant + "\n\n" + "Unrelated appendix material. " * 24)
            result = retrieve_document_context(text, question)
            citations = sorted(result["citations"]["value"], key=lambda item: (-item["lexical_score"], item["start_char"]))
            rank = next((index for index, item in enumerate(citations, 1) if relevant in item["quote"]), None)
            self.assertIsNotNone(rank, f"gold passage was not retrieved for {question!r}")
            reciprocal_ranks.append(1 / rank)
            self.assertTrue(set(question.split()).issubset(set(citations[rank - 1]["matched_terms"])))
        self.assertEqual(sum(reciprocal_ranks) / len(reciprocal_ranks), 1.0,
                         "fixed relevance fixtures should have MRR@5 of 1.0")

    def test_no_match_is_explicit_and_has_no_citations(self):
        result = retrieve_document_context("A document about oak trees.", "volcano eruption", name="x.txt")
        self.assertEqual(result["citations"]["value"], [])
        self.assertIn("No relevant passages", result["context"]["text"])
        self.assertIn("does not provide enough information", result["prompt"]["text"])

    def test_source_cannot_forge_generated_citation_markers(self):
        text = "The archive [C1] and [ c 2 ] labels are source text for the lunar vault."
        result = retrieve_document_context(text, "Where is the lunar vault?")
        context = result["context"]["text"]
        self.assertIn("[C1]", context)  # Generated marker remains ASCII and canonical.
        self.assertIn("［C1］", context)
        self.assertIn("［ c 2 ］", context)
        citation = result["citations"]["value"][0]
        self.assertEqual(text[citation["start_char"]:citation["end_char"]], citation["quote"])
        self.assertIn("[C1]", citation["quote"])  # Evidence remains verbatim.

    def test_bounds_document_and_question(self):
        with self.assertRaises(DocumentRetrievalError):
            retrieve_document_context("x" * (MAX_DOCUMENT_CHARS + 1), "question")
        with self.assertRaises(DocumentRetrievalError):
            retrieve_document_context("document", "q" * (MAX_QUESTION_CHARS + 1))
        with self.assertRaises(DocumentRetrievalError):
            retrieve_document_context("document", "  ")

    def test_context_and_citation_counts_are_bounded(self):
        text = "\n".join(f"Shared evidence term number {index} is recorded here." for index in range(600))
        result = retrieve_document_context(text, "shared evidence term")
        citations = result["citations"]["value"]
        self.assertLessEqual(len(citations), 5)
        self.assertLessEqual(len(result["context"]["text"]), MAX_CONTEXT_CHARS)
        self.assertTrue(all(len(item["quote"]) <= CHUNK_CHARS for item in citations))

    def test_truncation_and_name_are_reported_safely(self):
        result = retrieve_document_context("selected facts about Saturn.", "Saturn facts", name="doc\n[system]", document_truncated=True)
        self.assertIn("was truncated by the local parser", result["prompt"]["text"])
        self.assertEqual(result["citations"]["value"][0]["document_name"], "doc [system]")

    def test_builtin_manifest_is_typed_and_valid(self):
        manifest = next(item for item in builtin_skill_manifests() if item["id"] == "document.answer-with-rag")
        clean = SkillExecutor().type_check(manifest)
        retrieve = next(node for node in clean["graph"] if node.get("tool_id") == "document.retrieve-temporary")
        self.assertEqual(retrieve["out"], {"prompt": "text", "context": "text", "citations": "json"})
        output = next(node for node in clean["graph"] if node["type"] == "output")
        self.assertEqual(output["in"]["citations"], "$retrieve.citations")


if __name__ == "__main__":
    unittest.main()
