#!/usr/bin/env python3
"""Grok Build orchestrator contract: inventory, reason, route, enqueue, synthesize.

GPT is not called. A local schema is the reasoning result, and the limitation
says so. Execution jobs go to the existing queue. Nothing here is a second queue.
"""
import importlib.util
import json
import os
import sys
from pathlib import Path

from control import append_timeline, gate, log_line, read_log

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def inventory():
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    rows = []
    for tool in manifest.get("tools", []):
        entry = tool.get("entrypoint")
        exists = False
        if isinstance(entry, str) and entry.startswith("python"):
            relative = entry.split(" ", 1)[1]
            exists = (ROOT / relative).is_file()
        elif isinstance(entry, str):
            exists = (ROOT / entry).is_file()
        status = tool.get("status")
        if status == "ready" and not exists:
            checked = "blocked"
        elif status == "ready":
            checked = "ready"
        elif exists:
            checked = "partial"
        else:
            checked = "blocked"
        rows.append({
            "id": tool.get("id"),
            "declared": status,
            "checked": checked,
            "entrypoint_exists": exists,
        })
    return {
        "status": "ready",
        "result": {
            "will_not_rebuild": ["queue", "approval tiers", "notion bus", "team runner"],
            "tools": rows,
            "manus_cloud": "blocked",
            "reason": "MANUS_API_KEY is not required for the local computer. Cloud Manus is not claimed live.",
        },
        "evidence": ["team/manifest.json"],
        "limitations": ["Checked means the declared file exists. It does not mean an external account is funded."],
    }


def reason(task):
    if not isinstance(task, str) or not task.strip():
        return {
            "status": "blocked", "result": None, "evidence": ["team/orchestrator.py"],
            "limitations": ["A non-empty task is required."],
        }
    plan = {
        "lane": "local",
        "objective": task.strip(),
        "steps": [
            "State the objective and the success check.",
            "Route reasoning to the local schema. Do not call GPT unless a later explicit provider call succeeds.",
            "Enqueue execution only after policy, kill switch, and budget gates pass.",
        ],
        "schema": {
            "objective": "string",
            "success": "string",
            "tier": "0-4",
            "evidence": "list",
        },
    }
    return {
        "status": "partial",
        "result": plan,
        "evidence": ["team/orchestrator.py"],
        "limitations": ["GPT was not invoked. This is a local schema, not a model completion."],
    }


def route_and_enqueue(payload):
    folder = payload.get("state_dir")
    task = payload.get("task")
    if not isinstance(folder, str) or not folder.strip():
        return {"status": "blocked", "result": None, "evidence": [], "limitations": ["state_dir is required."]}
    decision = gate(
        folder,
        tier=int(payload.get("tier", 0)),
        approval=payload.get("approval"),
        spent=payload.get("spent"),
        limit=payload.get("limit"),
    )
    if decision["status"] != "ready":
        log_line(folder, "ROUTE", "BLOCKED", decision["reason"])
        return {
            "status": "blocked", "result": decision, "evidence": ["team/control.py"],
            "limitations": [decision["reason"]],
        }
    capabilities = payload.get("capabilities") or ["planning"]
    if not isinstance(capabilities, list) or not capabilities:
        return {"status": "blocked", "result": None, "evidence": [], "limitations": ["capabilities must be a non-empty list."]}
    router = _load("mind_router", "router.py")
    routed = router.route({"task": task, "capabilities": capabilities, "context": payload.get("context", {})}, router.load())
    why = {
        "capabilities": capabilities,
        "dispatch": routed.get("dispatch"),
        "router_status": routed.get("status"),
    }
    append_timeline(folder, {"kind": "route", "why": why})
    execution = "execution_computer" in capabilities
    if not execution:
        line = log_line(folder, "REASON", "LOCAL SCHEMA", "NO ENQUEUE")
        reasoned = reason(task if isinstance(task, str) else "")
        return {
            "status": reasoned["status"],
            "result": {"plan": reasoned["result"], "why": why, "enqueued": None, "log": line},
            "evidence": ["team/orchestrator.py", "team/router.py"],
            "limitations": reasoned["limitations"],
        }
    queue = _load("mind_queue", "queue.py")
    job_input = {
        "goal": task,
        "transport": "local",
        "state_dir": folder,
        "project_id": payload.get("project_id") or "default",
        "max_steps": 1,
        "tier": int(payload.get("tier", 0)),
        "approval": payload.get("approval"),
    }
    job = queue.enqueue(
        payload.get("db"),
        task if isinstance(task, str) else "execution",
        {"tool_id": "team.manus", "input": job_input},
    )
    line = log_line(folder, "ENQUEUE", job["id"], "WORKER CLAIM team.manus")
    return {
        "status": "ready" if routed.get("dispatch") else "partial",
        "result": {"why": why, "enqueued": job["id"], "log": line},
        "evidence": ["team/orchestrator.py", "team/queue.py"],
        "limitations": [] if routed.get("dispatch") else ["No specialist matched. The job was still queued for the local computer."],
    }


def notion_writeback_payload(evidence, line, page_id):
    limitations = evidence.get("limitations") or []
    if isinstance(limitations, str):
        limitations = [limitations]
    text = "\n".join([
        str(evidence.get("summary", "")),
        "Artifacts: " + ", ".join(str(item) for item in (evidence.get("artifact_files") or [])),
        "Evidence: " + ", ".join(str(item) for item in (evidence.get("evidence_log") or [])),
        "Limitations: " + ", ".join(str(item) for item in limitations),
        line,
    ]).strip()
    return {
        "tool_id": "notion.controller",
        "input": {"action": "append-text", "id": page_id or "", "text": text},
        "condition": (
            "Runs only when notion_page_id is a Notion page id, "
            "approval.approved is true with an id, and NOTION_API_KEY is set. "
            "Otherwise nothing is sent."
        ),
    }


def _append_notion(page_id, text):
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "notion_controller", ROOT / "tools" / "notion" / "controller.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.append_text(page_id, text)


def synthesize(payload):
    folder = payload.get("state_dir")
    evidence = payload.get("evidence")
    if not isinstance(folder, str) or not isinstance(evidence, dict):
        return {"status": "blocked", "result": None, "evidence": [], "limitations": ["state_dir and evidence object are required."]}
    required = ("summary", "artifact_files", "evidence_log")
    missing = [key for key in required if key not in evidence]
    tier = int(payload.get("tier", 0))
    if tier >= 3:
        decision = gate(folder, tier=tier, approval=payload.get("approval"))
        if decision["status"] != "ready":
            log_line(folder, "VERIFY", "BLOCKED", decision["reason"])
            return {"status": "blocked", "result": None, "evidence": ["team/control.py"], "limitations": [decision["reason"]]}
    if missing:
        log_line(folder, "VERIFY", "BLOCKED", "missing " + ",".join(missing))
        return {
            "status": "blocked", "result": None, "evidence": ["team/orchestrator.py"],
            "limitations": [f"Evidence package is missing: {', '.join(missing)}"],
        }
    line = log_line(folder, "SYNTHESIZE", "ACCEPTED", "NOTION WRITE-BACK")
    page_id = payload.get("notion_page_id")
    if not isinstance(page_id, str):
        page_id = ""
    deferred = notion_writeback_payload(evidence, line, page_id.strip())
    approval = payload.get("approval")
    key_set = bool(os.environ.get("NOTION_API_KEY"))
    approved = (
        isinstance(approval, dict)
        and approval.get("approved") is True
        and isinstance(approval.get("id"), str)
        and bool(approval.get("id").strip())
    )
    if not page_id.strip() or not approved or not key_set:
        reasons = []
        if not page_id.strip():
            reasons.append("notion_page_id is missing")
        if not approved:
            reasons.append("approval record is missing")
        if not key_set:
            reasons.append("NOTION_API_KEY is not set")
        reason = "Notion write-back deferred: " + "; ".join(reasons) + "."
        log_line(folder, "NOTION", "DEFERRED", reason)
        return {
            "status": "ready",
            "result": {
                "accepted": True, "log": line, "logs": read_log(folder),
                "notion_writeback": {"sent": False, "deferred": deferred},
            },
            "evidence": ["team/orchestrator.py"],
            "limitations": [reason, deferred["condition"]],
        }
    try:
        response = _append_notion(page_id.strip(), deferred["input"]["text"])
    except Exception as exc:
        message = str(exc)
        log_line(folder, "NOTION", "BLOCKED", message)
        return {
            "status": "partial",
            "result": {
                "accepted": True, "log": line, "logs": read_log(folder),
                "notion_writeback": {"sent": False, "deferred": deferred, "error": message},
            },
            "evidence": ["team/orchestrator.py", "tools/notion/controller.py"],
            "limitations": ["Notion append did not succeed.", deferred["condition"]],
        }
    log_line(folder, "NOTION", "APPENDED", page_id.strip())
    return {
        "status": "ready",
        "result": {
            "accepted": True, "log": line, "logs": read_log(folder),
            "notion_writeback": {"sent": True, "response": response},
        },
        "evidence": ["team/orchestrator.py", "tools/notion/controller.py"],
        "limitations": ["Notion append-text ran because the page id, approval, and NOTION_API_KEY were all present."],
    }


def run(payload):
    action = payload.get("action")
    if action == "inventory":
        return inventory()
    if action == "reason":
        result = reason(payload.get("task"))
        if isinstance(payload.get("state_dir"), str):
            result["result"] = result["result"] if isinstance(result["result"], dict) else {}
            result["result"]["log"] = log_line(payload["state_dir"], "REASON", result["status"].upper(), "HOLD FOR REVIEW")
        return result
    if action == "route_and_enqueue":
        if not payload.get("db"):
            return {"status": "blocked", "result": None, "evidence": [], "limitations": ["db is required."]}
        return route_and_enqueue(payload)
    if action == "synthesize":
        return synthesize(payload)
    return {
        "status": "blocked", "result": None, "evidence": ["team/orchestrator.py"],
        "limitations": ["action must be inventory, reason, route_and_enqueue, or synthesize."],
    }


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            raise ValueError("Input must be a JSON object.")
        print(json.dumps(run(payload), indent=2))
    except Exception as exc:
        print(json.dumps({
            "status": "blocked", "result": None, "evidence": ["team/orchestrator.py"],
            "limitations": [str(exc)],
        }))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
