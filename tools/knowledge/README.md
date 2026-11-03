# Offline Knowledge Search

Local lexical search over Markdown and text files. No embeddings, network requests,
or external knowledge database are used.

```bash
python tools/knowledge/knowledge_search.py ./notes --query "agent orchestration tools" --json
python -m unittest discover -s tools/knowledge -p 'test_*.py'
```

Supports Markdown, plain text, and reStructuredText. Returns ranked snippets with
matched terms. This is a functional offline fallback, not semantic retrieval or a
replacement for configured LightRAG/Obsidian/Claude Mem integrations.
