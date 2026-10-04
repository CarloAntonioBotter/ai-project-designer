"""End-to-end check of the stdin/stdout JSON boundary of executor_runner.

Guards the encoding contract: the runner is spawned with piped stdio (as the
VS Code extension does), where Python would otherwise default to the OS code
page and crash on any non-locale character in model output.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.support import PYTHON_DIR, make_fake_pi, make_request

RUNNER = PYTHON_DIR / "executor_runner.py"


class ExecutorRunnerBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.fake_pi = make_fake_pi(self.root)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_non_ascii_output_survives_piped_stdio(self) -> None:
        emoji = "\U0001f680"
        env = dict(os.environ, FAKE_PI_TEXT=f"{emoji} done")
        request = make_request(str(self.workspace), command=self.fake_pi)

        completed = subprocess.run(
            [sys.executable, str(RUNNER)],
            input=json.dumps(request),
            cwd=str(self.workspace),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
            env=env,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        envelope = json.loads(completed.stdout)
        self.assertEqual(envelope["status"], "completed")
        self.assertIn(emoji, envelope["summary"])


if __name__ == "__main__":
    unittest.main()
