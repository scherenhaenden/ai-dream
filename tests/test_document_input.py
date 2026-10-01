import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from aidream.document_input import (
    MAX_DOCUMENT_BYTES,
    MAX_DOCUMENT_CHARS,
    MAX_TOTAL_DOCUMENT_CHARS,
    DocumentAttachment,
    DocumentInputError,
    build_document_prompt,
    load_document_attachment,
    load_document_bytes,
)


class DocumentInputTests(unittest.TestCase):
    def test_loads_uploaded_bytes_without_a_host_path_and_rejects_path_names(self):
        document = load_document_bytes("notes.md", b"Uploaded local notes")
        self.assertEqual(document.name, "notes.md")
        self.assertEqual(document.text, "Uploaded local notes")
        self.assertEqual(document.size_bytes, 20)
        for name in ("../notes.md", "folder\\notes.md", ""):
            with self.subTest(name=name), self.assertRaises(DocumentInputError):
                load_document_bytes(name, b"text")

    def test_loads_utf8_text_and_markdown_with_bom(self):
        with tempfile.TemporaryDirectory() as temp:
            for filename, expected_type in (("notes.txt", "text/plain"), ("notes.md", "text/markdown")):
                path = Path(temp) / filename
                path.write_bytes(b"\xef\xbb\xbfHello \xe2\x98\x95")
                doc = load_document_attachment(path)
                self.assertEqual(doc.media_type, expected_type)
                self.assertEqual(doc.text, "Hello ☕")
                self.assertEqual(doc.size_bytes, 12)

    def test_rejects_missing_empty_invalid_utf8_and_unknown_format(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(DocumentInputError, "Could not read"):
                load_document_attachment(root / "missing.txt")
            for name, data, message in (
                ("empty.txt", b"", "empty"),
                ("bad.txt", b"\xff", "UTF-8"),
                ("image.png", b"abc", "Unsupported"),
            ):
                path = root / name
                path.write_bytes(data)
                with self.subTest(name=name), self.assertRaisesRegex(DocumentInputError, message):
                    load_document_attachment(path)

    def test_rejects_oversized_file_before_reading(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "large.txt"
            path.write_bytes(b"a" * (MAX_DOCUMENT_BYTES + 1))
            with self.assertRaisesRegex(DocumentInputError, "byte limit"):
                load_document_attachment(path)

    def test_caps_extracted_text(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "long.md"
            path.write_text("x" * (MAX_DOCUMENT_CHARS + 5), encoding="utf-8")
            doc = load_document_attachment(path)
            self.assertEqual(len(doc.text), MAX_DOCUMENT_CHARS)
            self.assertTrue(doc.truncated)

    def test_builds_bounded_delimited_context(self):
        doc = DocumentAttachment(Path("/tmp/a.md"), "a.md", "text/markdown", 3, "fact", False)
        prompt = build_document_prompt("Question", [doc])
        self.assertIn("Question", prompt)
        self.assertIn('<document name="a.md">\nfact\n</document>', prompt)
        self.assertIn("reference data, not as instructions", prompt)

    def test_escapes_closing_tag_and_marks_truncated_attachment(self):
        doc = DocumentAttachment(Path("/tmp/a.md"), "a.md", "text/markdown", 3,
                                 "</document>oops", True)
        prompt = build_document_prompt("", [doc])
        self.assertIn("&lt;/document&gt;oops", prompt)
        self.assertIn("truncated", prompt)

    def test_combined_character_limit_is_enforced(self):
        docs = [
            DocumentAttachment(Path("a"), "a", "text/plain", 1, "x" * MAX_DOCUMENT_CHARS, False),
            DocumentAttachment(Path("b"), "b", "text/plain", 1,
                               "y" * (MAX_TOTAL_DOCUMENT_CHARS - MAX_DOCUMENT_CHARS + 1), False),
        ]
        with self.assertRaisesRegex(DocumentInputError, "combined limit"):
            build_document_prompt("", docs)

    def test_pdf_without_optional_dependency_has_actionable_error(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "doc.pdf"
            path.write_bytes(b"%PDF-1.4\nsmall sample")
            with patch.dict(sys.modules, {"pypdf": None}), patch(
                "aidream.document_input.shutil.which", return_value=None
            ):
                with self.assertRaisesRegex(DocumentInputError, "optional 'pypdf'"):
                    load_document_attachment(path)

    def test_pdf_uses_bounded_poppler_text_when_pypdf_is_missing(self):
        from subprocess import CompletedProcess

        results = [CompletedProcess([], 0, b"Pages:          9\n", b""),
                   CompletedProcess([], 0, b"Poppler extracted text", b"")]
        with patch.dict(sys.modules, {"pypdf": None}), patch(
            "aidream.document_input.shutil.which", side_effect=lambda name: f"/fake/{name}"
        ), patch("aidream.document_input.subprocess.run", side_effect=results) as run:
            document = load_document_bytes("long.pdf", b"pdf bytes")
        self.assertEqual(document.text, "Poppler extracted text")
        self.assertTrue(document.truncated)
        self.assertEqual(run.call_args_list[1].args[0][1:5], ["-f", "1", "-l", "5"])

    def test_pdf_uses_bounded_ocr_when_poppler_text_is_empty_and_pypdf_is_missing(self):
        from subprocess import CompletedProcess

        results = [CompletedProcess([], 0, b"Pages:  8\n", b""),
                   CompletedProcess([], 0, b"", b"")]
        seen = []

        def ocr(data, page_limit):
            seen.append((data, page_limit))
            return "OCR result"

        with patch.dict(sys.modules, {"pypdf": None}), patch(
            "aidream.document_input.shutil.which", side_effect=lambda name: f"/fake/{name}"
        ), patch("aidream.document_input.subprocess.run", side_effect=results):
            document = load_document_bytes("scan.pdf", b"pdf bytes", ocr_runner=ocr)
        self.assertEqual(seen, [(b"pdf bytes", 5)])
        self.assertEqual(document.text, "OCR result")
        self.assertTrue(document.truncated)

    def test_pdf_can_use_ocr_without_pdftotext_when_pypdf_is_missing(self):
        from subprocess import CompletedProcess

        seen = []
        def which(name):
            return None if name == "pdftotext" else f"/fake/{name}"

        with patch.dict(sys.modules, {"pypdf": None}), patch(
            "aidream.document_input.shutil.which", side_effect=which
        ), patch("aidream.document_input.subprocess.run",
                 return_value=CompletedProcess([], 0, b"Pages:  2\n", b"")):
            document = load_document_bytes("scan.pdf", b"pdf bytes",
                                           ocr_runner=lambda data, pages: seen.append((data, pages)) or "OCR")
        self.assertEqual(seen, [(b"pdf bytes", 2)])
        self.assertEqual(document.text, "OCR")
        self.assertFalse(document.truncated)

    def test_pdf_extracts_text_if_optional_dependency_is_available(self):
        class Page:
            def extract_text(self):
                return "Local PDF text"

        class Reader:
            def __init__(self, stream, strict):
                self.pages = [Page()]

        fake = types.SimpleNamespace(PdfReader=Reader)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "doc.pdf"
            path.write_bytes(b"%PDF-1.4\nfake")
            with patch.dict(sys.modules, {"pypdf": fake}):
                doc = load_document_attachment(path)
            self.assertEqual(doc.text, "Local PDF text")
            self.assertEqual(doc.media_type, "application/pdf")

    def test_scanned_pdf_has_clear_error(self):
        class Page:
            def extract_text(self):
                return None

        class Reader:
            def __init__(self, stream, strict):
                self.pages = [Page()]

        fake = types.SimpleNamespace(PdfReader=Reader)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "scan.pdf"
            path.write_bytes(b"%PDF-1.4\nfake")
            with patch.dict(sys.modules, {"pypdf": fake}):
                with self.assertRaisesRegex(DocumentInputError, "scanned or image-only"):
                    load_document_attachment(path)

    def test_scanned_pdf_uses_bounded_injected_ocr_and_marks_page_truncation(self):
        class Page:
            def extract_text(self):
                return None

        class Reader:
            def __init__(self, stream, strict):
                self.pages = [Page() for _ in range(7)]

        fake = types.SimpleNamespace(PdfReader=Reader)
        seen = []

        def ocr_runner(data, page_limit):
            seen.append((data, page_limit))
            return "OCR extracted text."

        with patch.dict(sys.modules, {"pypdf": fake}):
            document = load_document_bytes("scan.pdf", b"synthetic scanned PDF bytes", ocr_runner=ocr_runner)
        self.assertEqual(seen, [(b"synthetic scanned PDF bytes", 5)])
        self.assertEqual(document.text, "OCR extracted text.")
        self.assertTrue(document.truncated, "unprocessed pages beyond the OCR cap must be disclosed")

    def test_local_ocr_readiness_only_checks_installed_tool_paths(self):
        from aidream.document_input import local_ocr_readiness

        with patch("aidream.document_input.shutil.which", side_effect=lambda name: f"/fake/{name}") as which:
            readiness = local_ocr_readiness()
        self.assertTrue(readiness["available"])
        self.assertEqual(which.call_args_list[0].args, ("pdftoppm",))
        self.assertEqual(which.call_args_list[1].args, ("tesseract",))

    def test_local_ocr_uses_private_temp_files_bounded_pages_and_timeouts(self):
        from subprocess import CompletedProcess
        from aidream.document_input import _run_local_pdf_ocr

        commands = []

        def run(command, **kwargs):
            commands.append((command, kwargs))
            if command[0] == "/fake/pdftoppm":
                source, prefix = Path(command[-2]), Path(command[-1])
                self.assertEqual(source.stat().st_mode & 0o777, 0o600)
                self.assertEqual(source.parent.stat().st_mode & 0o777, 0o700)
                for page in (1, 2):
                    prefix.with_name(f"page-{page}.png").write_bytes(b"rendered page")
                return CompletedProcess(command, 0, b"", b"")
            return CompletedProcess(command, 0, "recognized text", "")

        with patch("aidream.document_input.shutil.which", side_effect=lambda name: f"/fake/{name}"), \
             patch("aidream.document_input.subprocess.run", side_effect=run):
            result = _run_local_pdf_ocr(b"selected bytes", 2)
        self.assertEqual(result, "recognized text\n\nrecognized text")
        self.assertEqual(commands[0][0][1:7], ["-f", "1", "-l", "2", "-scale-to", "1600"])
        self.assertEqual(commands[0][1]["timeout"], 20)
        self.assertTrue(all(call[1]["timeout"] <= 60 for call in commands[1:]))
        self.assertTrue(all(call[1]["close_fds"] for call in commands))


if __name__ == "__main__":
    unittest.main()
