from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from pi.events import EventParser
from pi.result import map_status
from pi.runner import CANCEL_EVENT, PiRunner, _probe, _terminate, check_runtime
from schemas import parse_request
from tests.support import make_fake_pi, make_request


class EventRegressionTests(unittest.TestCase):
    def tool(self, parser, tool, args, error=False):
        parser.handle({"type": "tool_execution_start", "toolCallId": "1", "toolName": tool, "args": args})
        parser.handle({"type": "tool_execution_end", "toolCallId": "1", "toolName": tool, "isError": error})

    def test_read_then_edit_is_recorded_once(self):
        parser = EventParser()
        self.tool(parser, "read", {"path": "a.txt"})
        self.tool(parser, "edit", {"path": "a.txt"})
        self.tool(parser, "edit", {"path": "a.txt"})
        self.assertEqual(parser.state.files_changed, ["a.txt"])

    def test_failed_write_is_not_an_artifact_and_recovery_clears_failure(self):
        parser = EventParser()
        self.tool(parser, "write", {"path": "a.txt"}, True)
        self.assertEqual(parser.state.files_changed, [])
        self.assertEqual(map_status(0, False, False, parser), "failed")
        self.tool(parser, "write", {"path": "a.txt"})
        self.assertEqual(map_status(0, False, False, parser), "completed")
        self.assertEqual(parser.state.artifacts_created, ["a.txt"])

    def test_commands_record_outcomes_and_recovered_retry(self):
        parser = EventParser()
        self.tool(parser, "bash", {"command": "npm test"}, True)
        self.assertEqual(map_status(0, False, False, parser), "failed")
        self.tool(parser, "bash", {"command": "npm test"})
        self.assertEqual(map_status(0, False, False, parser), "completed")
        self.assertEqual([r["status"] for r in parser.test_reports()], ["failed", "passed"])

    def test_failed_read_can_legitimately_lead_to_create(self):
        parser = EventParser()
        self.tool(parser, "read", {"path": "missing"}, True)
        self.tool(parser, "write", {"path": "missing"})
        self.assertEqual(map_status(0, False, False, parser), "completed")


class ProcessRegressionTests(unittest.TestCase):
    def tearDown(self):
        CANCEL_EVENT.clear()

    def test_probe_cancellation_terminates_child(self):
        CANCEL_EVENT.set()
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            _probe([sys.executable, "-c", "import time; time.sleep(60)"])
        self.assertLess(time.monotonic() - started, 8)

    def test_runtime_is_present_but_incompatible(self):
        with patch("pi.runner._probe", return_value=subprocess.CompletedProcess([], 0, "legacy CLI", "")):
            info = check_runtime(sys.executable)
        self.assertTrue(info["available"])
        self.assertFalse(info["compatible"])
        self.assertIsNotNone(info["error"])

    def test_timeout_covers_blocked_stdin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = make_fake_pi(root)
            request = parse_request(make_request(directory, command=command, timeout_ms=300,
                prompt="x" * 1000000))
            with patch.dict(os.environ, {"FAKE_PI_BEFORE_READ_SLEEP": "60"}):
                started = time.monotonic()
                result = PiRunner().run(request)
            self.assertEqual(result.status, "timeout")
            self.assertLess(time.monotonic() - started, 10)

    @unittest.skipIf(os.name == "nt", "POSIX process group regression")
    def test_terminate_kills_descendants_even_after_parent_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "leaked.txt"
            child_code = f"import time; from pathlib import Path; time.sleep(1); Path({str(marker)!r}).write_text('leaked')"
            proc = subprocess.Popen([sys.executable, "-c",
                f"import subprocess,sys; subprocess.Popen([sys.executable, '-c', {child_code!r}])"],
                start_new_session=True)
            proc.wait(timeout=5)
            _terminate(proc)
            time.sleep(1.3)
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
