#!/usr/bin/env python3
"""Confirm the website-build crew and the motion packages are on disk."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KIT = Path(__file__).resolve().parent


def version(path: Path) -> str | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8")).get("version")


def locate() -> dict:
    members = {
        "gsap": {
            "source": ROOT / "upstream" / "gsap",
            "package": version(KIT / "node_modules" / "gsap" / "package.json"),
            "job": "Timelines and motion. Use this instead of homemade CSS animation.",
        },
        "lenis": {
            "source": ROOT / "upstream" / "lenis",
            "package": version(KIT / "node_modules" / "lenis" / "package.json"),
            "job": "Smooth scroll. Pair it with GSAP when the scroll itself is the motion.",
        },
        "react-bits": {
            "source": ROOT / "upstream" / "react-bits",
            "package": None,
            "job": "Copy the one animated component the page needs. Do not paste the whole gallery.",
        },
        "21st": {
            "source": ROOT / "upstream" / "21st-magic",
            "package": None,
            "job": "Interface components. Live search stays off until the owner sets API_KEY_21ST.",
        },
    }
    ready = []
    missing = []
    for name, item in members.items():
        present = item["source"].is_dir()
        (ready if present else missing).append(name)
        item["source"] = str(item["source"])
        item["present"] = present
    return {
        "status": "ready" if not missing else "partial",
        "team": "website",
        "charter": "team/WEBSITE_TEAM.md",
        "members": members,
        "ready": ready,
        "missing": missing,
        "limitations": [
            "React Bits is a source library. Copy one component into the site being built.",
            "21st live search needs the owner's own API key.",
            "Installing these packages does not design the page. Taste still directs the look.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = locate()
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"{report['status']}: website team")
        print("ready: " + ", ".join(report["ready"]))
        if report["missing"]:
            print("missing: " + ", ".join(report["missing"]))
    if report["missing"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
