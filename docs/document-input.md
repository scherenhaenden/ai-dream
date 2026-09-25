# Local document attachments

`aidream.document_input` extracts local `.txt`, `.md`, and `.markdown` files as UTF-8. Text PDFs are supported when the optional `pypdf` package is installed. The module does not access the network, run document content, or perform OCR. Scanned/image-only PDFs return a clear error.

Limits are 5 MiB per file, 40,000 extracted characters per document, and 80,000 characters across a prompt's document attachments. Text extraction stops at the per-document bound. Invalid UTF-8, empty files, and unsupported types are rejected. Attachment contents are inserted into clearly delimited prompt context and labeled as reference data, not instructions.

Example:

```python
from aidream.document_input import build_document_prompt, load_document_attachment

document = load_document_attachment("/home/user/notes.md")
prompt = build_document_prompt("Summarize the attached notes.", [document])
```

The runtime can restore document references in saved user turns and re-extract
them with these same limits; see
[`chat-attachment-history.md`](chat-attachment-history.md). Desktop UI
attachment controls remain separate work.

To enable PDF text extraction in a local environment, install `pypdf` into that environment. TXT and Markdown support has no extra dependency.
