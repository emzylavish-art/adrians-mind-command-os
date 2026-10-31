# Adrian's Mind Command OS

Private source for the Mind command app. This repository is not Oak Bridge and not BridgePoint. Those projects are not used as its database.

The running UI is `src/components/mind/command-app.tsx`. Product logic is in `src/lib/mind/`.

The workspace is stored in the browser under `amcos.workspace.v1`. Memory is off by default. Ask mode is the default. Delete and replace always ask. Grok 4.5 is the only live model, and it is called only when Send is pressed.

A dedicated database, web research, image generation, video generation, and the HP agent are not connected. REA doctor and file inspect call `rea-agents` from GitHub when you press those buttons. Native analysis engines are not installed in the build environment.
