#!/usr/bin/env python3
"""Validate the Mind Command OS registry, manifest, and Windows bootstrap catalogue."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "team" / "manifest.json"
REGISTRY_PATH = ROOT / "tools" / "registry.json"
BOOTSTRAP_CATALOG_PATH = ROOT / "tools" / "bootstrap" / "upstream-sources.json"
EXTENDED_UPSTREAM_PATH = ROOT / "tools" / "bootstrap" / "extended-upstream.json"
BOOTSTRAP_SCRIPT_PATH = ROOT / "tools" / "bootstrap" / "Install-MindCommandTools.ps1"


def slug(value):
    """Normalize human-readable catalog names into stable IDs."""
    value = value.lower().replace("—", "-").replace("–", "-")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value)).strip("-")


def validate():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    bootstrap = json.loads(BOOTSTRAP_CATALOG_PATH.read_text(encoding="utf-8"))
    extended_ids = []
    if EXTENDED_UPSTREAM_PATH.is_file():
        extended = json.loads(EXTENDED_UPSTREAM_PATH.read_text(encoding="utf-8"))
        extended_ids = [item.get("id") for item in extended.get("sources", [])]
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

    registry_items = registry.get("tools", [])
    registry_ids = {slug(item.get("name", "")) for item in registry_items}
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

    repositories = bootstrap.get("repositories", [])
    source_ids = [item.get("id") for item in repositories]
    if len(source_ids) != len(set(source_ids)):
        errors.append("Duplicate IDs in Windows bootstrap source catalogue.")
    if len(extended_ids) != len(set(extended_ids)):
        errors.append("Duplicate IDs in extended upstream catalogue.")
    for item in repositories:
        url = item.get("url", "")
        if item.get("id") == "burp-suite":
            valid_url = url == "https://portswigger.net/burp/communitydownload"
        else:
            valid_url = url.startswith("https://github.com/") and url.endswith(".git")
        if not valid_url:
            errors.append(f"Unverified or invalid official source URL: {item.get('id')}")
    if not BOOTSTRAP_SCRIPT_PATH.is_file():
        errors.append("Windows bootstrap PowerShell script is missing.")

    verified_registry_ids = {
        slug(item.get("name", ""))
        for item in registry_items
        if item.get("status") == "source-verified"
    }
    expected_verified_ids = set(source_ids) | set(extended_ids) | {"burp-suite"}
    if verified_registry_ids != expected_verified_ids:
        errors.append(
            "Source-verified registry entries do not match bootstrap and extended upstream catalogues: "
            f"registry={sorted(verified_registry_ids)}, catalogue={sorted(expected_verified_ids)}"
        )

    excluded_ids = {item.get("id") for item in bootstrap.get("not_auto_integrated", [])}
    if excluded_ids & set(source_ids):
        errors.append("An excluded or unresolved tool was accidentally added to the bootstrap source list.")
    if not {"blackeye", "gods-eyes", "arrow-ea"}.issubset(excluded_ids):
        errors.append("BlackEye, God's Eyes, and Arrow EA must remain explicitly excluded.")

    if errors:
        return False, errors
    return True, [
        f"Validated {len(agent_ids)} agents, {len(tool_ids)} callable tool declarations, "
        f"{len(registry_items)} registry entries, and {len(repositories)} upstream source checkouts."
    ]


def main():
    ok, messages = validate()
    print(json.dumps({"status": "ready" if ok else "blocked", "result": messages}, indent=2))
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
