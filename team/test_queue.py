import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "queue.py"
spec = importlib.util.spec_from_file_location("agent_queue", SCRIPT)
agent_queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_queue)


class DurableQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "jobs.sqlite3"

    def tearDown(self):
        self.tmp.cleanup()

    def test_enqueue_claim_complete_round_trip(self):
        queued = agent_queue.enqueue(self.db, "inventory repo", {"repo": "local"})
        self.assertEqual(queued["status"], "queued")
        claimed = agent_queue.claim(self.db, "worker-a")
        self.assertEqual(claimed["id"], queued["id"])
        self.assertEqual(claimed["attempts"], 1)
        completed = agent_queue.finish(self.db, queued["id"], "worker-a", {"files": 4})
        self.assertEqual(completed["status"], "succeeded")
        self.assertEqual(agent_queue.decode_job(completed)["result"], {"files": 4})

    def test_failure_requeues_then_terminal_after_attempt_limit(self):
        queued = agent_queue.enqueue(self.db, "retry task", {}, max_attempts=2)
        first = agent_queue.claim(self.db, "worker-a")
        requeued = agent_queue.fail(self.db, queued["id"], "worker-a", "transient")
        self.assertEqual(requeued["status"], "queued")
        second = agent_queue.claim(self.db, "worker-b")
        self.assertEqual(second["attempts"], 2)
        failed = agent_queue.fail(self.db, queued["id"], "worker-b", "final error")
        self.assertEqual(failed["status"], "failed")

    def test_worker_cannot_complete_another_workers_job(self):
        queued = agent_queue.enqueue(self.db, "secure task", {})
        agent_queue.claim(self.db, "worker-a")
        with self.assertRaises(ValueError):
            agent_queue.finish(self.db, queued["id"], "worker-b", {})

    def test_empty_queue_claim_returns_none(self):
        self.assertIsNone(agent_queue.claim(self.db, "worker-a"))

    def test_expired_final_lease_becomes_failed(self):
        queued = agent_queue.enqueue(self.db, "last attempt", {}, max_attempts=1)
        claimed = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        with agent_queue.connect(self.db) as conn:
            conn.execute("UPDATE jobs SET lease_until=0 WHERE id=?", (queued["id"],))
        self.assertIsNone(agent_queue.claim(self.db, "worker-b"))
        final = agent_queue.get_job(self.db, queued["id"])
        self.assertEqual(final["status"], "failed")
        self.assertIsNone(final["worker_id"])


if __name__ == "__main__":
    unittest.main()
