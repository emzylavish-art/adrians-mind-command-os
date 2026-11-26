# C1 local browser evidence

**Tested implementation:** `b17e90c5728f7f1a9f303f703fcf073cbdd2175e` ([exact local commit record](../c1-validated-source.commit.txt)), clean worktree at the start of both runs. These files were added afterward as evidence metadata. They do not claim that a later integration revision, live deployment, real account, provider or physical device was tested.

## Results

- [Fourteen-state report](report.json): seven synthetic states at desktop 1440×1000 and mobile 390×844; **14 passed**, zero axe violations, document overflow, overflowing controls, small targets or failed destinations. No waiver or provenance error. Recorded `2026-11-26T03:42:46.797Z`.
- [Transition report](transitions.json): **11 passed**, zero failures. Long chat navigation, older-message focus, streamed Markdown, editor symbols/dependencies, drawer focus/current state, themes, asynchronous page restoration, reduced motion/resize, lazy modules and delayed/rejected/accepted video receipts. Recorded `2026-11-26T03:44:44.359Z`.
- [Scoped environment evidence](environment-evidence.json): actual **Chromium 153.0.8010.0**. Mobile is emulation. Authenticated preview/production and physical devices remain unverified.
- Auth configuration invariant passed after both runs: the local dev server and build flag both had sign-in off. It does not establish authenticated account behavior.
- [Artifact manifest](manifest.json) lists SHA-256 checksums and byte lengths for retained reports and screenshots.

The reports' `revision` and `dirty:false` fields identify the source that was actually exercised. A metadata-only commit containing these artifacts has a different Git SHA; use the recorded implementation SHA when assessing this evidence. The visual policy result applies to the listed synthetic captures. Production release approval additionally needs the separate CI, build, migration, deployment, signed-in journey and rollback evidence.

## Isolation

Vite and Chromium ran as siblings on an isolated `127.0.0.1:4199` preview. The app used private temporary storage, `NODE_TEST_CONTEXT=mind-fixture`, `VITE_AUTH_ENABLED=false`, and no real provider/database credentials. The browser fixture fulfilled or refused every API/RPC request and blocked other origins, WebSockets and service workers. All displayed identities, workspace records, model receipts and video responses are synthetic. Preview/browser processes were stopped after each run.

The video URL intentionally cannot fetch a real asset. Its screenshot demonstrates receipt/progress and the unavailable-playback state, not generation or playback of an actual video. Pending-start durations use Playwright's synthetic clock.

## Representative captures

| Scenario | Capture |
|---|---|
| Read-connected Notion with denied append permission | [Mobile Plugins](mobile-fixture-plugins-permission-denied.png) |
| Reviewed Build save rejects a stale revision | [Desktop Build conflict](desktop-fixture-build-revision-conflict.png) |
| Unsaved syntax navigation retains the source buffer | [Symbol/dependency navigation](transition-build-buffer-symbol-and-dependency.png) |
| Drawer identifies the current page and traps focus | [Mobile drawer](transition-mobile-drawer-open.png) |
| Settings returns to its actual reading position | [Restored Settings](transition-page-reading-position.png) |
| Pending video start does not imply provider acceptance | [Submitting video](transition-video-rejected-submitting.png) |
| Synthetic accepted receipt reaches a completed state | [Completed receipt / blocked asset](transition-video-delayed-start-accepted.png) |

Every passed check's screenshot filename is retained beside its report, including the additional light/dark, open-drawer and pending-video captures. Screenshots are viewport captures; longer screens continue through their normal scroller.

## Earlier failures

[prior-failures.json](prior-failures.json) is an extracted, explicitly **dirty-worktree historical record** from before the final corrections. It preserves Settings restoring 1117 instead of 1600 while content was still growing, and video progress being absent because the previous notice renderer depended on queued messages. The three corresponding failed screenshots are retained separately. These failures prompted the pending-position restoration hook and dedicated chat/owner/session-scoped video progress. The final clean-source reports above supersede them.

The executable reproduction commands and boundaries are in [the verification checklist](../../c1-verification.md) and [the runner guide](../../../verification/README.md).

## GitHub publication

The authenticated GitHub upload assigned a new commit identity to the identical source tree. See [publication identity proof](../../c1-publication.md); the raw reports above preserve the actual local revision that ran. This does not relabel a local fixture as a production check.
