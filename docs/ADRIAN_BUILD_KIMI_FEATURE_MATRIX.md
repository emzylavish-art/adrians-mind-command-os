# Adrian Build — Kimi Capability Matrix

**Status key:** NOT AUDITED = upstream/current integration not inspected; PLANNED = target requirement; IN PROGRESS = coding agent has begun; VERIFIED = tested end-to-end against pinned runtime; UNSUPPORTED = reason documented.

No feature is VERIFIED at blueprint creation.

| Capability | Required Adrian Build behaviour | Evidence required | Initial status |
|---|---|---|---|
| Main agent | Real Kimi session, prompt, streaming, stop | Runtime E2E transcript + test | NOT AUDITED |
| Session lifecycle | Create, resume, rename, search, export, delete | Persistence and reconnect tests | PLANNED |
| Workspace | Open approved local/remote project | Companion workspace test | PLANNED |
| File tools | List/read/write/edit files | Real filesystem E2E | PLANNED |
| Terminal | Execute commands, stream output, cancel | Windows process E2E | PLANNED |
| Editor | Tabs, syntax, save, diffs | Browser interaction tests | PLANNED |
| Git | Status, diff, branch, commit, history | Git E2E | NOT AUDITED |
| Subagents | coder/explore/plan or current equivalents | Delegate/return result E2E | NOT AUDITED |
| MCP | Discover/configure/auth/call/disable | Real MCP server E2E | NOT AUDITED |
| Plugins | Browse/install/enable/disable | Plugin lifecycle E2E | NOT AUDITED |
| Skills | Discover/install/invoke | Skill invocation E2E | NOT AUDITED |
| Hooks | Lifecycle hooks and policy gates | Hook trigger and deny tests | NOT AUDITED |
| Media | Attach supported image/video/file input | Per-format E2E | NOT AUDITED |
| Provider routing | Compatible providers and custom endpoint | Auth/stream/tool-call matrix | PLANNED |
| Adrian Speak | Voice to same active coding session | Real hardware E2E | PLANNED |
| Companion pairing | Pair, reconnect, revoke | Device/auth adversarial tests | PLANNED |
| Approvals | Exact action/target confirmation | Policy and audit tests | PLANNED |
| Persistence | Durable metadata and event replay | Restart/reconnect tests | PLANNED |
| Security | Owner isolation, path scope, secret redaction | Security regression suite | PLANNED |
| Mobile | Useful responsive project/session interface | Mobile browser tests | PLANNED |

## Evidence rules

- A UI control is not proof of a working capability.
- A registry/manifest entry is not proof of an adapter.
- An adapter mock is not proof of upstream runtime integration.
- A successful HTTP health check is not proof of project execution.
- A mocked test is not live provider, MCP, microphone or speaker acceptance.
- Record the Kimi version/commit, test environment, test command, result and evidence link for every VERIFIED feature.
- When a capability is only partially supported, split it into smaller rows rather than marking the entire category VERIFIED.
