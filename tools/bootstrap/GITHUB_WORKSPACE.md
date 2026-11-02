# GitHub workspace tool installation

This is the GitHub-side installation path. It does not touch the owner's Windows machine.

## Activate the workspace

Open this repository in a GitHub Codespace. The committed `.devcontainer/devcontainer.json` runs `tools/bootstrap/install-github-workspace.sh` during Codespace creation. The setup script:

- installs the declared Frida and LightRAG Python packages in the Codespace;
- installs the n8n-MCP and UI UX Pro Max CLI packages globally in the Codespace;
- clones/fast-forward-updates each source-confirmed upstream repository under `.tools/upstream/`;
- leaves a pre-existing non-Git directory untouched and continues after an individual upstream/package failure.

Run the presence check at any time:

```bash
bash tools/bootstrap/verify-github-workspace.sh
```

The verifier reports found/missing commands and source checkouts. It does not claim that a tool is configured, activated, operational, or connected to an external provider.

## Source inventory

The 16 source repositories are pinned as Git submodules under `upstream/` and defined in `.gitmodules`; their source identities and installer metadata are listed in `tools/bootstrap/upstream-sources.json`. Codespaces initializes the exact pinned commits with `git submodule update --init --recursive`. Burp Suite Community Edition is represented as the official package/install source in the Windows bootstrap; this Codespaces installer does not claim to install its desktop GUI into a headless container. x64dbg source is checked out, but the Windows GUI binary is not runnable in a Linux Codespace. Ghidra/JADX/GDB/ZAP sources are present; runtime-specific dependencies and GUI support are not asserted by source checkout alone.

Third-party code is downloaded from its declared upstream URL and is not executed by the installer beyond package-manager setup commands. Review each upstream project's license, security posture, and setup instructions before activating plugins or running tool code.

God's Eyes and Arrow EA are not fetched until their exact official repositories are established. BlackEye phishing/credential-harvesting capability remains excluded. Defensive security and reverse-engineering tools must only be used against systems and software owned by the user or explicitly authorized for assessment.

No external service credentials are stored by this setup. Provider activation (Grok/xAI, OpenRouter, Ollama, Notion, n8n instance, etc.) remains separately configured using secret environment variables and integration adapters.
