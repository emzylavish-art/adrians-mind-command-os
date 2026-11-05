# Tooling Catalog and Integration Plan

This is a **candidate catalog and integration plan**, not a statement that every named project has been installed, connected, or verified. Resolve exact upstream repository/package and version before installation. Maintain license, security review, compatibility, and a smoke test for each entry.

## Agent engineering and workflow tools

| Candidate | Intended role | Integration requirement |
|---|---|---|
| Everything Claude Code | Reusable agent workflows, commands, skills, engineering patterns | Inspect upstream contents, license, dependencies, compatibility; adapt selected components instead of blind copying. |
| Superpowers | Structured software-development skills/workflows | Identify exact source/version; install selected reviewed skills; test examples. |
| GSD Core | Project planning/context and execution workflow | Resolve exact project identity; map it to task/state model. |
| UI UX Pro Max | UI design guidance and design-system support | Validate upstream package/source and license; integrate as optional skill/reference. |
| n8n-MCP | n8n workflow discovery/operation via MCP | Configure endpoint/credentials out of band; validate MCP handshake and allowed operations. |
| LightRAG | Retrieval-augmented knowledge layer | Define storage, embedding/model config, provenance, privacy, and retrieval tests. |
| Claude Mem | Persistent coding-agent context/memory | Resolve exact project/scope; assess retention/privacy; avoid secrets and full conversations by default. |
| Obsidian Skills | Knowledge-workflow skills | Identify exact skills/dependencies; integrate relevant items only. |
| Awesome Claude Code | Discovery index of tools and skills | Directory, not executable dependency; select and verify entries individually. |
| REA — Reverse Engineer Anything | Repository/system inventory and reverse-engineering workflow | Authorized targets only; record source/evidence and distinguish inference from fact. |

## Defensive security and reverse-engineering tools

| Candidate | Intended role | Boundary |
|---|---|---|
| Ghidra | Authorized binary analysis | Owned/authorized binaries; isolate samples and document scope. |
| JADX | Android APK analysis | Authorized app analysis; protect extracted secrets and user data. |
| Frida | Runtime instrumentation/testing | Owned or explicitly authorized apps/devices; no unauthorized bypass or extraction. |
| Burp Suite | Web application security testing | Authorized test environments; define scope and avoid real-user data. |
| OWASP ZAP | Web application security testing | Authorized targets; passive scan by default; active scans require explicit scope. |
| GDB | Debugging | Local/authorized targets. |
| x64dbg | Windows debugging | Local/authorized targets. |
| BlackEye | Exact upstream identity needs confirmation; name is associated with phishing-style tooling | Do not install or operationalize credential collection. Keep any inventory entry restricted and use safe awareness/testing alternatives. |

## Names requiring identification from source material

- **God's Eyes** — exact project, upstream URL, and intended function not verified.
- **Arrow EA** — exact project, upstream URL, and intended function not verified.

Do not guess. Capture source URL or recording timestamp when resolved.

## Required manifest for each approved integration

Canonical name; upstream URL; pinned version/commit; package/install method; license; supported OS/runtime; dependencies; environment variable names (never values); permission scopes; data handled; security review; adapter path; MCP/tool schema; health check; smoke test; known limitations; status (planned, partial, implemented, tested, live-verified, blocked); last verification date; rollback/uninstall procedure.

## Installation lifecycle

1. Discover exact upstream identity.
2. Review license, supply-chain risk, permissions, compatibility.
3. Pin version and record provenance.
4. Install in an isolated environment.
5. Configure secrets outside GitHub.
6. Run deterministic smoke and contract tests.
7. Verify real connection only when explicitly configured.
8. Enable in tool registry with least privilege.
9. Log updates and provide rollback.

## Voice and connection pins

Pinned on branch `fleet/tools/voice-and-connection-pins` from `main`. Status for every row below is **source pinned, not live-verified**. No secret is stored in this repository. Last verification date for the pin itself: 2026-11-05. Production was not deployed and `main` was not updated.

Lifecycle used: discover, review license, pin the commit, record the submodule, configure secrets only outside git, smoke-test presence, leave live connection for a later explicit run, register with least privilege, document rollback.

### Pipecat

- Canonical name: Pipecat
- Upstream URL: https://github.com/pipecat-ai/pipecat
- Pinned commit: `de8998789d5690073ddd1dafcec7268839af8153`
- Install: git submodule `upstream/pipecat`
- License: BSD-2-Clause
- Runtime: Python 3.11+
- Dependencies: declared in the upstream `pyproject.toml`. Not installed by this change.
- Environment variable names: none required to verify the pin. A bot reads `upstream/pipecat/env.example`. Speak path commonly uses `DAILY_API_KEY`, `DAILY_ROOM_URL`, plus one STT key, one LLM key, and one TTS key from that file.
- Permission scopes: local checkout. A live run needs microphone, speaker, and outbound network to the chosen providers.
- Data handled: voice audio and transcripts only if a human starts a local example. None are stored by this pin.
- Security review: source identity confirmed. No credential-harvesting code was added.
- Adapter path: `tools/voice/pipecat/README.md`
- MCP schema: none. Not an MCP server.
- Health check: `git -C upstream/pipecat rev-parse HEAD`
- Smoke test: `test -f upstream/pipecat/pyproject.toml`
- Limitations: pinning the framework does not start a voice session.
- Status: source pinned, not live-verified
- Rollback: `git submodule deinit -f upstream/pipecat && git rm -f upstream/pipecat`, then delete this entry and the registry row.

### whisper-loop

- Canonical name: whisper-loop
- Upstream URL: https://github.com/aryeo0908/whisper-loop
- Pinned commit: `810e1d5d410557038d1379cd709e3fb979422bde`
- Install: git submodule `upstream/whisper-loop`
- License: MIT
- Runtime: Python 3.11+, Node 18+ for the web client
- Dependencies: upstream server lockfile. Not installed by this change.
- Environment variable names: `LLM_PROVIDER`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, `OLLAMA_HOST`, `OLLAMA_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `STT_MODEL`, `STT_DEVICE`, `STT_COMPUTE_TYPE`, `HF_HOME`, `TTS_VOICE`, `TTS_MODELS_DIR`, `HOST`, `PORT`, `LOG_LEVEL`, `AGENT_NAME`, `WAKE_WORD_ENABLED`. AWS credentials use `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` when a profile is not used.
- Permission scopes: local audio devices and outbound network to the selected LLM.
- Data handled: microphone audio and model transcripts if the server is started. This change does not start it.
- Security review: README confirms barge-in cancels the LLM stream and current audio. Low star count is recorded; the behavior matches the requested loop.
- Adapter path: `tools/voice/whisper-loop/README.md`
- MCP schema: none.
- Health check: `git -C upstream/whisper-loop rev-parse HEAD`
- Smoke test: `test -f upstream/whisper-loop/server/pyproject.toml`
- Limitations: GPU is optional; CPU STT is slower. Not claimed to be under one second on every machine.
- Status: source pinned, not live-verified
- Rollback: `git submodule deinit -f upstream/whisper-loop && git rm -f upstream/whisper-loop`, then delete this entry and the registry row.

### voice-agent-starter

- Canonical name: voice-agent-starter
- Upstream URL: https://github.com/livekit-examples/agent-starter-python
- Pinned commit: `228095c442fcb259c80e9786fc0d7c5534e6af46`
- Install: git submodule `upstream/voice-agent-starter`
- License: MIT
- Runtime: Python, LiveKit Agents
- Dependencies: upstream `pyproject.toml`. Not installed by this change.
- Environment variable names: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- Permission scopes: LiveKit room connection when a human runs it.
- Data handled: voice session audio if the starter is started. This change does not start it.
- Security review: official LiveKit example. Chosen over `AssemblyAI/voice-agent-starter-python` because that repository has no detected license, and over `DINAKAR-S/voice-agent-starter-kit` because that kit publishes one combined latency range rather than per-stage fields.
- Adapter path: `tools/voice/voice-agent-starter/README.md`
- MCP schema: none in this pin.
- Health check: `git -C upstream/voice-agent-starter rev-parse HEAD`
- Smoke test: `test -f upstream/voice-agent-starter/pyproject.toml && test -f upstream/voice-agent-starter/.env.example`
- Limitations: the starter does not commit a numeric per-stage budget. The fields Latency Guard reads are end-to-end latency, LLM time to first token, and TTS time to first byte from LiveKit Agent Observability.
- Status: source pinned, not live-verified
- Rollback: `git submodule deinit -f upstream/voice-agent-starter && git rm -f upstream/voice-agent-starter`, then delete this entry and the registry row.

### api-health

- Canonical name: api-health
- Upstream URL: https://github.com/lxgicstudios/api-health
- Pinned commit: `4376ac6091ba93d9cce6f614a50861b99d689150`
- Install: git submodule `upstream/api-health`
- License: MIT
- Runtime: Node.js 22+ (`--experimental-strip-types`). Zero runtime npm dependencies.
- Dependencies: none beyond Node.
- Environment variable names: none.
- Permission scopes: outbound HTTPS to URLs the operator listed.
- Data handled: status code and latency. Request headers must not be written to git.
- Security review: CLI source matches the zero-dependency batch, SSL, and watch behavior. Lookalike npm names were not used.
- Adapter path: `tools/connection/api-health/README.md`
- MCP schema: none.
- Health check: `node --experimental-strip-types upstream/api-health/src/index.ts --help`
- Smoke test: same help command. It exits without a network call.
- Limitations: `dist/` is not in the pin. Run the TypeScript entry with Node's type stripper, or build with `tsc` locally.
- Status: source pinned, help command verified 2026-11-05
- Rollback: `git submodule deinit -f upstream/api-health && git rm -f upstream/api-health`, then delete this entry and the registry row.

### healthy-api

- Canonical name: healthy-api
- Upstream URL: https://github.com/mosishon/healthy-api
- Pinned commit: `23fbfbb444f41c7f9bcfdc4a3a6958487baddbe8`
- Install: git submodule `upstream/healthy-api`
- License: MIT
- Runtime: Go
- Dependencies: Go modules in the pin. Not downloaded by this change.
- Environment variable names: none. Secrets sit in an untracked YAML file (`password`, webhook URL, SMS token).
- Permission scopes: outbound HTTP plus optional SMTP or SMS if the operator configures a notifier.
- Data handled: health responses and alert text. Sample config contains fake recipients and must not be filled in inside git.
- Security review: concurrent checker with rule conditions. Alert delivery is off until a human writes a local config.
- Adapter path: `tools/connection/healthy-api/README.md`
- MCP schema: none.
- Health check: `test -f upstream/healthy-api/main.go && test -f upstream/healthy-api/go.mod`
- Smoke test: the health check above. `go run main.go -h` when Go is installed.
- Limitations: this environment did not have Go, so the binary was not executed.
- Status: source pinned, not live-verified
- Rollback: `git submodule deinit -f upstream/healthy-api && git rm -f upstream/healthy-api`, then delete this entry and the registry row.

### OmniProbe

- Canonical name: OmniProbe
- Upstream URL: https://github.com/ssrsgaga/API-Check
- Pinned commit: `292a011be478a3fdb348dd672c75d6bc0a6f114d`
- Install: git submodule `upstream/omniprobe`
- License: MIT
- Runtime: browser, Vite, React
- Dependencies: upstream `package.json`. Not installed by this change.
- Environment variable names: placeholder `GEMINI_API_KEY` in upstream `.env.local`. Do not copy it and do not replace it in git. Provider keys are entered in the browser.
- Permission scopes: the browser calls the endpoint the operator typed.
- Data handled: keys and chat stay in browser storage. They are not files in this parent repository.
- Security review: pure frontend. Function-call depth check is described in the upstream README. `GenIntel/OmniProbe` was rejected as the wrong project.
- Adapter path: `tools/connection/omniprobe/README.md`
- MCP schema: none.
- Health check: `test -f upstream/omniprobe/index.html && test -f upstream/omniprobe/package.json`
- Smoke test: the health check above.
- Limitations: a key that connects but cannot call tools still fails verification. This pin does not perform that check by itself.
- Status: source pinned, not live-verified
- Rollback: `git submodule deinit -f upstream/omniprobe && git rm -f upstream/omniprobe`, then delete this entry and the registry row.

### Coval benchmarks

- Canonical name: Coval benchmarks
- Upstream URL: https://github.com/coval-ai/benchmarks
- Pin path: `upstream/coval-benchmarks`
- Pinned commit: `7b4e5583fb720f503c467222c2ff447e48138a50`
- Install: git submodule
- License: Apache-2.0
- Runtime: the upstream runner. Not installed by this change.
- Dependencies: see the upstream README. Not installed here.
- Environment variable names: none to read the public leaderboard. A local rerun uses `*_API_KEY` names from `upstream/coval-benchmarks/.env.example`.
- Permission scopes: read https://benchmarks.coval.ai anonymously, or call a provider the operator named.
- Data handled: public benchmark tables. Local audio fixtures stay in the submodule.
- Security review: benchmark source and a public leaderboard. No key was added.
- Adapter path: `tools/voice/coval-benchmarks/README.md`
- MCP schema: none.
- Health check: `test -f upstream/coval-benchmarks/README.md && test -f upstream/coval-benchmarks/.env.example`
- Smoke test: the health check above.
- Free-tier entry: https://benchmarks.coval.ai
- Limitations: leaderboard numbers move. Quote the date you read.
- Status: source pinned, not live-verified
- Rollback: `git submodule deinit -f upstream/coval-benchmarks && git rm -f upstream/coval-benchmarks`, then delete this entry and the registry row.

## Considered and not added

- `AssemblyAI/voice-agent-starter-python` — closest name, no detected license.
- `DINAKAR-S/voice-agent-starter-kit` — one combined latency range, not per-stage fields, and it is a booking demo.
- `GenIntel/OmniProbe` — visual backbone probe, not an LLM function-call tester.
- `@asdsadw12312dwd2112xz/api-health-cli` and other npm lookalikes — not the zero-dependency CLI that was pinned.
- `ddalcu/llmprobe` — useful tool-call suite, but it is a CLI, and OmniProbe already covers the pure-frontend check. A second probe would be noise.
- BlackEye — still excluded. Phishing and credential collection stay blocked.
