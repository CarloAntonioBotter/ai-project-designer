#!/usr/bin/env python3
"""Python task runner: the mandatory process boundary between TS and Pi.

Reads one JSON :class:`TaskExecutionRequest` from stdin, runs exactly one
isolated Pi execution, streams normalized progress events to stderr (JSONL),
and writes a single stable result envelope to stdout.

Diagnostics and progress never mix with the final result: stdout carries only
the envelope, stderr carries the JSONL progress stream.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from typing import Any

from pi.runner import PiRunner, check_runtime, list_models
from schemas import STATUS_ERROR, TaskExecutionResult, ValidationError, parse_request


def _force_utf8_stdio() -> None:
    """Make the JSON boundary UTF-8 regardless of the OS locale.

    When stdio is a pipe (how the extension spawns this runner), Python defaults
    to the ANSI code page (cp1252 on Windows). The contract is UTF-8, so any
    non-locale character (emoji, CJK, ...) in model output would otherwise raise
    UnicodeEncodeError and kill the runner before it writes its envelope.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def _emit_progress(event: dict[str, Any]) -> None:
    sys.stderr.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def _write_envelope(result: TaskExecutionResult) -> None:
    sys.stdout.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _fail(task_id: str, message: str) -> int:
    sys.stderr.write(json.dumps({"kind": "diagnostic", "message": message}, ensure_ascii=False) + "\n")
    _write_envelope(
        TaskExecutionResult(task_id=task_id, status=STATUS_ERROR, summary=message, errors=[message])
    )
    return 2


def main(argv: list[str] | None = None) -> int:
    _force_utf8_stdio()
    parser = argparse.ArgumentParser(description="AI Project Designer Pi task runner")
    parser.add_argument("--check-runtime", action="store_true", help="probe the Pi CLI and exit")
    parser.add_argument("--list-models", action="store_true", help="list the models available in Pi and exit")
    parser.add_argument("--command", default="pi", help="Pi CLI command to probe")
    args = parser.parse_args(argv)

    if args.check_runtime:
        json.dump(check_runtime(args.command), sys.stdout)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 0

    if args.list_models:
        json.dump(list_models(args.command), sys.stdout)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 0

    raw = sys.stdin.read()
    if not raw.strip():
        return _fail("unknown", "empty request on stdin")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return _fail("unknown", f"invalid JSON request: {exc}")

    task_id = str(data.get("task_id", "unknown")) if isinstance(data, dict) else "unknown"
    try:
        request = parse_request(data)
    except ValidationError as exc:
        return _fail(task_id, f"invalid task request: {exc}")

    try:
        result = PiRunner(on_progress=_emit_progress).run(request)
        _write_envelope(result)
    except Exception:
        message = f"runner crashed: {traceback.format_exc().strip()}"
        sys.stderr.write(message + "\n")
        try:
            _write_envelope(
                TaskExecutionResult(task_id=task_id, status=STATUS_ERROR, summary=message, errors=[message])
            )
        except Exception:
            pass
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
