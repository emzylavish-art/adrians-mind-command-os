#!/usr/bin/env python3
"""Mind Command OS shared JSON task runner."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "team" / "manifest.json"
ROUTER = ROOT / "team" / "router.py"


def load_manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def envelope(status, result=None, evidence=None, limitations=None, dispatch=None):
    return {
        "status": status, "result": result, "evidence": evidence or [],
        "limitations": limitations or [], "dispatch": dispatch,
    }


def list_tools(manifest):
    return envelope(
        "ready", manifest.get("tools", []), ["team/manifest.json"],
        ["Catalog declarations do not prove external runtimes or services are connected."],
    )


def invoke(tool_id, payload, manifest):
    declared = {item.get("id"): item for item in manifest.get("tools", [])}
    tool = declared.get(tool_id)
    if tool is None:
        return envelope("blocked", limitations=[f"Tool is not declared: {tool_id}"])
    if tool.get("status") != "ready":
        return envelope(
            "blocked", evidence=[f"team/manifest.json#tools/{tool_id}"],
            limitations=[f"Tool status is {tool.get('status')}; invocation is disabled."],
        )

    if tool_id == "knowledge.search":
        query = payload.get("query")
        if not isinstance(query, str) or not query.strip():
            return envelope("blocked", limitations=["knowledge.search requires a non-empty query."])
        command = [
            sys.executable, str(ROOT / "tools" / "knowledge" / "knowledge_search.py"),
            payload.get("path", "."), "--query", query,
            "--top-k", str(payload.get("top_k", 5)), "--json",
        ]
        try:
            completed = subprocess.run(
                command, cwd=ROOT, capture_output=True, text=True,
                timeout=int(payload.get("timeout_seconds", 60)), check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"Knowledge search invocation failed: {exc}"])
        if completed.returncode:
            return envelope("blocked", result=completed.stdout.strip() or None,
                            evidence=["tools/knowledge/knowledge_search.py"],
                            limitations=[completed.stderr.strip() or "Knowledge search failed."])
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return envelope("blocked", result=completed.stdout,
                            evidence=["tools/knowledge/knowledge_search.py"],
                            limitations=["Knowledge search returned non-JSON output."])
        return envelope("ready", report, ["tools/knowledge/knowledge_search.py"],
                        report.get("limitations", []))

    adapters = {
        "rea.scan": (ROOT / "tools" / "rea" / "rea.py", "source"),
        "security.scan": (ROOT / "tools" / "security_review" / "security_review.py", "source"),
        "team.health": (ROOT / "team" / "health.py", "health"),
    }
    adapter = adapters.get(tool_id)
    if adapter is None or not adapter[0].is_file():
        return envelope(
            "not_implemented", evidence=[f"team/manifest.json#tools/{tool_id}"],
            limitations=["No verified executable adapter exists for this declaration."],
        )
    script, mode = adapter
    command = [sys.executable, str(script)]
    if mode == "source":
        command.extend([payload.get("path", "."), "--json"])
        if payload.get("out"):
            command.extend(["--out", str(payload["out"])])
    else:
        command.append("--json")
    try:
        completed = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True,
            timeout=int(payload.get("timeout_seconds", 120)), check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return envelope("blocked", limitations=[f"Invocation failed: {exc}"])
    if completed.returncode:
        return envelope(
            "blocked", result=completed.stdout.strip() or None,
            evidence=[str(script.relative_to(ROOT))],
            limitations=[completed.stderr.strip() or f"Tool exited {completed.returncode}"],
        )
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return envelope(
            "blocked", result=completed.stdout,
            evidence=[str(script.relative_to(ROOT))],
            limitations=["Tool output was not valid JSON."],
        )
    limitations = report.get("limitations", []) if isinstance(report, dict) else []
    return envelope("ready", report, [str(script.relative_to(ROOT))], limitations)


def run(payload, manifest):
    operation = payload.get("operation", "route")
    if operation == "list-tools":
        return list_tools(manifest)
    if operation == "invoke":
        tool_id = payload.get("tool_id")
        if not isinstance(tool_id, str) or not tool_id.strip():
            return envelope("blocked", limitations=["tool_id is required for invoke."])
        input_data = payload.get("input", {})
        if not isinstance(input_data, dict):
            return envelope("blocked", limitations=["input must be a JSON object."])
        return invoke(tool_id, input_data, manifest)
    if operation != "route":
        return envelope("blocked", limitations=[f"Unsupported operation: {operation}"])
    completed = subprocess.run(
        [sys.executable, str(ROUTER)],
        input=json.dumps(payload), capture_output=True, text=True,
        cwd=ROOT, check=False,
    )
    if completed.returncode:
        return envelope("blocked", result=completed.stdout.strip() or None,
                        limitations=[completed.stderr.strip() or "Router failed."])
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError:
        return envelope("blocked", result=completed.stdout,
                        limitations=["Router returned non-JSON output."])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", help="JSON task; otherwise read JSON from stdin.")
    args = parser.parse_args()
    try:
        payload = json.loads(args.task) if args.task else json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("Input must be a JSON object.")
        print(json.dumps(run(payload, load_manifest()), indent=2))
    except Exception as exc:
        print(json.dumps(envelope("blocked", limitations=[str(exc)]), indent=2))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
