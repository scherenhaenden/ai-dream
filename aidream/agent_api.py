"""Persistent-chat adapter for the bounded, read-only local agent.

HTTP handlers own transport (SSE and disconnect detection); this module owns
selection, limits, cancellation, and safe chat persistence for one agent turn.
"""
from __future__ import annotations

import threading
import json
from typing import Any

from aidream.agent import LocalAgent
from aidream.agent_tools import AgentToolRegistry
from aidream.http_api import (AGENT_AUDIT_PREFIX, APIError, MAX_HISTORY_CHARS,
                              MAX_HISTORY_MESSAGES, MAX_MODELS, CHAT_ID_RE)


class AgentRun:
    """A serialized agent turn that releases the shared model lock on close."""

    def __init__(self, api: Any, backend: Any, chat_id: str, prompt: str):
        self.api = api
        self.backend = backend
        self.chat_id = chat_id
        self.prompt = prompt
        self._closed = False

    def run(self, cancel_event: threading.Event | None = None) -> dict[str, Any]:
        session = self.api._safe_load_chat(self.chat_id)
        history: list[dict[str, str]] = []
        total = 0
        messages = session.get("messages", [])
        if not isinstance(messages, list):
            raise APIError("Invalid chat history")
        for item in reversed(messages):
            role, content = item.get("role"), item.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str) or not content.strip():
                continue
            cost = len(content)
            if len(history) >= MAX_HISTORY_MESSAGES or total + cost > MAX_HISTORY_CHARS:
                break
            history.append({"role": role, "content": content})
            total += cost
        history.reverse()
        result = LocalAgent(
            self.backend,
            AgentToolRegistry(hardware=self.api.hardware, models=self.api.catalog,
                              runtime=self.api.runtimes,
                              runtime_manager=getattr(self.api, "runtime_manager", None)),
            max_tool_calls=4, max_seconds=45.0, max_output_chars=12_000,
        ).run(self.prompt, history, cancel_event)
        # Don't persist an incomplete/cancelled turn. Other bounded stop reasons
        # (time/output/tool-call limit) return useful text and remain auditable.
        if result.stop_reason != "cancelled":
            self.api.chat_store.append(self.chat_id, "user", self.prompt)
            session = self.api.chat_store.append(self.chat_id, "assistant", result.text)
            summary = result.summary()
            audit = {key: summary[key] for key in (
                "tools", "tool_call_count", "elapsed_seconds", "stop_reason", "tool_calls_supported")}
            self.api.chat_store.append(self.chat_id, "system", AGENT_AUDIT_PREFIX +
                                       json.dumps(audit, ensure_ascii=False, separators=(",", ":")))
            session = self.api._safe_load_chat(self.chat_id)
        else:
            session = self.api._safe_load_chat(self.chat_id)
        return {"chat_id": self.chat_id, "assistant": result.text,
                "session_id": session.get("id"), "agent": result.summary()}

    def close(self):
        if not self._closed:
            self._closed = True
            self.api._chat_lock.release()


def prepare_agent(api: Any, chat_id: str, model_id: str, prompt: str) -> AgentRun:
    """Validate a saved chat/model and prepare a backend with tool-call support.

    Uses the API's existing one-model-at-a-time lock and unload policy. The
    user cannot provide paths, tool definitions, or runtime commands here.
    """
    if api._closed:
        raise APIError("Local agent service is shutting down")
    if not isinstance(chat_id, str) or not CHAT_ID_RE.fullmatch(chat_id):
        raise APIError("Invalid chat id")
    if not isinstance(model_id, str) or not 1 <= len(model_id) <= 256:
        raise APIError("Invalid model id")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 8_000:
        raise APIError("prompt must contain 1 to 8000 characters")
    if not api._chat_lock.acquire(blocking=False):
        raise APIError("Another local model request is active")
    try:
        api._safe_load_chat(chat_id)
        models = api.catalog.list_models()
        if len(models) > MAX_MODELS:
            raise APIError("Local model catalog exceeds the API limit")
        model = next((item for item in models if getattr(item, "id", None) == model_id), None)
        if model is None:
            raise APIError("Model id was not found in the local catalog")
        backend = next((item for item in api.runtimes.list_backends()
                        if item.capabilities().available and item.can_load(model)
                        and callable(getattr(item, "chat_with_tools", None))), None)
        if backend is None:
            raise APIError("No available local runtime supports read-only agent tool calls for this model")
        binding = (id(backend), model_id, chat_id)
        healthy = api._active_binding == binding
        process = getattr(backend, "_process", None)
        if hasattr(backend, "_process"):
            healthy = (healthy and process is not None and process.poll() is None
                       and getattr(backend, "_loaded_model", None) is not None)
        if not healthy:
            api._unload_active()
            backend.load(model)
            api._active_backend = backend
            api._active_binding = binding
        return AgentRun(api, backend, chat_id, prompt.strip())
    except APIError:
        api._chat_lock.release()
        raise
    except (OSError, RuntimeError, ValueError, TypeError) as exc:
        api._chat_lock.release()
        raise APIError("Local model could not be prepared for agent mode") from exc
