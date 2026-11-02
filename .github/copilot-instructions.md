# Repository instructions for AI coding assistants

Follow the root `AGENTS.md` as the operating contract. Before implementing a task, inspect `team/manifest.json`, `tools/registry.json`, relevant source, and tests. Prefer real repository adapters over catalog entries or prompt-only declarations.

Use `team/runner.py` / `team/mcp_server.py` for ready tools. Do not claim third-party integrations, provider routes, hosted MCP, voice, RAG, browser automation, or local-device control are active without executable adapters and verification evidence.

Never expose secrets, touch the two forbidden Supabase projects (`ybxowvzicirinpdcfyqe`, `espmxiitzucooxblmnpr`), or deploy/merge production changes without explicit owner approval and passing checks. BlackEye phishing/credential harvesting remains excluded; security tools are restricted to authorized targets.

Run relevant tests and update the manifest, registry, documentation, and CI together when tool readiness changes.