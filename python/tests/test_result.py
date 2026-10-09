from __future__ import annotations

import unittest

from pi.events import EventParser
from pi.result import map_status, normalize
from schemas import parse_request
from tests.support import make_request


class MapStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.parser = EventParser()

    def test_completed_on_zero_exit(self) -> None:
        self.assertEqual(map_status(0, False, False, self.parser), "completed")

    def test_failed_on_nonzero_exit(self) -> None:
        self.assertEqual(map_status(1, False, False, self.parser), "failed")

    def test_cancelled_takes_precedence(self) -> None:
        self.assertEqual(map_status(None, True, False, self.parser), "cancelled")

    def test_timeout(self) -> None:
        self.assertEqual(map_status(None, False, True, self.parser), "timeout")

    def test_error_stop_reason_causes_failure(self) -> None:
        self.parser.feed('{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error"}}')
        self.assertEqual(map_status(0, False, False, self.parser), "failed")


class NormalizeTests(unittest.TestCase):
    def test_envelope_shape(self) -> None:
        request = parse_request(make_request("/tmp/ws", task_id="task-003", attempt=2))
        parser = EventParser()
        parser.feed('{"type":"session","id":"sess-1"}')
        parser.feed('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"stopReason":"stop"}}')
        parser.feed('{"type":"tool_execution_start","toolCallId":"1","toolName":"write","args":{"path":"a.md"}}')

        parser.feed('{"type":"tool_execution_end","toolCallId":"1","toolName":"write","isError":false}')
        result = normalize(request, request.pi, parser, exit_code=0, version="0.87.1").to_dict()

        self.assertEqual(result["task_id"], "task-003")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["attempt"], 2)
        self.assertEqual(result["pi"]["sessionMode"], "no-session")
        self.assertEqual(result["pi"]["exitCode"], 0)
        self.assertEqual(result["pi"]["version"], "0.87.1")
        self.assertEqual(result["pi"]["sessionId"], "sess-1")
        self.assertIn("a.md", result["files_changed"])
        self.assertEqual(result["artifacts"][0]["path"], "a.md")

    def test_cancelled_has_no_success_status(self) -> None:
        request = parse_request(make_request("/tmp/ws"))
        parser = EventParser()
        result = normalize(request, request.pi, parser, exit_code=None, cancelled=True).to_dict()
        self.assertEqual(result["status"], "cancelled")
        self.assertNotEqual(result["status"], "completed")

    def test_zero_tool_calls_with_tools_enabled_is_not_completed(self) -> None:
        request = parse_request(make_request("/tmp/ws"))
        parser = EventParser()
        parser.feed('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop"}}')
        result = normalize(request, request.pi, parser, exit_code=0).to_dict()
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["errors"])

    def test_zero_tool_calls_without_tools_is_completed(self) -> None:
        request = parse_request(make_request("/tmp/ws"))
        request.pi.no_tools = True
        parser = EventParser()
        parser.feed('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"plan"}],"stopReason":"stop"}}')
        result = normalize(request, request.pi, parser, exit_code=0).to_dict()
        self.assertEqual(result["status"], "completed")

    def test_zero_tool_calls_with_raw_prompt_is_completed(self) -> None:
        # The planner is handed read-only tools but may answer without using them.
        request = parse_request(make_request("/tmp/ws", task_id="planner"))
        request.raw_prompt = True
        parser = EventParser()
        parser.feed('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"{}"}],"stopReason":"stop"}}')
        result = normalize(request, request.pi, parser, exit_code=0).to_dict()
        self.assertEqual(result["status"], "completed")


if __name__ == "__main__":
    unittest.main()
