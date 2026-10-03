"""Unified inference client for remote and local LLM chat and generation.

Handles credentials via OS keyring, SSRF-safe pinned sockets, streaming SSE
parsing, and transparent routing between local and remote models.
"""
from __future__ import annotations

from typing import Any, Iterator, Mapping

from aidream.providers.connections import ProviderConnections, ProviderConnectionError
from aidream.providers.errors import (
    ProviderError,
    ProviderModelNotFoundError,
    ProviderResponseError,
    safe_provider_error,
)


def parse_model_id(model_id: str) -> tuple[str | None, str]:
    """Parse model identifier into (connection_id, provider_or_local_model_id).

    Examples:
        'provider:3f8e...:gpt-4o' -> ('3f8e...', 'gpt-4o')
        'llama-3.2-1b.gguf'       -> (None, 'llama-3.2-1b.gguf')
    """
    if not isinstance(model_id, str):
        raise ProviderError("model_id must be a string")
    clean = model_id.strip()
    if clean.startswith("provider:"):
        parts = clean.split(":", 2)
        if len(parts) != 3 or not parts[1] or not parts[2]:
            raise ProviderError("Invalid remote model id format. Expected 'provider:<connection_id>:<model_id>'")
        return parts[1], parts[2]
    return None, clean


def chat(
    model_id: str,
    messages: list[dict[str, str]],
    provider_connections: ProviderConnections | None = None,
    **options: Any,
) -> dict[str, Any]:
    """Execute a chat completion request."""
    if not isinstance(messages, list) or not messages:
        raise ProviderError("messages must be a non-empty list of message objects")
    for msg in messages:
        if not isinstance(msg, Mapping) or "role" not in msg or "content" not in msg:
            raise ProviderError("Each message must be a dictionary with 'role' and 'content' fields")

    conn_id, p_model = parse_model_id(model_id)
    if conn_id is None:
        raise ProviderError(
            f"Direct local generation for '{model_id}' should use the local runtime. "
            "Remote generation requires a 'provider:<connection_id>:<model>' identifier."
        )

    conns = provider_connections or ProviderConnections()
    payload: dict[str, Any] = {
        "model": p_model,
        "messages": [dict(m) for m in messages],
    }

    allowed_options = ("temperature", "max_tokens", "top_p", "stop", "seed")
    for opt in allowed_options:
        if opt in options and options[opt] is not None:
            payload[opt] = options[opt]

    try:
        response = conns.request(conn_id, "POST", "/chat/completions", json_body=payload)
    except ProviderConnectionError as exc:
        raise ProviderError(str(exc)) from exc
    except Exception as exc:
        raise ProviderError(f"Provider chat request failed: {safe_provider_error(exc)}") from exc

    if response.status < 200 or response.status >= 300:
        raise ProviderResponseError(f"Provider returned HTTP {response.status}", status=response.status)

    body = response.body
    if not isinstance(body, Mapping) or not isinstance(body.get("choices"), list) or not body["choices"]:
        raise ProviderError("Provider returned invalid chat completion response (missing choices)")

    first_choice = body["choices"][0]
    message = first_choice.get("message", {})
    return {
        "id": body.get("id"),
        "model": model_id,
        "provider_model_id": p_model,
        "message": {
            "role": str(message.get("role", "assistant")),
            "content": str(message.get("content", "")),
        },
        "finish_reason": first_choice.get("finish_reason"),
        "usage": dict(body.get("usage", {})) if isinstance(body.get("usage"), Mapping) else {},
    }


def stream_chat(
    model_id: str,
    messages: list[dict[str, str]],
    provider_connections: ProviderConnections | None = None,
    **options: Any,
) -> Iterator[str]:
    """Stream chat completion tokens via SSE."""
    if not isinstance(messages, list) or not messages:
        raise ProviderError("messages must be a non-empty list of message objects")

    conn_id, p_model = parse_model_id(model_id)
    if conn_id is None:
        raise ProviderError(
            f"Direct local generation for '{model_id}' should use the local runtime. "
            "Remote generation requires a 'provider:<connection_id>:<model>' identifier."
        )

    conns = provider_connections or ProviderConnections()
    payload: dict[str, Any] = {
        "model": p_model,
        "messages": [dict(m) for m in messages],
        "stream": True,
    }

    allowed_options = ("temperature", "max_tokens", "top_p", "stop", "seed")
    for opt in allowed_options:
        if opt in options and options[opt] is not None:
            payload[opt] = options[opt]

    try:
        yield from conns.stream_request(conn_id, "POST", "/chat/completions", json_body=payload)
    except ProviderConnectionError as exc:
        raise ProviderError(str(exc)) from exc
    except Exception as exc:
        raise ProviderError(f"Provider chat stream failed: {safe_provider_error(exc)}") from exc
