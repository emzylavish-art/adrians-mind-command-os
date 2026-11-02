#!/usr/bin/env python3
"""Validate the Mind Command OS registry and team manifest consistency."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "team" / "manifest.json"
REGISTRY_PATH = ROOT / "tools" / "registry.json"


def validate():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    errors = []
    agent_ids = {agent.get("id") for agent in manifest.get("agents", [])}
    tool_ids = [tool.get("id") for tool in manifest.get("tools", [])]
    if len(tool_ids) != len(set(tool_ids)):
        errors.append("Duplicate tool IDs in team manifest.")
    for tool in manifest.get("tools", []):
        agent = tool.get("agent")
        if agent and agent not in agent_ids:
            errors.append(f"Tool {tool.get('id')} references unknown agent {agent}.")
        status = tool.get("status")
        entrypoint = tool.get("entrypoint")
        if status == "ready" and not entrypoint:
            errors.append(f"Ready tool {tool.get('id')} has no entrypoint.")
        if entrypoint and not entrypoint.startswith(("python3 ", "python ")):
            if not (ROOT / entrypoint).exists():
                errors.append(f"Tool {tool.get('id')} entrypoint does not exist: {entrypoint}")

    manifest_catalog = {item.get("id"): item for item in manifest.get("catalog", [])}
    registry_items = registry.get("tools", [])
    registry_ids = {
        item.get("name", "").strip().lower().replace(" ", "-")
        for item in registry_items
    }
    if len(registry_ids) != len(registry_items):
        errors.append("Duplicate normalized names in registry.")
    for item in manifest.get("catalog", []):
        if item.get("id") not in registry_ids:
            errors.append(f"Manifest catalog item missing in registry: {item.get('id')}")
        if item.get("agent") and item.get("agent") not in agent_ids and item.get("agent") != "unmapped":
            errors.append(f"Catalog item {item.get('id')} references unknown agent {item.get('agent')}")
    for item in registry_items:
        if item.get("team_agent") and item.get("team_agent") not in agent_ids and item.get("team_agent") != "unmapped":
            errors.append(f"Registry item {item.get('name')} references unknown agent {item.get('team_agent')}")
    if errors:
        return False, errors
    return True, [f"Validated {len(agent_ids)} agents, {len(tool_ids)} callable tool declarations, and {len(registry_items)} registry entries."]


def main():
    ok, messages = validate()
    print(json.dumps({"status": "ready" if ok else "blocked", "result": messages}, indent=2))
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
