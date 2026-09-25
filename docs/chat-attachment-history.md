# Chat attachment history

Chat messages may include an optional `attachments` array of metadata-only
references. Each reference records the local file kind, resolved path, display
name, byte size, modification time, and SHA-256 digest. The JSON history does
not copy image bytes or extracted document text. Older chat messages without
this key continue to load normally.

When a saved chat is restored, AI Dream validates the reference and then checks
that the file still exists and its size, modification time, and digest match
the saved values. Images are revalidated by file signature and encoded for the
local vision-capable llama.cpp request. Documents are re-extracted through the
bounded TXT/Markdown/PDF loader. Missing, modified, unsupported, or invalid
files are skipped; the text conversation remains available. Up to four images
and four documents can be referenced per user message, subject to the existing
per-file, per-message image-byte, and document-character limits.

The path metadata is local and may reveal filenames or directory structure to
anyone who can read the chat JSON or a Markdown export. It is not uploaded by
the history store. Rehydrated content is sent only to the configured local
llama.cpp server. Moving a source file or changing its contents makes that
attachment unavailable in the restored turn; attach it again to update the
reference. Exported Markdown includes attachment names and paths for
traceability, so review it before sharing.
