#!/usr/bin/env python3
"""Allowlisted local worker that consumes durable queue jobs.

Queue payload format:
  {"tool_id":"rea.scan","input":{"path":"."}}
or
  {"runner_request":{"operation":"invoke","tool_id":"security.scan","input":{...}}}

Only implemented local tools are dispatched. This worker never executes arbitrary
shell commands, code strings, or unknown tool IDs.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "team" / "queue.py"
RUNNER = ROOT / "team" / "runner.py"
ALLOWED_TOOLS = {"rea.scan", "security.scan", "knowledge.search", "team.health"}


def queue_call(db, action, args):
    command = [sys.executable, str(QUEUE), "--db", str(db), action, *args]
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(completed.stderr.strip() or "Queue returned invalid JSON") from exc
    if completed.returncode or result.get("status") != "ready":
        raise RuntimeError(result.get("error") or completed.stderr.strip() or "Queue operation failed")
    return result.get("result")


def normalize_request(payload):
    if not isinstance(payload, dict):
        raise ValueError("Job payload must be a JSON object.")
    request = payload.get("runner_request", payload)
    if not isinstance(request, dict):
        raise ValueError("runner_request must be a JSON object.")
    tool_id = request.get("tool_id")
    if request.get("operation", "invoke") != "invoke":
        raise ValueError("Worker jobs must request operation=invoke.")
    if tool_id not in ALLOWED_TOOLS:
        raise ValueError(f"Tool is not allowlisted for worker execution: {tool_id}")
    input_data = request.get("input", {})
    if not isinstance(input_data, dict):
        raise ValueError("Tool input must be a JSON object.")
    return {"operation": "invoke", "tool_id": tool_id, "input": input_data}


def execute(request):
    completed = subprocess.run(
        [sys.executable, str(RUNNER)],
        input=json.dumps(request), capture_output=True, text=True,
        cwd=ROOT, check=False,
    )
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(completed.stderr.strip() or "Runner returned invalid JSON") from exc
    if completed.returncode or result.get("status") not in {"ready", "partial"}:
        raise RuntimeError(json.dumps(result))
    return result


def process_one(db, worker_id, lease_seconds):
    job = queue_call(db, "claim", ["--worker", worker_id, "--lease-seconds", str(lease_seconds)])
    if job is None:
        return {"status": "idle"}
    try:
        payload = job.get("payload", {})\n        if isinstance(payload, str):\n            payload = json.loads(payload)
        request = normalize_request(payload)
        result = execute(request)
        done = queue_call(db, "complete", [
            "--id", job["id"], "--worker", worker_id, "--result", json.dumps(result)
        ])
        return {"status": "succeeded", "job_id": job["id"], "result": done.get("result")}
    except Exception as exc:
        failed = queue_call(db, "fail", [
            "--id", job["id"], "--worker", worker_id, "--error", str(exc)[:1800]
        ])
        return {"status": failed.get("status", "failed"), "job_id": job["id"], "error": str(exc)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(ROOT / "team" / "queue.sqlite3"))
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--lease-seconds", type=int, default=120)
    parser.add_argument("--once", action="store_true", help="Process at most one job and exit.")
    parser.add_argument("--poll-seconds", type=float, default=2.0, help="Idle polling interval in loop mode.")
    parser.add_argument("--max-jobs", type=int, default=0, help="Optional job limit; 0 means no limit.")
    args = parser.parse_args()
    if not args.worker_id.strip():
        parser.error("--worker-id cannot be empty")
    if args.lease_seconds < 5 or args.lease_seconds > 3600:
        parser.error("--lease-seconds must be 5..3600")
    if args.poll_seconds < 0.2:
        parser.error("--poll-seconds must be at least 0.2")
    processed = 0
    try:
        while True:
            outcome = process_one(args.db, args.worker_id, args.lease_seconds)
            print(json.dumps(outcome, indent=2), flush=True)
            if outcome["status"] == "idle":
                if args.once:
                    break
                time.sleep(args.poll_seconds)
                continue
            processed += 1
            if args.once or (args.max_jobs and processed >= args.max_jobs):
                break
    except Exception as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, indent=2))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
