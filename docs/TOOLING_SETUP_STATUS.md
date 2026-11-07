# Tooling Setup Status — GitHub

**Repository:** https://github.com/emzylavish-art/adrians-mind-command-os  
**Checked:** 2026-11-02  
**Parent commit before this setup pass:** `509b066bbab8c3c91fd8437a1ff6ea29a8b2ab08`

## What was executed

The previous stop was pinned submodule metadata only. This pass checked out every pinned upstream module, installed the declared Linux packages, and smoke-checked the commands that can run here.

- All 24 pinned `upstream/` submodules initialized at their recorded commits, including nested Frida and x64dbg submodules. Missing nested checkouts after recursive init: 0.
- Python: `frida-tools` 14.11.0 (`frida` 17.25.1) and `lightrag-hku` 1.5.7 import and the Frida CLI responds to `--version`.
- npm: `n8n-mcp` 2.96.1 (`n8n-mcp` on PATH) and `ui-ux-pro-max-cli` 2.15.0 (binary name is `uipro`, not `ui-ux-pro-max`). `uipro --help` runs.
- Release runtimes extracted under the gitignored `.tools/apps` directory: JADX 1.5.6 (`jadx --version`), OWASP ZAP 2.17.0 (`zap.sh -version` printed 2.17.0 on Java 17), Ghidra 12.2 public. Temurin JDK 25.0.5 is under `.tools/jdk`. With `JAVA_HOME` set and `/dev/fd` linked to `/proc/self/fd`, `analyzeHeadless` prints its usage text.
- Native team tests: `python3 -m unittest discover -s team -p 'test_*.py'` — 57 tests, OK. `python3 team/health.py` reported health ok. `python3 tools/bootstrap/validate_bootstrap.py` passed.

## Not installed, and why

| Item | Result |
| --- | --- |
| BlackEye | Not installed. Phishing and credential-harvesting setup stays excluded. No separate repository was created. |
| God's Eyes, Arrow EA, Blackbox, VoiceStudio, OpenSEO | Not installed. Exact source identity is still unconfirmed in the registry. |
| Zapia | Not configured. Needs an owner-authorized endpoint and credentials. |
| Burp Suite Community | Not installed here. The committed installer uses Windows `winget` (`PortSwigger.BurpSuite.Community`). This Linux workspace has no winget. |
| x64dbg binary | Source and nested deps are checked out. The Windows GUI binary is not runnable on Linux. |
| GDB binary | Source checkout `upstream/gdb` is present. No root package install is available in this workspace, and the binary was not built. |
| ComfyUI, Open Higgsfield, WeKnora, OpenWhispr, OpenProject, Cal.diy, Chatwoot, Cap | Source checkouts are present. They are not running services. Each still needs its own runtime, database, or provider credentials. |
| LightRAG server | Package is installed. A model or embedding provider and local config are still required before it is live. |
| UI UX Pro Max skill activation | CLI is installed. `uipro init` was not run, so no assistant skill files were written into the repo. |

Security and reverse-engineering tools are for owned or explicitly authorized targets only.

## Status vocabulary

- **Documented:** reference and intended use recorded.
- **Scaffolded:** integration contract/configuration structure exists.
- **Implemented:** code exists.
- **Tested:** relevant automated tests pass.
- **Live-verified:** real connection or operation succeeded with timestamped evidence.
- **Blocked:** missing source, permission, credential, runtime, or required approval.