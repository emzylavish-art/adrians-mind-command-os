# C1 — complete audit implementation checklist

**Audit chat:** Notion Access Audit / Adrian Analysis (archive chapter C1).

**Chapter ID:** `4231aa2763238138937ec5a478120d17`.

**Source archive:** <https://app.notion.com/p/4231aa2763238172a515d9ecebc9aa3d>.

**Chapter:** <https://app.notion.com/p/4231aa2763238138937ec5a478120d17>.

**Original chat:** <https://chatgpt.com/c/6b071f4e-17a4-83e8-8f7e-2c032925697c>.

**Base origin/main:** `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`.

**Implementation branch:** [audit/c1-notion-access-ef0782](https://github.com/emzylavish-art/adrians-mind-command-os/tree/audit/c1-notion-access-ef0782).

**Validated source revision:** Final committed-candidate verification pending; individual completed fixture results are recorded below.

## Coverage and evidence

All **24 C1 source records** were recovered and read: **22 substantive analysis passes and 114 unique original finding IDs**. M23/M24 are progress notes. Every original ID, title, source, expected behavior, changed files, implementation result and remaining boundary appears below. The complete machine-readable equivalent is [c1-checklist.json](c1-checklist.json).

The status vocabulary is the user-requested set: **fixed and tested**, **already fixed with proof**, **duplicate with a link to its fix**, **proposal needing a decision**, or **blocked with the exact missing step**. “Fixed and tested” refers to the stated code/fixture boundary. It never promotes a fixture to a real account, provider, deployment, invoice or physical-device result. An original proposal is implemented to its explicitly stated compatible scope; remaining broader architecture is identified below rather than presented as shipped.

Status totals: **112 fixed and tested**, **1 blocked with the exact missing step**, **1 already fixed with proof**.

Final branch verification is recorded in [c1-validation.json](c1-validation.json). Detailed workstream evidence: [connectors and Build](c1-connectors.md), [privacy/synchronization/knowledge](../audit-c1-privacy-knowledge.md), [runtime/research/resources](c1-runtime.md), [request contracts and recovery](c1-security-recovery.md), and [verification infrastructure](c1-verification.md). Local synthetic browser evidence lives in [evidence/c1-local](evidence/c1-local/README.md).

The initial complete 400-file run had390 passing files and10 failures. A later410-file run had409 passing files and one legacy assertion failure. These intermediate failures were repaired and retested; the final candidate result is recorded separately. Existing optional tests skipped because their gitignored OG skill is absent remain explicitly reported. No earlier release or production URL is used as evidence for this implementation.

## Integration, migration and remaining architecture

- High-conflict shared files: `command-app.tsx`, `types.ts`, `workspace.ts`, `server.ts`, `turn.server.ts`, `fleet.ts`, `provider-call.ts`, `model-consult.ts`, `mcp/tools.ts`, Build/Kimi handlers, connector persistence and auth middleware. Keep distinct owner, permission, revision, cost, receipt and cancellation tests when combining branches.
- Additive migrations0017–0021 introduce connector generation/status, resource and turn receipt authority, media operations, device coordination, and research/instruction persistence. The isolated upgrade fixture checks real pre-C1 records, all five migrations and replay preservation. Apply in order with one migrator, keep the encryption secret stable, and retain additive tables/columns during code rollback. Production migration and role/RLS configuration are separate release checks.
- The paired-device legacy importer defaults to dry-run. Back up and pause old writers, review source fingerprint/counts, and authorize the explicit import into an empty destination later. No native companion or installer is changed by this website branch.
- AA013/065 now use bounded record/message deltas and confirmed checkpoints. Fully independent paginated DB/browser reads remain a **proposal needing a decision** about the staged storage migration; compatibility snapshots still exist.
- AA042 now has paginated file/content discovery, revision-aware writes and parser-backed current-buffer symbol/dependency navigation. A persistent whole-repository semantic index/dependency graph remains a **proposal needing a decision** about runtime/index ownership. Current-buffer navigation never claims whole-repository analysis.
- AA078 retains checksums, extraction revisions, page offsets where the actual PDF page tree resolves, truncation/gaps and verification history. OCR for scanned/unsupported content is not implemented; gaps are explicit. Further OCR is a **proposal needing a decision** about an authorized engine and its data/cost policy.
- AA083/089 expose temporary/missing/included assets and verify original/document integrity. Download links are not represented as confirmed downloads. Cloud binary archives and automatic cross-device asset transfer remain a **proposal needing a decision** about authorized storage and retention.
- AA090 exposes only implemented xAI media options and validates them before dispatch. Additional media adapters, arbitrary resolution/aspect-ratio controls and a separate project asset search workspace remain a **proposal needing a decision** about supported provider/storage contracts.
- AA070/074 incident journals are browser-local and account-scoped; durable operation receipts/history are server-backed. Cross-device incident synchronization and a global background task manager under AA113 are further architecture proposals, not claimed capabilities.
- No real provider, external write, OAuth renewal, production account, deployment, physical iPhone/Windows/Android or installer was tested. The environment matrix and release-evidence validator preserve these as **unverified**. Integration Codex must collect genuine target-environment proof before any release claim.

## Per-finding record

### C1-AA-001

**Original title:** A known Notion write limitation does not become a shared, recoverable connection state

**Source:** [C1/M01](https://app.notion.com/p/4231aa276323816a9133d798b075b29e?pvs=204) · original ID `C1/AA-001`.

**Status:** **fixed and tested**.

- **Expected behavior:** A denied Notion append preserves usable reads while every surface identifies the affected workspace/action and safe recovery.
- **What actually changed:** Persisted typed owner/workspace/page/action status; generation-bound confirmations; permission repair and safe OAuth return destination. Shared Dashboard and Plugins projection.
- **Affected files:** `src/lib/mind/notion.ts`; `src/lib/mind/notion-operation-status.ts`; `src/lib/mind/connectors/notion-operation-status.server.ts`; `src/components/mind/notion-workspaces.tsx`; `src/lib/mind/dashboard/owner-connections.ts`.
- **Tests/evidence:** Connector lane: c1-notion-recovery.test.ts 3/3, including actual adapter fake transport, durable owner/workspace separation and callback script.
- **Still needed / boundary:** Apply migration 0017 before rollout; real OAuth renewal and real Notion write/readback remain an authorized integration check.

### C1-AA-002

**Original title:** A late identity lookup can mislabel a replacement grant and affect credential retention

**Source:** [C1/M02](https://app.notion.com/p/4231aa27632381babfcfe2dcf88bea6d?pvs=204) · original ID `C1/AA-002`.

**Status:** **fixed and tested**.

- **Expected behavior:** Delayed Google identity lookup must not relabel a replacement grant or retain a different account refresh token.
- **What actually changed:** Grant-generation and ciphertext CAS; verified OpenID subject continuity; bounded identity lookup; email alone cannot authorize refresh-token reuse.
- **Affected files:** `src/lib/mind/connectors/durable-oauth.server.ts`; `src/lib/mind/connectors/google-account.server.ts`; `src/lib/mind/connectors/store.ts`; `migrations/0017_c1_oauth_contract.sql`.
- **Tests/evidence:** Connector lane: c1-identity-contract.test.ts 3/3 covers replacement, equal-email/different-sub and timeout cases.
- **Still needed / boundary:** Real Google accounts were not connected or switched.

### C1-AA-003

**Original title:** Dictation adds a second audio recipient without a stage-specific choice

**Source:** [C1/M03](https://app.notion.com/p/4231aa2763238117a082ecbbc9e784ff?pvs=204) · original ID `C1/AA-003`.

**Status:** **fixed and tested**.

- **Expected behavior:** Only a selected transcription provider and explicitly allowed alternate may receive audio; silence and failures remain distinct.
- **What actually changed:** Account-scoped transcription policy, fallback allowlist/categories, attempted-provider receipts, empty-transcript result and visible attribution. Free-only and origin/auth checks retained.
- **Affected files:** `src/lib/mind/voice/transcription-policy.ts`; `src/lib/mind/voice/provider-fallback.ts`; `src/lib/mind/voice/http.server.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** voice/transcription-policy.test.ts 4/4 and provider-fallback.test.ts 4/4 passed; actual HTTP helpers use fake providers and preserve attempted-provider/error envelopes.
- **Still needed / boundary:** Real microphone and provider calls were not performed. Only explicit stage-specific recipients can receive audio.

### C1-AA-004

**Original title:** A temporary local-engine failure overwrites the saved voice route

**Source:** [C1/M03](https://app.notion.com/p/4231aa2763238117a082ecbbc9e784ff?pvs=204) · original ID `C1/AA-004`.

**Status:** **fixed and tested**.

- **Expected behavior:** A temporary local voice-engine outage must keep the selected route and block or offer an explicit choice.
- **What actually changed:** selectedVoiceRoute denies unavailable Orchestrator without changing persisted mode; the client no longer persists Direct merely because its probe failed.
- **Affected files:** `src/lib/mind/voice/selected-route.ts`; `src/lib/mind/voice/selected-route.test.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** voice/selected-route.test.ts passed; saved Orchestrator selection survives an unavailable local-engine probe.
- **Still needed / boundary:** Physical local-engine recovery and microphone tests remain a later authorized check.

### C1-AA-005

**Original title:** Approval does not bind the complete connection snapshot

**Source:** [C1/M04](https://app.notion.com/p/4231aa27632381a483d1ddf5621afb07?pvs=204) · original ID `C1/AA-005`.

**Status:** **fixed and tested**.

- **Expected behavior:** Approval binds exact account, connection, credential revision, tool definition, arguments and destination through dispatch.
- **What actually changed:** Canonical connection/definition fingerprint with owner-bound, expiring, one-use approval. Revalidate before transport and immediately before consequential call.
- **Affected files:** `src/lib/mind/mcp/approval-snapshot.ts`; `src/lib/mind/connected-mcp.server.ts`; `src/lib/mind/custom-connection.ts`; `src/components/mind/custom-connections.tsx`.
- **Tests/evidence:** Connector lane: connected-mcp.test.ts 16/16, including endpoint, credentials, schema, description and mid-approval changes.
- **Still needed / boundary:** Existing approvals are intentionally invalidated by connection or definition changes; retain these tests across overlapping branches.

### C1-AA-006

**Original title:** Remote tool definitions are not reverified during execution

**Source:** [C1/M04](https://app.notion.com/p/4231aa27632381a483d1ddf5621afb07?pvs=204) · original ID `C1/AA-006`.

**Status:** **fixed and tested**.

- **Expected behavior:** The live initialized MCP session must advertise the reviewed tool definition before tools/call.
- **What actually changed:** Bounded paginated rediscovery, full-definition comparison, duplicate/removed-tool rejection and explicit legacy-cache refresh requirement.
- **Affected files:** `src/lib/mind/custom-connection.ts`; `src/lib/mind/connected-mcp.test.ts`; `src/lib/mind/custom-connection.test.ts`.
- **Tests/evidence:** Connector fixtures show changed definition makes zero tools/call requests; identical definition permits one call.
- **Still needed / boundary:** Real external MCP services were not probed or invoked.

### C1-AA-007

**Original title:** Memory policy is not independently verified at model dispatch

**Source:** [C1/M05](https://app.notion.com/p/4231aa27632381a1983ad70b98d0eb77?pvs=204) · original ID `C1/AA-007`.

**Status:** **fixed and tested**.

- **Expected behavior:** Every new dispatch validates current authenticated-owner privacy policy and exact permitted saved content.
- **What actually changed:** Authoritative snapshot reread, policy revision, exact note body/scope/deletion checks, current bot revocation and project-passage validation. Planner uses real server rows and rechecks each step.
- **Affected files:** `src/lib/mind/memory/dispatch-policy.ts`; `src/lib/mind/memory/dispatch-policy.server.ts`; `src/lib/mind/turn.server.ts`; `src/lib/mind/agent-run.server.ts`; `src/lib/mind/use-mind-workspace.ts`.
- **Tests/evidence:** Privacy lane 48/48 includes current-owner reread, note deletion/edit/archive/scope, legacy payloads and planner identity/revocation fixtures.
- **Still needed / boundary:** Authenticated multi-tab permission changes remain a release journey; fixtures do not prove a live provider call.

### C1-AA-008

**Original title:** Previously prepared requests require memory-revocation checks

**Source:** [C1/M05](https://app.notion.com/p/4231aa27632381a1983ad70b98d0eb77?pvs=204) · original ID `C1/AA-008`.

**Status:** **fixed and tested**.

- **Expected behavior:** Old requests must not newly dispatch revoked context; already completed results should recover under their original operation ID.
- **What actually changed:** Server receipt recovery precedes new-dispatch privacy validation. Existing-client retry no longer blocks completed receipt lookup. No new ID or automatic re-billing after uncertain delivery.
- **Affected files:** `src/lib/mind/turn.server.ts`; `src/lib/mind/turn-recovery.ts`; `src/lib/mind/memory/dispatch-policy.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Policy old-body rejection plus runtime PGlite exact-response recovery/temporary-retention tests.
- **Still needed / boundary:** Keep receipt lookup ordering when reconciling other branches; live/provider proof remains unperformed.

### C1-AA-009

**Original title:** Memory Off is not the same as a fresh-context conversation

**Source:** [C1/M05](https://app.notion.com/p/4231aa27632381a1983ad70b98d0eb77?pvs=204) · original ID `C1/AA-009`.

**Status:** **fixed and tested**.

- **Expected behavior:** Saved memory, history, copied bot knowledge, document access and new memory saves are independently controlled and disclosed.
- **What actually changed:** Independent context policy and fresh-context preset. Ordinary memory-off retains history; fresh context explicitly suppresses it and copied bot knowledge.
- **Affected files:** `src/lib/mind/memory/context-policy.ts`; `src/lib/mind/types.ts`; `src/lib/mind/workspace.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** memory/dispatch-policy.test.ts fresh-context and memory-off/project-permission cases in the 48/48 privacy lane.
- **Still needed / boundary:** Project-conversation/research policy fields do not by themselves implement additional retrieval engines.

### C1-AA-010

**Original title:** Browser persistence merges changes without updating the active workspace

**Source:** [C1/M06](https://app.notion.com/p/4231aa276323814ba23ef6527ad64388?pvs=204) · original ID `C1/AA-010`.

**Status:** **fixed and tested**.

- **Expected behavior:** Active UI, local checkpoint and server synchronization should reconcile the same full workspace.
- **What actually changed:** Full storage-event and post-save reconciliation; async hydration uses account/generation checks and rebases edits made during hydration.
- **Affected files:** `src/lib/mind/use-mind-workspace.ts`; `src/lib/mind/workspace-edits.ts`; `src/lib/mind/workspace-reconciliation.test.ts`.
- **Tests/evidence:** Independent records/fields and deletion tests use the same reconciliation functions as the hook; privacy lane 48/48.
- **Still needed / boundary:** Real two-tab visibility and account switch during hydration are listed in the privacy lane release checks.

### C1-AA-011

**Original title:** Independent edits to the same non-chat record can overwrite each other

**Source:** [C1/M06](https://app.notion.com/p/4231aa276323814ba23ef6527ad64388?pvs=204) · original ID `C1/AA-011`.

**Status:** **fixed and tested**.

- **Expected behavior:** Independent non-chat edits merge; actual conflicts preserve both variants; sensitive configurations remain coherent.
- **What actually changed:** Field-aware project/file merge; atomic sensitive-agent conflicts; deletion-preserving reconciliation; explicit resolution persists instead of reappearing.
- **Affected files:** `src/lib/mind/workspace-edits.ts`; `src/lib/mind/sync.ts`; `src/lib/mind/types.ts`.
- **Tests/evidence:** workspace-reconciliation.test.ts independent/same-field/deletion/agent/conflict-resolution regression cases.
- **Still needed / boundary:** Merge policy for new security-sensitive collections must be defined before adding them.

### C1-AA-012

**Original title:** Server revision protection does not provide automatic conflict resolution

**Source:** [C1/M06](https://app.notion.com/p/4231aa276323814ba23ef6527ad64388?pvs=204) · original ID `C1/AA-012`.

**Status:** **fixed and tested**.

- **Expected behavior:** Use a common revision to merge independent device/server changes and expose real conflicts for review.
- **What actually changed:** Owner-scoped server checkpoint, three-way reconcile after startup/CAS conflict, per-record review for missing ancestry, including tool settings.
- **Affected files:** `src/lib/mind/sync.ts`; `src/lib/mind/use-mind-workspace.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Common-base and missing-ancestor tests; store stale-revision fixture; scalar settings conflict remains resolvable.
- **Still needed / boundary:** The multi-device browser journey is not represented as executed.

### C1-AA-013

**Original title:** Full workspace persistence has a fixed capacity ceiling

**Source:** [C1/M06](https://app.notion.com/p/4231aa276323814ba23ef6527ad64388?pvs=204) · original ID `C1/AA-013`.

**Status:** **fixed and tested**.

- **Expected behavior:** Workspace growth should not make every small edit exceed a single full-snapshot request limit.
- **What actually changed:** Changed-record and message deltas; UTF-8 byte accounting; bounded batch upload and resume from confirmed prefix; changed-only mirror replacement. Compatibility snapshots retained.
- **Affected files:** `src/lib/mind/workspace-delta.ts`; `src/lib/mind/store.ts`; `src/lib/mind/server.ts`; `src/lib/mind/use-mind-workspace.ts`.
- **Tests/evidence:** Large initial workspace + long-chat batch/resume, sub-1KB message delta, >1.5MB workspace update and actual PGlite reopen in privacy lane 48/48.
- **Still needed / boundary:** Further independently versioned/paginated DB/browser reads remain a staged migration proposal; an exceptionally large individual record still fails explicitly.

### C1-AA-014

**Original title:** Built-in provider usage information is discarded

**Source:** [C1/M07](https://app.notion.com/p/4231aa2763238171b61ded08986e6b29?pvs=204) · original ID `C1/AA-014`.

**Status:** **fixed and tested**.

- **Expected behavior:** Provider receipts preserve reported usage/model/request identity and never invent missing counters.
- **What actually changed:** Normalize built-in response receipts; carry requested and reported identities, usage, finish metadata through turn responses and UI storage.
- **Affected files:** `src/lib/mind/provider-call.ts`; `src/lib/mind/stream.ts`; `src/lib/mind/turn.server.ts`; `src/lib/mind/live-turn.ts`.
- **Tests/evidence:** Runtime lane: c1-runtime-regressions.test.ts AA014 plus provider tests in reported 84/84 batch.
- **Still needed / boundary:** Provider-reported model metadata is attribution, not independent proof of backend internals.

### C1-AA-015

**Original title:** Orchestrator automatically selects additional connected models

**Source:** [C1/M07](https://app.notion.com/p/4231aa2763238171b61ded08986e6b29?pvs=204) · original ID `C1/AA-015`.

**Status:** **fixed and tested**.

- **Expected behavior:** Being connected does not authorize a helper model or additional spend.
- **What actually changed:** Explicit bounded helper list, account-scoped chooser, participant validation and no automatic connected-model selection.
- **Affected files:** `src/lib/mind/model-consult.ts`; `src/lib/mind/turn.server.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Runtime AA015 fixture proves available providers are not implicit helpers; governed-call budget tests.
- **Still needed / boundary:** Live multi-model billing remains untested; helper configuration must survive semantic branch merge.

### C1-AA-016

**Original title:** Helper execution receipts lose important metadata

**Source:** [C1/M07](https://app.notion.com/p/4231aa2763238171b61ded08986e6b29?pvs=204) · original ID `C1/AA-016`.

**Status:** **fixed and tested**.

- **Expected behavior:** Every attempted helper keeps provider/model/request/usage/duration/outcome metadata, including failures.
- **What actually changed:** Structured helper receipts retained through SSE, message normalization and visible consulted-model details.
- **Affected files:** `src/lib/mind/model-consult.ts`; `src/lib/mind/turn.server.ts`; `src/lib/mind/types.ts`; `src/lib/mind/workspace.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Runtime AA016/017 fixture; privacy lane message receipt round-trip test.
- **Still needed / boundary:** Unknown usage remains unknown; no fixture claim of actual provider execution.

### C1-AA-017

**Original title:** Sequential helper execution creates avoidable latency

**Source:** [C1/M07](https://app.notion.com/p/4231aa2763238171b61ded08986e6b29?pvs=204) · original ID `C1/AA-017`.

**Status:** **fixed and tested**.

- **Expected behavior:** Independent helpers can run with bounded concurrency while cancellation prevents new dispatch.
- **What actually changed:** Bounded helper executor with per-attempt receipts, shared cancellation and resource authorization.
- **Affected files:** `src/lib/mind/model-consult.ts`; `src/lib/mind/execution-plan.ts`; `src/lib/mind/turn.server.ts`.
- **Tests/evidence:** Runtime AA016/017 concurrent/failure/cancel regression in the 84/84 batch.
- **Still needed / boundary:** Production latency improvement is not claimed from fixture timings.

### C1-AA-018

**Original title:** The identity instruction discourages model transparency

**Source:** [C1/M07](https://app.notion.com/p/4231aa2763238171b61ded08986e6b29?pvs=204) · original ID `C1/AA-018`.

**Status:** **fixed and tested**.

- **Expected behavior:** Adrian may keep its product identity while truthfully attributing models and tool execution.
- **What actually changed:** Identity instruction allows actual provider/model disclosure and forbids invented helper/tool participation; receipts remain available.
- **Affected files:** `src/lib/mind/model-consult.ts`; `src/lib/mind/model-consult.test.ts`; `src/lib/mind/prompt.ts`.
- **Tests/evidence:** Runtime model-consult regression assertions in the 84/84 batch.
- **Still needed / boundary:** A system instruction does not prove a real model obeyed it; live answer proof remains separate.

### C1-AA-019

**Original title:** Agent definitions can change during an active run

**Source:** [C1/M08](https://app.notion.com/p/4231aa27632381d6a2e8d69d24e7feac?pvs=204) · original ID `C1/AA-019`.

**Status:** **fixed and tested**.

- **Expected behavior:** An active run uses a pinned definition/plan but current revocation must still stop new steps.
- **What actually changed:** Immutable run definition and tool order; permission/agent changes checked before further execution.
- **Affected files:** `src/lib/mind/fleet.ts`; `src/lib/mind/worker-pass.ts`; `src/lib/mind/c1-runtime-regressions.test.ts`.
- **Tests/evidence:** Runtime AA019 fixture covers changed definition and revoked permissions.
- **Still needed / boundary:** Remote/native agent behavior is not inferred from local worker fixtures.

### C1-AA-020

**Original title:** Completing the tool list is not equivalent to completing the user's objective

**Source:** [C1/M08](https://app.notion.com/p/4231aa27632381d6a2e8d69d24e7feac?pvs=204) · original ID `C1/AA-020`.

**Status:** **fixed and tested**.

- **Expected behavior:** Completing listed steps must not imply the user objective was verified.
- **What actually changed:** Separate execution completion, budget exhaustion and objective-unverified state with evidence list.
- **Affected files:** `src/lib/mind/fleet.ts`; `src/lib/mind/core-runtime.ts`; `src/lib/mind/c1-runtime-regressions.test.ts`.
- **Tests/evidence:** Runtime AA020/021 completion/budget fixture.
- **Still needed / boundary:** Objective verification needs task-specific evidence; no universal success evaluator is claimed.

### C1-AA-021

**Original title:** Browser-based and background agent execution have different capabilities

**Source:** [C1/M08](https://app.notion.com/p/4231aa27632381d6a2e8d69d24e7feac?pvs=204) · original ID `C1/AA-021`.

**Status:** **fixed and tested**.

- **Expected behavior:** Browser-local, scheduled-local and server-local runs must identify their actual runtime/capabilities.
- **What actually changed:** Persist executionRuntime and retain explicit unsupported external-operation states.
- **Affected files:** `src/lib/mind/fleet.ts`; `src/lib/mind/worker-pass.ts`; `src/lib/mind/core-runtime.ts`.
- **Tests/evidence:** Runtime AA020/021 fixture distinguishes execution and objective status.
- **Still needed / boundary:** A local step does not prove a hosted model/browser/mailbox ran.

### C1-AA-022

**Original title:** Scheduled execution can outgrow its own reporting model

**Source:** [C1/M08](https://app.notion.com/p/4231aa27632381d6a2e8d69d24e7feac?pvs=204) · original ID `C1/AA-022`.

**Status:** **fixed and tested**.

- **Expected behavior:** Scheduled work retains each occurrence and an explicit overlap policy.
- **What actually changed:** Per-occurrence run IDs/status; queue/skip/parallel limits; consistent schedule reporting and recent outcomes.
- **Affected files:** `src/lib/mind/fleet.ts`; `src/lib/mind/worker-pass.ts`; `src/lib/mind/c1-runtime-regressions.test.ts`.
- **Tests/evidence:** Runtime AA022 fixture preserves occurrence history and queues overlapping execution.
- **Still needed / boundary:** Actual hosted timer availability is a deployment/runtime check.

### C1-AA-023

**Original title:** Local run cancellation is not a complete distributed cancellation protocol

**Source:** [C1/M08](https://app.notion.com/p/4231aa27632381d6a2e8d69d24e7feac?pvs=204) · original ID `C1/AA-023`.

**Status:** **fixed and tested**.

- **Expected behavior:** Cancellation distinguishes request/acknowledgement and preserves already produced results.
- **What actually changed:** Local cancellation state/receipt, retained results and current agent checks; paired-device late outcome protocol handled separately.
- **Affected files:** `src/lib/mind/fleet.ts`; `src/lib/mind/pc-pairing/store.ts`; `src/lib/mind/c1-runtime-regressions.test.ts`.
- **Tests/evidence:** Runtime AA023 local acknowledgement/result preservation plus durable device fixture.
- **Still needed / boundary:** No claim that an accepted external request can be forcibly undone.

### C1-AA-024

**Original title:** Deep Research currently performs source discovery rather than full evidence analysis

**Source:** [C1/M09](https://app.notion.com/p/4231aa2763238142af7ed04c954f6825?pvs=204) · original ID `C1/AA-024`.

**Status:** **fixed and tested**.

- **Expected behavior:** Research distinguishes discovered links, observed passages, provider synthesis, conflicts and uncertainty.
- **What actually changed:** Bounded public-source inspection with redirect/SSRF protections, excerpts/hashes/times and structured evidence reports; quick search does not claim to inspect pages.
- **Affected files:** `src/lib/mind/research-evidence.server.ts`; `src/lib/mind/research-service.server.ts`; `src/lib/mind/research.ts`; `src/components/mind/research-library.tsx`.
- **Tests/evidence:** Runtime Research/Skills 32/32 includes fake public pages, private redirect rejection and truthful source-excerpt/provider-synthesis tests.
- **Still needed / boundary:** Automated exhaustive fact checking, semantic contradiction resolution and live page research are not claimed.

### C1-AA-025

**Original title:** Later research queries can lose their unique evidence

**Source:** [C1/M09](https://app.notion.com/p/4231aa2763238142af7ed04c954f6825?pvs=204) · original ID `C1/AA-025`.

**Status:** **fixed and tested**.

- **Expected behavior:** Later research queries retain unique supporting evidence even when the first query fills the limit.
- **What actually changed:** Fair per-query evidence allocation and deduplication preserve risk/comparison passages.
- **Affected files:** `src/lib/mind/research.ts`; `src/lib/mind/c1-research-skills.test.ts`.
- **Tests/evidence:** AA025 fixture fills three eight-result groups and verifies later query evidence survives.
- **Still needed / boundary:** No private or live source was searched by the fixture.

### C1-AA-026

**Original title:** Research routes provide inconsistent evidence and report formats

**Source:** [C1/M09](https://app.notion.com/p/4231aa2763238142af7ed04c954f6825?pvs=204) · original ID `C1/AA-026`.

**Status:** **fixed and tested**.

- **Expected behavior:** Research routes expose consistent evidence/report fields while preserving route-specific answers and provenance.
- **What actually changed:** Shared report schema, provider answer/model/request/usage fields, route and configuration revision, truthful evidence status.
- **Affected files:** `src/lib/mind/research.ts`; `src/lib/mind/xai-search.ts`; `src/lib/mind/research-service.server.ts`; `src/lib/mind/research-evidence.server.ts`.
- **Tests/evidence:** AA024/026 configured and fake xAI route fixtures in Research/Skills 32/32.
- **Still needed / boundary:** Provider-supplied synthesis is labeled separately from directly inspected passages.

### C1-AA-027

**Original title:** Research retries are not bound to the original provider configuration

**Source:** [C1/M09](https://app.notion.com/p/4231aa2763238142af7ed04c954f6825?pvs=204) · original ID `C1/AA-027`.

**Status:** **fixed and tested**.

- **Expected behavior:** Research retry must retain the originally selected provider configuration or require a new review.
- **What actually changed:** Opaque configuration fingerprint binds provider/endpoint/credential generation; changed or missing retry identity fails closed; successful prior evidence remains.
- **Affected files:** `src/lib/mind/research-service.server.ts`; `src/lib/mind/research-followup.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** AA027 configuration-change rejection fixture plus AA028 merge regression.
- **Still needed / boundary:** Runtime fixture identity does not establish a current live provider configuration.

### C1-AA-028

**Original title:** Research follow-up transfers links rather than supporting evidence

**Source:** [C1/M09](https://app.notion.com/p/4231aa2763238142af7ed04c954f6825?pvs=204) · original ID `C1/AA-028`.

**Status:** **fixed and tested**.

- **Expected behavior:** Research follow-up transfers supporting passages, route and uncertainty, not only URLs.
- **What actually changed:** Bounded untrusted evidence bundle and retry evidence merge retaining prior successful passages.
- **Affected files:** `src/lib/mind/research-followup.ts`; `src/components/mind/command-app.tsx`; `src/components/mind/research-library.tsx`.
- **Tests/evidence:** AA028 fixture retains excerpt/status and marks external text untrusted.
- **Still needed / boundary:** A follow-up model response is not proven by preparing its evidence bundle.

### C1-AA-029

**Original title:** Research history has a small, browser-local retention model

**Source:** [C1/M09](https://app.notion.com/p/4231aa2763238142af7ed04c954f6825?pvs=204) · original ID `C1/AA-029`.

**Status:** **fixed and tested**.

- **Expected behavior:** Research reports survive reload and larger histories with explicit owner-scoped retention and archive.
- **What actually changed:** Durable account research library, revision CAS, pagination and explicit archival; browser history is a compatibility surface.
- **Affected files:** `src/lib/mind/research-library.server.ts`; `src/lib/mind/research-http.server.ts`; `src/routes/api/mind/research-reports.ts`; `migrations/0021_c1_research_skills.sql`.
- **Tests/evidence:** Runtime PGlite AA029 fixture stores more than eight reports, isolates owners and checks revisions/pagination/archive.
- **Still needed / boundary:** Apply additive migration before deployment; current production reports were not migrated here.

### C1-AA-030

**Original title:** Skills, tools and integration availability are conflated

**Source:** [C1/M10](https://app.notion.com/p/4231aa276323814dbf40cef97b4305d3?pvs=204) · original ID `C1/AA-030`.

**Status:** **fixed and tested**.

- **Expected behavior:** Instruction procedures, local tools and connector readiness must have distinct labels and authority.
- **What actually changed:** Explicit skill categories and dependencies; UI points readiness to operational surfaces; installed procedure does not grant capabilities.
- **Affected files:** `src/lib/mind/skills.ts`; `src/components/mind/instruction-library.tsx`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** AA030/031 category/tool-guard tests in Research/Skills 32/32.
- **Still needed / boundary:** New standalone procedures are not represented as installed merely because a connector exists.

### C1-AA-031

**Original title:** Turning off a skill does not necessarily disable its underlying tool

**Source:** [C1/M10](https://app.notion.com/p/4231aa276323814dbf40cef97b4305d3?pvs=204) · original ID `C1/AA-031`.

**Status:** **fixed and tested**.

- **Expected behavior:** Explicit tool permission must apply through every local dispatch route, independently of automatic skill selection.
- **What actually changed:** Known persisted toolPermissions enforced centrally in runLocalPlan and synchronized through workspace normalization.
- **Affected files:** `src/lib/mind/local-tools.ts`; `src/lib/mind/types.ts`; `src/lib/mind/workspace.ts`; `src/lib/mind/skills.ts`.
- **Tests/evidence:** AA030/031 direct-tool and named-skill rejection fixtures; permission state reconciliation tests.
- **Still needed / boundary:** An unknown new tool needs an explicit policy before being added.

### C1-AA-032

**Original title:** Skill preferences are not account-scoped in browser storage

**Source:** [C1/M10](https://app.notion.com/p/4231aa276323814dbf40cef97b4305d3?pvs=204) · original ID `C1/AA-032`.

**Status:** **fixed and tested**.

- **Expected behavior:** Skill preferences belong to one account and stale tabs must not silently replace them.
- **What actually changed:** Owner/version-scoped manual and automatic settings, CAS-like revision check, fail-closed malformed state and cross-tab refresh.
- **Affected files:** `src/lib/mind/skill-preferences.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** AA032 fixture checks owner separation, stale write rejection and corrupted preference pause.
- **Still needed / boundary:** These browser preferences are not described as server account backup.

### C1-AA-033

**Original title:** Server instruction sets have limited management visibility

**Source:** [C1/M10](https://app.notion.com/p/4231aa276323814dbf40cef97b4305d3?pvs=204) · original ID `C1/AA-033`.

**Status:** **fixed and tested**.

- **Expected behavior:** Instruction sets expose exact source/body/revision/assignments and distinguish attachment from execution proof.
- **What actually changed:** Owner-scoped reviewed instruction management and assignment CAS; current revision/dependency checks; dispatch audit records exact attached revision.
- **Affected files:** `src/lib/mind/skill-instructions.server.ts`; `src/routes/api/mind/skills.ts`; `src/components/mind/instruction-library.tsx`; `migrations/0021_c1_research_skills.sql`.
- **Tests/evidence:** AA033 instruction-change/removal/dependency fixture plus PGlite review/dispatch history CAS.
- **Still needed / boundary:** Instructions attached to a model request are not proof the model followed the procedure.

### C1-AA-034

**Original title:** Builder skill application and displayed instructions are not identical

**Source:** [C1/M10](https://app.notion.com/p/4231aa276323814dbf40cef97b4305d3?pvs=204) · original ID `C1/AA-034`.

**Status:** **fixed and tested**.

- **Expected behavior:** Hosted Build receives the same complete reviewed builder instructions displayed in Skills.
- **What actually changed:** Shared full versioned body sent through both ACP paths with exact body hash/version/length dispatch receipt; stale paths and claims removed.
- **Affected files:** `src/lib/mind/adrian-os-skill.ts`; `src/lib/mind/kimi/hosted/builder-instructions.ts`; `src/lib/mind/kimi/hosted/acp-client.ts`; `src/components/mind/build-workspace.tsx`.
- **Tests/evidence:** Connector lane: fake ACP child captures full body for both transports; handshake failure produces no attachment receipt.
- **Still needed / boundary:** No real coding model or hosted account was invoked.

### C1-AA-035

**Original title:** Automatic skill selection is limited to narrow keyword rules

**Source:** [C1/M10](https://app.notion.com/p/4231aa276323814dbf40cef97b4305d3?pvs=204) · original ID `C1/AA-035`.

**Status:** **fixed and tested**.

- **Expected behavior:** Skill recommendations are bounded, explain why they match, disclose missing dependencies and grant no permission.
- **What actually changed:** Transparent multi-step registered-category planner with omissions, disabled settings, runtime/connector dependencies and conflict hints; explicit review preview.
- **Affected files:** `src/lib/mind/skill-plan.ts`; `src/components/mind/instruction-library.tsx`; `src/lib/mind/c1-research-skills.test.ts`.
- **Tests/evidence:** AA035 bounded multi-skill/dependency/disabled-category fixture.
- **Still needed / boundary:** Matching remains deterministic registered categories; a semantic autonomous planner is a broader proposal, not claimed here.

### C1-AA-036

**Original title:** Build capabilities differ between local development and authenticated production

**Source:** [C1/M11](https://app.notion.com/p/4231aa27632381d99628f1d98fbeea1c?pvs=204) · original ID `C1/AA-036`.

**Status:** **fixed and tested**.

- **Expected behavior:** Build must expose account-files, hosted execution and paired-PC capabilities and retain explicit runtime selection.
- **What actually changed:** Capability manifest, gated unsupported actions, selection refresh and owner-bound buffers; no ambiguous device fallback.
- **Affected files:** `src/lib/mind/kimi/runtime-capabilities.ts`; `src/lib/mind/kimi/phase4.server.ts`; `src/components/mind/build-workspace.tsx`; `src/components/mind/code-ide.tsx`.
- **Tests/evidence:** Connector runtime matrix covers account/local/unknown/ready/busy; UI/source wiring reviewed.
- **Still needed / boundary:** Authenticated browser and actual companion capability emissions require later authorized tests.

### C1-AA-037

**Original title:** File-write conflict protection is not mandatory across all account-storage requests

**Source:** [C1/M11](https://app.notion.com/p/4231aa27632381d99628f1d98fbeea1c?pvs=204) · original ID `C1/AA-037`.

**Status:** **fixed and tested**.

- **Expected behavior:** Existing-file writes require a reviewed revision; creates explicitly require the destination to be absent.
- **What actually changed:** Transactional account insert/CAS and hosted filesystem hash requirements, UI review receipts and owner separation.
- **Affected files:** `src/lib/mind/kimi/account-workspace.ts`; `src/lib/mind/kimi/hosted-files.server.ts`; `src/components/mind/build-workspace.tsx`; `src/components/mind/owner-flow.tsx`.
- **Tests/evidence:** Account SQL and hosted filesystem fixtures reject missing/stale revisions and duplicate creates; reviewed saves succeed.
- **Still needed / boundary:** Preserve distinct shared-file regressions during integration; native companion not modified.

### C1-AA-038

**Original title:** Destructive file operations have inconsistent revision requirements

**Source:** [C1/M11](https://app.notion.com/p/4231aa27632381d99628f1d98fbeea1c?pvs=204) · original ID `C1/AA-038`.

**Status:** **fixed and tested**.

- **Expected behavior:** Delete/rename bind exact reviewed source revision and never overwrite an unexpected destination.
- **What actually changed:** Locked source/CAS, mandatory content hash, explicit destination conflict and aligned UI review contract.
- **Affected files:** `src/lib/mind/kimi/account-workspace.ts`; `src/lib/mind/kimi/hosted-files.server.ts`; `src/components/mind/build-workspace.tsx`.
- **Tests/evidence:** Account/hosted normal, stale/missing revision and destination-conflict fixtures.
- **Still needed / boundary:** Paired native implementation still needs a physical protocol check.

### C1-AA-039

**Original title:** Hosted file operations can report success despite persistence failure

**Source:** [C1/M11](https://app.notion.com/p/4231aa27632381d99628f1d98fbeea1c?pvs=204) · original ID `C1/AA-039`.

**Status:** **fixed and tested**.

- **Expected behavior:** A disk mutation followed by durable-save failure must report partial persistence and provide reviewed reconciliation.
- **What actually changed:** Explicit filesystem/durable/partial receipt; account/disk CAS reconciliation checks both reviewed states and avoids overwriting newer copies.
- **Affected files:** `src/lib/mind/kimi/hosted-files.server.ts`; `src/lib/mind/kimi/file-reconciliation.ts`; `src/lib/mind/kimi/persist.ts`; `src/components/mind/build-workspace.tsx`.
- **Tests/evidence:** Forced persistence failure returns 503/partial; stale reconciliation rejected; verified retry idempotent.
- **Still needed / boundary:** No cross-filesystem/database atomic transaction is claimed.

### C1-AA-040

**Original title:** Hosted restoration can overwrite newer filesystem content

**Source:** [C1/M11](https://app.notion.com/p/4231aa27632381d99628f1d98fbeea1c?pvs=204) · original ID `C1/AA-040`.

**Status:** **fixed and tested**.

- **Expected behavior:** Read-only listing cannot restore over newer disk content; recovery needs explicit reviewed intent.
- **What actually changed:** Listing no longer restores; preview and missing-only exclusive restoration preserve divergent files and report conflicts.
- **Affected files:** `src/lib/mind/kimi/persist.ts`; `src/lib/mind/kimi/hosted-files.server.ts`; `src/components/mind/build-workspace.tsx`.
- **Tests/evidence:** Hosted fixture: listing leaves newer file unchanged; preview writes nothing; reviewed recovery restores only missing files.
- **Still needed / boundary:** Production filesystem content was not inspected or restored.

### C1-AA-041

**Original title:** Checkpoint recovery can conceal the actual runtime blocker

**Source:** [C1/M11](https://app.notion.com/p/4231aa27632381d99628f1d98fbeea1c?pvs=204) · original ID `C1/AA-041`.

**Status:** **fixed and tested**.

- **Expected behavior:** Checkpoint errors must identify unsupported/denied/unreadable states instead of masquerading as an empty list.
- **What actually changed:** Capability-gated recovery, strict HTTP/ok parsing and explicit checkpointListOutcome errors.
- **Affected files:** `src/lib/mind/kimi/runtime-capabilities.ts`; `src/components/mind/build-workspace.tsx`; `src/lib/mind/kimi/runtime-capabilities.test.ts`.
- **Tests/evidence:** Authorization/service/malformed/empty/nonempty response fixtures.
- **Still needed / boundary:** A real hosted checkpoint recovery was not executed.

### C1-AA-042

**Original title:** Build file discovery has a limited repository navigation model

**Source:** [C1/M11](https://app.notion.com/p/4231aa27632381d99628f1d98fbeea1c?pvs=204) · original ID `C1/AA-042`.

**Status:** **fixed and tested**.

- **Expected behavior:** Large nested file trees and search results remain reachable through bounded navigation.
- **What actually changed:** Bounded nested tree/search navigation plus actual CodeMirror-parser symbols/import relationships for the current selected file/buffer revision. Exact stale-buffer and selected workspace/cwd guards; related imports only resolve to actual known files.
- **Affected files:** `src/components/mind/code-ide.tsx`; `src/components/mind/build-workspace.tsx`; `src/lib/mind/kimi/code-navigation.ts`; `src/lib/mind/kimi/code-navigation.test.ts`.
- **Tests/evidence:** Runtime lane: 3/3 actual parser/decoy/stale-buffer/workspace fixtures; connector file-navigation tests and browser QA evidence in lane docs.
- **Still needed / boundary:** Whole-project semantic graph/index is a broader proposal, not claimed by the bounded per-file navigation implementation.

### C1-AA-043

**Original title:** Paired-device coordination depends on local filesystem storage

**Source:** [C1/M12](https://app.notion.com/p/4231aa27632381f287e3e6e03345ff49?pvs=204) · original ID `C1/AA-043`.

**Status:** **fixed and tested**.

- **Expected behavior:** Website coordination persists across processes instead of relying on one server filesystem.
- **What actually changed:** Owner-scoped SQL device/queue/history authority and additive migration; website routes await shared coordination.
- **Affected files:** `src/lib/mind/pc-pairing/coordination.server.ts`; `src/lib/mind/pc-pairing/store.ts`; `src/routes/api/mind/pc/*`; `migrations/0020_c1_device_coordination.sql`.
- **Tests/evidence:** Runtime PGlite AA043–049 shared-device queue and owner isolation fixture.
- **Still needed / boundary:** Legacy production filesystem records are not imported automatically; operator must review a migration/retention plan. Native installers remain separate.

### C1-AA-044

**Original title:** Cancellation can discard a successful late execution result

**Source:** [C1/M12](https://app.notion.com/p/4231aa27632381f287e3e6e03345ff49?pvs=204) · original ID `C1/AA-044`.

**Status:** **fixed and tested**.

- **Expected behavior:** A cancellation request must not discard evidence that already accepted execution succeeded later.
- **What actually changed:** Preserve late outcome alongside cancellation/acknowledgement state; duplicate result submission reconciles instead of overwriting history.
- **Affected files:** `src/lib/mind/pc-pairing/store.ts`; `src/lib/mind/pc-pairing/coordination.server.ts`; `src/routes/api/mind/pc/result.ts`.
- **Tests/evidence:** Runtime durable device and pairing fixtures retain late success after cancellation.
- **Still needed / boundary:** Physical companion delivery and actual external side effects remain unverified.

### C1-AA-045

**Original title:** Timed-out jobs cannot reconcile their final execution outcome

**Source:** [C1/M12](https://app.notion.com/p/4231aa27632381f287e3e6e03345ff49?pvs=204) · original ID `C1/AA-045`.

**Status:** **fixed and tested**.

- **Expected behavior:** Timeout must remain distinct from final execution outcome and accept later authenticated reconciliation.
- **What actually changed:** Retained timed-out job identity and late result reconciliation; no automatic redispatch of uncertain work.
- **Affected files:** `src/lib/mind/pc-pairing/store.ts`; `src/lib/mind/pc-pairing/run.ts`; `src/lib/mind/pc-pairing/coordination.server.ts`.
- **Tests/evidence:** Runtime shared queue fixture verifies late result/owner/history behavior.
- **Still needed / boundary:** No live PC command or timeout was triggered.

### C1-AA-046

**Original title:** Device availability does not establish execution readiness

**Source:** [C1/M12](https://app.notion.com/p/4231aa27632381f287e3e6e03345ff49?pvs=204) · original ID `C1/AA-046`.

**Status:** **fixed and tested**.

- **Expected behavior:** A visible/online PC is not necessarily ready for the requested runtime capability.
- **What actually changed:** Explicit manifest/readiness and busy/capability distinctions propagated to website dispatch and Build runtime selector.
- **Affected files:** `src/lib/mind/pc-pairing/store.ts`; `src/lib/mind/pc-pairing/coordination.server.ts`; `src/lib/mind/kimi/runtime-capabilities.ts`.
- **Tests/evidence:** Runtime/connector manifest and runtime matrix fixtures.
- **Still needed / boundary:** Native agent capability advertisement requires a separate companion release verification.

### C1-AA-047

**Original title:** Default file dispatch can depend on the first available paired device

**Source:** [C1/M12](https://app.notion.com/p/4231aa27632381f287e3e6e03345ff49?pvs=204) · original ID `C1/AA-047`.

**Status:** **fixed and tested**.

- **Expected behavior:** Default file dispatch must not silently choose an arbitrary paired device.
- **What actually changed:** Require an explicit unambiguous eligible device and retain device identity through job dispatch/receipt.
- **Affected files:** `src/lib/mind/pc-pairing/run.ts`; `src/lib/mind/kimi/phase4.server.ts`; `src/lib/mind/mcp/tools.ts`.
- **Tests/evidence:** Runtime pairing and connector capability fixtures cover selection ambiguity.
- **Still needed / boundary:** No production device selection was changed.

### C1-AA-048

**Original title:** File protocol compatibility is inferred from polling behavior

**Source:** [C1/M12](https://app.notion.com/p/4231aa27632381f287e3e6e03345ff49?pvs=204) · original ID `C1/AA-048`.

**Status:** **fixed and tested**.

- **Expected behavior:** File protocol support must be advertised/versioned instead of inferred from polling.
- **What actually changed:** Protocol/capability manifest gates website file requests; unknown/legacy capabilities are reported unavailable.
- **Affected files:** `src/lib/mind/pc-pairing/store.ts`; `src/lib/mind/pc-pairing/coordination.server.ts`; `src/routes/api/mind/pc/register.ts`.
- **Tests/evidence:** Runtime manifest/queue fixture and connector runtime matrix.
- **Still needed / boundary:** Verify a real compatible companion advertises the expected manifest before enabling that route.

### C1-AA-049

**Original title:** Paired-device history has an inefficient growth model

**Source:** [C1/M12](https://app.notion.com/p/4231aa27632381f287e3e6e03345ff49?pvs=204) · original ID `C1/AA-049`.

**Status:** **fixed and tested**.

- **Expected behavior:** Paired-device history must be bounded/indexed and owner-scoped as it grows.
- **What actually changed:** Database-backed job/event collections, paginated indexed history and explicit terminal state retention.
- **Affected files:** `src/lib/mind/pc-pairing/coordination.server.ts`; `src/routes/api/mind/pc/events.ts`; `migrations/0020_c1_device_coordination.sql`.
- **Tests/evidence:** Runtime PGlite indexed history/owner separation fixture.
- **Still needed / boundary:** Production-scale query/load performance and legacy import remain release operations.

### C1-AA-050

**Original title:** Conversation reading position resets when switching chats

**Source:** [C1/M13](https://app.notion.com/p/4231aa27632381b19fa1fc1c1031fe5e?pvs=204) · original ID `C1/AA-050`.

**Status:** **fixed and tested**.

- **Expected behavior:** Switching chats preserves each conversation reading position and follow/detached intent.
- **What actually changed:** Per-chat observed reading positions survive DOM replacement/clamping; explicit user intent governs tail following. Bounded transcript windows preserve all stored messages.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/lib/mind/reading-position.ts`; `src/lib/mind/reading-position.test.ts`.
- **Tests/evidence:** reading-position.test.ts 3/3; actual Chromium long-chat-reading-position fixture passed with real wheel input and exact A→B→A restoration.
- **Still needed / boundary:** Local synthetic Chromium proof; physical mobile scrolling remains unverified.

### C1-AA-051

**Original title:** Automatic scrolling uses an incomplete representation of reading intent

**Source:** [C1/M13](https://app.notion.com/p/4231aa27632381b19fa1fc1c1031fe5e?pvs=204) · original ID `C1/AA-051`.

**Status:** **fixed and tested**.

- **Expected behavior:** Auto-follow must respect upward reading and selected text while still following new output when requested.
- **What actually changed:** Wheel/touch/keyboard/scrollbar and transcript-only selection detach reading; automatic layout clamping does not impersonate user intent. Following disables conflicting native anchoring.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/lib/mind/reading-position.ts`; `src/lib/mind/reading-position.test.ts`.
- **Tests/evidence:** reading-position.test.ts 3/3 plus real-wheel/streaming Chromium transitions passed. User wheel/touch/keyboard/selection intent is distinguished from layout clamping.
- **Still needed / boundary:** No physical input-device claim; selection is limited to this transcript.

### C1-AA-052

**Original title:** Streaming responses and completed responses have different rendering structures

**Source:** [C1/M13](https://app.notion.com/p/4231aa27632381b19fa1fc1c1031fe5e?pvs=204) · original ID `C1/AA-052`.

**Status:** **fixed and tested**.

- **Expected behavior:** Streaming and completed replies should use the same structured renderer to avoid a completion layout jump.
- **What actually changed:** Streaming now renders MemoAnswerTabs with stable callbacks instead of a raw whitespace-only paragraph.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/components/mind/message-body.tsx`.
- **Tests/evidence:** Actual Chromium stream-to-markdown-tail fixture passed: synthetic ReadableStream rendered the shared Markdown component and remained at the tail after completion.
- **Still needed / boundary:** Synthetic provider receipt only; no live model or network-stream reliability claim.

### C1-AA-053

**Original title:** Mobile primary navigation does not expose its selected state programmatically

**Source:** [C1/M13](https://app.notion.com/p/4231aa27632381b19fa1fc1c1031fe5e?pvs=204) · original ID `C1/AA-053`.

**Status:** **fixed and tested**.

- **Expected behavior:** Mobile primary navigation exposes its selected destination to assistive technology.
- **What actually changed:** Both mobile navigation groups set aria-current="page" on the active destination.
- **Affected files:** `src/components/mind/command-app.tsx`; `scripts/visual/destinations.mjs`; `scripts/visual/audit.mjs`.
- **Tests/evidence:** Actual hydrated mobile drawer current-page/focus fixture passed; selected Projects button has aria-current=page. Both primary navigation implementations carry the attribute in source.
- **Still needed / boundary:** The existing mobile shell hides its legacy bottom nav; the visible drawer was tested. No claim that hidden controls were clicked.

### C1-AA-054

**Original title:** Mobile drawer styling is managed through multiple independent mechanisms

**Source:** [C1/M13](https://app.notion.com/p/4231aa27632381b19fa1fc1c1031fe5e?pvs=204) · original ID `C1/AA-054`.

**Status:** **fixed and tested**.

- **Expected behavior:** One scoped drawer stylesheet owns theme, geometry, motion and responsive presentation.
- **What actually changed:** Removed effect-applied important geometry/theme styles and cleanup; final scoped command-drawer-nav.css owns those rules.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/components/mind/command-drawer-nav.css`.
- **Tests/evidence:** Actual mobile drawer focus/Tab/Escape restoration and light/dark persistence passed; reduced-motion and resize-to-desktop cleanup passed in the extended fixture.
- **Still needed / boundary:** Emulated Chromium viewport; no physical iOS/Safari/PWA claim.

### C1-AA-055

**Original title:** Navigation resets page scroll instead of restoring workspace context

**Source:** [C1/M13](https://app.notion.com/p/4231aa27632381b19fa1fc1c1031fe5e?pvs=204) · original ID `C1/AA-055`.

**Status:** **fixed and tested**.

- **Expected behavior:** Returning to a workspace page restores its prior reading context rather than always scrolling to top.
- **What actually changed:** Production-used useViewScrollPosition captures last observed scrolling before DOM replacement; owner/view/Settings pane caches restore independently, with explicit page scroll anchoring.
- **Affected files:** `src/lib/mind/use-view-scroll-position.ts`; `src/components/mind/command-app.tsx`; `src/components/mind/view-scroll-position.test.ts`.
- **Tests/evidence:** view-scroll-position.test.ts2/2 mounted React cases plus actual Chromium Settings Data→Projects→Data restores exact1600px after async content. Pending restore cancels on real user input; owner/pane boundaries verified.
- **Still needed / boundary:** Physical Safari/PWA not tested. Restoring observes pending content only until the saved position becomes available or genuine user input cancels it.

### C1-AA-056

**Original title:** Authentication fallback needs an explicit identity-continuity policy

**Source:** [C1/M14](https://app.notion.com/p/4231aa276323815f9afdfa12c46c4c5a?pvs=204) · original ID `C1/AA-056`.

**Status:** **fixed and tested**.

- **Expected behavior:** Credential fallback cannot change authenticated identity when another credential already established a different subject.
- **What actually changed:** Explicit identity-continuity policy in token verification; rejected/conflicting fallback fails without silently choosing another user.
- **Affected files:** `src/lib/auth/identity-continuity.ts`; `src/lib/auth/verify.server.ts`; `src/lib/auth/identity-continuity.test.ts`.
- **Tests/evidence:** identity-continuity.test.ts passed; local preview auth-invariant gate passed with sign-in disabled matching resolved build configuration.
- **Still needed / boundary:** No real authentication account or session was changed.

### C1-AA-057

**Original title:** Emergency-stop updates accept an insufficiently strict input contract

**Source:** [C1/M14](https://app.notion.com/p/4231aa276323815f9afdfa12c46c4c5a?pvs=204) · original ID `C1/AA-057`.

**Status:** **fixed and tested**.

- **Expected behavior:** Emergency-stop updates accept only a strict boolean and resume binds the observed stop revision.
- **What actually changed:** Reject malformed control input; durable owner-scoped state, monotonic revision/audit, exact-revision resume.
- **Affected files:** `src/lib/mind/halt.server.ts`; `src/lib/mind/server.ts`; `src/lib/mind/c1-runtime-regressions.test.ts`; `src/lib/mind/c1-durable-runtime.test.ts`.
- **Tests/evidence:** Runtime 84/84 includes malformed input; added eighth PGlite case covers resume CAS and audit.
- **Still needed / boundary:** Root must record the final result of the new eighth PGlite case in full-branch results.

### C1-AA-058

**Original title:** Emergency-stop state is not represented with sufficient precision in the status response

**Source:** [C1/M14](https://app.notion.com/p/4231aa276323815f9afdfa12c46c4c5a?pvs=204) · original ID `C1/AA-058`.

**Status:** **fixed and tested**.

- **Expected behavior:** Status distinguishes browser-local stop request, confirmed durable stop and unavailable authority.
- **What actually changed:** Precise owner control response including storage/revision; UI labels local blocking versus confirmed account state and keeps schedules paused on resume.
- **Affected files:** `src/lib/mind/halt.server.ts`; `src/lib/mind/server.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Runtime halt tests plus stop-state PGlite CAS fixture; UI mapping inspected.
- **Still needed / boundary:** A stop cannot undo work already accepted by an external service.

### C1-AA-059

**Original title:** Emergency-stop checks need consistent dispatch-time enforcement

**Source:** [C1/M14](https://app.notion.com/p/4231aa276323815f9afdfa12c46c4c5a?pvs=204) · original ID `C1/AA-059`.

**Status:** **fixed and tested**.

- **Expected behavior:** Current authoritative stop/permission state must be checked immediately before every external dispatch, including later agent steps.
- **What actually changed:** Shared guarded resource dispatch and rechecks in model/helper/agent/media/voice/Build/PC paths; local stop remains an additional restriction.
- **Affected files:** `src/lib/mind/external-resource-call.server.ts`; `src/lib/mind/turn.server.ts`; `src/lib/mind/agent-run.server.ts`; `src/lib/mind/kimi/hosted/resource-dispatch.server.ts`; `src/lib/mind/voice/http.server.ts`.
- **Tests/evidence:** Runtime dispatch/agent recheck tests and connector mid-discovery halt regression; cross-route exact coverage belongs in final inventory.
- **Still needed / boundary:** Do not infer a distributed external cancellation guarantee from a dispatch gate.

### C1-AA-060

**Original title:** Request-isolation enforcement is implemented through separate mechanisms

**Source:** [C1/M14](https://app.notion.com/p/4231aa276323815f9afdfa12c46c4c5a?pvs=204) · original ID `C1/AA-060`.

**Status:** **fixed and tested**.

- **Expected behavior:** Every direct endpoint and RPC has an explicit transport-specific owner/origin/credential contract.
- **What actually changed:** AST-discovered 72 routes/104 methods/58 RPCs match a checked-in policy inventory; undocumented additions fail. Added missing owner pairing/PC origin guards and origin-only login/local-copy middleware; OAuth and device guards remain distinct.
- **Affected files:** `scripts/security/endpoint-inventory.mjs`; `scripts/security/endpoint-inventory.json`; `docs/verification/endpoint-security.md`; `src/lib/auth/middleware.ts`; `src/lib/supabase/actions.ts`; `src/lib/mind/owner-keys-fns.ts`; `src/lib/mind/pairing/pairing.server.ts`; `src/routes/api/mind/pc/status.ts`.
- **Tests/evidence:** 9/9 inventory/request-isolation tests passed; included in 77/77 combined recovery batch. Exact guard-source paths appear in the inventory.
- **Still needed / boundary:** Static guard contracts are not live penetration testing. Preserve explicit public and native/OAuth exceptions when adding endpoints.

### C1-AA-061

**Original title:** Turn deduplication receipts do not provide complete response recovery

**Source:** [C1/M14](https://app.notion.com/p/4231aa276323815f9afdfa12c46c4c5a?pvs=204) · original ID `C1/AA-061`.

**Status:** **fixed and tested**.

- **Expected behavior:** An accepted turn receipt can recover the exact final result without another model dispatch.
- **What actually changed:** Owner/operation/fingerprint-bound response recovery; temporary responses excluded from retained payloads; original operation identity preserved.
- **Affected files:** `src/lib/mind/turn-recovery.ts`; `src/lib/mind/turn.server.ts`; `src/lib/mind/c1-durable-runtime.test.ts`; `migrations/0018_c1_resource_authority.sql`.
- **Tests/evidence:** Runtime PGlite AA061 fixture checks exact response, owner isolation and temporary retention.
- **Still needed / boundary:** Live provider loss/recovery not exercised; ambiguous external receipt remains ambiguous.

### C1-AA-062

**Original title:** Streaming updates can trigger unnecessarily broad interface rendering

**Source:** [C1/M15](https://app.notion.com/p/4231aa276323811985e2cac3d3a06889?pvs=204) · original ID `C1/AA-062`.

**Status:** **fixed and tested**.

- **Expected behavior:** Latest streaming text should not repeatedly rerender completed message bodies.
- **What actually changed:** Memoized StableMessageBody and stable current-callback hook keep completed transcript parsing unchanged during streaming while actions read the newest handler.
- **Affected files:** `src/components/mind/stable-message-body.ts`; `src/components/mind/command-app.tsx`; `src/components/mind/message-rendering.test.ts`.
- **Tests/evidence:** Runtime lane actual mounted React fixture: 20 live updates do not reparse historical splitBlocks; real content edit reparses; action uses newest callback.
- **Still needed / boundary:** Large-browser performance depends on actual data/device. This fixture verifies the production component boundary, not production timing.

### C1-AA-063

**Original title:** Long conversations lack a bounded rendering window in the inspected transcript

**Source:** [C1/M15](https://app.notion.com/p/4231aa276323811985e2cac3d3a06889?pvs=204) · original ID `C1/AA-063`.

**Status:** **fixed and tested**.

- **Expected behavior:** Long conversations progressively mount messages while preserving all data, selection, links and accessibility.
- **What actually changed:** Default 80-message window and explicit earlier-message loading with scroll compensation; underlying messages are retained.
- **Affected files:** `src/lib/mind/reading-position.ts`; `src/components/mind/command-app.tsx`; `src/lib/mind/reading-position.test.ts`.
- **Tests/evidence:** Actual Chromium initially rendered80/180 messages, loaded160, then revealed/focused the oldest hidden message; source messages remained retained.
- **Still needed / boundary:** This is bounded windowing with explicit earlier loading, not variable-height virtualization of every rendered message.

### C1-AA-064

**Original title:** Workspace-size calculation serializes the entire workspace

**Source:** [C1/M15](https://app.notion.com/p/4231aa276323811985e2cac3d3a06889?pvs=204) · original ID `C1/AA-064`.

**Status:** **fixed and tested**.

- **Expected behavior:** Storage-size display should not serialize the whole workspace while unrelated UI is active.
- **What actually changed:** Record byte calculation runs only when view=settings and pane=data, with cache across unrelated renders; remembering the Data pane while returning to Chat no longer serializes workspace.
- **Affected files:** `src/lib/mind/workspace-metrics.ts`; `src/components/mind/command-app.tsx`; `src/components/mind/message-rendering.test.ts`.
- **Tests/evidence:** Runtime lane actual mounted React serialization-count fixture; two combined component performance tests passed.
- **Still needed / boundary:** Figure explicitly excludes draft/separate binary stores and is not total disk usage.

### C1-AA-065

**Original title:** Workspace persistence can repeatedly process complete snapshots

**Source:** [C1/M15](https://app.notion.com/p/4231aa276323811985e2cac3d3a06889?pvs=204) · original ID `C1/AA-065`.

**Status:** **fixed and tested**.

- **Expected behavior:** Network/database persistence processes changed records instead of rewriting every mirror on every save.
- **What actually changed:** Message/record deltas, bounded batched requests and changed-only mirror deletes/inserts; compatibility crash-recovery snapshots preserved.
- **Affected files:** `src/lib/mind/workspace-delta.ts`; `src/lib/mind/store.ts`; `src/lib/mind/use-mind-workspace.ts`.
- **Tests/evidence:** Privacy lane 48/48 includes mutation-scope capture, large workspace small update and batch/resume; shares the AA013 implementation without omitting this finding.
- **Still needed / boundary:** Full compatibility snapshot and browser checkpoint serialization still exist. Fully paginated records are a subsequent migration proposal.

### C1-AA-066

**Original title:** Execution timers are maintained at the main application level

**Source:** [C1/M15](https://app.notion.com/p/4231aa276323811985e2cac3d3a06889?pvs=204) · original ID `C1/AA-066`.

**Status:** **fixed and tested**.

- **Expected behavior:** Presentation timers update only the visible component that displays elapsed time.
- **What actually changed:** ElapsedTime leaf owns recording clocks in dictation/voice/OwnerFlow; tool timeline clock moved into ChatPane. CommandApp presentation clock intervals removed.
- **Affected files:** `src/components/mind/elapsed-time.tsx`; `src/components/mind/command-app.tsx`; `src/components/mind/dictation-pill.tsx`; `src/components/mind/owner-flow.tsx`.
- **Tests/evidence:** browser-work-pump.test.ts 3/3 includes visibility-aware clock stop/resume and no retained intervals; production ElapsedTime/ChatPane subscribe to the tested clock.
- **Still needed / boundary:** A 30-second general status refresh remains; no one-second recording timer drives CommandApp.

### C1-AA-067

**Original title:** Heavy application modules are not uniformly lazy-loaded

**Source:** [C1/M15](https://app.notion.com/p/4231aa276323811985e2cac3d3a06889?pvs=204) · original ID `C1/AA-067`.

**Status:** **fixed and tested**.

- **Expected behavior:** Heavy optional features load behind explicit boundaries while essential navigation/chat remain available.
- **What actually changed:** BuildWorkspace and VoiceCloningStudioPage are lazy imports; Dashboard lazy boundary retained; loading fallback remains explicit.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/components/mind/stable-message-body.ts`.
- **Tests/evidence:** Direct Vite production bundle passed and emitted separate Build/Voice Studio chunks; actual Chromium lazy-build-and-voice entry fixture passed.
- **Still needed / boundary:** No deployment; native/runtime initialization and physical-device performance are not established.

### C1-AA-068

**Original title:** Browser worker processing introduces a fixed scheduling delay

**Source:** [C1/M15](https://app.notion.com/p/4231aa276323811985e2cac3d3a06889?pvs=204) · original ID `C1/AA-068`.

**Status:** **fixed and tested**.

- **Expected behavior:** New authorized queued work starts from an event, with periodic reconciliation as fallback.
- **What actually changed:** Owner-scoped coalesced immediate worker pump wakes on queued work, preserves the safety reconciliation heartbeat and disposes listeners/timers on owner/unmount changes.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/lib/mind/worker-pass.ts`; `src/lib/mind/browser-work-pump.ts`; `src/lib/mind/browser-work-pump.test.ts`.
- **Tests/evidence:** browser-work-pump.test.ts 3/3: actual Fleet tick dispatches on queued wake without waiting2seconds, coalesces bursts, and disposes stale owner/visibility subscriptions.
- **Still needed / boundary:** Reconciliation heartbeat remains2seconds; the helper does not claim browser-closed execution.

### C1-AA-069

**Original title:** Failure classification depends heavily on human-readable error messages

**Source:** [C1/M16](https://app.notion.com/p/4231aa27632381dda334ed147a51ab26?pvs=204) · original ID `C1/AA-069`.

**Status:** **fixed and tested**.

- **Expected behavior:** Machine failure code/subsystem/operation/provider/stage/retry/outcome control classification independently of display wording.
- **What actually changed:** Versioned shared envelopes emitted by actual Chat/resource/research/media/voice JSON helpers and relay SSE, preserved by production parsers, prioritized by CommandApp and durable recovery. Notion adapter consumes its existing typed evidence. Legacy string parsing remains compatibility fallback.
- **Affected files:** `src/lib/mind/failure-envelope.ts`; `src/lib/mind/failure-states.ts`; `src/lib/mind/stream.ts`; `src/lib/mind/live-turn.ts`; `src/lib/mind/relay.ts`; `src/lib/mind/turn.server.ts`; `src/lib/mind/media/imagine-http.ts`; `src/lib/mind/voice/http.server.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** failure-envelope.test.ts changed-wording/status/policy/actual HTTP+SSE fixtures; 77/77 combined targeted recovery tests passed.
- **Still needed / boundary:** Do not infer no remote effect from a generic HTTP failure. Resource/Free-only policies use review, halt uses never, permission repair requires a permission code.

### C1-AA-070

**Original title:** Persistent incident tracking is specialized for Notion search

**Source:** [C1/M16](https://app.notion.com/p/4231aa27632381dda334ed147a51ab26?pvs=204) · original ID `C1/AA-070`.

**Status:** **fixed and tested**.

- **Expected behavior:** Open incidents remain discoverable beyond activity retention and are scoped to the current account.
- **What actually changed:** Separate retained owner journal, immediate owner filtering, account-change write guard, temporary-conversation exclusion and actual recovery cards.
- **Affected files:** `src/lib/mind/incidents.ts`; `src/components/mind/command-app.tsx`; `src/components/mind/incident-recovery-card.tsx`.
- **Tests/evidence:** 250-open-incident retention, reload/account/privacy and actual card markup tests; combined 77/77 targeted pass.
- **Still needed / boundary:** Journal is browser/account-scoped. Account-wide cross-device incident synchronization is not claimed.

### C1-AA-071

**Original title:** Successful unrelated operations can clear the active failure banner

**Source:** [C1/M16](https://app.notion.com/p/4231aa27632381dda334ed147a51ab26?pvs=204) · original ID `C1/AA-071`.

**Status:** **fixed and tested**.

- **Expected behavior:** Only exact verified recovery resolves an incident; unrelated success and acknowledgement remain distinct.
- **What actually changed:** Typed incidents require exact owner/operation or explicit recovery relation, resource/revision bindings and all verification checks. Generic clearFailure(target) cannot mark them resolved.
- **Affected files:** `src/lib/mind/incidents.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Wrong operation/binding/missing check and unidentified-operation tests reject resolution; exact verified proof succeeds; 77/77 combined pass.
- **Still needed / boundary:** Uncertain operations remain open for inspection; no generic target-only success is presented as proof.

### C1-AA-072

**Original title:** Retry removes the visible failure before recovery is established

**Source:** [C1/M16](https://app.notion.com/p/4231aa27632381dda334ed147a51ab26?pvs=204) · original ID `C1/AA-072`.

**Status:** **fixed and tested**.

- **Expected behavior:** Recovering state and attempt history survive retry failure without merging unrelated operations at one target.
- **What actually changed:** Operation identity selects incident; begin review/retry records attempt, subsequent failure preserves its ID and marks attempt failed. A click never implies resolution.
- **Affected files:** `src/lib/mind/incidents.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Same target/different operation and recovering→failed identity fixtures; 77/77 combined pass.
- **Still needed / boundary:** Actual in-session retry remains limited to safe read or original-send receipt policy; other actions reopen fresh review.

### C1-AA-073

**Original title:** Notion timeout wording can overstate execution certainty

**Source:** [C1/M16](https://app.notion.com/p/4231aa27632381dda334ed147a51ab26?pvs=204) · original ID `C1/AA-073`.

**Status:** **fixed and tested**.

- **Expected behavior:** Notion timeout wording must preserve uncertainty after a potentially accepted write.
- **What actually changed:** Timeout messages distinguish unconfirmed completion and require destination inspection before retry; typed operation outcomes persist.
- **Affected files:** `src/lib/mind/notion-failure-action.ts`; `src/lib/mind/failure-states.ts`; `src/lib/mind/notion.ts`; `src/lib/mind/notion-operation-status.ts`.
- **Tests/evidence:** Connector adapter/operation-state fixtures; root normal suite must retain timeout classification checks.
- **Still needed / boundary:** No assertion that a real provider operation was or was not executed after timeout.

### C1-AA-074

**Original title:** Recovery callbacks are not durable recovery plans

**Source:** [C1/M16](https://app.notion.com/p/4231aa27632381dda334ed147a51ab26?pvs=204) · original ID `C1/AA-074`.

**Status:** **fixed and tested**.

- **Expected behavior:** Recovery plans survive reload with original destination and current authority checks but no old approval or sensitive body.
- **What actually changed:** Versioned operation-specific descriptors bind account/chat/workspace/page/grant/connection/report/configuration and wait policy. Actual UI opens original feature/media history; Voice opens Settings without starting capture. Unknown writes/generation inspect first.
- **Affected files:** `src/lib/mind/incidents.ts`; `src/lib/mind/failure-envelope.ts`; `src/components/mind/incident-recovery-card.tsx`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Reload/private-payload stripping, owner/grant/destination/halt/wait/reauthentication, exact receipt replay and actual component render fixtures; 77/77 combined pass.
- **Still needed / boundary:** No automatic provider call, restored approval or cross-device journal is claimed. Completed receipt inspection and new dispatch authority remain separate.

### C1-AA-075

**Original title:** Projects do not automatically provide comprehensive document context to Chat

**Source:** [C1/M17](https://app.notion.com/p/4231aa27632381a8a514ca3d0e9b3a84?pvs=204) · original ID `C1/AA-075`.

**Status:** **fixed and tested**.

- **Expected behavior:** Ordinary project Chat can retrieve relevant explicitly permitted document passages with truthful source identity.
- **What actually changed:** Bounded lexical passage retrieval, file/version/range labels, untrusted-evidence prompt and server validation of current source state.
- **Affected files:** `src/lib/mind/knowledge.ts`; `src/lib/mind/prompt.ts`; `src/lib/mind/memory/dispatch-policy.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Privacy lane knowledge tests: multiple relevant files, foreign-project exclusion, bounded context, exact slice/hash/name/coverage and revocation rejection.
- **Still needed / boundary:** Actual model citation use was not tested; other project conversations/research engines are not implicitly enabled.

### C1-AA-076

**Original title:** Project context and personal memory are coupled

**Source:** [C1/M17](https://app.notion.com/p/4231aa27632381a8a514ca3d0e9b3a84?pvs=204) · original ID `C1/AA-076`.

**Status:** **fixed and tested**.

- **Expected behavior:** Project document permission is separate from personal memory and temporary chats remain protected.
- **What actually changed:** Independent context policy, explicit document-off override even with memory on, separate saved-note scope.
- **Affected files:** `src/lib/mind/workspace.ts`; `src/lib/mind/memory/context-policy.ts`; `src/lib/mind/knowledge.ts`.
- **Tests/evidence:** Privacy lane independent memory-off/document-on and temporary denial tests.
- **Still needed / boundary:** Retain explicit policy precedence when combining workspace/privacy branches.

### C1-AA-077

**Original title:** The document library has restrictive storage and ingestion limits

**Source:** [C1/M17](https://app.notion.com/p/4231aa27632381a8a514ca3d0e9b3a84?pvs=204) · original ID `C1/AA-077`.

**Status:** **fixed and tested**.

- **Expected behavior:** Original documents, searchable extraction and model context have separate storage/size policies.
- **What actually changed:** Owner-scoped original Blob store; 5 MB input, 400k extracted text, 1,000 Library records; bounded six-passage/6,000-character model context; explicit original download.
- **Affected files:** `src/lib/mind/document-originals.ts`; `src/lib/mind/knowledge-limits.ts`; `src/lib/mind/workspace.ts`; `src/components/mind/knowledge-settings.tsx`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Privacy lane IDB fixture: owner separation, hash/read/delete, failure and size cap; >40k text and >40 records; original/extraction round trip.
- **Still needed / boundary:** Originals are browser-local; metadata/account JSON export is not binary cloud backup. Final legacy Files delete/excerpt consumer wiring must match shared semantics.

### C1-AA-078

**Original title:** Saved documents do not have a comprehensive evidence-provenance model

**Source:** [C1/M17](https://app.notion.com/p/4231aa27632381a8a514ca3d0e9b3a84?pvs=204) · original ID `C1/AA-078`.

**Status:** **fixed and tested**.

- **Expected behavior:** Evidence identifies the exact original/extraction/revision and never pretends a partial extraction is a full document.
- **What actually changed:** Original/text checksums, extraction revision and page-tree ordered PDF evidence index identify actual extracted, clipped, unavailable and not-retained pages. Retrieval validates hash and exact text/page ranges; unresolved trees expose unknown attribution. Original download verifies checksum.
- **Affected files:** `src/lib/mind/pdf-text.ts`; `src/lib/mind/knowledge.ts`; `src/lib/mind/types.ts`; `src/lib/mind/workspace.ts`; `src/lib/mind/document-originals.ts`; `src/components/mind/knowledge-settings.tsx`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Runtime completion: 31/31 PDF/knowledge/original/render fixtures; actual PDF page offsets/checksum-bound retrieval and actual provenance markup.
- **Still needed / boundary:** Scanned/unsupported PDFs retain explicit unavailable/unknown evidence. OCR and external-provider citation correctness are not invented; no physical document/provider test is claimed.

### C1-AA-079

**Original title:** Project deletion leaves different resource relationships in different states

**Source:** [C1/M17](https://app.notion.com/p/4231aa27632381a8a514ca3d0e9b3a84?pvs=204) · original ID `C1/AA-079`.

**Status:** **fixed and tested**.

- **Expected behavior:** Project archive/restore preserves associations; reviewed deletion reconciles all associated future execution without broadening notes.
- **What actually changed:** Archive/restore helpers; delete unlinks files/chats, disables project context, archives associated agents and their schedules, and retains restricted notes/history.
- **Affected files:** `src/lib/mind/workspace.ts`; `src/components/mind/knowledge-settings.tsx`; `src/lib/mind/fleet.ts`.
- **Tests/evidence:** Privacy lane relationship fixture plus actual KnowledgeSettings render check.
- **Still needed / boundary:** Root must ensure all legacy project deletion buttons call the shared lifecycle helper and active navigation treats archive consistently.

### C1-AA-080

**Original title:** Existing bot conversations retain copied knowledge and configuration

**Source:** [C1/M17](https://app.notion.com/p/4231aa27632381a8a514ca3d0e9b3a84?pvs=204) · original ID `C1/AA-080`.

**Status:** **fixed and tested**.

- **Expected behavior:** Bot conversation revision is explicit, adoption is reviewed, and current permission/knowledge revocation applies immediately.
- **What actually changed:** Pinned botRevision, revision disclosure and reviewed adopt action; current agent/knowledge guard before dispatch.
- **Affected files:** `src/lib/mind/workspace.ts`; `src/lib/mind/memory/dispatch-policy.ts`; `src/components/mind/knowledge-settings.tsx`.
- **Tests/evidence:** Privacy lane old/new knowledge, explicit adoption, preserved messages, unavailable bot and actual settings markup tests.
- **Still needed / boundary:** Adoption does not rewrite an active agent run; runtime immutable-plan rules remain separate.

### C1-AA-081

**Original title:** Deleting a library file does not necessarily remove its copied conversation contents

**Source:** [C1/M17](https://app.notion.com/p/4231aa27632381a8a514ca3d0e9b3a84?pvs=204) · original ID `C1/AA-081`.

**Status:** **fixed and tested**.

- **Expected behavior:** Library removal, retrieval exclusion and previously copied conversation/provider content are disclosed as separate effects.
- **What actually changed:** Stable documentSources metadata, legacy attachment matching, original-delete retry state, explicit future retrieval exclusion and reviewed retention copy.
- **Affected files:** `src/lib/mind/knowledge.ts`; `src/lib/mind/document-originals.ts`; `src/components/mind/knowledge-settings.tsx`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Privacy lane retained-copy and failed-original-delete fixtures; source→staged→message linkage reviewed.
- **Still needed / boundary:** External provider erasure is not claimed. Legacy Files controls and excerpt selection must retain source metadata; root is reconciling those consumer paths.

### C1-AA-082

**Original title:** Video generation recovery depends on the active browser session

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-082`.

**Status:** **fixed and tested**.

- **Expected behavior:** Accepted video jobs survive reload with their original owner, chat and provider request identity.
- **What actually changed:** Durable media operation claim/receipt/recovery endpoint and generation-history UI; accepted jobs resume status checks without resubmitting generation.
- **Affected files:** `src/lib/mind/media/operations.server.ts`; `src/lib/mind/media/imagine-http.ts`; `src/components/mind/command-app.tsx`; `migrations/0019_c1_media_operations.sql`.
- **Tests/evidence:** media/operations.test.ts 4/4: accepted request recovers by stable operation ID, concurrent duplicates do not redispatch, owner isolation and temporary retention hold.
- **Still needed / boundary:** Apply migration0019 before rollout; actual provider job completion remains unverified.

### C1-AA-083

**Original title:** Video assets are represented by temporary provider URLs

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-083`.

**Status:** **fixed and tested**.

- **Expected behavior:** Video UI distinguishes temporary provider URLs, local download attempts and genuinely retained assets.
- **What actually changed:** RetainedVideo shows temporary retention and an unavailable error state; message metadata supports explicit retention and expiry without claiming a clicked link guarantees download.
- **Affected files:** `src/components/mind/retained-video.tsx`; `src/lib/mind/types.ts`; `src/lib/mind/workspace.ts`; `src/lib/mind/media/asset-lifecycle.ts`; `src/components/mind/retained-video.test.ts`.
- **Tests/evidence:** retained-video.test.ts actual React error→unavailable→retry-playback passed; asset-lifecycle export test labels external-temporary assets.
- **Still needed / boundary:** No account/cloud video binary archive is implemented. Opening a download link is not claimed as verified local retention.

### C1-AA-084

**Original title:** Video polling has limited recovery from transient communication failures

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-084`.

**Status:** **fixed and tested**.

- **Expected behavior:** Transient video-status communication errors retry the same accepted job with bounded backoff.
- **What actually changed:** Bounded status polling recovery preserves saved request ID and reports interrupted observation; no generation retry hidden inside polling.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/lib/mind/media/operations.server.ts`; `src/lib/mind/media/imagine-http.ts`; `src/lib/mind/media/video-poll.ts`; `src/lib/mind/media/video-poll.test.ts`.
- **Tests/evidence:** media/video-poll.test.ts 3/3 covers transient status failure/Retry-After/deadline and cancellation; observer only receives a status callback and cannot start generation.
- **Still needed / boundary:** Provider outage behavior is synthetic; resume uses the saved accepted request ID.

### C1-AA-085

**Original title:** Video generation announces startup before provider acceptance

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-085`.

**Status:** **fixed and tested**.

- **Expected behavior:** The interface should say submitting until provider acceptance is actually observed.
- **What actually changed:** Dedicated owner/login/chat-scoped video progress is visible outside the queued-message panel. Submitting/recovering cannot become accepted/rendering without a provider handle; rejected start removes progress. Generic busy copy does not infer stages from user text.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/lib/mind/media/imagine-http.ts`; `src/lib/mind/media/video-progress.ts`; `src/lib/mind/media/video-progress.test.ts`.
- **Tests/evidence:** video-progress.test.ts2/2 plus real Chromium delayed rejected/accepted Home→Video→Chat flows: no premature acceptance/status poll, rejected start clears progress, accepted same operation/requestId gets one status and zero repeated starts.
- **Still needed / boundary:** Synthetic transport and clock only; no live generation, billing or physical device proof.

### C1-AA-086

**Original title:** Image generation lacks a complete recoverable execution receipt

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-086`.

**Status:** **fixed and tested**.

- **Expected behavior:** Image generation has an owner/operation-bound recoverable receipt and ambiguous results do not automatically generate again.
- **What actually changed:** Durable claim with canonical request fingerprint, completed/unknown/failed outcomes and safe generation history recovery.
- **Affected files:** `src/lib/mind/media/operations.server.ts`; `src/lib/mind/media/imagine-http.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** media/operations.test.ts 4/4 and route fixtures passed: stable payload identity, one claim, concurrent duplicates, unknown outcome, no automatic repeated generation, temporary-result privacy.
- **Still needed / boundary:** Provider-reported identifiers/usage are retained when supplied; actual billing remains unknown unless independently reported.

### C1-AA-087

**Original title:** Image editing lacks a structured asset-version relationship

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-087`.

**Status:** **fixed and tested**.

- **Expected behavior:** An edit creates a distinct asset linked to original identity, prompt, operation and creation time.
- **What actually changed:** Content identity, parentAssetId, operationId, editPrompt, createdAt and preferred variant persist through message normalization/export; image edit UI records lineage.
- **Affected files:** `src/lib/mind/media/asset-lifecycle.ts`; `src/lib/mind/media/blob-store.ts`; `src/lib/mind/types.ts`; `src/lib/mind/workspace.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** asset-lifecycle.test.ts 3/3; original/edited SHA identity, immutable parent lineage, offload/hydration/export plus workspace preferred-version normalization passed.
- **Still needed / boundary:** Version metadata and preferred selection do not create cloud binary storage.

### C1-AA-088

**Original title:** Legacy image retrieval requires stronger account-migration guarantees

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-088`.

**Status:** **fixed and tested**.

- **Expected behavior:** Account-scoped image reads never silently fall back to unowned legacy shared storage.
- **What actually changed:** Removed automatic legacy fallback from account stores; explicit owner namespace and truthful missing-asset handling.
- **Affected files:** `src/lib/mind/media/blob-store.ts`; `src/lib/mind/media/asset-lifecycle.test.ts`.
- **Tests/evidence:** account-blob-isolation.test.ts passed using actual fake IndexedDB namespaces: no legacy fallback, no guest/owner adoption and owner-only clear.
- **Still needed / boundary:** Legacy assets require a separately reviewed ownership migration; there is no automatic legacy adoption.

### C1-AA-089

**Original title:** Image storage has different persistence guarantees across environments

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-089`.

**Status:** **fixed and tested**.

- **Expected behavior:** Conversation availability and each asset binary availability are independently visible in exports.
- **What actually changed:** Hydrate available images for portable JSON and include per-asset included/missing/external-temporary manifest; unavailable original documents explicitly excluded.
- **Affected files:** `src/lib/mind/media/asset-lifecycle.ts`; `src/lib/mind/workspace.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** asset-lifecycle.test.ts passed: export hydrates available pixels and marks included/missing/external-temporary assets without mutating source; original-document exclusions remain explicit.
- **Still needed / boundary:** A reference without local bytes is not a backup or a promise of cross-device availability.

### C1-AA-090

**Original title:** Creative generation parameters are fixed in the inspected client paths

**Source:** [C1/M18](https://app.notion.com/p/4231aa27632381cc9d3bd3c7803fcb87?pvs=204) · original ID `C1/AA-090`.

**Status:** **fixed and tested**.

- **Expected behavior:** Only implemented provider-supported creative options should be selectable and validated.
- **What actually changed:** Image count 1–4 and video duration 1–15 controls with matching validation; existing provider path remains explicit. Lineage/preferred state supports later creative organization.
- **Affected files:** `src/lib/mind/media/asset-lifecycle.ts`; `src/lib/mind/media/imagine-http.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** asset-lifecycle.test.ts validates implemented image count1–4 and video duration1–15, rejects invalid/fractional/out-of-range inputs; server validation matches client options.
- **Still needed / boundary:** Only the implemented xAI media route is exposed. Broader provider adapters, arbitrary resolution/aspect-ratio options and project-wide creative search remain explicit follow-on proposals.

### C1-AA-091

**Original title:** Rate limiting is process-local rather than a shared financial control

**Source:** [C1/M19](https://app.notion.com/p/4231aa276323810fb293e13da228b8cd?pvs=204) · original ID `C1/AA-091`.

**Status:** **fixed and tested**.

- **Expected behavior:** Provider allowance must be shared durably across requests/processes, independent of local abuse-rate counters.
- **What actually changed:** Owner-scoped SQL resource reservations, atomic allowance checks, operation identity and settled outcomes.
- **Affected files:** `src/lib/mind/resource-governor.server.ts`; `src/lib/mind/resource-policy.ts`; `src/lib/mind/external-resource-call.server.ts`; `migrations/0018_c1_resource_authority.sql`.
- **Tests/evidence:** Runtime PGlite AA091/092/094/095 concurrent reservation and exactly-once settlement tests.
- **Still needed / boundary:** Apply migration; no claim of an exact invoice without trusted provider cost data.

### C1-AA-092

**Original title:** One orchestrated Chat turn can represent multiple provider requests

**Source:** [C1/M19](https://app.notion.com/p/4231aa276323810fb293e13da228b8cd?pvs=204) · original ID `C1/AA-092`.

**Status:** **fixed and tested**.

- **Expected behavior:** A multi-model request reserves and reports all actual provider participants, not only one UI turn.
- **What actually changed:** Shared plan counts authorized helpers/answer calls; bounded concurrency and each governed dispatch consume shared allowance.
- **Affected files:** `src/lib/mind/execution-plan.ts`; `src/lib/mind/model-consult.ts`; `src/lib/mind/resource-governor.server.ts`; `src/lib/mind/turn.server.ts`.
- **Tests/evidence:** Runtime plan/helper tests and PGlite reservation fixture.
- **Still needed / boundary:** Keep participant authorization, receipt and resource behavior consistent across orchestration branches.

### C1-AA-093

**Original title:** Free-only enforcement lacks a demonstrated unified account authority

**Source:** [C1/M19](https://app.notion.com/p/4231aa276323810fb293e13da228b8cd?pvs=204) · original ID `C1/AA-093`.

**Status:** **fixed and tested**.

- **Expected behavior:** Persisted owner free-only policy cannot be disabled by an omitted or false request field.
- **What actually changed:** Server resource authority combines persisted policy and request restrictions; unknown-paid routes fail closed under free-only across governed external calls.
- **Affected files:** `src/lib/mind/resource-governor.server.ts`; `src/lib/mind/resource-http.server.ts`; `src/lib/mind/external-resource-call.server.ts`; `src/components/mind/resource-settings.tsx`.
- **Tests/evidence:** Runtime PGlite AA093 request-omission case; voice/media/BYOK/Build route fixtures in lane batches.
- **Still needed / boundary:** A free-only classification is not a promise that provider rate limits or access will remain available.

### C1-AA-094

**Original title:** Request-size limits are not equivalent to monetary budgets

**Source:** [C1/M19](https://app.notion.com/p/4231aa276323810fb293e13da228b8cd?pvs=204) · original ID `C1/AA-094`.

**Status:** **fixed and tested**.

- **Expected behavior:** Request byte/token limits are separate from owner call and monetary allowance.
- **What actually changed:** Explicit per-period calls/concurrency and cost limits with reservation accounting; unknown price cannot masquerade as zero cost under a money cap.
- **Affected files:** `src/lib/mind/resource-policy.ts`; `src/lib/mind/resource-governor.server.ts`; `src/components/mind/resource-settings.tsx`.
- **Tests/evidence:** Runtime unknown-price/reservation fixtures and atomic PGlite tests.
- **Still needed / boundary:** Money enforcement requires configured trusted price data; unknown values remain unknown.

### C1-AA-095

**Original title:** Financial authorization requires a distinct inference-spending policy

**Source:** [C1/M19](https://app.notion.com/p/4231aa276323810fb293e13da228b8cd?pvs=204) · original ID `C1/AA-095`.

**Status:** **fixed and tested**.

- **Expected behavior:** Inference spending is explicitly governed independently from tool/write approval.
- **What actually changed:** Owner resource policy and revision-reviewed management; shared preflight for external model/audio/media/research/Build inference paths.
- **Affected files:** `src/lib/mind/external-resource-call.server.ts`; `src/lib/mind/resource-http.server.ts`; `src/components/mind/resource-settings.tsx`.
- **Tests/evidence:** Runtime reservation policy and guarded-route tests; approvals remain a separate contract.
- **Still needed / boundary:** No account spending settings were changed during implementation.

### C1-AA-096

**Original title:** Usage records cannot yet establish comprehensive financial expenditure

**Source:** [C1/M19](https://app.notion.com/p/4231aa276323810fb293e13da228b8cd?pvs=204) · original ID `C1/AA-096`.

**Status:** **fixed and tested**.

- **Expected behavior:** Usage reporting separates observed usage, estimates, unknown cost and complete financial expenditure.
- **What actually changed:** Structured provider usage/request/model receipts and durable reservation settlement; attempted failures retain null/unknown cost.
- **Affected files:** `src/lib/mind/provider-call.ts`; `src/lib/mind/resource-governor.server.ts`; `src/lib/mind/turn.server.ts`.
- **Tests/evidence:** Runtime provider receipt normalization and PGlite AA096 unknown-cost test.
- **Still needed / boundary:** No billing reconciliation/invoice import was performed or claimed.

### C1-AA-097

**Original title:** The default test command can omit existing regression tests

**Source:** [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4?pvs=204) · original ID `C1/AA-097`.

**Status:** **blocked with the exact missing step**.

- **Expected behavior:** The default runner discovers every intended checked-in regression file and reports the inventory.
- **What actually changed:** Normal npm test recursively discovers every .test.ts/.test.mjs under src/scripts; shard runner shares inventory. Each file runs in its own process/private temp directory; all failures are reported.
- **Affected files:** `scripts/test-inventory.mjs`; `scripts/test-inventory.test.mjs`; `scripts/run-tests.mjs`; `scripts/run-tests-shard.mjs`; `package.json`.
- **Tests/evidence:** Inventory regression passed. First400-file run:390passed/10failed; next410-file run:409passed/1legacy research assertion failed. All identified regressions were repaired and separately retested; committed-candidate full run pending.
- **Still needed / boundary:** Record the final full-run totals and failures after repairs. Do not replace the failed result with an earlier smaller pass.

### C1-AA-098

**Original title:** Visual audit findings do not necessarily fail the audit command

**Source:** [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4?pvs=204) · original ID `C1/AA-098`.

**Status:** **fixed and tested**.

- **Expected behavior:** Visual report-only output is distinct from a release gate with thresholds, reviewed exceptions and regression comparison.
- **What actually changed:** Explicit report/release modes, committed policy, exact-fingerprint/revision/expiry exceptions, dirty-tree gate and baseline comparison.
- **Affected files:** `scripts/visual/policy.mjs`; `scripts/visual/policy.test.mjs`; `scripts/visual/audit.mjs`; `docs/verification/visual-policy.json`.
- **Tests/evidence:** visual/policy.test.mjs 3/3: report/release gates, exact exceptions, dirty state and thresholds; local fixture captures and scoped final Build contrast rerun executed.
- **Still needed / boundary:** This is local synthetic evidence, not a production release approval. Report mode deliberately does not equate exit0 with release eligibility.

### C1-AA-099

**Original title:** Visual audit screenshots do not independently establish the intended destination

**Source:** [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4?pvs=204) · original ID `C1/AA-099`.

**Status:** **fixed and tested**.

- **Expected behavior:** A screenshot must carry independently verified destination, heading/readiness and environment identity.
- **What actually changed:** Central destination contracts check data-view, heading and readiness before capture; report records SHA, dirty state, browser/version and emulation label.
- **Affected files:** `scripts/visual/destinations.mjs`; `scripts/visual/policy.test.mjs`; `scripts/visual/audit.mjs`.
- **Tests/evidence:** visual/policy.test.mjs and fixture-states.test.mjs passed;14 actual desktop/mobile captures verified destination and readiness before screenshot.
- **Still needed / boundary:** Screen readiness only proves the named fixture, not every authenticated downstream service.

### C1-AA-100

**Original title:** The general visual sweep has limited functional-state coverage

**Source:** [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4?pvs=204) · original ID `C1/AA-100`.

**Status:** **fixed and tested**.

- **Expected behavior:** Safe navigation coverage is supplemented with deterministic failure/loading/permission functional states.
- **What actually changed:** Fresh local fixture contexts intercept API/RPC traffic, block external/WebSocket calls and provide declared state scenarios.
- **Affected files:** `scripts/visual/fixture-states.mjs`; `scripts/visual/fixture-states.test.mjs`; `scripts/visual/audit.mjs`.
- **Tests/evidence:** fixture-states.test.mjs 2/2 plus14 actual desktop/mobile state captures; requests are intercepted and external traffic/WebSockets blocked.
- **Still needed / boundary:** Additional real-account/provider states remain separate acceptance runs, never inferred from fixtures.

### C1-AA-101

**Original title:** Desktop and mobile emulation cannot establish physical-device compatibility

**Source:** [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4?pvs=204) · original ID `C1/AA-101`.

**Status:** **fixed and tested**.

- **Expected behavior:** Verification explicitly separates source/unit/emulated/browser/authenticated/physical environments.
- **What actually changed:** Environment evidence schema rejects an emulated result labeled physical; explicit unverified matrix and next actions retained.
- **Affected files:** `scripts/verification/evidence.mjs`; `docs/verification/environment-evidence.json`.
- **Tests/evidence:** verification/evidence.test.mjs 4/4 includes refusing emulation labeled physical; environment matrix records all physical environments as unverified.
- **Still needed / boundary:** Actual iPhone/Safari/PWA, native Windows companion/installer and later Android proof require the corresponding physical devices and separately authorized runs.

### C1-AA-102

**Original title:** Feature-completion documentation needs revision-specific evidence

**Source:** [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4?pvs=204) · original ID `C1/AA-102`.

**Status:** **fixed and tested**.

- **Expected behavior:** Feature completion evidence identifies exact revision, environment/date, artifacts and remaining blockers.
- **What actually changed:** Feature evidence schema/validator, historical legacy matrix and candidate feature record; older verification becomes historical when revision differs.
- **Affected files:** `scripts/verification/evidence.mjs`; `scripts/verification/validate.mjs`; `docs/verification/feature-evidence.json`; `docs/verification/feature-matrix-legacy.md`.
- **Tests/evidence:** verification/evidence.test.mjs passed: current versus historical revision, complete evidence fields and unverified records; master114-ID checklist and final validation evidence retained.
- **Still needed / boundary:** A supplied evidence URL is checked for consistency, not independently authenticated by the validator.

### C1-AA-103

**Original title:** Release verification requires stronger evidence linking between CI and deployment

**Source:** [C1/M20](https://app.notion.com/p/4231aa276323815eb1e9c95087daece4?pvs=204) · original ID `C1/AA-103`.

**Status:** **fixed and tested**.

- **Expected behavior:** Release evidence links tested SHA, build artifact hash, migration state, deployment/alias and journeys.
- **What actually changed:** Durable release-evidence template and consistency validation for exact SHA/artifact/alias/environment/rollback relationships.
- **Affected files:** `scripts/verification/evidence.mjs`; `scripts/verification/validate.mjs`; `docs/verification/release-evidence.template.json`.
- **Tests/evidence:** verification/evidence.test.mjs passed: wrong CI/build/deployment SHA, artifact/alias/database mismatch, skipped/canceled journey and missing rollback cannot pass.
- **Still needed / boundary:** This branch is not merged or deployed. Integration Codex must collect actual CI, target migration, deployment, production-alias, signed-in journey and rollback evidence later.

### C1-AA-104

**Original title:** Multiple orchestration modes require a common execution-plan contract

**Source:** [C1/M21](https://app.notion.com/p/4231aa2763238116b82eeb6f3e38e85e?pvs=204) · original ID `C1/AA-104`.

**Status:** **fixed and tested**.

- **Expected behavior:** Independent comparisons and synthesis share participant/call/concurrency/authority structure without confusing their behavior.
- **What actually changed:** Common ModelExecutionPlan envelope, explicit dependency order and resource authority; routing and consultation retain different plan kinds.
- **Affected files:** `src/lib/mind/execution-plan.ts`; `src/lib/mind/routing-modes.ts`; `src/lib/mind/model-consult.ts`.
- **Tests/evidence:** Runtime AA104 plan fixture rejects implicit helpers in independent mode and preserves synthesis dependency edges.
- **Still needed / boundary:** A shared envelope is not a fully distributed durable scheduler; actual operations keep their existing receipt systems.

### C1-AA-105

**Original title:** Emergency-stop state has multiple representations requiring explicit authority boundaries

**Source:** [C1/M21](https://app.notion.com/p/4231aa2763238116b82eeb6f3e38e85e?pvs=204) · original ID `C1/AA-105`.

**Status:** **fixed and tested**.

- **Expected behavior:** Durable owner stop authority overrides all workspace/process projections; a stale local state cannot grant permission.
- **What actually changed:** Durable dispatch gates and precise local-request/account-confirmed UI; process-local execution-gate module has no production importer in the inspected source.
- **Affected files:** `src/lib/mind/halt.server.ts`; `src/lib/mind/turn.server.ts`; `src/lib/mind/core-runtime.server.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Runtime source reachability check plus AA057–059 regression coverage; original bypass hypothesis was not treated as an independently reproduced defect.
- **Still needed / boundary:** Preserve fail-closed unavailable-authority handling while integrating alternate runtimes.

### C1-AA-106

**Original title:** Dashboard connection status is assembled separately from operational connector state

**Source:** [C1/M21](https://app.notion.com/p/4231aa2763238116b82eeb6f3e38e85e?pvs=204) · original ID `C1/AA-106`.

**Status:** **fixed and tested**.

- **Expected behavior:** Dashboard and operational surfaces distinguish saved authorization from known operation restrictions and verification.
- **What actually changed:** Shared Notion workspace operation status/projection with page/action/time/cause and permission-repair affordance; scope-aware existing connector identities retained.
- **Affected files:** `src/lib/mind/notion-operation-status.ts`; `src/lib/mind/dashboard/owner-connections.ts`; `src/components/mind/service-board.tsx`; `src/components/mind/notion-workspaces.tsx`.
- **Tests/evidence:** Connector AA001 shared status fixtures; same implementation addresses this consolidation finding without dropping it.
- **Still needed / boundary:** A universal six-dimensional status contract for every future connector is a broader proposal; only inspected implemented connectors are claimed.

### C1-AA-107

**Original title:** Core execution summaries use different definitions of active work

**Source:** [C1/M21](https://app.notion.com/p/4231aa2763238116b82eeb6f3e38e85e?pvs=204) · original ID `C1/AA-107`.

**Status:** **fixed and tested**.

- **Expected behavior:** Execution counts use the same named states for running, queued, approval/external waits, cancellation and unresolved work.
- **What actually changed:** Shared countRuns category function used by core pass summary; active explicitly means unresolved in that response.
- **Affected files:** `src/lib/mind/core-runtime.ts`; `src/lib/mind/c1-runtime-regressions.test.ts`.
- **Tests/evidence:** Runtime AA107 fixture includes waiting and paused states in unresolved totals.
- **Still needed / boundary:** Confirm every dashboard consumer renders the category meanings; do not equate unresolved with CPU-active execution.

### C1-AA-108

**Original title:** Model evaluation records need a shared evidence model

**Source:** [C1/M21](https://app.notion.com/p/4231aa2763238116b82eeb6f3e38e85e?pvs=204) · original ID `C1/AA-108`.

**Status:** **fixed and tested**.

- **Expected behavior:** Subjective ratings link to actual execution/model/task context without automatically changing provider routing.
- **What actually changed:** Exact execution snapshot joins subjective rating to server plan, requested/reported models, primary/helper usage and provider/resource request IDs. Chat/usage/rating share executionId; factual/task/tool/billing proof remains independently unknown until verified.
- **Affected files:** `src/lib/mind/execution-evidence.ts`; `src/lib/mind/execution-evidence.test.ts`; `src/lib/mind/routing-modes.ts`; `src/lib/mind/types.ts`; `src/lib/mind/workspace.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** Runtime completion: 40/40 tests including production synthetic SSE→workspace reload→rating/exact execution join; 15-case routing/durable follow-up also passed.
- **Still needed / boundary:** Ratings never change routing automatically and are not billing/factual proof. Live provider invoice reconciliation remains separate.

### C1-AA-109

**Original title:** Video completion lacks the account-continuity guard used by other operations

**Source:** [C1/M22](https://app.notion.com/p/4231aa276323813da4e1cba1752ca724?pvs=204) · original ID `C1/AA-109`.

**Status:** **fixed and tested**.

- **Expected behavior:** Late video completion cannot mutate a different account or a later operation.
- **What actually changed:** Owner/session epoch and operation ticket guard progress, result, failure and cleanup; durable media receipt remains owned by the original account/chat.
- **Affected files:** `src/lib/mind/operation-scope.ts`; `src/components/mind/command-app.tsx`; `src/lib/mind/media/operations.server.ts`.
- **Tests/evidence:** operation-scope.test.ts 3/3 and media operations4/4: A→B→A and fresh same-owner sessions invalidate stale progress/results/cleanup; accepted jobs stay owned by their original account.
- **Still needed / boundary:** No live delayed video or authenticated account was tested; actual callbacks use the tested operation ticket.

### C1-AA-110

**Original title:** Stale image-operation cleanup can interfere with a newer Chat operation

**Source:** [C1/M22](https://app.notion.com/p/4231aa276323813da4e1cba1752ca724?pvs=204) · original ID `C1/AA-110`.

**Status:** **fixed and tested**.

- **Expected behavior:** An old image completion/finally callback cannot clear a newer Chat or media operation state.
- **What actually changed:** Per-kind tickets plus generation identity gate cleanup and result application; finish succeeds only for its own active ticket.
- **Affected files:** `src/lib/mind/operation-scope.ts`; `src/components/mind/command-app.tsx`.
- **Tests/evidence:** operation-scope.test.ts 3/3: older image cleanup cannot finish a newer ticket; CommandApp also requires its captured chat generation before clearing Chat state.
- **Still needed / boundary:** Actual physical/provider concurrency remains unverified; no synthetic response is labeled a real generation.

### C1-AA-111

**Original title:** Research success and failure paths apply different account-continuity rules

**Source:** [C1/M22](https://app.notion.com/p/4231aa276323813da4e1cba1752ca724?pvs=204) · original ID `C1/AA-111`.

**Status:** **fixed and tested**.

- **Expected behavior:** Research success and error paths obey the same account/session/request identity.
- **What actually changed:** Research operation ticket checked in success, catch and finally; original configuration receipt retained on retries.
- **Affected files:** `src/lib/mind/operation-scope.ts`; `src/components/mind/command-app.tsx`; `src/lib/mind/research-service.server.ts`.
- **Tests/evidence:** operation-scope.test.ts plus research configuration/retry tests passed; success, failure and finally use the same current-ticket condition.
- **Still needed / boundary:** Source-bound client callback wiring plus isolated timing fixtures; no real late research request was issued.

### C1-AA-112

**Original title:** Account identity alone does not distinguish successive sessions of the same account

**Source:** [C1/M22](https://app.notion.com/p/4231aa276323813da4e1cba1752ca724?pvs=204) · original ID `C1/AA-112`.

**Status:** **fixed and tested**.

- **Expected behavior:** A→B→A and successive sessions of one account remain distinguishable for pending callbacks.
- **What actually changed:** Ephemeral operation epoch includes a non-secret immutable cookie session identity, so same-owner reauthentication differs from token refresh. Every operation ticket still binds owner/session/generation.
- **Affected files:** `src/lib/auth/session-identity.ts`; `src/lib/auth/client.ts`; `src/lib/mind/operation-scope.ts`; `src/lib/mind/operation-scope.test.ts`; `src/components/mind/command-app.tsx`; `src/lib/auth/use-current-user.ts`.
- **Tests/evidence:** Root reported 3/3 operation-scope fixtures including real cookie-session identity reauthentication and token-refresh continuity; server auth identity tests retained.
- **Still needed / boundary:** No real account switch or physical device claimed; final integration test evidence belongs below.

### C1-AA-113

**Original title:** Media concurrency uses separate guards without a demonstrated shared execution policy

**Source:** [C1/M22](https://app.notion.com/p/4231aa276323813da4e1cba1752ca724?pvs=204) · original ID `C1/AA-113`.

**Status:** **fixed and tested**.

- **Expected behavior:** Independent operations have explicit ownership/concurrency rules and cannot interfere through shared cleanup flags.
- **What actually changed:** Per-kind registry separates image/video/research work while shared account/epoch authority invalidates all stale work; per-provider resource budgets still govern dispatch.
- **Affected files:** `src/lib/mind/operation-scope.ts`; `src/components/mind/command-app.tsx`; `src/lib/mind/resource-governor.server.ts`.
- **Tests/evidence:** operation-scope.test.ts 3/3 covers independent Chat/research tickets and invalidation; SQL resource tests enforce shared reservations across operations.
- **Still needed / boundary:** This browser operation registry is not a full background task manager or a claim of browser-closed execution.

### C1-AA-114

**Original title:** Notion search provides an existing stronger pattern for stale-response protection

**Source:** [C1/M22](https://app.notion.com/p/4231aa276323813da4e1cba1752ca724?pvs=204) · original ID `C1/AA-114`.

**Status:** **already fixed with proof**.

- **Expected behavior:** Preserve the existing stronger Notion request+connection-epoch+owner pattern and reuse its invariant elsewhere.
- **What actually changed:** Existing searchConnectedNotion current() checks retained; generalized operation scope applies that principle to media/research. This source entry was a positive control, not another invented Notion defect.
- **Affected files:** `src/components/mind/command-app.tsx`; `src/lib/mind/operation-scope.ts`; `src/lib/mind/operation-scope.test.ts`.
- **Tests/evidence:** Original Notion search current() guards retained; operation-scope.test.ts3/3 proves generalization used by media/research, including fresh same-owner session identity.
- **Still needed / boundary:** Positive control retained; no new Notion defect claimed. Live provider/device proof remains separate.
