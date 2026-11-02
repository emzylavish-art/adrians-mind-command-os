import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "team" / "runner.py"


def call(payload):
    proc = subprocess.run(
        [sys.executable, str(RUNNER)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    return proc.returncode, json.loads(proc.stdout)


class RunnerTests(unittest.TestCase):
    def test_list_tools_returns_catalog(self):
        code, result = call({"operation": "list-tools"})
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "ready")
        self.assertTrue(any(item["id"] == "rea.scan" for item in result["result"]))

    def test_rea_scan_executes(self):
        code, result = call({"operation": "invoke", "tool_id": "rea.scan", "input": {"path": "team"}})
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "ready")
        self.assertIsInstance(result["result"], dict)
        self.assertIn("tools/rea/rea.py", result["evidence"])

    def test_security_scan_executes(self):
        code, result = call({
            "operation": "invoke",
            "tool_id": "security.scan",
            "input": {"path": "team"},
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "ready")
        self.assertIsInstance(result["result"], dict)
        self.assertIn("tools/security_review/security_review.py", result["evidence"])
        self.assertTrue(result["limitations"])

    def test_team_health_executes(self):
        code, result = call({"operation": "invoke", "tool_id": "team.health", "input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["result"]["status"], "ok")
        self.assertIn("team/health.py", result["evidence"])

    def test_team_health_executes(self):
        code, result = call({"operation": "invoke", "tool_id": "team.health", "input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["result"]["status"], "ok")
        self.assertIn("team/health.py", result["evidence"])

    def test_knowledge_search_executes(self):
        code, result = call({
            "operation": "invoke",
            "tool_id": "knowledge.search",
            "input": {"path": "team", "query": "manifest agent tool", "top_k": 3},
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "ready")
        self.assertIsInstance(result["result"]["results"], list)
        self.assertIn("tools/knowledge/knowledge_search.py", result["evidence"])

    def test_unavailable_tool_is_not_claimed_ready(self):
        code, result = call({"operation": "invoke", "tool_id": "gods-eyes", "input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "blocked")
        self.assertIn("source_unmapped", result["limitations"][0])

    def test_routes_capability(self):
        code, result = call({"operation": "route", "task": "inspect source", "capabilities": ["source_inventory"]})
        self.assertEqual(code, 0)
        self.assertEqual(result["dispatch"]["agent_id"], "rea")


if __name__ == "__main__":
    unittest.main()
