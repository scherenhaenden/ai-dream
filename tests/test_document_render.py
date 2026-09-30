import unittest

from aidream.document_render import render_html, render_pdf, render_report, suggested_filename


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

    def test_pdf_has_valid_header_xref_and_multiple_pages(self):
        data = render_pdf("Long report", "Useful sentence. " * 300)
        self.assertTrue(data.startswith(b"%PDF-1.4\n"))
        self.assertIn(b"/Type /Pages /Count 2", data)
        self.assertIn(b"xref\n0 ", data)
        start = int(data.rsplit(b"startxref\n", 1)[1].splitlines()[0])
        self.assertEqual(data[start:start + 5], b"xref\n")
        self.assertTrue(data.endswith(b"%%EOF\n"))

    def test_filename_is_a_bounded_leaf_with_supported_extension(self):
        self.assertEqual(suggested_filename("An Example / Report", "pdf"), "An-Example-Report.pdf")
        with self.assertRaises(ValueError):
            suggested_filename("Report", "exe")


if __name__ == "__main__":
    unittest.main()
