#!/usr/bin/env python3
"""Explicit Notion API controller; credentials are environment-only.

Supports search, page retrieval, block-child retrieval, and explicit text append.
No network request occurs until a CLI action is selected.
"""
import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.notion.com/v1"
VERSION = "2022-06-28"
ID_RE = re.compile(r"^[0-9a-fA-F-]{32,36}$")


class NotionControllerError(RuntimeError):
    pass


def _request(method, path, payload=None, *, token=None, timeout=30):
    secret = token or os.environ.get("NOTION_API_KEY")
    if not secret:
        raise NotionControllerError("NOTION_API_KEY is not configured.")
    if not path.startswith("/") or ".." in path:
        raise NotionControllerError("Invalid Notion API path.")
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        API + path, data=data, method=method,
        headers={
            "Authorization": "Bearer " + secret,
            "Notion-Version": VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=int(timeout)) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise NotionControllerError("Notion response exceeded the 2 MB limit.")
    except urllib.error.HTTPError as exc:
        raise NotionControllerError(f"Notion API returned HTTP {exc.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise NotionControllerError(f"Notion request failed: {type(exc).__name__}.") from None
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise NotionControllerError("Notion returned invalid JSON.") from None


def search(query, *, page_size=10, timeout=30):
    if not isinstance(query, str):
        raise NotionControllerError("Search query must be text.")
    size = max(1, min(int(page_size), 100))
    return _request("POST", "/search", {"query": query, "page_size": size}, timeout=timeout)


def retrieve_page(page_id, *, timeout=30):
    if not isinstance(page_id, str) or not ID_RE.fullmatch(page_id):
        raise NotionControllerError("Page ID is invalid.")
    return _request("GET", "/pages/" + page_id, timeout=timeout)


def retrieve_children(block_id, *, page_size=100, timeout=30):
    if not isinstance(block_id, str) or not ID_RE.fullmatch(block_id):
        raise NotionControllerError("Block ID is invalid.")
    size = max(1, min(int(page_size), 100))
    return _request("GET", "/blocks/" + block_id + "/children?page_size=" + str(size), timeout=timeout)


def append_text(block_id, text, *, timeout=30):
    if not isinstance(block_id, str) or not ID_RE.fullmatch(block_id):
        raise NotionControllerError("Block ID is invalid.")
    if not isinstance(text, str) or not text.strip():
        raise NotionControllerError("Append text must be non-empty.")
    chunks = [text[i:i + 1800] for i in range(0, len(text), 1800)]
    blocks = [{
        "object": "block",
        "type": "paragraph",
        "paragraph": {"rich_text": [{"type": "text", "text": {"content": chunk}}]},
    } for chunk in chunks]
    return _request("PATCH", "/blocks/" + block_id + "/children", {"children": blocks}, timeout=timeout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["search", "retrieve-page", "retrieve-children", "append-text"])
    parser.add_argument("--query")
    parser.add_argument("--id")
    parser.add_argument("--text")
    parser.add_argument("--page-size", type=int, default=10)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    try:
        if args.action == "search":
            if args.query is None:
                parser.error("search requires --query")
            result = search(args.query, page_size=args.page_size, timeout=args.timeout)
        elif args.action == "retrieve-page":
            result = retrieve_page(args.id, timeout=args.timeout)
        elif args.action == "retrieve-children":
            result = retrieve_children(args.id, page_size=args.page_size, timeout=args.timeout)
        else:
            result = append_text(args.id, args.text, timeout=args.timeout)
        print(json.dumps(result, ensure_ascii=False))
    except NotionControllerError as exc:
        print(json.dumps({"error": str(exc)}))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
