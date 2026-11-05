import importlib.util
import tempfile
import unittest
from unittest.mock import patch
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

    def test_expired_lease_cannot_finish_or_fail_and_is_unchanged(self):
        for operation, argument in (("finish", {"stale": True}), ("fail", "stale")):
            with self.subTest(operation=operation):
                queued = agent_queue.enqueue(self.db, "expired", {})
                with patch.object(agent_queue.time, "time", return_value=1000.0):
                    agent_queue.claim(self.db, "worker-a", lease_seconds=5)
                with agent_queue.connect(self.db) as conn:
                    conn.execute("UPDATE jobs SET lease_until=1000 WHERE id=?", (queued["id"],))
                before = agent_queue.get_job(self.db, queued["id"])
                with patch.object(agent_queue.time, "time", return_value=1000.001):
                    with self.assertRaises(ValueError):
                        getattr(agent_queue, operation)(self.db, queued["id"], "worker-a", argument)
                self.assertEqual(agent_queue.get_job(self.db, queued["id"]), before)
                with agent_queue.connect(self.db) as conn:
                    conn.execute("UPDATE jobs SET status='failed' WHERE id=?", (queued["id"],))

    def test_expired_holder_cannot_finish_or_fail_after_reclaim(self):
        queued = agent_queue.enqueue(self.db, "reclaimed", {}, max_attempts=3)
        with patch.object(agent_queue.time, "time", return_value=1000.0):
            first = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        with patch.object(agent_queue.time, "time", return_value=1006.0):
            second = agent_queue.claim(self.db, "worker-b", lease_seconds=5)
        self.assertEqual(second["attempts"], first["attempts"] + 1)
        for operation, argument in (("finish", {"stale": True}), ("fail", "stale")):
            with self.subTest(operation=operation):
                with patch.object(agent_queue.time, "time", return_value=1007.0):
                    with self.assertRaises(ValueError):
                        getattr(agent_queue, operation)(self.db, queued["id"], "worker-a", argument)
                self.assertEqual(agent_queue.get_job(self.db, queued["id"]), second)

    def test_finish_and_fail_accept_exact_lease_deadline(self):
        for operation, argument, status in (
            ("finish", {"ok": True}, "succeeded"),
            ("fail", "retry", "queued"),
        ):
            with self.subTest(operation=operation):
                queued = agent_queue.enqueue(self.db, "boundary", {}, max_attempts=2)
                with patch.object(agent_queue.time, "time", return_value=1000.0):
                    agent_queue.claim(self.db, "worker-a", lease_seconds=5)
                # Claim's lease deadline is 1005.0; equality is valid.
                with patch.object(agent_queue.time, "time", return_value=1005.0):
                    updated = getattr(agent_queue, operation)(self.db, queued["id"], "worker-a", argument)
                self.assertEqual(updated["status"], status)
                self.assertIsNone(updated["worker_id"])
                self.assertIsNone(updated["lease_until"])
                if status == "queued":
                    with agent_queue.connect(self.db) as conn:
                        conn.execute("UPDATE jobs SET status='failed' WHERE id=?", (queued["id"],))

    def test_fail_uses_single_conditional_update_for_retry_decision(self):
        queued = agent_queue.enqueue(self.db, "atomic retry", {}, max_attempts=2)
        agent_queue.claim(self.db, "worker-a")
        statements = []
        original_connect = agent_queue.connect

        def traced_connect(db_path):
            conn = original_connect(db_path)
            conn.set_trace_callback(statements.append)
            return conn

        with patch.object(agent_queue, "connect", side_effect=traced_connect):
            result = agent_queue.fail(self.db, queued["id"], "worker-a", "transient")
        relevant = [sql.strip().upper() for sql in statements
                    if sql.strip().upper().startswith(("SELECT", "UPDATE"))]
        self.assertEqual(len(relevant), 2)
        self.assertTrue(relevant[0].startswith("UPDATE JOBS"), relevant)
        self.assertIn("CASE", relevant[0])
        self.assertIn("WORKER_ID=", relevant[0])
        self.assertIn("LEASE_UNTIL >=", relevant[0])
        self.assertIn("ATTEMPTS < MAX_ATTEMPTS", relevant[0])
        self.assertTrue(relevant[1].startswith("SELECT"), relevant)
        self.assertEqual(result["status"], "queued")

    def test_valid_final_attempt_failure_is_terminal(self):
        queued = agent_queue.enqueue(self.db, "final failure", {}, max_attempts=1)
        agent_queue.claim(self.db, "worker-a")
        result = agent_queue.fail(self.db, queued["id"], "worker-a", "final error")
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["worker_id"])
        self.assertIsNone(result["lease_until"])
        self.assertEqual(result["error"], "final error")

    def test_same_worker_reclaim_aba_is_not_fenced_by_legacy_interface(self):
        """Document limit: APIs carrying only worker_id cannot identify claim incarnation."""
        queued = agent_queue.enqueue(self.db, "same worker id", {}, max_attempts=3)
        with patch.object(agent_queue.time, "time", return_value=1000.0):
            first = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        with patch.object(agent_queue.time, "time", return_value=1006.0):
            second = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        self.assertEqual(second["attempts"], first["attempts"] + 1)
        # No claim-token/attempt argument exists in the preserved interface. This
        # legacy call is indistinguishable from the current holder's call.
        with patch.object(agent_queue.time, "time", return_value=1007.0):
            finished = agent_queue.finish(self.db, queued["id"], "worker-a", {"stale": True})
        self.assertEqual(finished["status"], "succeeded")

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
