"""Bounded deterministic HTML and PDF renderers for orchestration skills.

The renderers accept text/structured data only. They do not interpret arbitrary
HTML, access files, invoke a shell, or call a model. Outputs are bytes for the
RunManager's typed artifact store.
"""
from __future__ import annotations

from html import escape
import re
from typing import Any, Mapping

MAX_DOCUMENT_CHARS = 256_000
MAX_REPORT_SECTIONS = 32
MAX_REPORT_ITEMS = 100
MAX_REPORT_COLUMNS = 12
MAX_REPORT_CELL_CHARS = 8_000
MAX_TITLE_CHARS = 240
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def render_html(title: str, text: str) -> bytes:
    """Render plain text into a safe, self-contained UTF-8 HTML document."""
    clean_title = _text(title, "title", MAX_TITLE_CHARS)
    clean_text = _text(text, "text", MAX_DOCUMENT_CHARS)
    paragraphs = "\n".join(
        f"<p>{escape(part, quote=True)}</p>"
        for part in _paragraphs(clean_text)
    )
    document = (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>{escape(clean_title, quote=True)}</title>"
        "<style>body{max-width:48rem;margin:3rem auto;padding:0 1rem;"
        "font:1rem/1.65 system-ui,sans-serif;color:#182230}h1{line-height:1.2}"
        "p{white-space:pre-wrap}</style></head><body>"
        f"<main><h1>{escape(clean_title, quote=True)}</h1>{paragraphs}</main>"
        "</body></html>\n"
    )
    return document.encode("utf-8")


def render_report(report: Mapping[str, Any]) -> bytes:
    """Render a bounded report object with a title, optional summary and sections."""
    if not isinstance(report, Mapping):
        raise ValueError("report must be an object")
    allowed = {"title", "summary", "sections"}
    if set(report) - allowed or not {"title", "sections"} <= set(report):
        raise ValueError("report accepts title, optional summary, and sections")
    title = _text(report["title"], "title", MAX_TITLE_CHARS)
    raw_summary = report.get("summary", "")
    summary = "" if raw_summary == "" else _text(raw_summary, "summary", MAX_DOCUMENT_CHARS)
    total_chars = len(title) + len(summary)
    sections = report["sections"]
    if not isinstance(sections, list) or not 1 <= len(sections) <= MAX_REPORT_SECTIONS:
        raise ValueError(f"sections must contain 1 to {MAX_REPORT_SECTIONS} items")
    parts = []
    if summary:
        parts.append(f"<section class=\"summary\"><h2>Summary</h2>{_paragraph_html(summary)}</section>")
    for index, section in enumerate(sections, 1):
        if not isinstance(section, Mapping):
            raise ValueError(f"sections[{index - 1}] must be an object")
        heading = _text(section.get("heading"), f"sections[{index - 1}].heading", MAX_TITLE_CHARS)
        kind = section.get("kind", "text")
        if kind == "text":
            if set(section) not in ({"heading", "body"}, {"heading", "kind", "body"}):
                raise ValueError(f"sections[{index - 1}] text section must contain heading and body")
            body = _text(section["body"], f"sections[{index - 1}].body", MAX_DOCUMENT_CHARS)
            total_chars += len(heading) + len(body)
            content = _paragraph_html(body)
        elif kind == "bullets":
            if set(section) != {"heading", "kind", "items"}:
                raise ValueError(f"sections[{index - 1}] bullet section must contain heading, kind, and items")
            items = section["items"]
            if not isinstance(items, list) or not 1 <= len(items) <= MAX_REPORT_ITEMS:
                raise ValueError(f"sections[{index - 1}].items must contain 1 to {MAX_REPORT_ITEMS} items")
            clean_items = [_text(item, f"sections[{index - 1}].items[{item_index}]", MAX_REPORT_CELL_CHARS)
                           for item_index, item in enumerate(items)]
            total_chars += len(heading) + sum(map(len, clean_items))
            content = "<ul>" + "".join(f"<li>{escape(item, quote=True)}</li>" for item in clean_items) + "</ul>"
        elif kind == "table":
            if set(section) != {"heading", "kind", "columns", "rows"}:
                raise ValueError(f"sections[{index - 1}] table section must contain heading, kind, columns, and rows")
            columns = section["columns"]
            rows = section["rows"]
            if not isinstance(columns, list) or not 1 <= len(columns) <= MAX_REPORT_COLUMNS:
                raise ValueError(f"sections[{index - 1}].columns must contain 1 to {MAX_REPORT_COLUMNS} columns")
            if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_REPORT_ITEMS:
                raise ValueError(f"sections[{index - 1}].rows must contain 1 to {MAX_REPORT_ITEMS} rows")
            clean_columns = [_text(value, f"sections[{index - 1}].columns[{column_index}]", MAX_TITLE_CHARS)
                             for column_index, value in enumerate(columns)]
            clean_rows = []
            for row_index, row in enumerate(rows):
                if not isinstance(row, list) or len(row) != len(clean_columns):
                    raise ValueError(f"sections[{index - 1}].rows[{row_index}] must match the declared columns")
                clean_rows.append([_cell(value, f"sections[{index - 1}].rows[{row_index}][{column_index}]")
                                   for column_index, value in enumerate(row)])
            total_chars += len(heading) + sum(map(len, clean_columns)) + sum(
                len(cell) for row in clean_rows for cell in row)
            headers = "".join(f"<th scope=\"col\">{escape(value, quote=True)}</th>" for value in clean_columns)
            body_rows = "".join("<tr>" + "".join(
                f"<td>{escape(value, quote=True)}</td>" for value in row) + "</tr>" for row in clean_rows)
            content = f"<table><thead><tr>{headers}</tr></thead><tbody>{body_rows}</tbody></table>"
        else:
            raise ValueError(f"sections[{index - 1}].kind must be text, bullets, or table")
        if total_chars > MAX_DOCUMENT_CHARS:
            raise ValueError(f"report text exceeds {MAX_DOCUMENT_CHARS} characters in total")
        parts.append(f"<section><h2>{escape(heading, quote=True)}</h2>{content}</section>")
    body = f"<h1>{escape(title, quote=True)}</h1>{''.join(parts)}"
    return _html_document(title, body)


def render_pdf(title: str, text: str) -> bytes:
    """Create a standards-compliant, dependency-free letter-sized PDF."""
    clean_title = _text(title, "title", MAX_TITLE_CHARS)
    clean_text = _text(text, "text", MAX_DOCUMENT_CHARS)
    lines = _wrap_lines(_paragraph_lines(clean_text))
    lines_per_page = 48
    pages = [lines[index:index + lines_per_page]
             for index in range(0, max(1, len(lines)), lines_per_page)]
    if not pages:
        pages = [[]]
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        4: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    }
    page_ids = [5 + 2 * index for index in range(len(pages))]
    objects[2] = (f"<< /Type /Pages /Count {len(pages)} /Kids [" +
                  " ".join(f"{page_id} 0 R" for page_id in page_ids) + "] >>").encode("ascii")
    for index, (page_id, page_lines) in enumerate(zip(page_ids, pages), 1):
        content_id = page_id + 1
        commands = ["BT", "/F2 18 Tf", "50 748 Td", f"({_pdf_text(clean_title)}) Tj", "ET",
                    "BT", "/F1 10 Tf", "50 710 Td", "13 TL"]
        for line in page_lines:
            commands.append(f"({_pdf_text(line)}) Tj")
            commands.append("T*")
        commands.extend(["ET", "BT", "/F1 9 Tf", "276 28 Td", f"(Page {index}) Tj", "ET"])
        stream = "\n".join(commands).encode("cp1252", errors="replace")
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode("ascii")
        objects[content_id] = (f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") +
                               stream + b"\nendstream")
    return _pdf_file(objects)


def render_pdf_report(report: Mapping[str, Any]) -> bytes:
    """Render validated structured report sections into a paginated PDF.

    Text, bullet and table sections share the same limits and strict shape
    validation as the HTML report renderer. Tables are written as labeled,
    pipe-separated rows so values remain associated with their columns in the
    PDF's plain-text flow layout.
    """
    render_report(report)  # Reuse the canonical shape, escaping and size checks.
    title = _text(report["title"], "title", MAX_TITLE_CHARS)
    body: list[str] = []
    summary = report.get("summary", "")
    if summary:
        body.extend(("Summary", _text(summary, "summary", MAX_DOCUMENT_CHARS)))
    for section in report["sections"]:
        heading = _text(section["heading"], "section heading", MAX_TITLE_CHARS)
        kind = section.get("kind", "text")
        body.append(heading)
        if kind == "text":
            body.append(_text(section["body"], "section body", MAX_DOCUMENT_CHARS))
        elif kind == "bullets":
            body.extend(f"- {_text(item, 'bullet item', MAX_REPORT_CELL_CHARS)}"
                        for item in section["items"])
        else:  # The canonical renderer above restricts this to `table`.
            columns = [_text(value, "table column", MAX_TITLE_CHARS) for value in section["columns"]]
            body.append(" | ".join(columns))
            for row in section["rows"]:
                body.append(" | ".join(_cell(value, "table cell") for value in row))
    text = "\n\n".join(body)
    if len(text) > MAX_DOCUMENT_CHARS:
        raise ValueError(f"PDF report text exceeds {MAX_DOCUMENT_CHARS} characters after layout")
    return render_pdf(title, text)


def suggested_filename(title: str, extension: str) -> str:
    """Return a safe leaf filename for a rendered artifact."""
    base = _SAFE_NAME.sub("-", title.strip()).strip("-._")[:96] or "document"
    suffix = extension.lstrip(".").lower()
    if suffix not in {"html", "pdf"}:
        raise ValueError("extension must be html or pdf")
    return f"{base}.{suffix}"


def _html_document(title: str, body: str) -> bytes:
    return (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>{escape(title, quote=True)}</title>"
        "<style>body{max-width:48rem;margin:3rem auto;padding:0 1rem;"
        "font:1rem/1.65 system-ui,sans-serif;color:#182230}h1,h2{line-height:1.2}"
        "section{margin:2rem 0}p{white-space:pre-wrap}table{width:100%;table-layout:fixed;"
        "border-collapse:collapse;overflow-wrap:anywhere}"
        "th,td{border:1px solid #cbd5e1;padding:.45rem;text-align:left;vertical-align:top;"
        "overflow-wrap:anywhere;word-break:break-word}"
        "thead{background:#f1f5f9}li{margin:.25rem 0}</style></head><body>"
        f"<main>{body}</main></body></html>\n"
    ).encode("utf-8")


def _paragraph_html(value: str) -> str:
    return "".join(f"<p>{escape(part, quote=True)}</p>" for part in _paragraphs(value))


def _paragraphs(value: str) -> list[str]:
    return [part.strip() for part in re.split(r"\n\s*\n", value) if part.strip()]


def _paragraph_lines(value: str) -> list[str]:
    result: list[str] = []
    for paragraph in _paragraphs(value):
        result.extend(paragraph.splitlines() or [""])
        result.append("")
    return result


def _text(value: Any, label: str, limit: int) -> str:
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"{label} must be text with at most {limit} characters")
    if not value.strip():
        raise ValueError(f"{label} cannot be empty")
    if "\x00" in value:
        raise ValueError(f"{label} contains a null character")
    return value.strip()


def _cell(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) > MAX_REPORT_CELL_CHARS:
        raise ValueError(f"{label} must be text with at most {MAX_REPORT_CELL_CHARS} characters")
    if "\x00" in value:
        raise ValueError(f"{label} contains a null character")
    return value.strip()


def _wrap_lines(lines: list[str], width: int = 88) -> list[str]:
    wrapped = []
    for line in lines:
        line = line.replace("\t", "    ")
        while len(line) > width:
            split = line.rfind(" ", 0, width + 1)
            if split <= 0:
                split = width
            wrapped.append(line[:split])
            line = line[split:].lstrip()
        wrapped.append(line)
    return wrapped


def _pdf_text(value: str) -> str:
    encoded = value.encode("cp1252", errors="replace").decode("cp1252")
    return encoded.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _pdf_file(objects: Mapping[int, bytes]) -> bytes:
    maximum = max(objects)
    result = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0] * (maximum + 1)
    for object_id in range(1, maximum + 1):
        offsets[object_id] = len(result)
        result.extend(f"{object_id} 0 obj\n".encode("ascii"))
        result.extend(objects[object_id])
        result.extend(b"\nendobj\n")
    xref_offset = len(result)
    result.extend(f"xref\n0 {maximum + 1}\n".encode("ascii"))
    result.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    result.extend((f"trailer\n<< /Size {maximum + 1} /Root 1 0 R >>\n"
                   f"startxref\n{xref_offset}\n%%EOF\n").encode("ascii"))
    return bytes(result)


__all__ = ["MAX_DOCUMENT_CHARS", "render_html", "render_pdf", "render_pdf_report",
           "render_report", "suggested_filename"]
