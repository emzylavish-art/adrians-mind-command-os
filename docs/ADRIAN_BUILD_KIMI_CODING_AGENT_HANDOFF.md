# Coding Agent Handoff — Adrian Build / Kimi Code

## Assignment

Implement the Adrian Build Kimi Code integration described in:
- `docs/ADRIAN_BUILD_KIMI_BLUEPRINT.md`
- `docs/ADRIAN_BUILD_KIMI_FEATURE_MATRIX.md`

Work on branch `feature/adrian-build-kimi-integration`. Do not commit to `main` or deploy production.

## First actions — mandatory

1. Read root `AGENTS.md`, `ENGINEERING.md`, `README.md`, and this handoff.
2. Fetch latest `main` and confirm branch ancestry/current SHA; do not assume the handoff baseline is still current.
3. Inspect actual Build sidebar wiring and route. Search `src/components/mind/command-app.tsx`, navigation registries, route definitions and tests. The route listing at blueprint time did not show a standalone build route.
4. Inspect existing PC pairing, approval, audit, provider router, MCP, voice/Speak, session persistence and event-stream code. Reuse existing abstractions.
5. Inspect official Kimi upstream source at https://github.com/MoonshotAI/kimi-code and its current docs. Record exact current release/tag, commit SHA, package manager/runtime requirements, Windows support, license and supported interfaces. Do not assume stale API docs or invent REST/WebSocket endpoints.
6. Produce a concise Phase 0 report with file-level plan, architecture decision, dependency/licence analysis, feature matrix and baseline tests before broad code edits.

## Implementation rules

- Preserve existing Adrian OS architecture and all current features.
- Use isolated, small commits on this branch.
- Never write secrets into repository files, tests, logs or screenshots.
- Do not access forbidden Supabase projects `ybxowvzicirinpdcfyqe` or `espmxiitzucooxblmnpr`.
- Do not alter Vercel secrets, run production migrations or deploy production.
- Do not claim an integration is live from code presence or mocks.
- Add tests with every adapter/security/data change.
- Run repository standard validation from `AGENTS.md`; report exact commands and results.
- Distinguish unit/mock, local runtime, Windows companion, provider, MCP, hardware voice and deployment verification.
- Preserve Kimi MIT licence/copyright and upstream notices.
- Do not add a separate coding agent UI or iframe-only shortcut.
- If a feature cannot be integrated in the current phase, mark it honestly in the feature matrix with blocker and next action.

## Required first proof of value

Before building the complete UI, produce a working vertical slice:
1. Adrian-authenticated Build route (or existing Build surface).
2. Paired local runtime status.
3. Create Kimi session in an approved project.
4. Send one prompt and stream actual response/tool events.
5. Edit one test file in the workspace and show a diff.
6. Run a harmless project command and stream output.
7. Stop/cancel and reconnect without duplicate execution.

This vertical slice must use the real pinned Kimi runtime, not a fake adapter.

## Required final report

- Commit/branch and changed files.
- Upstream Kimi version and SHA.
- Architecture and API/protocol used.
- Features VERIFIED / PARTIAL / UNSUPPORTED / BLOCKED.
- Exact test commands and pass/fail/cancel counts.
- Windows Companion installation/test state.
- Security and owner-isolation evidence.
- Remaining owner-only tasks (credentials, hardware, approvals, deployment).
- Preview link only if a preview was actually deployed and verified.
