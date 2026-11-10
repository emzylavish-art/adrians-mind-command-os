#!/usr/bin/env python3
"""Wake a mapped fleet specialist. Writes a record. Starts nothing."""
import json
import sys

from control import wake


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    folder = payload.get("state_dir")
    agent_id = payload.get("agent_id")
    if not isinstance(folder, str) or not folder.strip():
        print(json.dumps({
            "status": "blocked", "result": None, "evidence": [],
            "limitations": ["state_dir is required."],
        }))
        raise SystemExit(2)
    if not isinstance(agent_id, str) or not agent_id.strip():
        print(json.dumps({
            "status": "blocked", "result": None, "evidence": [],
            "limitations": ["agent_id is required."],
        }))
        raise SystemExit(2)
    print(json.dumps(wake(folder, agent_id.strip()), indent=2))


if __name__ == "__main__":
    main()
