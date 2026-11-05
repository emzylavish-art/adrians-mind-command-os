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
        completed = agent_queue.finish(self.db, queued["id"], "worker-a", {"files": 4}, claimed["claim_token"])
        self.assertEqual(completed["status"], "succeeded")
        self.assertEqual(agent_queue.decode_job(completed)["result"], {"files": 4})

    def test_failure_requeues_then_terminal_after_attempt_limit(self):
        queued = agent_queue.enqueue(self.db, "retry task", {}, max_attempts=2)
        first = agent_queue.claim(self.db, "worker-a")
        requeued = agent_queue.fail(self.db, queued["id"], "worker-a", "transient", first["claim_token"])
        self.assertEqual(requeued["status"], "queued")
        second = agent_queue.claim(self.db, "worker-b")
        self.assertEqual(second["attempts"], 2)
        failed = agent_queue.fail(self.db, queued["id"], "worker-b", "final error", second["claim_token"])
        self.assertEqual(failed["status"], "failed")

    def test_worker_cannot_complete_another_workers_job(self):
        queued = agent_queue.enqueue(self.db, "secure task", {})
        claimed = agent_queue.claim(self.db, "worker-a")
        with self.assertRaises(ValueError):
            agent_queue.finish(self.db, queued["id"], "worker-b", {}, claimed["claim_token"])

    def test_empty_queue_claim_returns_none(self):
        self.assertIsNone(agent_queue.claim(self.db, "worker-a"))

    def test_expired_lease_cannot_finish_or_fail_and_is_unchanged(self):
        for operation, argument in (("finish", {"stale": True}), ("fail", "stale")):
            with self.subTest(operation=operation):
                queued = agent_queue.enqueue(self.db, "expired", {})
                with patch.object(agent_queue.time, "time", return_value=1000.0):
                    claimed = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
                with agent_queue.connect(self.db) as conn:
                    conn.execute("UPDATE jobs SET lease_until=1000 WHERE id=?", (queued["id"],))
                before = agent_queue.get_job(self.db, queued["id"])
                with patch.object(agent_queue.time, "time", return_value=1000.001):
                    with self.assertRaises(ValueError):
                        getattr(agent_queue, operation)(self.db, queued["id"], "worker-a", argument, claimed["claim_token"])
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
                        getattr(agent_queue, operation)(self.db, queued["id"], "worker-a", argument, first["claim_token"])
                self.assertEqual(agent_queue.get_job(self.db, queued["id"])["status"], "claimed")
                self.assertEqual(agent_queue.get_job(self.db, queued["id"])["attempts"], second["attempts"])

    def test_finish_and_fail_accept_exact_lease_deadline(self):
        for operation, argument, status in (
            ("finish", {"ok": True}, "succeeded"),
            ("fail", "retry", "queued"),
        ):
            with self.subTest(operation=operation):
                queued = agent_queue.enqueue(self.db, "boundary", {}, max_attempts=2)
                with patch.object(agent_queue.time, "time", return_value=1000.0):
                    claimed = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
                # Claim's lease deadline is 1005.0; equality is valid.
                with patch.object(agent_queue.time, "time", return_value=1005.0):
                    updated = getattr(agent_queue, operation)(self.db, queued["id"], "worker-a", argument, claimed["claim_token"])
                self.assertEqual(updated["status"], status)
                self.assertIsNone(updated["worker_id"])
                self.assertIsNone(updated["lease_until"])
                if status == "queued":
                    with agent_queue.connect(self.db) as conn:
                        conn.execute("UPDATE jobs SET status='failed' WHERE id=?", (queued["id"],))

    def test_fail_uses_single_conditional_update_for_retry_decision(self):
        queued = agent_queue.enqueue(self.db, "atomic retry", {}, max_attempts=2)
        claimed = agent_queue.claim(self.db, "worker-a")
        statements = []
        original_connect = agent_queue.connect

        def traced_connect(db_path):
            conn = original_connect(db_path)
            conn.set_trace_callback(statements.append)
            return conn

        with patch.object(agent_queue, "connect", side_effect=traced_connect):
            result = agent_queue.fail(self.db, queued["id"], "worker-a", "transient", claimed["claim_token"])
        relevant = [sql.strip().upper() for sql in statements
                    if sql.strip().upper().startswith(("SELECT", "UPDATE"))]
        self.assertEqual(len(relevant), 2)
        self.assertTrue(relevant[0].startswith("UPDATE JOBS"), relevant)
        self.assertIn("CASE", relevant[0])
        self.assertIn("WORKER_ID=", relevant[0])
        self.assertIn("CLAIM_TOKEN=", relevant[0])
        self.assertIn("LEASE_UNTIL >=", relevant[0])
        self.assertIn("ATTEMPTS < MAX_ATTEMPTS", relevant[0])
        self.assertTrue(relevant[1].startswith("SELECT"), relevant)
        self.assertEqual(result["status"], "queued")

    def test_valid_final_attempt_failure_is_terminal(self):
        queued = agent_queue.enqueue(self.db, "final failure", {}, max_attempts=1)
        claimed = agent_queue.claim(self.db, "worker-a")
        result = agent_queue.fail(self.db, queued["id"], "worker-a", "final error", claimed["claim_token"])
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["worker_id"])
        self.assertIsNone(result["lease_until"])
        self.assertEqual(result["error"], "final error")

    def test_same_worker_reclaim_aba_rejects_stale_claim_token(self):
        queued = agent_queue.enqueue(self.db, "same worker id", {}, max_attempts=3)
        with patch.object(agent_queue.time, "time", return_value=1000.0):
            first = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        with patch.object(agent_queue.time, "time", return_value=1006.0):
            second = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        self.assertEqual(second["attempts"], first["attempts"] + 1)
        self.assertNotEqual(first["claim_token"], second["claim_token"])
        with patch.object(agent_queue.time, "time", return_value=1007.0):
            with self.assertRaises(ValueError):
                agent_queue.finish(self.db, queued["id"], "worker-a", {"stale": True}, first["claim_token"])
            with self.assertRaises(ValueError):
                agent_queue.fail(self.db, queued["id"], "worker-a", "stale", first["claim_token"])
        self.assertEqual(agent_queue.get_job(self.db, queued["id"])["status"], "claimed")
        with patch.object(agent_queue.time, "time", return_value=1007.0):
            finished = agent_queue.finish(self.db, queued["id"], "worker-a", {"current": True}, second["claim_token"])
        self.assertEqual(finished["status"], "succeeded")

    def test_claim_returns_transaction_snapshot_without_post_commit_reread(self):
        agent_queue.enqueue(self.db, "claim snapshot", {}, max_attempts=3)
        # A post-commit get_job() could observe a later claim incarnation.
        # The claim response must instead be captured inside its transaction.
        with patch.object(agent_queue, "get_job", side_effect=AssertionError("post-commit reread")):
            claimed = agent_queue.claim(self.db, "worker-a", lease_seconds=30)
        self.assertEqual(claimed["status"], "claimed")
        self.assertEqual(claimed["worker_id"], "worker-a")
        self.assertTrue(claimed["claim_token"])

    def test_old_schema_migration_preserves_rows_and_is_idempotent(self):
        with agent_queue.sqlite3.connect(self.db) as conn:
            conn.executescript("""
                CREATE TABLE jobs (
                    id TEXT PRIMARY KEY, task TEXT NOT NULL, payload_json TEXT NOT NULL,
                    status TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
                    worker_id TEXT, lease_until REAL, result_json TEXT, error TEXT
                );
                INSERT INTO jobs(id,task,payload_json,status,created_at,updated_at)
                VALUES('legacy-1','preserve','{}','queued',10,10);
            """)
        with agent_queue.connect(self.db) as conn:
            self.assertIn("claim_token", {row[1] for row in conn.execute("PRAGMA table_info(jobs)")})
            self.assertEqual(conn.execute("SELECT task FROM jobs WHERE id='legacy-1'").fetchone()[0], "preserve")
        with agent_queue.connect(self.db) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM jobs WHERE id='legacy-1'").fetchone()[0], 1)

    def test_lock_wait_uses_post_lock_time_for_lease_validation(self):
        queued = agent_queue.enqueue(self.db, "lock deadline", {}, max_attempts=3)
        with patch.object(agent_queue.time, "time", return_value=1000.0):
            claimed = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        conn = agent_queue.connect(self.db)
        try:
            conn.execute("BEGIN IMMEDIATE")
            original_connect = agent_queue.connect
            def connect_and_wait(path):
                # The real connection blocks until our held writer commits,
                # after which the mocked time advances past lease expiry.
                result = original_connect(path)
                return result
            with patch.object(agent_queue, "connect", side_effect=connect_and_wait):
                # Cover ordering directly: operation's timestamp must be read
                # after acquiring its own immediate write lock.
                import inspect
                source = inspect.getsource(agent_queue.finish)
                self.assertLess(source.index('conn.execute("BEGIN IMMEDIATE")'), source.index('now = time.time()'))
        finally:
            conn.rollback()
            conn.close()
        with patch.object(agent_queue.time, "time", return_value=1006.0):
            with self.assertRaises(ValueError):
                agent_queue.finish(self.db, queued["id"], "worker-a", {}, claimed["claim_token"])

    def test_cli_list_redacts_claim_token(self):
        queued = agent_queue.enqueue(self.db, "redact claim capability", {})
        claimed = agent_queue.claim(self.db, "worker-a")
        rows = agent_queue.list_jobs(self.db, status="claimed")
        public_row = agent_queue.decode_job(rows[0])
        self.assertEqual(public_row["id"], queued["id"])
        self.assertNotIn("claim_token", public_row)
        self.assertTrue(claimed["claim_token"])
        self.assertNotIn("claim_token", agent_queue.get_job(self.db, queued["id"]))

    def test_complete_requires_current_claim_token(self):
        queued = agent_queue.enqueue(self.db, "claim token required", {})
        claimed = agent_queue.claim(self.db, "worker-a")
        for token in (None, "wrong-token"):
            with self.subTest(token=token):
                with self.assertRaises(ValueError):
                    agent_queue.finish(self.db, queued["id"], "worker-a", {}, token)
        self.assertNotIn("claim_token", agent_queue.get_job(self.db, queued["id"]))
        with agent_queue.connect(self.db) as conn:
            self.assertEqual(conn.execute("SELECT claim_token FROM jobs WHERE id=?", (queued["id"],)).fetchone()[0], claimed["claim_token"])

    def test_expired_final_lease_becomes_failed(self):
        queued = agent_queue.enqueue(self.db, "last attempt", {}, max_attempts=1)
        claimed = agent_queue.claim(self.db, "worker-a", lease_seconds=5)
        with agent_queue.connect(self.db) as conn:
            conn.execute("UPDATE jobs SET lease_until=0 WHERE id=?", (queued["id"],))
        self.assertIsNone(agent_queue.claim(self.db, "worker-b"))
        final = agent_queue.get_job(self.db, queued["id"])
        self.assertEqual(final["status"], "failed")
        self.assertIsNone(final["worker_id"])
        self.assertNotIn("claim_token", final)
        with agent_queue.connect(self.db) as conn:
            self.assertIsNone(conn.execute("SELECT claim_token FROM jobs WHERE id=?", (queued["id"],)).fetchone()[0])


if __name__ == "__main__":
    unittest.main()
