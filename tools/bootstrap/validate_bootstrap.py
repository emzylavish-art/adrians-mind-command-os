"""Validate Windows bootstrap metadata against its installer and tool registry.

This is intentionally a static check: it does not download or execute third-party code.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def validate() -> list[str]:
    errors: list[str] = []
    sources = load_json(ROOT / "tools/bootstrap/upstream-sources.json")
    registry = load_json(ROOT / "tools/registry.json")
    installer = (ROOT / "tools/bootstrap/Install-MindCommandTools.ps1").read_text(
        encoding="utf-8"
    )

    source_ids = [entry["id"] for entry in sources["repositories"]]
    if len(source_ids) != len(set(source_ids)):
        errors.append("Duplicate upstream repository IDs in source catalog.")

    for entry in sources["repositories"]:
        url = entry.get("url", "")
        if not url.startswith(("https://github.com/", "https://portswigger.net/")):
            errors.append(f"{entry['id']}: source URL is not an approved HTTPS URL.")
        repo_id = entry["id"]
        if repo_id not in installer and entry["name"] not in installer:
            errors.append(f"{repo_id}: catalog entry is not referenced by bootstrap script.")

    registry_ids = [entry["name"] for entry in registry["tools"]]
    if len(registry_ids) != len(set(registry_ids)):
        errors.append("Duplicate tool names in registry.")

    restricted = {entry["id"] for entry in sources["not_auto_integrated"]}
    if not {"blackeye", "arrow-ea"}.issubset(restricted):
        errors.append("BlackEye and unresolved identities must remain excluded.")

    blackeye = next((x for x in registry["tools"] if x["name"] == "BlackEye"), None)
    if not blackeye or blackeye.get("install") != "blocked":
        errors.append("BlackEye must remain marked blocked in registry.")

    for identity in ("Arrow EA",):
        item = next((x for x in registry["tools"] if x["name"] == identity), None)
        if not item or item.get("status") != "identity-unconfirmed":
            errors.append(f"{identity} must remain identity-unconfirmed.")

    # Keep this check intentionally simple and portable; PowerShell itself is not
    # available on all CI runners.
    if not re.search(r"\$ErrorActionPreference\s*=\s*[\"']Stop[\"']", installer):
        errors.append("Bootstrap must stop on terminating PowerShell errors.")

    return errors


if __name__ == "__main__":
    problems = validate()
    if problems:
        print("\n".join(f"ERROR: {problem}" for problem in problems), file=sys.stderr)
        raise SystemExit(1)
    print("Bootstrap metadata validation passed.")
