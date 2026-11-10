#!/usr/bin/env python3
"""Shared gates for the Grok Build loop.

Kill switch, budget, approval, project memory, one-line log, cost, and fleet
wake records. This module never calls the network and never reads secrets.
"""
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLEET_PATH = ROOT / "team" / "fleet.json"


def state_dir(path):
    folder = Path(path)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def kill_file(folder):
    return state_dir(folder) / "KILL"


def killed(folder):
    return kill_file(folder).is_file()


def set_kill(folder, on):
    path = kill_file(folder)
    if on:
        path.write_text("stop\n", encoding="utf-8")
    elif path.exists():
        path.unlink()
    return killed(folder)


def stamp():
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime())


def _cell(value):
    return str(value).replace("|", "/").replace("\n", " ").strip() or "-"


def log_line(folder, action, result, nxt):
    line = f"{stamp()} | GROK-BUILD | {_cell(action)} | {_cell(result)} | {_cell(nxt)}"
    path = state_dir(folder) / "orchestrator.log"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    return line


def read_log(folder):
    path = state_dir(folder) / "orchestrator.log"
    if not path.is_file():
        return []
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def approval_ok(tier, approval):
    if not isinstance(tier, int) or isinstance(tier, bool) or tier < 0 or tier > 4:
        raise ValueError("tier must be an integer from 0 to 4")
    if tier < 3:
        return True
    return (
        isinstance(approval, dict)
        and approval.get("approved") is True
        and isinstance(approval.get("id"), str)
        and bool(approval.get("id").strip())
    )


def budget_gate(spent, limit):
    if spent is None and limit is None:
        return {"action": "allow", "reason": "No budget was supplied for this task."}
    import sys
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from policies.budget import evaluate_budget

    decision = evaluate_budget(float(spent), float(limit))
    return {
        "action": decision.action.value,
        "state": decision.state.value,
        "reason": decision.reason,
        "spent": decision.spent,
        "limit": decision.limit,
    }


def gate(folder, tier=0, approval=None, spent=None, limit=None):
    if killed(folder):
        return {"status": "blocked", "reason": "Kill switch is on. No external action was taken."}
    if not approval_ok(tier, approval):
        return {
            "status": "blocked",
            "reason": "Tier 3 or higher requires an approval record with approved=true and an id.",
        }
    budget = budget_gate(spent, limit)
    if budget["action"] in {"pause"}:
        return {"status": "blocked", "reason": budget["reason"], "budget": budget}
    return {"status": "ready", "reason": budget["reason"], "budget": budget}


def project_folder(folder, project_id):
    if not isinstance(project_id, str) or not project_id.strip():
        raise ValueError("project_id is required")
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in project_id.strip())
    path = state_dir(folder) / "projects" / safe
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_project(folder, project_id):
    path = project_folder(folder, project_id) / "context.json"
    if not path.is_file():
        return {"project_id": project_id, "instructions": "", "files": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("project context must be an object")
    return data


def save_project(folder, project_id, context):
    if not isinstance(context, dict):
        raise ValueError("context must be an object")
    path = project_folder(folder, project_id) / "context.json"
    path.write_text(json.dumps(context, indent=2) + "\n", encoding="utf-8")
    return context


def append_timeline(folder, event):
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    path = state_dir(folder) / "timeline.jsonl"
    row = {"at": stamp(), **event}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")
    return row


def read_timeline(folder):
    path = state_dir(folder) / "timeline.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append_cost(folder, item):
    if not isinstance(item, dict):
        raise ValueError("cost item must be an object")
    path = state_dir(folder) / "cost.jsonl"
    row = {"at": stamp(), "usd": 0, **item}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")
    return row


def load_fleet():
    data = json.loads(FLEET_PATH.read_text(encoding="utf-8"))
    if data.get("hub") != "dashboard-lead":
        raise ValueError("Fleet hub must stay dashboard-lead.")
    return data


def wake(folder, agent_id):
    fleet = load_fleet()
    known = {item["id"]: item for item in fleet.get("agents", [])}
    if agent_id not in known:
        return {
            "status": "blocked",
            "result": None,
            "evidence": ["team/fleet.json"],
            "limitations": [f"Unknown fleet agent: {agent_id}"],
        }
    agent = known[agent_id]
    if agent.get("wake") != "event" or agent.get("background_only") is not True:
        return {
            "status": "blocked",
            "result": None,
            "evidence": ["team/fleet.json"],
            "limitations": ["Fleet agents wake only on an event and stay background-only."],
        }
    record = append_timeline(folder, {
        "kind": "fleet_wake",
        "agent_id": agent_id,
        "hub": fleet["hub"],
        "spawned": False,
    })
    log_line(folder, "FLEET WAKE", agent_id, "WAIT FOR EVENT HANDLER")
    return {
        "status": "ready",
        "result": {"woken": agent_id, "spawned": False, "record": record},
        "evidence": ["team/fleet.json"],
        "limitations": ["Wake writes a record only. It does not start a process or call a model."],
    }
