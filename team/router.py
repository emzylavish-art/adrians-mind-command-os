#!/usr/bin/env python3
"""Capability router for Mind Command OS.

Selects a specialist using declared capabilities, readiness, and explicit
requirements. Produces dispatch metadata; does not invoke a language model.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "team" / "manifest.json"
ELIGIBLE_STATUSES = {"ready", "contract_defined", "partial"}


def load():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def route(task, manifest):
    if not isinstance(task, dict) or not task.get("task"):
        return {
            "status": "blocked", "result": None, "evidence": [],
            "limitations": ["A non-empty task is required."], "dispatch": None,
        }
    requested = set(task.get("capabilities", []))
    if not requested:
        return {
            "status": "blocked", "result": None, "evidence": [],
            "limitations": ["At least one capability is required for deterministic specialist routing."],
            "dispatch": None,
        }

    scored = []
    for agent in manifest.get("agents", []):
        matched = requested & set(agent.get("capabilities", []))
        if not matched:
            continue
        status = agent.get("status", "not_implemented")
        if status not in ELIGIBLE_STATUSES:
            continue
        # Sort by matched capability count, then actual readiness, then stable ID.
        readiness = {"ready": 2, "partial": 1, "contract_defined": 0}.get(status, -1)
        scored.append((len(matched), readiness, agent.get("id", ""), agent, matched))

    if not scored:
        return {
            "status": "blocked", "result": None, "evidence": [],
            "limitations": ["No executable or defined specialist matched the requested capabilities."],
            "dispatch": None,
        }

    scored.sort(key=lambda row: (-row[0], -row[1], row[2]))
    score, readiness, _, agent, matched = scored[0]
    status = agent["status"]
    return {
        "status": "ready" if status == "ready" else "partial",
        "result": "Dispatch envelope created; compatible host must execute the specialist.",
        "evidence": [f"team/manifest.json#agents/{agent['id']}"],
        "limitations": [] if status == "ready" else [
            f"Specialist status is {status}; requirements and runtime must be satisfied by the host."
        ],
        "dispatch": {
            "agent_id": agent["id"],
            "role": agent["role"],
            "entrypoint": agent.get("entrypoint"),
            "requires": agent.get("requires", []),
            "task": task["task"],
            "context": task.get("context", {}),
            "matched_capabilities": sorted(matched),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", help="task text; otherwise JSON is read from stdin")
    parser.add_argument("--capability", action="append", default=[], help="repeatable capability")
    args = parser.parse_args()
    try:
        payload = json.loads(sys.stdin.read()) if not args.task else {"task": args.task}
        if args.capability:
            payload["capabilities"] = args.capability
        print(json.dumps(route(payload, load()), indent=2))
    except Exception as exc:
        print(json.dumps({
            "status": "blocked", "result": None, "evidence": [],
            "limitations": [str(exc)], "dispatch": None,
        }))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
