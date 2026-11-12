#!/usr/bin/env python3
"""Record coding-process hook events without storing prompts or secrets."""

import json
import sys
from pathlib import Path


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    event = payload.get("hook_event_name")
    tool = payload.get("tool_name")
    agent = payload.get("agent_name")
    line = json.dumps(
        {
            "event": event if isinstance(event, str) else "unknown",
            "tool": tool if isinstance(tool, str) else "",
            "agent": agent if isinstance(agent, str) else "",
        },
        separators=(",", ":"),
    )
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/adrian-build-home/proof/hooks.jsonl")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
