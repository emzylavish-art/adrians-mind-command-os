#!/usr/bin/env python3
"""Local lexical search over Markdown and text knowledge files.

No embeddings, remote services, or network access. This is a simple offline
retrieval adapter intended as a useful fallback until a dedicated knowledge store
is configured.
"""
import argparse
import json
import math
import re
from pathlib import Path

SUPPORTED = {".md", ".markdown", ".txt", ".rst"}
SKIP = {".git", ".venv", "venv", "node_modules", "__pycache__"}
TOKEN = re.compile(r"[a-z0-9_]{2,}", re.IGNORECASE)
MAX_FILE_BYTES = 1_500_000


def tokens(text):
    return [term.lower() for term in TOKEN.findall(text)]


def gather(root):
    if root.is_file():
        candidates = [root]
    elif root.is_dir():
        candidates = root.rglob("*")
    else:
        raise ValueError(f"Knowledge path does not exist: {root}")
    files = []
    for path in candidates:
        if not path.is_file() or path.suffix.lower() not in SUPPORTED:
            continue
        if any(part in SKIP for part in path.parts):
            continue
        try:
            if path.stat().st_size <= MAX_FILE_BYTES:
                files.append(path)
        except OSError:
            continue
    return files


def search(root, query, top_k=5):
    query_terms = set(tokens(query))
    if not query_terms:
        raise ValueError("Query must contain at least one searchable term.")
    if top_k < 1 or top_k > 50:
        raise ValueError("top_k must be between 1 and 50.")

    files = gather(root)
    docs = []
    document_frequency = {}
    for path in files:
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        terms = tokens(content)
        frequencies = {}
        for term in terms:
            frequencies[term] = frequencies.get(term, 0) + 1
        docs.append((path, content, frequencies, len(terms)))
        for term in query_terms:
            if frequencies.get(term, 0):
                document_frequency[term] = document_frequency.get(term, 0) + 1

    count = max(len(docs), 1)
    results = []
    for path, content, frequencies, length in docs:
        score = 0.0
        matched = []
        for term in query_terms:
            tf = frequencies.get(term, 0)
            if not tf:
                continue
            matched.append(term)
            idf = math.log(1 + (count - document_frequency.get(term, 0) + 0.5) /
                           (document_frequency.get(term, 0) + 0.5))
            score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * length / 500))
        if not score:
            continue
        snippet = ""
        lines = content.splitlines()
        for line in lines:
            if query_terms.intersection(tokens(line)):
                snippet = re.sub(r"\s+", " ", line.strip())[:420]
                break
        if not snippet:
            snippet = re.sub(r"\s+", " ", content.strip())[:420]
        results.append({
            "file": str(path.relative_to(root) if root.is_dir() else path.name),
            "score": round(score, 5),
            "matched_terms": sorted(matched),
            "snippet": snippet,
        })
    results.sort(key=lambda item: (-item["score"], item["file"]))
    return {
        "query": query,
        "files_searched": len(docs),
        "results": results[:top_k],
        "limitations": [
            "Lexical retrieval only; it does not understand semantic similarity.",
            "Searches local Markdown and text files only; no remote knowledge store is queried."
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", default=".", help="Knowledge directory or text file")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        report = search(Path(args.path), args.query, args.top_k)
        print(json.dumps(report, indent=2) if args.json else
              f"Search completed: {len(report['results'])} results across {report['files_searched']} files.")
    except Exception as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
