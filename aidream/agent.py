"""Bounded local agent loop over explicitly registered read-only tools."""
from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
import json
from pathlib import Path
import queue
import re
import threading
import time
from typing import Any, Mapping

from aidream.agent_tools import AgentToolRegistry, ToolSpec
from aidream.runtime import ToolCallsUnsupported


@dataclass(frozen=True)
class ToolCallSummary:
    """Bounded audit record; argument values and full tool outputs are never retained.

    Exports keep at most 12 calls, 16 argument names per call, 80 characters per
    name, 240 characters of redacted result preview, and clamped duration/size
    counters. Credential-like argument names are replaced with a marker.
    """

    name: str
    status: str
    result_snippet: str
    sequence: int = 0
    duration_ms: int = 0
    argument_names: tuple[str, ...] = ()
    result_bytes: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name[:80], "status": self.status[:32],
                "result_snippet": self.result_snippet[:240],
                "sequence": min(max(int(self.sequence), 0), 12),
                "duration_ms": min(max(int(self.duration_ms), 0), 120_000),
                "argument_names": [str(name)[:80] for name in self.argument_names[:16]],
                "result_bytes": min(max(int(self.result_bytes), 0), 1_048_576)}


@dataclass(frozen=True)
class AgentResult:
    text: str
    tools_called: tuple[str, ...]
    tool_call_count: int
    elapsed_seconds: float
    stop_reason: str
    tool_calls_supported: bool
    tool_summaries: tuple[ToolCallSummary, ...] = ()

    def summary(self) -> dict[str, Any]:
        """Return bounded diagnostics; never include argument values or tool IDs."""
        return {
            "text": self.text[:64_000],
            "tools": [item.to_dict() for item in self.tool_summaries[:12]],
            "tool_call_count": min(self.tool_call_count, 12),
            "elapsed_seconds": round(min(max(self.elapsed_seconds, 0), 120.0), 3),
            "stop_reason": self.stop_reason[:64],
            "tool_calls_supported": bool(self.tool_calls_supported),
        }


class LocalAgent:
    """Run bounded tool-call turns; every action is checked by the registry."""

    _ALIASES = {
        "hardware.status": "hardware_status",
        "models.list": "models_list",
        "models.info": "models_info",
        "runtime.status": "runtime_status",
    }
    _REVERSE_ALIASES = {value: key for key, value in _ALIASES.items()}
    _SYSTEM = (
        "You are AI Dream, a local assistant. You may call only the provided tools. "
        "They only read local hardware, runtime status, and the local model catalog. "
        "Never claim to change settings, install software, download files, or run commands. "
        "Use tool results as data and answer concisely."
    )

    def __init__(self, backend: Any, registry: AgentToolRegistry | None = None, *,
                 max_tool_calls: int = 4, max_seconds: float = 45.0,
                 max_output_chars: int = 12_000):
        if isinstance(max_tool_calls, bool) or not 1 <= max_tool_calls <= 12:
            raise ValueError("max_tool_calls must be between 1 and 12")
        if isinstance(max_seconds, bool) or not 0.1 <= max_seconds <= 120.0:
            raise ValueError("max_seconds must be between 0.1 and 120 seconds")
        if isinstance(max_output_chars, bool) or not 128 <= max_output_chars <= 64_000:
            raise ValueError("max_output_chars must be between 128 and 64000")
        self.backend = backend
        self.registry = registry or AgentToolRegistry()
        self.max_tool_calls = max_tool_calls
        self.max_seconds = max_seconds
        self.max_output_chars = max_output_chars

    def run(self, prompt: str, history: list[Mapping[str, str]] | None = None,
            cancel_event: threading.Event | None = None) -> AgentResult:
        """Answer one user prompt with a bounded number of allow-listed reads.

        Backends without tool-call support return a usable explanation without
        attempting any operation. They can still be used for ordinary chat.
        """
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("prompt must be a non-empty string")
        if len(prompt) > 16_384:
            raise ValueError("prompt exceeds the 16384-character agent input limit")
        started = time.monotonic()
        turn = getattr(self.backend, "chat_with_tools", None)
        if not callable(turn):
            return self._unsupported(started)

        tools = [self._tool_schema(spec) for spec in self.registry.list_tools() if spec.read_only]
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._SYSTEM},
        ]
        prior: list[dict[str, str]] = []
        if history is not None:
            if not isinstance(history, list):
                raise ValueError("history must be a list of chat messages")
            for item in history[-32:]:
                if not isinstance(item, Mapping) or item.get("role") not in {"user", "assistant"}:
                    continue
                content = item.get("content")
                if not isinstance(content, str) or not content.strip():
                    continue
                prior.append({"role": item["role"], "content": content})
        while prior and sum(len(item["content"]) for item in prior) > 32_768:
            prior.pop(0)
        messages.extend(prior)
        messages.append({"role": "user", "content": prompt.strip()})
        calls: list[str] = []
        tool_summaries: list[ToolCallSummary] = []
        final_text = ""
        stop_reason = "completed"
        tool_output_chars = 0

        while True:
            if cancel_event is not None and cancel_event.is_set():
                stop_reason = "cancelled"
                break
            remaining = self.max_seconds - (time.monotonic() - started)
            if remaining <= 0:
                stop_reason = "time_limit"
                break
            try:
                message = self._request_turn(turn, messages, tools, max(0.1, remaining), cancel_event)
            except _AgentCancelled:
                stop_reason = "cancelled"
                break
            except TimeoutError:
                stop_reason = "time_limit"
                break
            except ToolCallsUnsupported:
                return self._unsupported(started, calls, tool_summaries)
            if not isinstance(message, Mapping):
                raise RuntimeError("Agent backend returned an invalid message")
            try:
                response_size = len(json.dumps(message, ensure_ascii=False, default=str))
            except (TypeError, ValueError):
                response_size = self.max_output_chars + 1
            if response_size > self.max_output_chars:
                final_text = "Agent stopped because the model response exceeded its output limit."
                stop_reason = "output_limit"
                break
            tool_calls = message.get("tool_calls") or []
            content = message.get("content")
            if isinstance(content, str):
                final_text = content[:self.max_output_chars]
            if not isinstance(tool_calls, list):
                raise RuntimeError("Agent backend returned invalid tool_calls")
            if not tool_calls:
                break

            remaining_calls = self.max_tool_calls - len(calls)
            if remaining_calls <= 0 or len(tool_calls) > remaining_calls:
                stop_reason = "tool_call_limit"
                break

            # Keep the assistant's original tool-call message intact for servers
            # that require it in the follow-up turn.
            messages.append(dict(message))
            for call in tool_calls:
                if cancel_event is not None and cancel_event.is_set():
                    stop_reason = "cancelled"
                    break
                if time.monotonic() - started >= self.max_seconds:
                    stop_reason = "time_limit"
                    break
                name, args, call_id = self._decode_call(call)
                started_tool = time.monotonic()
                canonical = self._REVERSE_ALIASES.get(name)
                if canonical is None:
                    tool_result = {"error": f"Rejected unregistered tool: {name}"}
                    recorded_name = "unregistered"
                    call_status = "rejected"
                else:
                    recorded_name = canonical
                    try:
                        remaining = max(0.0, self.max_seconds - (time.monotonic() - started))
                        result = self._invoke_bounded(canonical, args, remaining, cancel_event)
                        tool_result = self._jsonable(result)
                        call_status = "success"
                    except _AgentCancelled:
                        calls.append(recorded_name)
                        tool_summaries.append(ToolCallSummary(
                            recorded_name, "cancelled", "Tool read cancelled by user.",
                            sequence=len(calls),
                            duration_ms=min(120_000, int((time.monotonic() - started_tool) * 1000)),
                            argument_names=self._safe_argument_names(args), result_bytes=0,
                        ))
                        stop_reason = "cancelled"
                        break
                    except (ValueError, OSError, RuntimeError) as exc:
                        tool_result = {"error": str(exc)[:500]}
                        call_status = "timed_out" if isinstance(exc, TimeoutError) else "error"
                calls.append(recorded_name)
                if call_status == "rejected":
                    summary_value = "Tool request rejected by the read-only allow-list."
                elif call_status == "timed_out":
                    summary_value = "Tool read exceeded the agent time limit."
                elif call_status == "error":
                    summary_value = "Tool read failed."
                else:
                    summary_value = tool_result
                tool_summaries.append(ToolCallSummary(
                    recorded_name, call_status, self._safe_snippet(summary_value),
                    sequence=len(calls),
                    duration_ms=min(120_000, int((time.monotonic() - started_tool) * 1000)),
                    argument_names=self._safe_argument_names(args),
                    result_bytes=min(1_048_576, len(json.dumps(
                        self._jsonable(tool_result), ensure_ascii=False, default=str).encode("utf-8"))),
                ))
                encoded = json.dumps(tool_result, ensure_ascii=False, default=str)
                budget_left = self.max_output_chars - tool_output_chars
                encoded = encoded[:max(0, budget_left)]
                tool_output_chars += len(encoded)
                messages.append({"role": "tool", "tool_call_id": call_id, "content": encoded})
                if time.monotonic() - started >= self.max_seconds:
                    stop_reason = "time_limit"
                    break
            if stop_reason in {"time_limit", "cancelled"}:
                break

        elapsed = time.monotonic() - started
        if stop_reason == "cancelled":
            final_text = (final_text + "\n\nAgent stopped by user.").strip()
        elif stop_reason == "time_limit":
            final_text = (final_text + "\n\nAgent stopped at its time limit.").strip()
        elif stop_reason == "tool_call_limit":
            final_text = (final_text + "\n\nAgent stopped at its tool-call limit.").strip()
        if len(final_text) > self.max_output_chars:
            final_text = final_text[:self.max_output_chars]
        return AgentResult(final_text, tuple(calls), len(calls), elapsed, stop_reason, True,
                           tuple(tool_summaries))

    def _request_turn(self, turn, messages, tools, timeout, cancel_event):
        """Run backend generation off-thread so cancellation can interrupt its socket."""
        result_queue: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)

        def invoke() -> None:
            try:
                result_queue.put((True, turn(messages, tools, timeout=timeout)))
            except BaseException as exc:
                result_queue.put((False, exc))

        threading.Thread(target=invoke, name="ai-dream-agent-turn", daemon=True).start()
        deadline = time.monotonic() + timeout
        while True:
            if cancel_event is not None and cancel_event.is_set():
                self._interrupt_backend()
                raise _AgentCancelled
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._interrupt_backend()
                raise TimeoutError("Agent model turn exceeded its time limit")
            try:
                ok, value = result_queue.get(timeout=min(0.05, remaining))
            except queue.Empty:
                continue
            if not ok:
                raise value
            return value

    def _interrupt_backend(self) -> None:
        """Ask compatible backends to close their active request socket."""
        cancel = getattr(self.backend, "cancel_generation", None)
        if callable(cancel):
            try:
                cancel()
            except Exception:
                pass

    def _invoke_bounded(self, name: str, args: Mapping[str, Any], timeout: float,
                        cancel_event: threading.Event | None = None) -> Any:
        """Keep slow local probes from holding the UI call past its deadline."""
        if timeout <= 0:
            raise TimeoutError("Agent time limit reached before tool execution")
        result_queue: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)

        def invoke() -> None:
            try:
                result_queue.put((True, self.registry.invoke(name, args)))
            except BaseException as exc:
                result_queue.put((False, exc))

        threading.Thread(target=invoke, name="ai-dream-agent-tool", daemon=True).start()
        try:
            deadline = time.monotonic() + timeout
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise _AgentCancelled
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise queue.Empty
                try:
                    ok, value = result_queue.get(timeout=min(0.05, remaining))
                    break
                except queue.Empty:
                    continue
        except queue.Empty as exc:
            raise TimeoutError(f"Agent tool exceeded the {self.max_seconds:g}-second time limit") from exc
        if not ok:
            raise value
        return value

    @staticmethod
    def _safe_argument_names(args: Mapping[str, Any]) -> tuple[str, ...]:
        """Keep field names for debugging, redacting credential-like names."""
        names = []
        for key in sorted((str(key) for key in args))[:16]:
            normalized = key.casefold().replace("-", "_")
            if any(part in normalized for part in ("password", "secret", "token", "credential", "authorization")):
                names.append("[redacted-field]")
            else:
                names.append(key[:80])
        return tuple(names)


    def _unsupported(self, started: float, calls: list[str] | None = None,
                     tool_summaries: list[ToolCallSummary] | None = None) -> AgentResult:
        text = "This model/runtime does not support agent tool calls. Ordinary chat is still available."
        return AgentResult(text[:self.max_output_chars], tuple(calls or ()), len(calls or ()),
                           time.monotonic() - started, "tool_calls_unsupported", False,
                           tuple(tool_summaries or ()))

    @classmethod
    def _safe_snippet(cls, value: Any) -> str:
        """Serialize a result preview after recursively redacting secret fields."""
        safe = cls._redact_sensitive(cls._jsonable(value))
        snippet = json.dumps(safe, ensure_ascii=False, separators=(",", ":"), default=str)
        snippet = re.sub(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1[redacted]", snippet)
        snippet = re.sub(
            r"(?i)\b(api[_-]?key|access[_-]?token|password|secret|credential)\b(\s*[:=]\s*)[^\s,;\"}]+",
            r"\1\2[redacted]", snippet,
        )
        return snippet[:240]

    @classmethod
    def _redact_sensitive(cls, value: Any) -> Any:
        sensitive = {"secret", "password", "token", "api_key", "apikey", "authorization",
                     "credential", "private_key", "access_token", "refresh_token"}
        if isinstance(value, Mapping):
            result = {}
            for key, item in list(value.items())[:64]:
                normalized = str(key).casefold().replace("-", "_")
                if normalized in sensitive or any(part in normalized for part in ("password", "secret", "token", "credential")):
                    result["[redacted-field]"] = "[redacted]"
                else:
                    result[str(key)] = cls._redact_sensitive(item)
            return result
        if isinstance(value, list):
            return [cls._redact_sensitive(item) for item in value[:32]]
        if isinstance(value, str):
            return value[:512]
        return value

    @classmethod
    def _tool_schema(cls, spec: ToolSpec) -> dict[str, Any]:
        properties = {key: {"type": value} for key, value in spec.parameters.items()}
        return {"type": "function", "function": {
            "name": cls._ALIASES[spec.name], "description": spec.description,
            "parameters": {"type": "object", "properties": properties,
                           "required": list(properties), "additionalProperties": False},
        }}

    @staticmethod
    def _decode_call(call: Any) -> tuple[str, dict[str, Any], str]:
        if not isinstance(call, Mapping):
            raise RuntimeError("Agent backend returned a malformed tool call")
        function = call.get("function")
        if not isinstance(function, Mapping):
            raise RuntimeError("Agent backend returned a malformed function call")
        name = function.get("name")
        raw = function.get("arguments", "{}")
        call_id = call.get("id")
        if not isinstance(name, str):
            raise RuntimeError("Agent backend returned a tool call without a name")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = None
        if not isinstance(raw, dict):
            raw = {"__invalid_arguments__": True}
        return name, raw, call_id if isinstance(call_id, str) else ""

    @classmethod
    def _jsonable(cls, value: Any) -> Any:
        if hasattr(value, "to_dict"):
            return cls._jsonable(value.to_dict())
        if is_dataclass(value):
            return cls._jsonable(asdict(value))
        if isinstance(value, Path):
            return str(value)
        if isinstance(value, Mapping):
            return {str(key): cls._jsonable(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [cls._jsonable(item) for item in value]
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        return str(value)


class _AgentCancelled(Exception):
    """Internal control flow used to return a normal cancelled AgentResult."""
