"""Normalize a finished Pi run into the stable result envelope."""

from __future__ import annotations

from datetime import datetime, timezone

from schemas.result import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_ERROR,
    STATUS_FAILED,
    STATUS_TIMEOUT,
    PiRuntimeInfo,
    TaskExecutionResult,
)
from schemas.task import PiConfig, TaskExecutionRequest
from .events import EventParser


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def map_status(exit_code: int | None, cancelled: bool, timed_out: bool, parser: EventParser) -> str:
    """Map process outcome to a task status."""
    if cancelled:
        return STATUS_CANCELLED
    if timed_out:
        return STATUS_TIMEOUT
    if exit_code is None:
        return STATUS_ERROR
    if exit_code != 0:
        return STATUS_FAILED
    if parser.state.stop_reason in ("error", "aborted") or parser.state.tool_failures:
        return STATUS_FAILED
    return STATUS_COMPLETED


def normalize(
    request: TaskExecutionRequest,
    config: PiConfig,
    parser: EventParser,
    *,
    exit_code: int | None,
    cancelled: bool = False,
    timed_out: bool = False,
    version: str | None = None,
    started_at: str | None = None,
    stderr_tail: list[str] | None = None,
) -> TaskExecutionResult:
    status = map_status(exit_code, cancelled, timed_out, parser)

    errors = list(parser.state.errors) + list(parser.state.tool_failures.values())
    warnings = list(parser.state.warnings)
    if timed_out:
        errors.append(f"pi execution timed out after {config.timeout_ms} ms")
    if cancelled:
        errors.append("pi execution cancelled by host")
    if stderr_tail:
        for line in stderr_tail[-20:]:
            if line.strip():
                warnings.append(f"pi stderr: {line.strip()[:400]}")

    # A tool-enabled run that invoked zero tools did nothing. Pi exits 0 even
    # when the selected model never emits a tool call (e.g. an OCR model), so
    # without this guard the task is reported "completed" over an empty
    # workspace. A raw-prompt run (planner/probe) is not an executor run: it may
    # be handed read-only tools and still answer without using them.
    if (
        status == STATUS_COMPLETED
        and not config.no_tools
        and not request.raw_prompt
        and not parser.state.tool_calls
    ):
        status = STATUS_FAILED
        if parser.final_text():
            errors.append(
                "pi produced no tool calls; the selected executor model "
                f"({config.provider or 'default'}/{config.model or 'default'}) may not support tool use — "
                "set aiProjectDesigner.pi.model to a tool-capable model"
            )
        else:
            # Reasoning without a single action or sentence: the turn was cut
            # before the model produced anything, not a tool-capability problem.
            errors.append(
                "pi produced no tool calls and no output: the run ended after reasoning only, "
                "so the model never acted — lower aiProjectDesigner.pi.thinking or raise the model "
                "output budget, then retry the task"
            )

    summary = parser.final_text()
    if not summary:
        if status == STATUS_COMPLETED:
            summary = "Pi run completed without assistant text."
        else:
            summary = errors[-1] if errors else f"Pi run ended with status {status}."

    artifacts = [{"path": path, "kind": "file", "origin": "pi-write"} for path in parser.state.artifacts_created]

    return TaskExecutionResult(
        task_id=request.task_id,
        status=status,
        summary=summary,
        attempt=request.attempt,
        pi=PiRuntimeInfo(
            agent="pi",
            session_mode="no-session" if config.no_session else "session",
            command=config.command,
            mode=config.mode,
            version=version,
            exit_code=exit_code,
            session_id=parser.state.session_id,
        ),
        artifacts=artifacts,
        files_changed=parser.state.files_changed,
        tests=parser.test_reports(),
        commands_executed=parser.state.commands_executed,
        errors=errors,
        warnings=warnings,
        events=parser.events,
        started_at=started_at or _now(),
        finished_at=_now(),
        usage=dict(parser.state.usage),
    )
