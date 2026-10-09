"""Task request schema + validation for the Python/Pi boundary.

Validation is hand-rolled on the standard library: the payload is a small,
fixed contract, so a schema library would add a dependency without adding
safety. Unknown keys are ignored; required keys and types are enforced.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class ValidationError(ValueError):
    """Raised when an incoming request does not satisfy the task contract."""


def _require_mapping(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{where} must be a JSON object")
    return value


def _require_str(obj: dict[str, Any], key: str, where: str, default: str | None = None) -> str:
    value = obj.get(key, default)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{where}.{key} must be a non-empty string")
    return value


def _opt_str(obj: dict[str, Any], key: str, where: str) -> str | None:
    value = obj.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{where}.{key} must be a string when set")
    return value or None


def _str_list(obj: dict[str, Any], key: str, where: str) -> list[str]:
    value = obj.get(key, [])
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValidationError(f"{where}.{key} must be a list of strings")
    return list(value)


def _opt_int(obj: dict[str, Any], key: str, where: str, default: int) -> int:
    value = obj.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{where}.{key} must be an integer")
    return value


def _opt_bool(obj: dict[str, Any], key: str, where: str, default: bool) -> bool:
    value = obj.get(key, default)
    if not isinstance(value, bool):
        raise ValidationError(f"{where}.{key} must be a boolean")
    return value


@dataclass
class ContextFile:
    path: str
    content: str = ""


@dataclass
class ArtifactReference:
    path: str
    kind: str = "file"
    content: str | None = None


@dataclass
class TaskContext:
    workspace_root: str
    files: list[ContextFile] = field(default_factory=list)
    artifacts: list[ArtifactReference] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    environment: dict[str, str] = field(default_factory=dict)


@dataclass
class PiConfig:
    command: str = "pi"
    mode: str = "json"
    no_session: bool = True
    provider: str | None = None
    model: str | None = None
    thinking: str | None = None
    tools: list[str] = field(default_factory=list)
    no_tools: bool = False
    trust_project_files: bool = False
    agent_dir: str | None = None
    timeout_ms: int = 120_000
    extra_args: list[str] = field(default_factory=list)


@dataclass
class TaskExecutionRequest:
    task_id: str
    attempt: int
    prompt: str
    instructions: list[str]
    context: TaskContext
    pi: PiConfig
    # When true, `prompt` is sent verbatim instead of the executor contract wrapper.
    raw_prompt: bool = False


def _parse_context(data: Any) -> TaskContext:
    raw = _require_mapping(data, "context")
    workspace_root = _require_str(raw, "workspaceRoot", "context")
    files = [
        ContextFile(
            path=_require_str(item, "path", "context.files[]"),
            content=str(item.get("content", "")),
        )
        for item in _as_list(raw.get("files", []), "context.files")
    ]
    artifacts = [
        ArtifactReference(
            path=_require_str(item, "path", "context.artifacts[]"),
            kind=str(item.get("kind", "file")),
            content=item.get("content") if isinstance(item.get("content"), str) else None,
        )
        for item in _as_list(raw.get("artifacts", []), "context.artifacts")
    ]
    environment_raw = _require_mapping(raw.get("environment", {}), "context.environment")
    environment = {str(k): str(v) for k, v in environment_raw.items()}
    return TaskContext(
        workspace_root=workspace_root,
        files=files,
        artifacts=artifacts,
        constraints=_str_list(raw, "constraints", "context"),
        environment=environment,
    )


def _as_list(value: Any, where: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(f"{where} must be a list")
    return value


def _parse_pi(data: Any) -> PiConfig:
    raw = _require_mapping(data, "pi")
    mode = str(raw.get("mode", "json"))
    if mode != "json":
        raise ValidationError("pi.mode must be 'json' (one-shot event stream)")
    return PiConfig(
        command=_require_str(raw, "command", "pi", default="pi"),
        mode=mode,
        no_session=_opt_bool(raw, "noSession", "pi", True),
        provider=_opt_str(raw, "provider", "pi"),
        model=_opt_str(raw, "model", "pi"),
        thinking=_opt_str(raw, "thinking", "pi"),
        tools=_str_list(raw, "tools", "pi"),
        no_tools=_opt_bool(raw, "noTools", "pi", False),
        trust_project_files=_opt_bool(raw, "trustProjectFiles", "pi", False),
        agent_dir=_opt_str(raw, "agentDir", "pi"),
        timeout_ms=_opt_int(raw, "timeoutMs", "pi", 120_000),
        extra_args=_str_list(raw, "extraArgs", "pi"),
    )


def parse_request(data: Any) -> TaskExecutionRequest:
    """Validate and coerce an incoming TS->Python request payload."""
    raw = _require_mapping(data, "request")
    context = _parse_context(raw.get("context", {}))
    pi = _parse_pi(raw.get("pi", {}))
    return TaskExecutionRequest(
        task_id=_require_str(raw, "task_id", "request"),
        attempt=_opt_int(raw, "attempt", "request", 1),
        prompt=_require_str(raw, "prompt", "request"),
        instructions=_str_list(raw, "instructions", "request"),
        context=context,
        pi=pi,
        raw_prompt=_opt_bool(raw, "rawPrompt", "request", False),
    )
