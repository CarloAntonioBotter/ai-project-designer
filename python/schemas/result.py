"""Stable Python->TypeScript result envelope."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"
STATUS_TIMEOUT = "timeout"
STATUS_ERROR = "error"

VALID_STATUSES = {
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_CANCELLED,
    STATUS_TIMEOUT,
    STATUS_ERROR,
}


@dataclass
class PiRuntimeInfo:
    agent: str = "pi"
    session_mode: str = "no-session"
    command: str = "pi"
    mode: str = "json"
    version: str | None = None
    exit_code: int | None = None
    session_id: str | None = None


@dataclass
class TaskExecutionResult:
    task_id: str
    status: str
    summary: str = ""
    attempt: int = 1
    pi: PiRuntimeInfo = field(default_factory=PiRuntimeInfo)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    files_changed: list[str] = field(default_factory=list)
    tests: list[dict[str, Any]] = field(default_factory=list)
    commands_executed: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    started_at: str | None = None
    finished_at: str | None = None
    # Token usage Pi reported for the run: the host shows the context fill from it.
    usage: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        if self.status not in VALID_STATUSES:
            raise ValueError(f"invalid result status: {self.status}")
        payload = asdict(self)
        payload["pi"] = {
            "agent": self.pi.agent,
            "sessionMode": self.pi.session_mode,
            "command": self.pi.command,
            "mode": self.pi.mode,
            "version": self.pi.version,
            "exitCode": self.pi.exit_code,
            "sessionId": self.pi.session_id,
        }
        payload["files_changed"] = self.files_changed
        payload["commands_executed"] = self.commands_executed
        return payload
