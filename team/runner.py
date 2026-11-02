#!/usr/bin/env python3
"""Common JSON task runner for compatible AI hosts.

Routes requests through the shared manifest and executes only tools whose
entrypoints are explicitly implemented here. No model inference is performed.
"""
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
        "status": status,
        "result": result,
        "evidence": evidence or [],
        "limitations": limitations or [],
        "dispatch": dispatch,
    }


def list_tools(manifest):
    return {
        "status": "ready",
        "result": manifest.get("tools", []),
        "evidence": ["team/manifest.json"],
        "limitations": ["Catalog entries are not proof that external runtimes are installed or connected."],
        "dispatch": None,
    }


def invoke(tool_id, payload, manifest):
    declared = {item.get("id"): item for item in manifest.get("tools", [])}
    tool = declared.get(tool_id)
    if tool is None:
        return envelope("blocked", limitations=[f"Tool is not declared: {tool_id}"])
    if tool.get("status") != "ready":
        return envelope(
            "blocked",
            evidence=[f"team/manifest.json#tools/{tool_id}"],
            limitations=[f"Tool status is {tool.get('status')}; it cannot be invoked by this runner."],
        )

    if tool_id == "rea.scan":
        path = payload.get("path", ".")
        command = [sys.executable, str(ROOT / "tools" / "rea" / "rea.py"), path, "--json"]
        output_path = payload.get("out")
        if output_path:
            command.extend(["--out", str(output_path)])
        try:
            completed = subprocess.run(
                command,
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=int(payload.get("timeout_seconds", 60)),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return envelope("blocked", limitations=[f"REA invocation failed: {exc}"])
        if completed.returncode:
            return envelope(
                "blocked",
                result=completed.stdout.strip() or None,
                evidence=["tools/rea/rea.py"],
                limitations=[completed.stderr.strip() or f"REA exited with {completed.returncode}"],
            )
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return envelope("blocked", result=completed.stdout, evidence=["tools/rea/rea.py"],
                            limitations=["REA returned non-JSON output."])
        return envelope("ready", report, ["tools/rea/rea.py"], [])

    return envelope(
        "not_implemented",
        evidence=[f"team/manifest.json#tools/{tool_id}"],
        limitations=["The tool is declared, but this runner has no executable adapter for it yet."],
    )


def run(payload, manifest):
    operation = payload.get("operation", "route")
    if operation == "list-tools":
        return list_tools(manifest)
    if operation == "invoke":
        tool_id = payload.get("tool_id")
        if not isinstance(tool_id, str) or not tool_id.strip():
            return envelope("blocked", limitations=["tool_id is required for operation=invoke."])
        return invoke(tool_id, payload.get("input", {}), manifest)
    if operation != "route":
        return envelope("blocked", limitations=[f"Unsupported operation: {operation}"])

    completed = subprocess.run(
        [sys.executable, str(ROUTER)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    if completed.returncode:
        return envelope("blocked", result=completed.stdout.strip() or None,
                        limitations=[completed.stderr.strip() or "Router returned an error."])
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError:
        return envelope("blocked", result=completed.stdout, limitations=["Router returned non-JSON output."])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", help="JSON task; stdin is used when omitted.")
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
