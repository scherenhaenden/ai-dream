"""Small, dependency-free image attachment support for local multimodal chats.

Only local PNG, JPEG, and WebP raster files are accepted. This module does not
decode image pixels; the selected llama.cpp model/server must support vision.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from pathlib import Path


MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024
MAX_IMAGES_PER_MESSAGE = 4

_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


@dataclass(frozen=True)
class ImageAttachment:
    """Validated image bytes encoded as a data URI for OpenAI-compatible APIs."""

    path: Path
    mime_type: str
    size_bytes: int
    data_uri: str


class ImageInputError(ValueError):
    """Raised when an image attachment is unsupported or exceeds limits."""


def _detect_mime(data: bytes) -> str | None:
    for signature, mime in _SIGNATURES:
        if data.startswith(signature):
            return mime
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def load_image_attachment(path: str | Path) -> ImageAttachment:
    """Read a local supported raster image and return a bounded data URI.

    Symlinks are resolved intentionally: the API operates on the final local
    file. MIME is determined from file signatures, never from the filename.
    """

    try:
        resolved = Path(path).expanduser().resolve(strict=True)
        if not resolved.is_file():
            raise ImageInputError("Image path must point to a regular file")
        size = resolved.stat().st_size
        if size <= 0:
            raise ImageInputError("Image file is empty")
        if size > MAX_IMAGE_BYTES:
            raise ImageInputError(f"Image exceeds the {MAX_IMAGE_BYTES} byte limit")
        data = resolved.read_bytes()
    except ImageInputError:
        raise
    except (OSError, RuntimeError) as exc:
        raise ImageInputError(f"Could not read image: {exc}") from exc

    mime = _detect_mime(data)
    if mime is None:
        raise ImageInputError("Unsupported image format; use PNG, JPEG, or WebP")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageInputError(f"Image exceeds the {MAX_IMAGE_BYTES} byte limit")
    encoded = base64.b64encode(data).decode("ascii")
    return ImageAttachment(resolved, mime, len(data), f"data:{mime};base64,{encoded}")


def build_multimodal_message(
    text: str,
    images: list[ImageAttachment] | tuple[ImageAttachment, ...],
    *,
    role: str = "user",
) -> dict[str, object]:
    """Build an OpenAI chat-completions message with text and image_url parts."""

    if role not in {"user", "system"}:
        raise ImageInputError("Image messages support only user or system roles")
    if len(images) > MAX_IMAGES_PER_MESSAGE:
        raise ImageInputError(f"A message can contain at most {MAX_IMAGES_PER_MESSAGE} images")
    if any(image.size_bytes <= 0 or image.size_bytes > MAX_IMAGE_BYTES for image in images):
        raise ImageInputError("Attachment size is invalid")
    total = sum(image.size_bytes for image in images)
    if total > MAX_TOTAL_IMAGE_BYTES:
        raise ImageInputError(f"Images exceed the {MAX_TOTAL_IMAGE_BYTES} byte combined limit")
    parts: list[dict[str, object]] = []
    if text:
        parts.append({"type": "text", "text": text})
    for image in images:
        if image.mime_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise ImageInputError("Attachment has an unsupported MIME type")
        prefix = f"data:{image.mime_type};base64,"
        if not image.data_uri.startswith(prefix):
            raise ImageInputError("Attachment data URI does not match its MIME type")
        expected_chars = 4 * ((image.size_bytes + 2) // 3)
        if len(image.data_uri) != len(prefix) + expected_chars:
            raise ImageInputError("Attachment data URI length does not match its declared size")
        try:
            payload = base64.b64decode(image.data_uri[len(prefix):], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ImageInputError("Attachment data URI is not valid base64") from exc
        if len(payload) != image.size_bytes or _detect_mime(payload) != image.mime_type:
            raise ImageInputError("Attachment data does not match its declared type and size")
        parts.append({"type": "image_url", "image_url": {"url": image.data_uri}})
    return {"role": role, "content": parts}
