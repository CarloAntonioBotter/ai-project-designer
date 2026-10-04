from __future__ import annotations

import unittest

from pi.events import EventParser


class EventParserTests(unittest.TestCase):
    def test_extracts_text_from_message_end(self) -> None:
        parser = EventParser()
        parser.feed('{"type":"session","id":"abc","cwd":"/ws"}')
        parser.feed('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop"}}')
        self.assertEqual(parser.final_text(), "done")
        self.assertEqual(parser.state.session_id, "abc")
        self.assertEqual(parser.state.stop_reason, "stop")

    def test_streams_text_deltas(self) -> None:
        parser = EventParser()
        events = parser.feed(
            '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"He"}}'
        )
        self.assertEqual(events[0]["type"], "text")
        self.assertEqual(events[0]["delta"], "He")

    def test_tracks_written_files_and_commands(self) -> None:
        parser = EventParser()
        parser.feed('{"type":"tool_execution_start","toolCallId":"1","toolName":"write","args":{"path":"src/a.ts"}}')
        parser.feed('{"type":"tool_execution_start","toolCallId":"2","toolName":"bash","args":{"command":"python -m unittest"}}')
        self.assertIn("src/a.ts", parser.state.artifacts_created)
        self.assertIn("src/a.ts", parser.state.files_changed)
        self.assertEqual(parser.state.commands_executed, ["python -m unittest"])
        self.assertEqual(parser.test_reports(), [{"command": "python -m unittest", "detected": True}])

    def test_malformed_line_is_recorded_not_raised(self) -> None:
        parser = EventParser()
        events = parser.feed("this is not json")
        self.assertEqual(events[0]["kind"], "diagnostic")
        self.assertEqual(len(parser.state.warnings), 1)

    def test_error_stop_reason_recorded(self) -> None:
        parser = EventParser()
        parser.feed('{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error"}}')
        self.assertTrue(any("error" in warning for warning in parser.state.errors))

    def test_blank_lines_ignored(self) -> None:
        parser = EventParser()
        self.assertEqual(parser.feed("   "), [])


if __name__ == "__main__":
    unittest.main()
