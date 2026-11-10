#!/usr/bin/env python3
"""Accept a trigger into the existing queue. This is not a scheduler."""
import importlib.util
import json
import sys
from pathlib import Path

from control import gate, log_line

HERE = Path(__file__).resolve().parent

DEFINITIONS = {
    "daily-research-summary": {
        "task": "daily research summary",
        "goal": "Write the daily research summary from project context only.",
    }
}
TRIGGER_TYPES = {"time", "notion", "calendar", "email"}


def _queue():
    spec = importlib.util.spec_from_file_location("mind_queue", HERE / "queue.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def accept(payload):
    folder = payload.get("state_dir")
    db = payload.get("db")
    trigger = payload.get("trigger")
    if not isinstance(folder, str) or not isinstance(db, str):
        return _blocked("state_dir and db are required.")
    if not isinstance(trigger, dict):
        return _blocked("trigger object is required.")
    kind = trigger.get("type")
    name = trigger.get("name")
    if kind not in TRIGGER_TYPES:
        return _blocked("trigger type must be time, notion, calendar, or email.")
    if name not in DEFINITIONS:
        return _blocked(f"Unknown automation: {name}")
    decision = gate(
        folder,
        tier=int(payload.get("tier", 0)),
        approval=payload.get("approval"),
        spent=payload.get("spent"),
        limit=payload.get("limit"),
    )
    if decision["status"] != "ready":
        log_line(folder, "AUTOMATION", "BLOCKED", decision["reason"])
        return _blocked(decision["reason"])
    spec = DEFINITIONS[name]
    job = _queue().enqueue(db, spec["task"], {
        "tool_id": "team.manus",
        "input": {
            "goal": spec["goal"],
            "transport": "local",
            "state_dir": folder,
            "project_id": payload.get("project_id") or name,
            "max_steps": 1,
            "tier": 0,
        },
    })
    line = log_line(folder, "AUTOMATION", name, f"QUEUED {job['id']}")
    return {
        "status": "ready",
        "result": {"enqueued": job["id"], "trigger": kind, "name": name, "log": line},
        "evidence": ["team/automations.py", "team/queue.py"],
        "limitations": ["The trigger was enqueued. No second scheduler was started."],
    }


def _blocked(reason):
    return {
        "status": "blocked", "result": None, "evidence": ["team/automations.py"],
        "limitations": [reason],
    }


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            raise ValueError("Input must be a JSON object.")
        print(json.dumps(accept(payload), indent=2))
    except Exception as exc:
        print(json.dumps(_blocked(str(exc))))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
