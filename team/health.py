#!/usr/bin/env python3
"""Offline readiness and consistency health report for the Mind Command OS team."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "team" / "manifest.json"


def entrypoint_path(entrypoint):
    if not entrypoint:
        return None
    value = entrypoint.strip()
    value = re.sub(r"^(?:python3?|py)\s+", "", value)
    if value.startswith("./"):
        value = value[2:]
    return ROOT / value


def health():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    tools = []
    for item in manifest.get("tools", []):
        status = item.get("status", "not_implemented")
        path = entrypoint_path(item.get("entrypoint"))
        file_exists = bool(path and path.exists())
        declared_ready = status == "ready"
        healthy = (not declared_ready) or file_exists
        tools.append({
            "id": item.get("id"),
            "declared_status": status,
            "entrypoint": item.get("entrypoint"),
            "entrypoint_exists": file_exists if path else None,
            "health": "ok" if healthy else "degraded",
        })

    agents = [{
        "id": item.get("id"),
        "declared_status": item.get("status", "not_implemented"),
        "health": "ok" if item.get("status") == "ready" else "limited",
        "requires": item.get("requires", []),
    } for item in manifest.get("agents", [])]

    failed_ready = [item for item in tools if item["health"] != "ok"]
    return {
        "status": "degraded" if failed_ready else "ok",
        "summary": {
            "agents_total": len(agents),
            "agents_fully_ready": sum(1 for item in agents if item["declared_status"] == "ready"),
            "tools_total": len(tools),
            "tools_declared_ready": sum(1 for item in tools if item["declared_status"] == "ready"),
            "tools_healthy": sum(1 for item in tools if item["health"] == "ok"),
        },
        "agents": agents,
        "tools": tools,
        "limitations": [
            "Offline report checks repository-declared status and entrypoint existence only.",
            "It does not verify provider credentials, external services, model access, or deployment."
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()
    report = health()
    print(json.dumps(report, indent=2) if args.json else
          f"Mind Command OS health: {report['status']} — {report['summary']}")
    if report["status"] != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
