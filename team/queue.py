#!/usr/bin/env python3
"""SQLite-backed durable task queue for local Mind Command OS workers.

The queue stores task data and lease state. It never executes queued payloads.
Worker implementations must validate the task and invoke permitted tools separately.
"""
import argparse
import json
import sqlite3
import sys
import time
import uuid
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent / "queue.sqlite3"


def connect(db_path):
    connection = sqlite3.connect(str(db_path), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            task TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('queued','claimed','succeeded','failed')),
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            worker_id TEXT,
            lease_until REAL,
            result_json TEXT,
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_claim
        ON jobs(status, created_at, lease_until);
    """)
    return connection


def enqueue(db_path, task, payload, max_attempts=3):
    if not isinstance(task, str) or not task.strip():
        raise ValueError("task must be a non-empty string")
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    if not isinstance(max_attempts, int) or max_attempts < 1 or max_attempts > 20:
        raise ValueError("max_attempts must be between 1 and 20")
    now = time.time()
    job_id = str(uuid.uuid4())
    with connect(db_path) as conn:
        conn.execute(
            """INSERT INTO jobs(id,task,payload_json,status,created_at,updated_at,max_attempts)
               VALUES(?,?,?,?,?,?,?)""",
            (job_id, task.strip(), json.dumps(payload), "queued", now, now, max_attempts),
        )
    return get_job(db_path, job_id)


def get_job(db_path, job_id):
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    return dict(row) if row else None


def claim(db_path, worker_id, lease_seconds=120):
    if not isinstance(worker_id, str) or not worker_id.strip():
        raise ValueError("worker_id must be a non-empty string")
    if not isinstance(lease_seconds, int) or not 5 <= lease_seconds <= 3600:
        raise ValueError("lease_seconds must be between 5 and 3600")
    now = time.time()
    conn = connect(db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        # A final-attempt lease that expires is terminal; don't strand it as claimed.
        conn.execute(
            """UPDATE jobs SET status='failed',worker_id=NULL,lease_until=NULL,
               error=COALESCE(error,'Lease expired after final attempt'),updated_at=?
               WHERE status='claimed' AND lease_until < ? AND attempts >= max_attempts""",
            (now, now),
        )
        row = conn.execute(
            """SELECT * FROM jobs
               WHERE attempts < max_attempts AND
                 (status='queued' OR (status='claimed' AND lease_until < ?))
               ORDER BY created_at ASC LIMIT 1""",
            (now,),
        ).fetchone()
        if row is None:
            conn.commit()
            return None
        lease_until = now + lease_seconds
        conn.execute(
            """UPDATE jobs SET status='claimed',worker_id=?,lease_until=?,
               attempts=attempts+1,updated_at=? WHERE id=?""",
            (worker_id.strip(), lease_until, now, row["id"]),
        )
        conn.commit()
        return get_job(db_path, row["id"])
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def finish(db_path, job_id, worker_id, result):
    """Finish a job only while this worker's lease is still valid.

    A lease is expired strictly before its deadline (the same boundary used by
    claim()), so an operation at exactly lease_until remains valid.
    """
    now = time.time()
    with connect(db_path) as conn:
        cursor = conn.execute(
            """UPDATE jobs SET status='succeeded',result_json=?,updated_at=?,
               worker_id=NULL,lease_until=NULL,error=NULL
               WHERE id=? AND status='claimed' AND worker_id=?
                 AND lease_until >= ? AND attempts >= 1
                 AND attempts <= max_attempts""",
            (json.dumps(result), now, job_id, worker_id, now),
        )
        if cursor.rowcount != 1:
            raise ValueError("job is not claimed by this worker")
    return get_job(db_path, job_id)


def fail(db_path, job_id, worker_id, error):
    """Fail/requeue a job in one conditional, lease-checked SQL update."""
    now = time.time()
    with connect(db_path) as conn:
        cursor = conn.execute(
            """UPDATE jobs
               SET status=CASE
                     WHEN attempts < max_attempts THEN 'queued'
                     ELSE 'failed'
                   END,
                   error=?,updated_at=?,worker_id=NULL,lease_until=NULL
               WHERE id=? AND status='claimed' AND worker_id=?
                 AND lease_until >= ? AND attempts >= 1
                 AND attempts <= max_attempts""",
            (str(error)[:2000], now, job_id, worker_id, now),
        )
        if cursor.rowcount != 1:
            raise ValueError("job is not claimed by this worker")
    return get_job(db_path, job_id)


def list_jobs(db_path, status=None, limit=100):
    if status and status not in {"queued", "claimed", "succeeded", "failed"}:
        raise ValueError("invalid status")
    if not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError("limit must be between 1 and 1000")
    with connect(db_path) as conn:
        if status:
            rows = conn.execute("SELECT * FROM jobs WHERE status=? ORDER BY created_at DESC LIMIT ?",
                                (status, limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
                                (limit,)).fetchall()
    return [dict(row) for row in rows]


def decode_job(job):
    if job is None:
        return None
    job["payload"] = json.loads(job.pop("payload_json"))
    if job.get("result_json") is not None:
        job["result"] = json.loads(job.pop("result_json"))
    else:
        job.pop("result_json", None)
    return job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB))
    sub = parser.add_subparsers(dest="command", required=True)
    add = sub.add_parser("enqueue")
    add.add_argument("--task", required=True)
    add.add_argument("--payload", default="{}")
    add.add_argument("--max-attempts", type=int, default=3)
    take = sub.add_parser("claim")
    take.add_argument("--worker", required=True)
    take.add_argument("--lease-seconds", type=int, default=120)
    done = sub.add_parser("complete")
    done.add_argument("--id", required=True)
    done.add_argument("--worker", required=True)
    done.add_argument("--result", default="{}")
    error = sub.add_parser("fail")
    error.add_argument("--id", required=True)
    error.add_argument("--worker", required=True)
    error.add_argument("--error", required=True)
    listing = sub.add_parser("list")
    listing.add_argument("--status", choices=["queued", "claimed", "succeeded", "failed"])
    listing.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    try:
        if args.command == "enqueue":
            item = enqueue(args.db, args.task, json.loads(args.payload), args.max_attempts)
        elif args.command == "claim":
            item = claim(args.db, args.worker, args.lease_seconds)
        elif args.command == "complete":
            item = finish(args.db, args.id, args.worker, json.loads(args.result))
        elif args.command == "fail":
            item = fail(args.db, args.id, args.worker, args.error)
        else:
            item = list_jobs(args.db, args.status, args.limit)
        if isinstance(item, list):
            output = [decode_job(row) for row in item]
        else:
            output = decode_job(item)
        print(json.dumps({"status": "ready", "result": output}, indent=2))
    except Exception as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, indent=2))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
