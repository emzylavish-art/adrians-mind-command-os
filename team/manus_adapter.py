#!/usr/bin/env python3
"""Thin execution-computer adapter on the existing queue.

Local transport is a controlled computer: one step, then files. Cloud Manus
and webhooks are not called unless the matching environment variable is set,
and this process still refuses to invent a successful cloud result.
"""
import json
import os
import sys
from pathlib import Path

from control import append_cost, append_timeline, gate, load_project, log_line, save_project

DEFAULT_STEPS = ("objective.md", "evidence.md", "report.md")


def _computer(folder, project_id):
    path = Path(folder) / "computers" / "".join(
        ch if ch.isalnum() or ch in "-_" else "-" for ch in project_id
    )
    path.mkdir(parents=True, exist_ok=True)
    return path


def _memory(computer):
    path = computer / "memory.json"
    if not path.is_file():
        return {"cursor": 0, "done": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("cursor"), int):
        raise ValueError("computer memory is corrupt")
    return data


def _write_step(computer, name, goal, context):
    if name == "objective.md":
        body = f"# Objective\n\n{goal}\n"
    elif name == "evidence.md":
        inherited = context.get("instructions") or "(no inherited project instructions)"
        body = f"# Evidence\n\nInherited context:\n\n{inherited}\n\nSource: local project context only.\n"
    else:
        body = f"# Report\n\n{goal}\n\nFinished from local files. No cloud computer was used.\n"
    (computer / name).write_text(body, encoding="utf-8")


def run_local(payload):
    folder = payload.get("state_dir")
    goal = payload.get("goal")
    project_id = payload.get("project_id") or "default"
    if not isinstance(folder, str) or not folder.strip():
        return _blocked("state_dir is required.")
    if not isinstance(goal, str) or not goal.strip():
        return _blocked("goal is required.")
    tier = int(payload.get("tier", 0))
    decision = gate(folder, tier=tier, approval=payload.get("approval"),
                    spent=payload.get("spent"), limit=payload.get("limit"))
    if decision["status"] != "ready":
        log_line(folder, "MANUS", "BLOCKED", decision["reason"])
        return _blocked(decision["reason"])
    if payload.get("transport", "local") != "local":
        return _remote(payload)

    computer = _computer(folder, project_id)
    memory = _memory(computer)
    context = load_project(folder, project_id)
    steps = DEFAULT_STEPS
    cursor = memory["cursor"]
    resumed = cursor > 0
    if cursor >= len(steps):
        package = _package(goal, computer, memory, resumed, remaining=0)
        log_line(folder, "MANUS", "ALREADY DONE", "SYNTHESIZE")
        return {
            "status": "ready", "result": package,
            "evidence": [str(computer / "memory.json")],
            "limitations": package["limitations"],
        }
    name = steps[cursor]
    _write_step(computer, name, goal.strip(), context)
    memory["cursor"] = cursor + 1
    memory["done"] = memory.get("done", []) + [name]
    (computer / "memory.json").write_text(json.dumps(memory, indent=2) + "\n", encoding="utf-8")
    context["files"] = memory["done"]
    save_project(folder, project_id, context)
    remaining = len(steps) - memory["cursor"]
    append_timeline(folder, {
        "kind": "execution_step", "project_id": project_id, "file": name,
        "cursor": memory["cursor"], "remaining": remaining, "resumed": resumed,
    })
    append_cost(folder, {"transport": "local", "usd": 0, "step": name})
    package = _package(goal, computer, memory, resumed, remaining)
    log_line(folder, "MANUS STEP", name, "RESUME" if remaining else "SYNTHESIZE")
    status = "ready" if remaining == 0 else "partial"
    return {
        "status": status,
        "result": package,
        "evidence": [str(Path("computers") / computer.name / name)],
        "limitations": package["limitations"],
    }


def _remote(payload):
    transport = payload.get("transport")
    if transport == "api":
        if not os.environ.get("MANUS_API_KEY"):
            return _blocked("MANUS_API_KEY is not set. Cloud Manus was not called.")
        return _blocked("Cloud Manus call is refused in this adapter until a successful response is recorded. No request was sent.")
    if transport == "webhook":
        if not os.environ.get("MANUS_WEBHOOK_URL"):
            return _blocked("MANUS_WEBHOOK_URL is not set. No webhook was sent.")
        return _blocked("Webhook delivery is refused until a successful response is recorded. No request was sent.")
    return _blocked("transport must be local, api, or webhook.")


def _package(goal, computer, memory, resumed, remaining):
    files = [str(computer / name) for name in memory.get("done", [])]
    return {
        "summary": f"Local computer step for: {goal}",
        "artifact_files": files,
        "evidence_log": memory.get("done", []),
        "limitations": ["Local controlled computer only. Manus Cloud was not called."],
        "confidence": "local-only",
        "cost": {"usd": 0, "transport": "local"},
        "cursor": memory["cursor"],
        "remaining": remaining,
        "resumed": resumed,
    }


def _blocked(reason):
    return {
        "status": "blocked", "result": None, "evidence": ["team/manus_adapter.py"],
        "limitations": [reason],
    }


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            raise ValueError("Input must be a JSON object.")
        print(json.dumps(run_local(payload), indent=2))
    except Exception as exc:
        print(json.dumps(_blocked(str(exc))))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
