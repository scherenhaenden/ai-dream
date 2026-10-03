"""Sanitized, safe provider error types and error redaction helpers.

Prevents credentials, bearer tokens, API keys, and sensitive internal URL details
from leaking into logs, user interfaces, or error payloads.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

_BEARER_RE = re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9_\-\.]{8,}\b")
_KEY_PARAM_RE = re.compile(r"(?i)(key|token|secret|password|api[_-]?key)=([^&\s]+)")
_BASIC_AUTH_RE = re.compile(r"(?i)\b(basic\s+)[A-Za-z0-9+/=]{10,}\b")


def safe_provider_error(error: Any) -> str:
    """Redact secrets and sensitive transport details from error text."""
    if error is None:
        return "Provider error"
    text = str(error)

    # Redact Authorization header patterns
    text = _BEARER_RE.sub(r"\1[REDACTED]", text)
    text = _BASIC_AUTH_RE.sub(r"\1[REDACTED]", text)
    text = _KEY_PARAM_RE.sub(r"\1=[REDACTED]", text)

    # Redact user:password embedded in URLs
    def _sanitize_url(match: re.Match[str]) -> str:
        url = match.group(0)
        try:
            parts = urlsplit(url)
            if parts.username or parts.password:
                netloc = parts.hostname or ""
                if parts.port:
                    netloc += f":{parts.port}"
                return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
        except Exception:
            pass
        return url

    text = re.sub(r"https?://[^\s'\"<>]+", _sanitize_url, text)

    text = text.strip()
    if len(text) > 240:
        text = text[:237] + "..."
    return text or "Provider error"


class ProviderError(Exception):
    """Base error for provider inference and metadata operations."""
    status: int = 400
    code: str = "provider_error"

    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        safe_msg = safe_provider_error(message)
        super().__init__(safe_msg)
        self.message = safe_msg
        if status is not None:
            self.status = status
        if code is not None:
            self.code = code

    def to_dict(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "status": self.status}}


class ProviderAuthError(ProviderError):
    status: int = 401
    code: str = "provider_auth_error"


class ProviderTimeoutError(ProviderError):
    status: int = 504
    code: str = "provider_timeout"


class ProviderModelNotFoundError(ProviderError):
    status: int = 404
    code: str = "provider_model_not_found"


class ProviderResponseError(ProviderError):
    status: int = 502
    code: str = "provider_response_error"
