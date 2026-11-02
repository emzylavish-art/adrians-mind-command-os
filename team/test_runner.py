import json
import subprocess
import sys
import tempfile
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

    def test_durable_queue_is_callable(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "queue.sqlite3")
            code, queued = call({
                "operation": "invoke", "tool_id": "team.queue",
                "input": {"action": "enqueue", "task": "test job", "payload": {"k": "v"}, "db": db},
            })
            self.assertEqual(code, 0)
            self.assertEqual(queued["status"], "ready", queued)
            self.assertEqual(queued["result"]["status"], "queued")
            code, claimed = call({
                "operation": "invoke", "tool_id": "team.queue",
                "input": {"action": "claim", "worker": "worker-1", "db": db},
            })
            self.assertEqual(code, 0)
            self.assertEqual(claimed["result"]["status"], "claimed")
            self.assertEqual(claimed["result"]["payload"], {"k": "v"})

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

    def test_durable_queue_runner_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "jobs.sqlite3")
            code, queued = call({
                "operation": "invoke", "tool_id": "team.queue",
                "input": {"operation": "enqueue", "db": db, "task": "test queue", "payload": {"x": 1}},
            })
            self.assertEqual(code, 0)
            self.assertEqual(queued["status"], "ready")
            job_id = queued["result"]["id"]
            code, claimed = call({
                "operation": "invoke", "tool_id": "team.queue",
                "input": {"operation": "claim", "db": db, "worker_id": "runner-test"},
            })
            self.assertEqual(code, 0)
            self.assertEqual(claimed["result"]["id"], job_id)
            code, completed = call({
                "operation": "invoke", "tool_id": "team.queue",
                "input": {"operation": "complete", "db": db, "job_id": job_id,
                          "worker_id": "runner-test", "result": {"ok": True}},
            })
            self.assertEqual(code, 0)
            self.assertEqual(completed["result"]["status"], "succeeded")

    def test_allowlisted_worker_processes_health_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "jobs.sqlite3")
            code, queued = call({
                "operation": "invoke", "tool_id": "team.queue",
                "input": {"operation": "enqueue", "db": db, "task": "health check",
                          "payload": {"tool_id": "team.health", "input": {}}},
            })
            self.assertEqual(code, 0)
            self.assertEqual(queued["status"], "ready", queued)
            code, outcome = call({
                "operation": "invoke", "tool_id": "team.worker",
                "input": {"db": db, "worker_id": "worker-test"},
            })
            self.assertEqual(code, 0)
            self.assertEqual(outcome["status"], "ready", outcome)
            self.assertEqual(outcome["result"]["status"], "succeeded")

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
