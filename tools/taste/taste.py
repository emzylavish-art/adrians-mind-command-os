#!/usr/bin/env python3
"""Locate the installed taste skill and print its team rules.

Offline. Does not run the design scripts, fetch pictures, or copy another product.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "upstream" / "taste-skill" / "skills" / "taste-skill"
REFERENCES = (
    "copy.md",
    "type.md",
    "colour.md",
    "layout.md",
    "imagery.md",
    "motion.md",
    "scenes.md",
    "critique.md",
    "app-screens.md",
    "tells.md",
    "research.md",
)


def locate() -> dict:
    skill_md = SKILL / "SKILL.md"
    present = skill_md.is_file()
    refs = [name for name in REFERENCES if (SKILL / "references" / name).is_file()]
    return {
        "status": "ready" if present else "blocked",
        "skill": "design-taste-frontend",
        "path": str(skill_md) if present else None,
        "references": refs,
        "reference_policy": (
            "Study the craft of Manus, GPT, Grok, and other frontier product surfaces. "
            "Do not copy their names, logos, layout, or wording. "
            "Adrian's own shell is the subject."
        ),
        "use": {
            "page": "marketing and public pages",
            "app_screen": "the command OS shell, dashboards, and working screens",
        },
        "limitations": [
            "This command only confirms the skill is installed.",
            "A real design pass still has to run the skill's own scripts in a browser.",
            "Open-archive pictures are searched only during that design pass, never by this locator.",
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
        print(f"{report['status']}: {report['skill']}")
        print(report["path"] or "skill file missing")
        print("references: " + ", ".join(report["references"]))
    if report["status"] != "ready":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
