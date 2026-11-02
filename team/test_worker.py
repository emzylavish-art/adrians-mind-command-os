import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("worker", HERE / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_normalize_rejects_unallowlisted_tool(self):
        with self.assertRaises(ValueError):
            worker.normalize_request({"tool_id": "arbitrary.shell", "input": {}})

    def test_worker_executes_allowlisted_health_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "jobs.sqlite3"
            queued = worker.queue_call(db, "enqueue", [
                "--task", "run local health check",
                "--payload", '{"tool_id":"team.health","input":{}}',
            ])
            outcome = worker.process_one(db, "test-worker", 120)
            self.assertEqual(outcome["status"], "succeeded")
            self.assertEqual(outcome["job_id"], queued["id"])
            self.assertEqual(outcome["result"]["status"], "ready")

    def test_idle_queue_returns_idle(self):
        with tempfile.TemporaryDirectory() as tmp:
            outcome = worker.process_one(Path(tmp) / "empty.sqlite3", "test-worker", 120)
            self.assertEqual(outcome["status"], "idle")


if __name__ == "__main__":
    unittest.main()
