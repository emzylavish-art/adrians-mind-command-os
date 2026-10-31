# Adrian's Mind Command OS

Private source for the Mind command app. This repository is not Oak Bridge and not BridgePoint. Those projects are not used as its database.

The running UI is `src/components/mind/command-app.tsx`. Product logic is in `src/lib/mind/`. Settings includes a short owner guide.

The workspace is stored in the browser under `amcos.workspace.v1`. Memory is off by default. Ask mode is the default. Delete and replace always ask. Emergency stop is also enforced in the server process that received it. Grok 4.5 is the only live model, and it is called only when Send is pressed.

Open chats on a project shows only that project's chats.

REA is pinned to `rea-agents@6.8.0`. Doctor can run and is not a healthy environment here. `inspect-artifact` rejects TypeScript and plain text without evidence. `analyze-javascript-application` expects an application directory or ASAR, not one source file. Native engines are not installed.

A dedicated database, web research, image generation, video generation, and the HP agent are not connected.
