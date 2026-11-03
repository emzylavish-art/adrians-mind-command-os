#!/usr/bin/env python3
"""GodEye (God's Eyes): read-only visual and structural auditor for a URL.

Fetches a page with Playwright headless when available, otherwise requests.
Captures screenshot (when possible), title, status, links, buttons, forms,
inputs, script/style assets, and console errors (headless). Checks same-origin
link HTTP statuses. Emits JSON. Never submits forms and never issues POSTs.

In-repo implementation; upstream identity of any third-party "GodEye" remains
unconfirmed — this does not download external GodEye binaries.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

ALLOWED_HOST_SUFFIXES = ("adrians-mind.vercel.app", "localhost", "127.0.0.1")
USER_AGENT = "AdriansMind-GodEye/1.0 (+read-only; no-POST)"


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self._in_title = False
        self.links: list[dict[str, str]] = []
        self.buttons: list[dict[str, str]] = []
        self.forms: list[dict[str, Any]] = []
        self.inputs: list[dict[str, str]] = []
        self.scripts: list[str] = []
        self.styles: list[str] = []
        self._form_stack: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "a":
            href = ad.get("href", "")
            self.links.append({"href": href, "text": ad.get("aria-label") or ad.get("title") or ""})
        elif tag == "button":
            self.buttons.append({
                "type": ad.get("type", "submit"),
                "text": ad.get("aria-label") or ad.get("title") or ad.get("name") or "",
                "id": ad.get("id", ""),
            })
        elif tag == "form":
            form = {
                "action": ad.get("action", ""),
                "method": (ad.get("method") or "get").lower(),
                "id": ad.get("id", ""),
            }
            self.forms.append(form)
            self._form_stack.append(form)
        elif tag == "input":
            entry = {
                "type": ad.get("type", "text"),
                "name": ad.get("name", ""),
                "id": ad.get("id", ""),
                "placeholder": ad.get("placeholder", ""),
            }
            self.inputs.append(entry)
        elif tag == "script":
            src = ad.get("src", "")
            if src:
                self.scripts.append(src)
        elif tag == "link" and "stylesheet" in ad.get("rel", "").lower():
            href = ad.get("href", "")
            if href:
                self.styles.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "form" and self._form_stack:
            self._form_stack.pop()

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)


def _host_allowed(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    return any(host == s or host.endswith("." + s) for s in ALLOWED_HOST_SUFFIXES)


def _same_origin(base: str, other: str) -> bool:
    b, o = urlparse(base), urlparse(other)
    return (b.scheme, b.netloc) == (o.scheme, o.netloc)


def _absolutize(base: str, href: str) -> str | None:
    if not href or href.startswith(("#", "javascript:", "mailto:", "tel:", "data:")):
        return None
    return urljoin(base, href)


def _fetch_requests(url: str, timeout: float = 30.0) -> dict[str, Any]:
    import requests

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    # Force GET only — never POST
    resp = session.get(url, timeout=timeout, allow_redirects=True)
    html = resp.text
    parser = _PageParser()
    try:
        parser.feed(html)
    except Exception as exc:  # noqa: BLE001
        parser = _PageParser()
        return {
            "engine": "requests",
            "status": resp.status_code,
            "final_url": str(resp.url),
            "title": "",
            "parse_error": str(exc),
            "links": [],
            "buttons": [],
            "forms": [],
            "inputs": [],
            "scripts": [],
            "styles": [],
            "console_errors": [],
            "screenshot_path": None,
            "html_bytes": len(html.encode("utf-8", errors="replace")),
        }
    title = re.sub(r"\s+", " ", "".join(parser.title_parts)).strip()
    return {
        "engine": "requests",
        "status": resp.status_code,
        "final_url": str(resp.url),
        "title": title,
        "links": parser.links,
        "buttons": parser.buttons,
        "forms": parser.forms,
        "inputs": parser.inputs,
        "scripts": parser.scripts,
        "styles": parser.styles,
        "console_errors": [],
        "screenshot_path": None,
        "html_bytes": len(html.encode("utf-8", errors="replace")),
    }


def _fetch_playwright(url: str, screenshot: Path | None, timeout_ms: int = 30000) -> dict[str, Any] | None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None

    console_errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(user_agent=USER_AGENT)
            page = context.new_page()
            page.on("console", lambda msg: console_errors.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
            page.on("pageerror", lambda exc: console_errors.append(f"pageerror: {exc}"))
            response = page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            status = response.status if response else None
            final_url = page.url
            title = page.title()
            # Structural extraction via DOM — read-only, no clicks that submit
            links = page.eval_on_selector_all(
                "a[href]",
                "els => els.map(e => ({href: e.getAttribute('href') || '', text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0,120)}))",
            )
            buttons = page.eval_on_selector_all(
                "button, [role='button'], input[type='button'], input[type='submit']",
                "els => els.map(e => ({type: e.getAttribute('type') || e.tagName.toLowerCase(), text: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0,120), id: e.id || ''}))",
            )
            forms = page.eval_on_selector_all(
                "form",
                "els => els.map(e => ({action: e.getAttribute('action') || '', method: (e.getAttribute('method') || 'get').toLowerCase(), id: e.id || ''}))",
            )
            inputs = page.eval_on_selector_all(
                "input, textarea, select",
                "els => els.map(e => ({type: e.getAttribute('type') || e.tagName.toLowerCase(), name: e.getAttribute('name') || '', id: e.id || '', placeholder: e.getAttribute('placeholder') || ''}))",
            )
            scripts = page.eval_on_selector_all("script[src]", "els => els.map(e => e.src)")
            styles = page.eval_on_selector_all(
                "link[rel~='stylesheet']",
                "els => els.map(e => e.href)",
            )
            shot_path = None
            if screenshot is not None:
                screenshot.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(screenshot), full_page=True)
                shot_path = str(screenshot)
            html_bytes = len(page.content().encode("utf-8", errors="replace"))
        finally:
            browser.close()

    return {
        "engine": "playwright",
        "status": status,
        "final_url": final_url,
        "title": title,
        "links": links,
        "buttons": buttons,
        "forms": forms,
        "inputs": inputs,
        "scripts": scripts,
        "styles": styles,
        "console_errors": console_errors,
        "screenshot_path": shot_path,
        "html_bytes": html_bytes,
    }


def _check_same_origin_links(base_url: str, links: list[dict[str, str]], timeout: float = 15.0) -> list[dict[str, Any]]:
    import requests

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for item in links:
        abs_url = _absolutize(base_url, item.get("href", ""))
        if not abs_url or abs_url in seen:
            continue
        seen.add(abs_url)
        if not _same_origin(base_url, abs_url):
            continue
        if not _host_allowed(abs_url):
            continue
        try:
            # HEAD first; fall back to GET if HEAD rejected — still never POST
            resp = session.head(abs_url, timeout=timeout, allow_redirects=True)
            if resp.status_code in {405, 501}:
                resp = session.get(abs_url, timeout=timeout, allow_redirects=True, stream=True)
                resp.close()
            results.append({"url": abs_url, "status": resp.status_code})
        except Exception as exc:  # noqa: BLE001
            results.append({"url": abs_url, "status": None, "error": str(exc)})
    return results


def audit(url: str, screenshot: Path | None = None, prefer_playwright: bool = True) -> dict[str, Any]:
    if not _host_allowed(url):
        raise ValueError(
            f"GodEye refuses hosts outside allowlist {ALLOWED_HOST_SUFFIXES}; got {urlparse(url).hostname!r}"
        )
    page: dict[str, Any] | None = None
    if prefer_playwright:
        page = _fetch_playwright(url, screenshot)
    if page is None:
        page = _fetch_requests(url)
    final = page.get("final_url") or url
    link_statuses = _check_same_origin_links(final, page.get("links") or [])
    broken = [x for x in link_statuses if isinstance(x.get("status"), int) and x["status"] >= 400]
    return {
        "tool": "godeye",
        "product": "Adrian's Mind",
        "mode": "read-only",
        "target": url,
        "page": page,
        "same_origin_link_statuses": link_statuses,
        "broken_same_origin_links": broken,
        "summary": {
            "title": page.get("title"),
            "status": page.get("status"),
            "engine": page.get("engine"),
            "link_count": len(page.get("links") or []),
            "button_count": len(page.get("buttons") or []),
            "form_count": len(page.get("forms") or []),
            "input_count": len(page.get("inputs") or []),
            "script_count": len(page.get("scripts") or []),
            "style_count": len(page.get("styles") or []),
            "console_error_count": len(page.get("console_errors") or []),
            "broken_same_origin_count": len(broken),
            "screenshot": page.get("screenshot_path"),
        },
        "note": "in-repo implementation; upstream identity still unconfirmed",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url", nargs="?", default="https://adrians-mind.vercel.app", help="URL to audit (allowlisted hosts only)")
    ap.add_argument("--json", action="store_true", help="emit JSON (default)")
    ap.add_argument("--out", help="write report to a file")
    ap.add_argument("--screenshot", help="optional screenshot path (Playwright only)")
    ap.add_argument("--requests-only", action="store_true", help="skip Playwright even if installed")
    args = ap.parse_args()
    shot = Path(args.screenshot) if args.screenshot else None
    try:
        report = audit(args.url, screenshot=shot, prefer_playwright=not args.requests_only)
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
