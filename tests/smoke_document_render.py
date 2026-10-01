#!/usr/bin/env python3
"""Generate and inspect real report PDF output with local Poppler tools.

This explicit acceptance smoke leaves a PDF, extracted text, and rasterized
pages in a temporary directory for visual review. It does not run a model.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aidream.document_render import render_pdf_report


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise SystemExit(f"Missing local tool: {name}. Install Poppler to run this visual smoke.")
    return path


def run(command: list[str]) -> str:
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return result.stdout


def main() -> int:
    pdfinfo = require_tool("pdfinfo")
    pdftotext = require_tool("pdftotext")
    pdftoppm = require_tool("pdftoppm")
    output = Path(tempfile.mkdtemp(prefix="ai-dream-document-render-"))
    report = {
        "title": "AI Dream deterministic report",
        "summary": "Rendered locally from a typed report; no model or network was used.",
        "sections": [
            {"heading": "Long text and pagination", "kind": "text", "body": "\n".join(
                f"Line {index:03d}: Report layout remains readable across page boundaries."
                for index in range(1, 101)
            )},
            {"heading": "Actions", "kind": "bullets", "items": ["Inspect page one", "Inspect later pages"]},
            {"heading": "Checks", "kind": "table", "columns": ["Check", "State"],
             "rows": [["PDF generation", "Passed"], ["Local raster render", "Passed"]]},
        ],
    }
    pdf_path = output / "report.pdf"
    pdf_path.write_bytes(render_pdf_report(report))
    if not pdf_path.read_bytes().startswith(b"%PDF-"):
        raise AssertionError("renderer did not produce a PDF signature")

    info = run([pdfinfo, str(pdf_path)])
    match = re.search(r"^Pages:\s+(\d+)\s*$", info, re.MULTILINE)
    if not match or int(match.group(1)) < 3:
        raise AssertionError(f"expected a multi-page PDF with at least 3 pages; pdfinfo reported:\n{info}")
    text_path = output / "report.txt"
    run([pdftotext, "-layout", str(pdf_path), str(text_path)])
    extracted = text_path.read_text(encoding="utf-8")
    for expected in ("AI Dream deterministic report", "Line 001:", "Line 100:", "PDF generation", "Local raster render"):
        if expected not in extracted:
            raise AssertionError(f"PDF text extraction did not contain {expected!r}")

    prefix = output / "page"
    run([pdftoppm, "-png", "-r", "72", str(pdf_path), str(prefix)])
    images = sorted(output.glob("page-*.png"))
    if len(images) != int(match.group(1)):
        raise AssertionError(f"Poppler rasterized {len(images)} pages; expected {match.group(1)}")
    try:
        from PIL import Image, ImageStat
    except ImportError as error:
        raise SystemExit("Missing Pillow; install it to verify nonblank rendered PDF pages.") from error
    for image_path in images:
        with Image.open(image_path) as image:
            if image.width < 500 or image.height < 650:
                raise AssertionError(f"unexpected raster size for {image_path.name}: {image.size}")
            if max(ImageStat.Stat(image.convert("RGB")).stddev) < 1:
                raise AssertionError(f"rendered page is blank: {image_path}")
    print(f"Real report PDF passed pdfinfo ({match.group(1)} pages), pdftotext, and pdftoppm raster checks.")
    print(f"Visual QA files: {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() if error.stderr else str(error)
        print(f"Local PDF tool failed: {detail}", file=sys.stderr)
        raise SystemExit(error.returncode or 1)
