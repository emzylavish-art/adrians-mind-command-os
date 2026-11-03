#!/usr/bin/env python3
"""OWASP ZAP–style passive baseline for Adrian's Mind (read-only).

Prefers an installed OWASP ZAP baseline (`zap-baseline.py` or
`docker run zaproxy/zap-stable zap-baseline.py`) when available. If neither
Docker nor a local ZAP CLI is present, runs an in-repo passive probe that
checks security-relevant response headers, cookie flags, HTTPS redirects, and
mixed-content markers — still GET/HEAD only, never active attack mode.

Only https://adrians-mind.vercel.app (and localhost for tests) are allowed.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ALLOWED_HOSTS = {"adrians-mind.vercel.app", "localhost", "127.0.0.1"}
LIVE_TARGET = "https://adrians-mind.vercel.app"
USER_AGENT = "AdriansMind-ZAP-Passive/1.0 (+read-only; no-active-scan)"


def _allowed(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in ALLOWED_HOSTS


def _try_zap_cli(url: str) -> dict[str, Any] | None:
    zap = shutil.which("zap-baseline.py") or shutil.which("zap-baseline")
    if not zap:
        return None
    # Passive baseline only (-I ignore warnings exit; no active spider attack flags)
    cmd = [zap, "-t", url, "-I", "-J", "-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"engine": "zap-baseline-cli", "error": str(exc)}
    payload: Any
    try:
        payload = json.loads(proc.stdout) if proc.stdout.strip().startswith("{") else {"raw_stdout": proc.stdout[-4000:]}
    except json.JSONDecodeError:
        payload = {"raw_stdout": proc.stdout[-4000:], "stderr": proc.stderr[-2000:]}
    return {"engine": "zap-baseline-cli", "exit_code": proc.returncode, "result": payload}


def _try_zap_docker(url: str) -> dict[str, Any] | None:
    docker = shutil.which("docker")
    if not docker:
        return None
    cmd = [
        docker, "run", "--rm", "ghcr.io/zaproxy/zaproxy:stable",
        "zap-baseline.py", "-t", url, "-I",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"engine": "zap-docker-baseline", "error": str(exc)}
    return {
        "engine": "zap-docker-baseline",
        "exit_code": proc.returncode,
        "stdout_tail": proc.stdout[-6000:],
        "stderr_tail": proc.stderr[-2000:],
    }


def _passive_probe(url: str, timeout: float = 30.0) -> dict[str, Any]:
    import requests

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    resp = session.get(url, timeout=timeout, allow_redirects=True)
    headers = {k.lower(): v for k, v in resp.headers.items()}
    findings: list[dict[str, str]] = []

    def missing(name: str, advice: str) -> None:
        if name not in headers:
            findings.append({"id": f"missing_{name.replace('-', '_')}", "severity": "medium", "description": advice})

    missing("content-security-policy", "No Content-Security-Policy header observed.")
    missing("x-content-type-options", "No X-Content-Type-Options header (expect nosniff).")
    missing("x-frame-options", "No X-Frame-Options header (or rely on CSP frame-ancestors).")
    missing("referrer-policy", "No Referrer-Policy header.")
    missing("permissions-policy", "No Permissions-Policy header.")
    if urlparse(resp.url).scheme == "https" and "strict-transport-security" not in headers:
        findings.append({
            "id": "missing_hsts",
            "severity": "medium",
            "description": "HTTPS response lacks Strict-Transport-Security.",
        })
    set_cookies = resp.headers.get("Set-Cookie", "")
    if set_cookies:
        low = set_cookies.lower()
        if "secure" not in low:
            findings.append({"id": "cookie_missing_secure", "severity": "medium", "description": "Set-Cookie without Secure flag."})
        if "httponly" not in low:
            findings.append({"id": "cookie_missing_httponly", "severity": "low", "description": "Set-Cookie without HttpOnly flag."})
    # Mixed content markers in HTML (passive)
    html = resp.text
    if urlparse(resp.url).scheme == "https":
        for m in re.finditer(r"""(?:src|href)\s*=\s*["']http://[^"']+""", html, re.I):
            findings.append({
                "id": "mixed_content_candidate",
                "severity": "low",
                "description": f"HTTP resource reference on HTTPS page: {m.group(0)[:160]}",
            })
            if len([f for f in findings if f["id"] == "mixed_content_candidate"]) >= 10:
                break
    return {
        "engine": "in-repo-passive-probe",
        "status": resp.status_code,
        "final_url": str(resp.url),
        "response_headers": headers,
        "findings": findings,
        "findings_count": len(findings),
        "note": "Full OWASP ZAP daemon not installed; in-repo passive baseline used. Active scan disabled.",
    }


def scan(url: str) -> dict[str, Any]:
    if not _allowed(url):
        raise ValueError(f"Refusing non-allowlisted host: {urlparse(url).hostname!r}")
    for runner in (_try_zap_cli, _try_zap_docker):
        result = runner(url)
        if result is not None and "error" not in result:
            return {
                "tool": "owasp_zap_passive",
                "product": "Adrian's Mind",
                "mode": "passive-only",
                "target": url,
                "scan": result,
            }
    probe = _passive_probe(url)
    return {
        "tool": "owasp_zap_passive",
        "product": "Adrian's Mind",
        "mode": "passive-only",
        "target": url,
        "scan": probe,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url", nargs="?", default=LIVE_TARGET)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out", help="write JSON report")
    args = ap.parse_args()
    try:
        report = scan(args.url)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    output = json.dumps(report, indent=2)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)


if __name__ == "__main__":
    main()
