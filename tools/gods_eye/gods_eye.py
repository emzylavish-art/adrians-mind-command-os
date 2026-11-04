#!/usr/bin/env python3
"""Locate the pinned God's Eye View checkout and print the website rule.

Offline. Does not start the globe, call a data feed, scan a person, or store a key.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKOUT = ROOT / "upstream" / "gods-eye-view"


def locate() -> dict:
    readme = CHECKOUT / "README.md"
    package = CHECKOUT / "package.json"
    present = readme.is_file() and package.is_file()
    return {
        "status": "ready" if present else "blocked",
        "name": "Gods Eye View",
        "repo": "https://github.com/bilawalsidhu/gods-eye-view",
        "path": str(CHECKOUT) if present else None,
        "rule": (
            "On every website, landing page, or app screen, run the website pass. "
            "God's Eye View is one of the tools that pass lists. "
            "Use the globe when the surface is a place, a map, or live public world data. "
            "On any other surface, say there is no place and still count this tool as used. "
            "Public data only. Do not scan a person. Do not add an API key."
        ),
        "limitations": [
            "The source is pinned. The globe is not a running service in this repository.",
            "This locator does not fetch aircraft, cameras, or any other live feed.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = locate()
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(report["status"])
        print(report["repo"])
        print(report["rule"])
    if report["status"] != "ready":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
