"""PiRunner: the only component that spawns and controls a Pi process.

Each call to :meth:`PiRunner.run` creates a brand new Pi process in an isolated,
no-session execution. No state is shared between runs; the agentic loop belongs
entirely to Pi.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from dataclasses import replace
from typing import Any, Callable

from schemas.result import STATUS_ERROR, TaskExecutionResult, PiRuntimeInfo
from schemas.task import PiConfig, TaskExecutionRequest
from .command import IsolationError, assert_isolated, build_argv, build_prompt, resolve_command
from .events import EventParser
from .result import normalize

ProgressCallback = Callable[[dict[str, Any]], None]

# Set by the signal handler so a long run can be interrupted cleanly.
CANCEL_EVENT = threading.Event()

_TERMINATE_GRACE_SECONDS = 3.0


def _install_signal_handlers() -> None:
    def _handler(signum: int, _frame: Any) -> None:  # pragma: no cover - signal path
        CANCEL_EVENT.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handler)
        except (ValueError, OSError):
            # Not on the main thread, or unsupported signal on this platform.
            pass


def _terminate(proc: subprocess.Popen[str]) -> None:
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/pid", str(proc.pid), "/T", "/F"],
                capture_output=True,
                check=False,
                timeout=5,
            )
        else:
            os.killpg(proc.pid, signal.SIGTERM)
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        proc.wait(timeout=_TERMINATE_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        try:
            if os.name == "nt":
                proc.kill()
            else:
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=_TERMINATE_GRACE_SECONDS)
        except (OSError, subprocess.TimeoutExpired):
            pass
    if os.name != "nt":
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def _probe(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
    """Bound probes too: extensions/providers can block during CLI startup."""
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", start_new_session=(os.name != "nt"), **kwargs)
    deadline = time.monotonic() + 10
    while True:
        try:
            stdout, stderr = proc.communicate(timeout=0.2)
            return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)
        except subprocess.TimeoutExpired:
            if CANCEL_EVENT.is_set() or time.monotonic() >= deadline:
                _terminate(proc)
                for stream in (proc.stdout, proc.stderr):
                    if stream is not None:
                        stream.close()
                raise


def parse_model_table(output: str) -> list[dict[str, Any]]:
    """Parse the fixed-width table printed by `pi --list-models`."""
    models: list[dict[str, Any]] = []
    for line in output.splitlines():
        parts = line.split()
        # provider model context max-out thinking images
        if len(parts) != 6 or parts[0] == "provider":
            continue
        if parts[4] not in ("yes", "no") or parts[5] not in ("yes", "no"):
            continue
        models.append(
            {
                "provider": parts[0],
                "model": parts[1],
                "context": parts[2],
                "maxOutput": parts[3],
                "thinking": parts[4] == "yes",
                "images": parts[5] == "yes",
            }
        )
    return models


def list_models(command: str, cwd: str | None = None) -> list[dict[str, Any]]:
    """Ask the Pi CLI which models are actually available (respects auth)."""
    command = resolve_command(command)
    try:
        completed = _probe([command, "--list-models"], cwd=cwd)
    except (OSError, subprocess.SubprocessError):
        return []
    if completed.returncode != 0:
        return []
    return parse_model_table(completed.stdout or "")


def probe_version(command: str, cwd: str | None = None, env: dict[str, str] | None = None) -> str | None:
    command = resolve_command(command)
    try:
        completed = _probe([command, "--version"], cwd=cwd, env=env)
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    output = (completed.stdout or completed.stderr or "").strip()
    return output.splitlines()[0] if output else None


def check_runtime(command: str) -> dict[str, Any]:
    """Verify the installed Pi CLI and the modes the project relies on."""
    command = resolve_command(command)
    info: dict[str, Any] = {
        "available": False,
        "compatible": False,
        "command": command,
        "version": None,
        "jsonMode": False,
        "noSession": False,
        "toolAllowlist": False,
        "error": None,
    }
    try:
        completed = _probe([command, "--help"])
    except FileNotFoundError:
        info["error"] = f"pi executable not found: {command}"
        return info
    except (OSError, subprocess.SubprocessError) as exc:
        info["error"] = f"failed to run {command} --help: {exc}"
        return info

    if completed.returncode != 0:
        info["error"] = f"{command} --help exited with code {completed.returncode}"
        return info

    help_text = completed.stdout or ""
    info["available"] = True
    info["version"] = probe_version(command)
    info["jsonMode"] = "--mode" in help_text and "json" in help_text
    info["noSession"] = "--no-session" in help_text
    info["toolAllowlist"] = "--tools" in help_text
    info["compatible"] = all(info[key] for key in ("version", "jsonMode", "noSession", "toolAllowlist"))
    if not info["compatible"]:
        info["error"] = "Pi is installed but required CLI capabilities are missing"
    return info


class PiRunner:
    """Execute a single task through one isolated Pi run."""

    def __init__(self, on_progress: ProgressCallback | None = None) -> None:
        self._on_progress = on_progress

    def _emit(self, event: dict[str, Any]) -> None:
        if self._on_progress is not None:
            self._on_progress(event)

    def run(self, request: TaskExecutionRequest) -> TaskExecutionResult:
        CANCEL_EVENT.clear()
        _install_signal_handlers()

        config = replace(request.pi, command=resolve_command(request.pi.command))
        parser = EventParser()
        started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        try:
            argv = build_argv(config)
            assert_isolated(config, argv)
        except IsolationError as exc:
            return self._error_result(request, config, parser, str(exc), started_at)

        workspace = request.context.workspace_root
        if not os.path.isdir(workspace):
            return self._error_result(
                request, config, parser, f"workspaceRoot is not a directory: {workspace}", started_at
            )

        deadline = time.monotonic() + config.timeout_ms / 1000.0
        env = self._build_env(config, request)
        version = probe_version(config.command, cwd=workspace, env=env)
        if version is None:
            return self._error_result(
                request,
                config,
                parser,
                f"pi executable not available: {config.command} (run 'AI Project Designer: Check Pi Runtime')",
                started_at,
            )

        prompt = request.prompt if request.raw_prompt else build_prompt(request)

        try:
            proc = subprocess.Popen(
                argv,
                cwd=workspace,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=env,
                start_new_session=(os.name != "nt"),
            )
        except OSError as exc:
            return self._error_result(request, config, parser, f"failed to start pi: {exc}", started_at)

        stderr_tail: list[str] = []
        stdout_thread = threading.Thread(
            target=self._pump_stdout, args=(proc, parser), name="pi-stdout", daemon=True
        )
        stderr_thread = threading.Thread(
            target=self._pump_stderr, args=(proc, stderr_tail), name="pi-stderr", daemon=True
        )
        stdout_thread.start()
        stderr_thread.start()

        def write_prompt() -> None:
            try:
                if proc.stdin is not None:
                    proc.stdin.write(prompt)
            except OSError as exc:
                stderr_tail.append(f"failed to write prompt to pi stdin: {exc}")
            finally:
                if proc.stdin is not None:
                    try:
                        proc.stdin.close()
                    except OSError:
                        pass

        writer = threading.Thread(target=write_prompt, name="pi-stdin", daemon=True)
        writer.start()
        cancelled, timed_out = self._wait(proc, max(0, int((deadline - time.monotonic()) * 1000)))
        writer.join(timeout=1)
        # A completed parent may still have spawned children holding its pipes open.
        if os.name != "nt":
            _terminate(proc)
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        for stream in (proc.stdout, proc.stderr):
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass

        exit_code = proc.returncode
        result = normalize(
            request,
            config,
            parser,
            exit_code=exit_code,
            cancelled=cancelled,
            timed_out=timed_out,
            version=version,
            started_at=started_at,
            stderr_tail=stderr_tail,
        )
        self._emit({"kind": "progress", "type": "phase", "phase": "finalizing"})
        return result

    def _wait(self, proc: subprocess.Popen[str], timeout_ms: int) -> tuple[bool, bool]:
        """Wait for pi, stopping on cancel or on the configured deadline."""
        deadline = time.monotonic() + (timeout_ms / 1000.0)
        cancelled = False
        timed_out = False
        while proc.poll() is None:
            if CANCEL_EVENT.is_set():
                cancelled = True
                _terminate(proc)
                break
            if time.monotonic() >= deadline:
                timed_out = True
                _terminate(proc)
                break
            time.sleep(0.1)
        return cancelled, timed_out

    def _pump_stdout(self, proc: subprocess.Popen[str], parser: EventParser) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            events = parser.feed(line)
            for event in events:
                self._emit(event)

    def _pump_stderr(self, proc: subprocess.Popen[str], tail: list[str]) -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            tail.append(line.rstrip("\r\n"))
            if len(tail) > 200:
                del tail[0]

    def _build_env(self, config: PiConfig, request: TaskExecutionRequest) -> dict[str, str]:
        env = dict(os.environ)
        if config.agent_dir:
            env["PI_CODING_AGENT_DIR"] = config.agent_dir
        env.update(request.context.environment)
        if config.agent_dir:
            env["PI_CODING_AGENT_DIR"] = config.agent_dir
        return env

    def _error_result(
        self,
        request: TaskExecutionRequest,
        config: PiConfig,
        parser: EventParser,
        message: str,
        started_at: str,
    ) -> TaskExecutionResult:
        self._emit({"kind": "diagnostic", "message": message})
        return TaskExecutionResult(
            task_id=request.task_id,
            status=STATUS_ERROR,
            summary=message,
            attempt=request.attempt,
            pi=PiRuntimeInfo(
                agent="pi",
                session_mode="no-session" if config.no_session else "session",
                command=config.command,
                mode=config.mode,
                exit_code=None,
            ),
            errors=[message],
            events=parser.events,
            started_at=started_at,
        )
