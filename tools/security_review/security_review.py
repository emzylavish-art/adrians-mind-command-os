#!/usr/bin/env python3
"""Defensive static security review for repository-owned source files.

This first version intentionally performs local, offline checks only. It does not
run target code, probe hosts, exploit findings, or print matched secret values.
"""
import argparse
import json
import re
from pathlib import Path

SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", "dist", "build"}
TEXT_SUFFIXES = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".c", ".h", ".cpp", ".hpp",
    ".go", ".rs", ".java", ".kt", ".php", ".rb", ".sh", ".ps1", ".yaml", ".yml",
    ".json", ".toml", ".ini", ".env", ".conf", ".sql",
}
PATTERNS = [
    ("hardcoded_secret_assignment", re.compile(
        r"(?i)\b(?:api[_-]?key|secret|access[_-]?token|password|passwd)\b\s*[:=]\s*['\"][^'\"]{8,}['\"]"
    ), "high", "Potential hardcoded secret assignment; verify whether value is sensitive."),
    ("python_shell_true", re.compile(r"(?i)\bsubprocess\.(?:run|Popen|call)\s*\([^\n]*\bshell\s*=\s*True"), "high",
     "Shell execution enabled; inspect command construction and input provenance."),
    ("dynamic_eval", re.compile(r"\b(?:eval|exec)\s*\("), "medium",
     "Dynamic code execution; inspect whether input can be influenced externally."),
    ("disabled_tls_verification", re.compile(r"(?i)\bverify\s*=\s*False\b"), "medium",
     "TLS certificate verification appears disabled."),
    ("wildcard_cors", re.compile(r"(?i)\bAccess-Control-Allow-Origin\s*[:=]\s*['\"]\*['\"]"), "medium",
     "Wildcard CORS policy detected; review whether credentials or sensitive endpoints are involved."),
    ("unsafe_deserialization", re.compile(r"\bpickle\.(?:load|loads)\s*\("), "high",
     "Pickle deserialization can execute code; verify data is trusted."),
]
SECRET_VALUE = re.compile(r"(?i)(?P<prefix>\b(?:api[_-]?key|secret|access[_-]?token|password|passwd)\b\s*[:=]\s*['\"])[^'\"]+(?P<suffix>['\"])")
MAX_FILE_BYTES = 1_000_000


def iter_files(root):
    for path in root.rglob("*"):
        if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {".env", "Dockerfile"}:
            continue
        try:
            if path.stat().st_size <= MAX_FILE_BYTES:
                yield path
        except OSError:
            continue


def review(target):
    root = target.resolve()
    if not root.exists():
        raise ValueError(f"Path does not exist: {target}")
    paths = [root] if root.is_file() else list(iter_files(root))
    findings = []
    for path in paths:
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {".env", "Dockerfile"}:
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line_number, line in enumerate(content.splitlines(), 1):
            for finding_id, pattern, severity, description in PATTERNS:
                if pattern.search(line):
                    safe_line = SECRET_VALUE.sub(r"\g<prefix>[REDACTED]\g<suffix>", line.strip())[:300]
                    findings.append({
                        "id": finding_id,
                        "severity": severity,
                        "file": str(path.relative_to(root) if root.is_dir() else path.name),
                        "line": line_number,
                        "description": description,
                        "excerpt": safe_line,
                    })
    counts = {level: sum(1 for item in findings if item["severity"] == level) for level in ("high", "medium", "low")}
    return {
        "target": str(target),
        "files_scanned": len(paths),
        "findings_count": len(findings),
        "severity_counts": counts,
        "findings": findings,
        "limitations": [
            "Heuristic static review; false positives and false negatives are expected.",
            "No target code is executed and no network requests are made.",
            "Not a substitute for a dedicated SAST, dependency, or penetration test.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", default=".", help="Repository directory or source file")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    parser.add_argument("--out", help="Optional output path")
    args = parser.parse_args()
    try:
        report = review(Path(args.path))
        output = json.dumps(report, indent=2)
        if args.out:
            Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(output if args.json or args.out else
              f"Scanned {report['files_scanned']} files; {report['findings_count']} heuristic findings.")
    except Exception as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
