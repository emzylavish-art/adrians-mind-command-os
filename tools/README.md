# Tool integrations

The registry in [registry.json](./registry.json) tracks requested tools in machine-readable form.

## Execution truth

This repository can contain manifests, adapters, setup scripts, and workflows. GitHub itself is not a runtime that installs binaries or starts external services. A tool is connected only after its runtime installation/configuration, health check, and verification evidence.

For each integration, record exact upstream source, pinned version, license, OS/runtime, install/uninstall instructions, adapter/MCP config, externally supplied secrets, health check, smoke test, and evidence-backed lifecycle status.

Do not guess sources for unresolved tool names. Security-analysis tools are for authorized defensive targets only. BlackEye is blocked from phishing or credential-collection operation.


## Voice and connection pins

Voice pins are documented in [voice/README.md](voice/README.md). Connection pins are documented in [connection/README.md](connection/README.md). Both are registered in `registry.json` and checked out under `upstream/`.
