# Adrian's Mind Command OS

Private source for the Mind command app. This repository is not Oak Bridge and not BridgePoint. Those projects are not used as its database.

The running UI is `src/components/mind/command-app.tsx`. Product logic is in `src/lib/mind/`. Settings includes a short owner guide.

The workspace is stored in the browser under `amcos.workspace.v1`. Memory is off by default. Ask mode is the default. Delete and replace always ask. A signed-in owner can also keep a copy in the local server database (`migrations/0002_mind.sql`, owner-scoped). That copy is not cloud backup unless a dedicated `DATABASE_URL` is configured. If the browser and the server both already have data, the browser copy is kept and the server copy is not overwritten until the owner chooses that. Oak Bridge and BridgePoint are not used. Grok 4.5 is called only when Send is pressed, and the reply is streamed. A stopped or broken reply is not saved.

Sign-in is on for protected operations. Grok, voice, REA, the server copy, and emergency stop changes require the verified owner. A cross-site scripted request is rejected. The stop file is per owner and survives a process restart. The embedded database does not.

Open chats on a project shows only that project's chats.

REA is pinned to `rea-agents@6.8.0`. Doctor can run and is not a healthy environment here. `inspect-artifact` rejects TypeScript and plain text without evidence. `analyze-javascript-application` expects an application directory or ASAR, not one source file. Native engines are not installed.

A dedicated database, web research, image generation, video generation, and the HP agent are not connected.


## Agent team runtime

The `team/` folder contains the interoperable agent manifest, capability router,
shared JSON runner, and a minimal MCP stdio server. Currently implemented local
tool adapters include:

- `rea.scan` — offline source inventory.
- `security.scan` — defensive heuristic static review of authorized source.
- `knowledge.search` — offline lexical retrieval from local Markdown/text notes.
- `team.health` — repository readiness and entrypoint check.
- `team.queue` — durable SQLite job enqueue/claim/complete/fail/list operations.\n- `team/worker.py` — explicit allowlisted worker process for queued local tool jobs.

Run the team tests with `python -m unittest discover -s team -p 'test_*.py'`.
Use `python team/runner.py --task '{"operation":"list-tools"}'` to inspect
the declared tool contract. The MCP server is launched with
`python team/mcp_server.py`. Queue state is local and ignored by Git; queue
payloads are not executed by the queue itself. External model providers,
browser runtimes, remote knowledge stores, and unresolved tools are not
represented as connected merely because they appear in the manifest.
