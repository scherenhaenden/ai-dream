import unittest

from aidream.document_render import render_html, render_pdf, render_pdf_report, render_report, suggested_filename


class DocumentRenderTests(unittest.TestCase):
    def test_html_escapes_untrusted_text_and_has_a_document_shell(self):
        html = render_html("Release <notes>", "<script>alert(1)</script>\n\nsecond paragraph")
        decoded = html.decode("utf-8")
        self.assertIn("<!doctype html>", decoded)
        self.assertIn("Release &lt;notes&gt;", decoded)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", decoded)
        self.assertNotIn("<script>", decoded)

    def test_report_requires_bounded_typed_sections_and_escapes_markup(self):
        report = render_report({
            "title": "Quarterly report",
            "summary": "Short summary",
            "sections": [{"heading": "Risks", "body": "<untrusted> input"}],
        }).decode("utf-8")
        self.assertIn("<h2>Risks</h2>", report)
        self.assertIn("&lt;untrusted&gt; input", report)
        for invalid in (
            {"title": "bad", "sections": []},
            {"title": "bad", "sections": [{"heading": "missing body"}]},
            {"title": "bad", "extra": "not accepted", "sections": [{"heading": "h", "body": "b"}]},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                render_report(invalid)

    def test_report_enforces_total_text_budget(self):
        body = "x" * 140_000
        with self.assertRaisesRegex(ValueError, "in total"):
            render_report({"title": "Report", "sections": [
                {"heading": "One", "body": body},
                {"heading": "Two", "body": body},
            ]})

    def test_report_renders_explicit_bullet_and_table_sections_safely(self):
        report = render_report({
            "title": "Project status",
            "summary": "Two sections",
            "sections": [
                {"heading": "Risks", "kind": "bullets", "items": ["<script>no</script>", "Ship Friday"]},
                {"heading": "Milestones", "kind": "table", "columns": ["Name", "State"],
                 "rows": [["Alpha", "<ready>"], ["Beta", "pending"]]},
            ],
        }).decode("utf-8")
        self.assertIn("<ul><li>&lt;script&gt;no&lt;/script&gt;</li><li>Ship Friday</li></ul>", report)
        self.assertIn("<th scope=\"col\">Name</th><th scope=\"col\">State</th>", report)
        self.assertIn("<td>&lt;ready&gt;</td>", report)
        self.assertNotIn("<script>", report)

    def test_report_rejects_undeclared_or_unbounded_section_shapes(self):
        invalid_sections = (
            {"heading": "Unknown", "kind": "html", "body": "<script/>"},
            {"heading": "Bad table", "kind": "table", "columns": ["A", "B"], "rows": [["one"]]},
            {"heading": "Too many", "kind": "bullets", "items": ["x"] * 101},
            {"heading": "Too wide", "kind": "table", "columns": [f"c{i}" for i in range(13)],
             "rows": [["x"] * 13]},
            {"heading": "Too tall", "kind": "table", "columns": ["A"],
             "rows": [["x"] for _ in range(101)]},
            {"heading": "Cell limit", "kind": "table", "columns": ["A"],
             "rows": [["x" * 8_001]]},
            {"heading": "Extra", "kind": "bullets", "items": ["x"], "html": "<b>unsafe</b>"},
        )
        for section in invalid_sections:
            with self.subTest(section=section), self.assertRaises(ValueError):
                render_report({"title": "Report", "sections": [section]})

    def test_report_output_is_deterministic(self):
        report = {"title": "Stable report", "sections": [
            {"heading": "Items", "kind": "bullets", "items": ["one", "two"]},
        ]}
        self.assertEqual(render_report(report), render_report(report))

    def test_pdf_has_valid_header_xref_and_multiple_pages(self):
        data = render_pdf("Long report", "Useful sentence. " * 300)
        self.assertTrue(data.startswith(b"%PDF-1.4\n"))
        self.assertIn(b"/Type /Pages /Count 2", data)
        self.assertIn(b"xref\n0 ", data)
        start = int(data.rsplit(b"startxref\n", 1)[1].splitlines()[0])
        self.assertEqual(data[start:start + 5], b"xref\n")
        self.assertTrue(data.endswith(b"%%EOF\n"))

    def test_structured_report_renders_to_paginated_pdf_with_escaped_text(self):
        data = render_pdf_report({
            "title": "Quarterly <report>",
            "summary": "A <summary> with (parens) and \\slashes.",
            "sections": [
                {"heading": "Results", "kind": "text", "body": "Ready <today>."},
                {"heading": "Actions", "kind": "bullets", "items": ["<script>hidden</script>", "Ship Friday"]},
                {"heading": "Checks", "kind": "table", "columns": ["Check", "State"],
                 "rows": [["Tests", "Passed"], ["Review", "Complete"]]},
            ],
        })
        self.assertTrue(data.startswith(b"%PDF-1.4\n"))
        self.assertIn(b"Quarterly <report>", data)
        self.assertIn(b"Ready <today>.", data)
        self.assertIn(b"- <script>hidden</script>", data)
        self.assertIn(b"Check | State", data)
        self.assertIn(b"Review | Complete", data)
        self.assertIn(b"(A <summary> with \\(parens\\) and \\\\slashes.) Tj", data)

    def test_structured_pdf_reuses_shape_and_size_limits(self):
        with self.assertRaisesRegex(ValueError, "sections must contain"):
            render_pdf_report({"title": "Empty", "sections": []})
        with self.assertRaisesRegex(ValueError, "exceeds"):
            render_pdf_report({"title": "Large", "summary": "x" * 256_000,
                               "sections": [{"heading": "One", "body": "b"}]})
        long_text = "word " * 250
        data = render_pdf_report({"title": "Pages", "sections": [
            {"heading": "Long text", "body": long_text * 40},
        ]})
        page_count = int(data.split(b"/Type /Pages /Count ", 1)[1].split(b" ", 1)[0])
        self.assertGreater(page_count, 1)

    def test_filename_is_a_bounded_leaf_with_supported_extension(self):
        self.assertEqual(suggested_filename("An Example / Report", "pdf"), "An-Example-Report.pdf")
        with self.assertRaises(ValueError):
            suggested_filename("Report", "exe")


if __name__ == "__main__":
    unittest.main()
