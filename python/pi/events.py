"""Pi JSONL event parsing and normalization.

Pi emits one JSON object per line. This module turns that stream into:
  * live progress events (forwarded to stderr as JSON lines), and
  * accumulated facts used to build the final result envelope.

Parsing never raises on a malformed line: diagnostics are recorded and parsing
continues, because Pi may interleave non-fatal output.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterable

# Tool argument keys that name a file the tool touched.
_PATH_KEYS = ("path", "filePath", "file", "filepath", "target")

# Tools that introduce files as new artifacts rather than editing them.
_WRITE_TOOLS = {"write"}
_EDIT_TOOLS = {"edit", "apply_patch", "multi_edit", "patch"}


@dataclass
class ParsedState:
    session_id: str | None = None
    cwd: str | None = None
    text: str = ""
    thinking: str = ""
    stop_reason: str | None = None
    provider: str | None = None
    model: str | None = None
    files_changed: list[str] = field(default_factory=list)
    artifacts_created: list[str] = field(default_factory=list)
    commands_executed: list[str] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    tests: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)


def _extract_path(args: Any) -> str | None:
    if not isinstance(args, dict):
        return None
    for key in _PATH_KEYS:
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "".join(parts)
    return ""


class EventParser:
    """Incrementally consume Pi JSONL lines."""

    def __init__(self, max_recorded_events: int = 500) -> None:
        self.state = ParsedState()
        self.events: list[dict[str, Any]] = []
        self._max_recorded_events = max_recorded_events
        self._seen_files: set[str] = set()

    # -- recording helpers -------------------------------------------------
    def _record(self, normalized: dict[str, Any]) -> list[dict[str, Any]]:
        if len(self.events) < self._max_recorded_events:
            self.events.append(normalized)
        return [normalized]

    def _track_file(self, tool_name: str, args: Any) -> None:
        path = _extract_path(args)
        if not path or path in self._seen_files:
            return
        self._seen_files.add(path)
        if tool_name in _WRITE_TOOLS:
            self.state.artifacts_created.append(path)
        if tool_name in _EDIT_TOOLS or tool_name in _WRITE_TOOLS:
            self.state.files_changed.append(path)

    # -- line handling -----------------------------------------------------
    def feed(self, line: str) -> list[dict[str, Any]]:
        """Parse one JSONL record and return normalized progress events."""
        stripped = line.strip()
        if not stripped:
            return []
        try:
            event = json.loads(stripped)
        except json.JSONDecodeError:
            message = f"unparsed pi output line: {stripped[:200]}"
            self.state.warnings.append(message)
            return [{"kind": "diagnostic", "message": message}]
        if not isinstance(event, dict):
            return []
        return self.handle(event)

    def handle(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        event_type = event.get("type")

        if event_type == "session":
            self.state.session_id = event.get("id")
            self.state.cwd = event.get("cwd")
            return self._record(
                {"kind": "progress", "type": "session", "sessionId": event.get("id"), "cwd": event.get("cwd")}
            )

        if event_type == "message_update":
            return self._handle_assistant_update(event)

        if event_type == "message_end":
            return self._handle_message_end(event)

        if event_type == "tool_execution_start":
            tool_name = str(event.get("toolName", "unknown"))
            args = event.get("args")
            self.state.tool_calls.append({"name": tool_name, "args": args})
            self._track_file(tool_name, args)
            if tool_name == "bash" and isinstance(args, dict) and isinstance(args.get("command"), str):
                self.state.commands_executed.append(args["command"])
            return self._record(
                {"kind": "progress", "type": "tool_start", "tool": tool_name, "args": args}
            )

        if event_type == "tool_execution_end":
            tool_name = str(event.get("toolName", "unknown"))
            is_error = bool(event.get("isError"))
            if is_error:
                self.state.errors.append(f"tool {tool_name} failed")
            return self._record(
                {"kind": "progress", "type": "tool_end", "tool": tool_name, "isError": is_error}
            )

        if event_type == "auto_retry_start":
            message = f"pi auto-retry attempt {event.get('attempt')}: {event.get('errorMessage', '')}"
            self.state.warnings.append(message)
            return self._record({"kind": "progress", "type": "retry", "message": message})

        if event_type == "auto_retry_end" and not event.get("success", True):
            message = str(event.get("finalError", "pi auto-retry exhausted"))
            self.state.errors.append(message)
            return self._record({"kind": "progress", "type": "error", "message": message})

        if event_type in ("compaction_start", "compaction_end"):
            return self._record({"kind": "progress", "type": event_type, "reason": event.get("reason")})

        if event_type == "agent_settled":
            return self._record({"kind": "progress", "type": "phase", "phase": "settled"})

        return []

    def _handle_assistant_update(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        self.state.usage = event.get("usage", self.state.usage) or self.state.usage
        inner = event.get("assistantMessageEvent")
        if not isinstance(inner, dict):
            return []
        inner_type = inner.get("type")
        if inner_type == "text_delta":
            delta = str(inner.get("delta", ""))
            return self._record({"kind": "progress", "type": "text", "delta": delta})
        if inner_type == "thinking_delta":
            delta = str(inner.get("delta", ""))
            return self._record({"kind": "progress", "type": "thinking", "delta": delta})
        if inner_type == "toolcall_start":
            return self._record(
                {"kind": "progress", "type": "toolcall_start", "tool": inner.get("toolName")}
            )
        return []

    def _handle_message_end(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        message = event.get("message")
        if not isinstance(message, dict):
            return []
        role = message.get("role")
        if role == "assistant":
            text = _message_text(message.get("content"))
            if text:
                self.state.text = text
            self.state.stop_reason = message.get("stopReason") or self.state.stop_reason
            self.state.provider = message.get("provider") or self.state.provider
            self.state.model = message.get("model") or self.state.model
            self.state.usage = message.get("usage") or self.state.usage
            if self.state.stop_reason in ("error", "aborted"):
                self.state.errors.append(f"pi stopped with reason: {self.state.stop_reason}")
        return []

    # -- finalization ------------------------------------------------------
    def final_text(self) -> str:
        return self.state.text.strip()

    def test_reports(self) -> list[dict[str, Any]]:
        """Best-effort test detection from executed commands."""
        reports: list[dict[str, Any]] = []
        for command in self.state.commands_executed:
            lowered = command.lower()
            if any(token in lowered for token in ("test", "pytest", "jest", "vitest", "unittest")):
                reports.append({"command": command, "detected": True})
        return reports

    def feed_all(self, lines: Iterable[str]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for line in lines:
            normalized.extend(self.feed(line))
        return normalized
