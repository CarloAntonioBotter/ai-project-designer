from __future__ import annotations

import unittest

from schemas import ValidationError, parse_request
from tests.support import make_request


class ParseRequestTests(unittest.TestCase):
    def test_parses_valid_request(self) -> None:
        request = parse_request(make_request("/tmp/ws", task_id="task-007", attempt=2))
        self.assertEqual(request.task_id, "task-007")
        self.assertEqual(request.attempt, 2)
        self.assertTrue(request.pi.no_session)
        self.assertEqual(request.context.workspace_root, "/tmp/ws")

    def test_missing_task_id_is_rejected(self) -> None:
        payload = make_request("/tmp/ws")
        del payload["task_id"]
        with self.assertRaises(ValidationError):
            parse_request(payload)

    def test_bad_no_session_type_is_rejected(self) -> None:
        payload = make_request("/tmp/ws")
        payload["pi"]["noSession"] = "yes"
        with self.assertRaises(ValidationError):
            parse_request(payload)

    def test_missing_workspace_root_is_rejected(self) -> None:
        payload = make_request("/tmp/ws")
        del payload["context"]["workspaceRoot"]
        with self.assertRaises(ValidationError):
            parse_request(payload)

    def test_artifacts_and_constraints_are_parsed(self) -> None:
        payload = make_request(
            "/tmp/ws",
            artifacts=[{"path": "architecture.md", "kind": "file", "content": "hi"}],
            constraints=["no network"],
        )
        request = parse_request(payload)
        self.assertEqual(request.context.artifacts[0].path, "architecture.md")
        self.assertEqual(request.context.artifacts[0].content, "hi")
        self.assertEqual(request.context.constraints, ["no network"])


if __name__ == "__main__":
    unittest.main()
