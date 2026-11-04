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
        "hallmark": {
            "source": ROOT / "upstream" / "hallmark" / "skills" / "hallmark" / "SKILL.md",
            "package": None,
            "job": "Anti-slop design for a new page. Do not copy another product.",
        },
        "impeccable": {
            "source": ROOT / "upstream" / "impeccable" / "skill" / "SKILL.src.md",
            "package": None,
            "job": "Polish and redesign. The brief wins.",
        },
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
        "motion": {
            "source": KIT / "node_modules" / "motion" / "package.json",
            "package": version(KIT / "node_modules" / "motion" / "package.json"),
            "job": "React section animation. Package motion. GSAP still owns sequenced timelines.",
        },
        "react-bits": {
            "source": ROOT / "upstream" / "react-bits",
            "package": None,
            "job": "Copy the one animated component the page needs. Do not paste the whole gallery.",
        },
        "scrapling": {
            "source": ROOT / "upstream" / "scrapling" / "agent-skill" / "Scrapling-Skill" / "SKILL.md",
            "package": None,
            "job": "Research helper. Read a page you are allowed to read. Not a design system.",
        },
        "pixelrag": {
            "source": ROOT / "upstream" / "pixelrag" / "plugin" / "skills" / "pixelbrowse" / "SKILL.md",
            "package": None,
            "job": "Research helper. See an authorized page as pictures. No model weights.",
        },
        "gods-eye-view": {
            "source": ROOT / "upstream" / "gods-eye-view" / "README.md",
            "package": None,
            "job": "God's Eye View. Required on every website pass. Place, map, or live public world data only. Do not scan a person.",
        },
    }
    ready = []
    missing = []
    for name, item in members.items():
        present = item["source"].exists()
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
            "Motion animates sections. GSAP still owns sequenced timelines. Lenis owns scroll.",
            "Scrapling and PixelRAG only read pages you are allowed to read. They are not design systems.",
            "Installing these packages does not design the page. Taste or Hallmark still directs the look.",
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
