from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from pathlib import Path

from pi.runner import CANCEL_EVENT, PiRunner, parse_model_table
from schemas import parse_request
from tests.support import make_fake_pi, make_request


def _read_log(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class RunnerIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.fake_pi = make_fake_pi(self.root)
        self.log_path = self.root / "pi-log.jsonl"
        os.environ["FAKE_PI_LOG"] = str(self.log_path)
        os.environ.pop("FAKE_PI_SLEEP", None)
        os.environ.pop("FAKE_PI_EXIT", None)

    def tearDown(self) -> None:
        CANCEL_EVENT.clear()
        for key in ("FAKE_PI_LOG", "FAKE_PI_PROMPT_OUT", "FAKE_PI_WRITE_FILE", "FAKE_PI_SLEEP", "FAKE_PI_EXIT"):
            os.environ.pop(key, None)
        self._tmp.cleanup()

    def _run(self, payload: dict) -> tuple[dict, list[dict]]:
        progress: list[dict] = []
        result = PiRunner(on_progress=progress.append).run(parse_request(payload))
        return result.to_dict(), progress

    def test_successful_task_normalizes_result(self) -> None:
        write_file = "generated.md"
        os.environ["FAKE_PI_WRITE_FILE"] = write_file
        result, progress = self._run(
            make_request(str(self.workspace), command=self.fake_pi, task_id="task-001")
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["pi"]["agent"], "pi")
        self.assertEqual(result["pi"]["sessionMode"], "no-session")
        self.assertEqual(result["pi"]["exitCode"], 0)
        self.assertEqual(result["pi"]["version"], "fake-pi 1.0.0")
        self.assertIn(write_file, result["files_changed"])
        self.assertTrue(any(event.get("type") == "text" for event in progress))

    def test_failure_exit_code_maps_to_failed(self) -> None:
        os.environ["FAKE_PI_EXIT"] = "1"
        result, _ = self._run(make_request(str(self.workspace), command=self.fake_pi))
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["pi"]["exitCode"], 1)

    def test_timeout_is_reported(self) -> None:
        os.environ["FAKE_PI_SLEEP"] = "10"
        result, _ = self._run(
            make_request(str(self.workspace), command=self.fake_pi, timeout_ms=300)
        )
        self.assertEqual(result["status"], "timeout")
        self.assertTrue(any("timed out" in error for error in result["errors"]))

    def test_cancellation_is_reported(self) -> None:
        os.environ["FAKE_PI_SLEEP"] = "10"
        timer = threading.Timer(0.6, CANCEL_EVENT.set)
        timer.start()
        try:
            result, _ = self._run(make_request(str(self.workspace), command=self.fake_pi))
        finally:
            timer.cancel()
        self.assertEqual(result["status"], "cancelled")
        self.assertNotEqual(result["status"], "completed")

    def test_missing_pi_command_is_an_error(self) -> None:
        result, _ = self._run(make_request(str(self.workspace), command="pi-does-not-exist-xyz"))
        self.assertEqual(result["status"], "error")
        self.assertIn("not available", result["summary"])

    def test_tasks_are_isolated_from_each_other(self) -> None:
        prompt_a = self.root / "prompt-a.txt"
        prompt_b = self.root / "prompt-b.txt"

        os.environ["FAKE_PI_PROMPT_OUT"] = str(prompt_a)
        result_a, _ = self._run(
            make_request(str(self.workspace), command=self.fake_pi, task_id="task-A", prompt="Task A secret")
        )
        os.environ["FAKE_PI_PROMPT_OUT"] = str(prompt_b)
        result_b, _ = self._run(
            make_request(str(self.workspace), command=self.fake_pi, task_id="task-B", prompt="Task B secret")
        )

        log = _read_log(self.log_path)
        self.assertEqual(len(log), 2, "each task must spawn its own Pi invocation")
        self.assertNotEqual(log[0]["run_id"], log[1]["run_id"], "runs must be distinct processes")
        self.assertNotEqual(result_a["pi"]["sessionId"], result_b["pi"]["sessionId"])

        for entry in log:
            self.assertIn("--no-session", entry["argv"])
            for flag in ("--continue", "-c", "--resume", "-r", "--fork", "--session"):
                self.assertNotIn(flag, entry["argv"])

        # Task B must not receive task A's transcript; only explicit artifacts are shared.
        text_b = prompt_b.read_text(encoding="utf-8")
        self.assertIn("Task B secret", text_b)
        self.assertNotIn("ran ", text_b)
        self.assertNotIn("Task A secret", text_b)

    def test_retry_creates_new_pi_invocation(self) -> None:
        self._run(make_request(str(self.workspace), command=self.fake_pi, task_id="task-R", attempt=1))
        self._run(make_request(str(self.workspace), command=self.fake_pi, task_id="task-R", attempt=2))
        log = _read_log(self.log_path)
        self.assertEqual(len(log), 2)
        self.assertNotEqual(log[0]["run_id"], log[1]["run_id"])

    def test_raw_prompt_skips_executor_contract(self) -> None:
        prompt_out = self.root / "prompt-raw.txt"
        os.environ["FAKE_PI_PROMPT_OUT"] = str(prompt_out)
        payload = make_request(str(self.workspace), command=self.fake_pi, prompt="planner system\n\nplanner user")
        payload["rawPrompt"] = True
        self._run(payload)
        text = prompt_out.read_text(encoding="utf-8")
        self.assertEqual(text, "planner system\n\nplanner user")

    def test_explicit_artifact_is_passed_to_next_task(self) -> None:
        prompt_out = self.root / "prompt-artifact.txt"
        os.environ["FAKE_PI_PROMPT_OUT"] = str(prompt_out)
        self._run(
            make_request(
                str(self.workspace),
                command=self.fake_pi,
                task_id="task-B",
                artifacts=[{"path": "architecture.md", "kind": "file", "content": "explicit artifact body"}],
            )
        )
        text = prompt_out.read_text(encoding="utf-8")
        self.assertIn("explicit artifact body", text)
        self.assertIn("INPUT ARTIFACTS", text)


class ModelTableTests(unittest.TestCase):
    def test_parses_table_skipping_header_and_blank_lines(self) -> None:
        output = (
            "provider            model                context  max-out  thinking  images\n"
            "deepseek            deepseek-flash       1M       384K     yes       yes   \n"
            "\n"
            "localllm-lm-studio  qwen/qwen3.8-27b     262.1K   65.5K    yes       yes   \n"
        )
        models = parse_model_table(output)
        self.assertEqual(
            models,
            [
                {"provider": "deepseek", "model": "deepseek-flash", "context": "1M", "maxOutput": "384K", "thinking": True, "images": True},
                {"provider": "localllm-lm-studio", "model": "qwen/qwen3.8-27b", "context": "262.1K", "maxOutput": "65.5K", "thinking": True, "images": True},
            ],
        )

    def test_empty_output_yields_no_models(self) -> None:
        self.assertEqual(parse_model_table("provider model context max-out thinking images\n"), [])


if __name__ == "__main__":
    unittest.main()
