# Windows 11 tool bootstrap

This repository includes a one-command Windows 11 bootstrap for the safe, source-verified tools in the requested catalog.

## Run it

Open PowerShell in the repository root and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\tools\bootstrap\Install-MindCommandTools.ps1
```

The script installs Git, Node.js LTS, Python 3.12, JDK 25, and MSYS2 through Windows Package Manager where available. It then checks out the official upstream repositories under `%USERPROFILE%\AdriansMind\upstream-tools`, installs the n8n-MCP and UI UX Pro Max npm packages, installs Frida and LightRAG Python packages, downloads the latest Ghidra/JADX/x64dbg release ZIPs, installs OWASP ZAP and Burp Suite Community through winget, and installs GDB through MSYS2.

## What it does not do

- It does not run any third-party code after cloning it.
- It does not write into Codex, Claude, Obsidian, or n8n user configuration automatically.
- Claude Mem and the skill repositories are checked out, but activation must follow each project's current instructions.
- LightRAG needs a model/embedding provider and secure local configuration before it can serve queries.
- Burp Suite is Community Edition. PortSwigger's license terms apply.
- God's Eyes and Arrow EA remain excluded because their exact project identities are not confirmed.
- BlackEye remains blocked; phishing and credential collection are not integrated.

Use reverse-engineering and security tools only on software, devices, and applications you own or have explicit permission to assess.

## Selective reruns

```powershell
.\tools\bootstrap\Install-MindCommandTools.ps1 -SkipSystemPackages
.\tools\bootstrap\Install-MindCommandTools.ps1 -SkipSourceClones
.\tools\bootstrap\Install-MindCommandTools.ps1 -SkipDesktopTools
```

The process is repeatable. Existing checkouts are updated only with fast-forward pulls; directories that are not Git repositories are never overwritten.

The bootstrap config is in `tools/bootstrap/upstream-sources.json`.
