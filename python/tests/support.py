"""Test helpers shared by the Python test modules."""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PYTHON_DIR = REPO_ROOT / "python"
FAKE_PI = Path(__file__).with_name("fake_pi.py")


def make_fake_pi(tmpdir: Path) -> str:
    """Create a cross-platform launcher for fake_pi.py and return its path."""
    if os.name == "nt":
        launcher = tmpdir / "fake-pi.cmd"
        launcher.write_text(f'@echo off\r\n"{sys.executable}" "{FAKE_PI}" %*\r\n', encoding="utf-8")
    else:
        launcher = tmpdir / "fake-pi"
        launcher.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{FAKE_PI}" "$@"\n', encoding="utf-8")
        launcher.chmod(0o755)
    return str(launcher)


def make_request(
    workspace_root: str,
    *,
    task_id: str = "task-001",
    attempt: int = 1,
    prompt: str = "Do the thing",
    instructions: list[str] | None = None,
    command: str = "pi",
    no_session: bool = True,
    timeout_ms: int = 30_000,
    extra_args: list[str] | None = None,
    artifacts: list[dict] | None = None,
    constraints: list[str] | None = None,
) -> dict:
    return {
        "task_id": task_id,
        "attempt": attempt,
        "pi": {
            "command": command,
            "mode": "json",
            "noSession": no_session,
            "tools": ["read", "edit", "write", "bash"],
            "trustProjectFiles": False,
            "timeoutMs": timeout_ms,
            "extraArgs": extra_args or [],
        },
        "prompt": prompt,
        "instructions": instructions or ["Follow the objective"],
        "context": {
            "workspaceRoot": workspace_root,
            "files": [],
            "artifacts": artifacts or [],
            "constraints": constraints or [],
            "environment": {},
        },
    }
