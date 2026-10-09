#!/usr/bin/env python3
"""Deterministic stand-in for the real Pi CLI, used by the test suite.

It records each invocation (pid, argv, prompt hash) and emits a realistic JSON
event stream, so isolation and normalization can be tested without network
access or model calls.

Environment controls:
  FAKE_PI_LOG         append one JSON line per invocation
  FAKE_PI_PROMPT_OUT  write the received prompt to this path
  FAKE_PI_EXIT        exit code (default 0)
  FAKE_PI_SLEEP       seconds to sleep before finishing (for timeout/cancel)
  FAKE_PI_WRITE_FILE  create this file (relative to cwd) via a write tool event
  FAKE_PI_TEXT        override the assistant text (delta and final message)
  FAKE_PI_STREAM      "thinking", "thinking_loop" or "text": stream that delta type
  FAKE_PI_STREAM_SECONDS  how long to keep streaming (default 0 = off)
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import uuid


def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def main() -> int:
    argv = sys.argv[1:]

    if "--version" in argv:
        print("fake-pi 1.0.0")
        return 0
    if "--help" in argv:
        print("--mode <json|rpc>\n--no-session\n--tools <list>\n--provider <name>\n--model <id>")
        return 0

    if "--list-models" in argv:
        print("provider model context max-out thinking images")
        print(f"fake {os.environ.get('PI_CODING_AGENT_DIR', 'default')} 32K 8K yes no")
        return 0

    time.sleep(float(os.environ.get("FAKE_PI_BEFORE_READ_SLEEP", "0")))
    prompt = sys.stdin.read()
    run_id = str(uuid.uuid4())
    text = os.environ.get("FAKE_PI_TEXT") or f"ran {run_id}"
    final_text = os.environ.get("FAKE_PI_TEXT") or f"completed run {run_id}"

    if "--continue" in argv or "-c" in argv or "--resume" in argv or "-r" in argv:
        sys.stderr.write("fake-pi: forbidden session reuse flag\n")
        return 3

    log_path = os.environ.get("FAKE_PI_LOG")
    if log_path:
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "run_id": run_id,
                        "pid": os.getpid(),
                        "argv": argv,
                        "cwd": os.getcwd(),
                        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                        "prompt_length": len(prompt),
                    }
                )
                + "\n"
            )

    prompt_out = os.environ.get("FAKE_PI_PROMPT_OUT")
    if prompt_out:
        with open(prompt_out, "w", encoding="utf-8") as handle:
            handle.write(prompt)

    session_id = str(uuid.uuid4())
    emit({"type": "session", "version": 3, "id": session_id, "timestamp": "2024-01-01T00:00:00.000Z", "cwd": os.getcwd()})
    emit({"type": "agent_start"})
    emit({"type": "turn_start"})
    emit({"type": "message_start", "message": {"role": "user", "content": prompt}})
    emit({"type": "message_end", "message": {"role": "user", "content": prompt}})
    emit({"type": "message_start", "message": {"role": "assistant", "content": [], "stopReason": "pending"}})
    emit(
        {
            "type": "message_update",
            "usage": {"input": 10, "output": 5, "totalTokens": 15},
            "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": text},
        }
    )

    write_file = os.environ.get("FAKE_PI_WRITE_FILE")
    if write_file:
        emit({"type": "tool_execution_start", "toolCallId": "call_1", "toolName": "write", "args": {"path": write_file, "content": "x"}})
        emit({"type": "tool_execution_end", "toolCallId": "call_1", "toolName": "write", "result": {"content": []}, "isError": False})
        with open(write_file, "w", encoding="utf-8") as handle:
            handle.write("written by fake pi\n")

    emit({"type": "tool_execution_start", "toolCallId": "call_2", "toolName": "bash", "args": {"command": "python -m unittest"}})
    emit({"type": "tool_execution_end", "toolCallId": "call_2", "toolName": "bash", "result": {"content": []}, "isError": False})

    stream = os.environ.get("FAKE_PI_STREAM")
    stream_seconds = float(os.environ.get("FAKE_PI_STREAM_SECONDS", "0") or "0")
    if stream and stream_seconds > 0:
        delta_type = "thinking_delta" if stream in ("thinking", "thinking_loop") else "text_delta"
        stream_deadline = time.monotonic() + stream_seconds
        counter = 0
        while time.monotonic() < stream_deadline:
            if stream == "thinking_loop":
                delta = "Company X is in Verona province, not in Vicenza. Stop it. "
            elif stream == "thinking":
                delta = f"reasoning step {counter} about a distinct subject; "
            else:
                delta = "stream "
            emit(
                {
                    "type": "message_update",
                    "assistantMessageEvent": {"type": delta_type, "contentIndex": 0, "delta": delta},
                }
            )
            counter += 1
            time.sleep(0.2)

    sleep_seconds = float(os.environ.get("FAKE_PI_SLEEP", "0"))
    if sleep_seconds > 0:
        time.sleep(sleep_seconds)

    exit_code = int(os.environ.get("FAKE_PI_EXIT", "0"))
    stop_reason = "stop" if exit_code == 0 else "error"
    emit(
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": final_text}],
                "provider": "fake",
                "model": "fake-model",
                "stopReason": stop_reason,
                "usage": {"input": 10, "output": 5, "totalTokens": 15},
            },
        }
    )
    emit({"type": "turn_end", "message": {"role": "assistant", "content": []}, "toolResults": []})
    emit({"type": "agent_end", "messages": [], "willRetry": False})
    emit({"type": "agent_settled"})
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
