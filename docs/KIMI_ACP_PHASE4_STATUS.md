# Kimi ACP Phase 4 — implementation status

**State: Phase 4 adapter foundation implemented; live end-to-end acceptance is not complete.** This checkout does not contain the Phase 1–3 worker/workspace/API claimed in the handoff, and no Kimi executable or attached Windows device is available here. This note distinguishes completed local code from runtime work that cannot be verified in this environment.

## Implemented on the local branch `manus/phase4-kimi-adapter`

- `src/lib/mind/kimi/acp-phase4.ts` builds a bounded inventory from the actual ACP `initialize` response. Only explicitly returned booleans are surfaced; absent values remain unknown. `session/fork` and `session/load` are only shown as advertised when the response explicitly supplies a supported-method list; the code does not infer them from a version string.
- The same module normalizes `session/update` into compact Timeline events for user-visible assistant text, tool-call lifecycle, plan progress counts, and unknown updates. It omits tool arguments/results and raw event payloads; private reasoning/thinking update types are suppressed, and plan text is never emitted.
- MCP projection is fail-closed. A server is emitted only when it is enabled, explicitly owner-approved, has an allowlisted command, has no unresolved secret environment, and the caller explicitly marks stdio as runtime-verified. HTTP/OAuth and built-in connections remain unmapped pending transport/auth verification.
- `src/components/mind/kimi-phase4-panel.tsx` renders actual reported capability flags, fork/load evidence, and normalized activity. It is mounted in the existing Build view. Since this checkout has no Kimi initialize/event source, the current page passes `null` and an empty event list; it truthfully displays “waiting/unknown” rather than fabricated availability.
- Nine focused tests cover capability evidence and bounds, session method uncertainty, safe event normalization, private reasoning suppression, tool payload omission, MCP owner approval/allowlist/transport/secret gates. The Phase 4 test file is included in `npm test`.

## Verification

- Phase 4 tests: **9/9 passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed (with existing dependency/CSS warnings; no build error).
- ESLint on the new adapter, its tests, and the new panel: passed with zero warnings.
- Full `npm test`: 1,335 passed; six tests in the unchanged `src/lib/mind/service-board-status.test.ts` cancel because a Promise remains pending after the Node event loop resolves. Running that file alone reproduces the same six cancellations. The Phase 4 tests pass within the full test run.

## Remaining acceptance gates (not safely closable from this checkout)

1. Restore the uncommitted Phase 1–3 files named in the handoff (`agent/windows/KimiAcpClient.mjs`, `src/components/mind/build-workspace.tsx`, and `src/routes/api/mind/kimi/`). They are absent from all inspected GitHub branches; the recording exposes only partial OCR source and no workspace source. The adapter is not connected to the original worker callback or event store.
2. Run `kimi --version` and an ACP handshake on the actual paired Windows device. Feed its real `initialize` response and `session/update` stream to the panel. Until this happens, displayed capabilities and `session/fork`/`session/load` must stay unknown.
3. Exercise `session/fork` and `session/load` on that exact installed version, including restore/error behavior. No fork/load call is made by this patch.
4. Verify Kimi ACP's actual MCP transport schema and credentials path, then connect the Adrian registry through its authenticated server-side policy. The current mapper deliberately returns no server by default because it has no verified transport, approval, or secret resolver connected.
5. Re-run the complete regression suite after restoration; investigate the six service-board cancellations separately.

## Repository hygiene

Changes are local and uncommitted on `manus/phase4-kimi-adapter`, branched from `main`. Nothing has been pushed. No Phase 1–3 file was reconstructed or overwritten.