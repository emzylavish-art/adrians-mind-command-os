# Handoff for the Manus session holding Adrian OS Phases 1–3

**Do not redo Phases 0–3.** This session implemented the Phase 4 adapter layer on local branch `manus/phase4-kimi-adapter`, based on `main`, because the claimed Phase 1–3 files were not present in its checkout or any inspected GitHub branch. The adapter is ready to integrate into the original Phase 1–3 working tree, but it is not live-connected yet.

## Files from this session

- `src/lib/mind/kimi/acp-phase4.ts` — safe initialize capability inventory, fork/load evidence, `session/update` normalization, and fail-closed MCP server projection.
- `src/lib/mind/kimi/acp-phase4.test.ts` — nine focused contract/security tests; included in the standard `npm test` command.
- `src/components/mind/kimi-phase4-panel.tsx` — capability/activity UI panel.
- `src/components/mind/command-app.tsx` — panel mounted in the current Build placeholder with `initializeResponse={null}` and no events. Replace that placeholder integration with the real Phase 3 Build workspace data flow; do not keep the null/empty inputs once the real session source is available.
- `package.json` — includes the new Phase 4 test in the test list.
- `docs/KIMI_ACP_PHASE4_STATUS.md` — detailed status, verification, and gates.

## Integrate into the Phase 1–3 tree

1. Copy/merge the adapter module and tests; reconcile the single `package.json` test-list addition.
2. In the real `KimiAcpClient.mjs`/session API, pass the actual ACP `initialize` response to the capability panel/state store. Do not infer absent capability fields or version support.
3. Feed every actual `session/update` event through `normalizeSessionUpdate` and append its safe result to the existing Timeline/event store. Keep private reasoning suppressed; never forward tool args or raw results to the UI.
4. Run `kimi --version` on the paired Windows device and capture the real initialize response. Test `session/fork` and `session/load` on that exact version; until observed, display those methods as unknown, not supported.
5. Verify Kimi's actual MCP transport/config schema. Only then call `mapApprovedMcpServers` with explicit owner-approved server IDs, allowlisted commands, and verified transports. The current mapper intentionally refuses unverified transports, HTTP/OAuth, and unresolved environment secrets. Connect secrets only through the existing trusted server-side resolver; never place them in browser state or logs.
6. Run focused adapter tests, typecheck, build, then the Phase 1–3 ACP/file/terminal/cancel regression tests and a real Windows ACP smoke test. Do not report Phase 4 complete until the capability UI and Timeline receive real runtime events and the session/MCP acceptance checks pass.

## Validation from this session

- Phase 4 focused tests: **9/9 passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- ESLint on the new adapter/test/panel files: passed with zero warnings.
- Full `npm test`: 1,335 passed; six cancellations reproduce in the unchanged `src/lib/mind/service-board-status.test.ts` when run alone. Recheck after merging.

## Important state

No Kimi executable or paired Windows device was available here. The repository on this branch lacked `agent/windows/KimiAcpClient.mjs`, `src/components/mind/build-workspace.tsx`, and `src/routes/api/mind/kimi/`. The screen recording only supplied partial OCR, not a trustworthy complete source file. Nothing was reconstructed over Phases 1–3. The adapter branch is local, uncommitted, and not pushed.
