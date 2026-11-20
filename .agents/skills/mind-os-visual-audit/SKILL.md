---
name: mind-os-visual-audit
description: Audit Adrian's Mind OS visually and behaviorally using Playwright. Use for do analysis, continue analysis, visual QA, generic design review, or execute when it refers to the visual audit backlog.
---

# Mind OS visual audit

Read AGENTS.md. Treat “do analysis” as a read-only product audit using isolated browser data. Treat “continue analysis” as the next unexplored surface or materially different failure mode. “Execute” authorizes implementation of the active audit backlog. Follow the current instructions for GitHub pushes and leave deployment to Manus unless explicitly directed otherwise.

For deep passes, use [Advanced audit drills](references/advanced-audit-drills.md). Start with its harness preflight, then choose drills based on the journey's specific risks. Capture a normal run and a stressed run. Add one case suggested by what you observed, even if it is absent from the checklist. Research unfamiliar behavior against primary sources before calling it a bug. Research, skill updates, and recommendations do not authorize product edits or asset generation.

## Start each pass

1. Identify the branch, commit, running app, and existing findings. Preserve unrelated work. Use the repo's own Playwright setup where available. Verify the URL shows Mind OS before collecting evidence.
2. Inventory routes, navigation entries, and controls behind menus, tabs, disclosures, dialogs, permissions, and feature states. Include direct links, mobile navigation, and alternate entry points. Use the authorized repository's offline REA source inventory when it helps map ownership. Confirm its output against browser behavior.
3. Pick a journey and state the user goal. Review it through design, accessibility, interaction, responsive layout, and data lifecycle lenses. Consult coverage before choosing. Follow newly discovered dependencies or surprising behavior when they change the diagnosis.
4. Use a disposable browser context with sample data and mocked external responses. Never put real keys or private content in screenshots, traces, fixtures, or logs. Keep external provider and MCP checks at the UI contract level when credentials, credits, or authorization are unavailable.

## Test the journey

- Capture desktop, tablet, and narrow/short mobile states. Check default dark and light, zoom/reflow, reduced motion, long text and filenames, and narrow or translated labels. Check the software keyboard on a real device when available. Record emulation limits.
- Inventory actionable controls by role and accessible name. For each reachable control in scope, record what opens, where focus goes, what changes, and how to return. Exercise Escape, outside click, Back, reload, and opening a competing panel. Check stacking, clipping, scroll lock, focus restoration, and whether overlays intercept nearby controls.
- Try initial, empty, populated, loading, success, validation error, timeout, unavailable, retry, canceled, partial, and permission-denied states where relevant. Use slow or reordered responses, rapid repeat clicks, switching items mid-request, and reopening saved data. Verify the displayed result belongs to the initiating item or request.
- Check focus visibility, keyboard order, visible labels, target size, readable contrast in both themes, accessible status announcements, and whether instructions depend only on color. Use the ARIA pattern that matches actual behavior. Automated accessibility checks supplement keyboard and visual inspection.
- Verify save and reopen, navigation state, copy feedback, preview completeness, and undo/recovery. For destructive controls, inspect confirmation and use disposable fixtures. Make sure the interface explains scope, consequences, and recovery before committing.

## Review visual quality with screenshots

1. Capture the page before and after the interaction. Take viewport images for hierarchy and clipping, component crops for detailed defects, and full-page images for overall structure when useful. Record viewport, browser, theme, route, fixture, and state.
2. Open the actual images with an image viewer and inspect them. Look at the first visible action, usable space, alignment, contrast, typography, wrapping, and what competes for attention. Share representative images in chat with a caption describing the state and what to look at. If capture or image inspection is unavailable, report that explicitly.
3. Flag generic visual patterns with examples: redundant hero headings, boilerplate copy, repeated badges, identical card shells, oversized empty-state art, unrelated glow or gradients, vague labels, and unofficial logos. Ask what each element helps someone understand or do. Keep headings, actions, metadata, and help in an order that matches the task. Put secondary detail where it can be opened when needed.
4. Use authentic brand assets from official sources where usage terms permit. Track provenance and check light/dark legibility. Generate original product artwork only when a concrete state or feature benefits from it. Set subject, composition, palette, crop, and intended size before generation. Review results in context, supply useful alt text or mark decoration appropriately, and check asset size. Keep decorative artwork out of task-dense controls and errors.

## Maintain coverage and report

Track surface, entry point, role, state, browser/theme/viewport, control, expected and observed behavior, evidence, and remaining cases. Mark each result browser-reproduced, source-confirmed, design proposal, or blocked/unverified. Reuse the ledger on future passes and retest a known issue only when confirming a new condition or a fix. Report actual scope and avoid claiming whole-site coverage from a sample.

Prioritize data loss, misleading states, blocked tasks, and inaccessible controls ahead of cosmetic details. For each finding give reproduction steps, impact, plausible cause with a source location, proposed structure or behavior, and a concrete acceptance check. Include a short list of what still needs coverage.

## Mind OS backlog to reconcile with the current branch

- Archive and recovery: inventory completeness, conflict and replacement previews, readable errors, processing, cancellation, and completion.
- Explore and agents: redundant headings and filters, query-aware empty states, keyboard controls, and local persona-to-Chat handoff. Verify agent creation, reopening, and allowed local behavior separately from remote runtime claims.
- Research: blank submit, in-flight races, report identity, source grouping, saved reports, and follow-up context.
- Safe Keys, API connections, and MCP: differentiate missing, configured, unavailable, and local-only copy. Verify fake-key copy, per-row feedback, concurrent actions, authorization, and recovery. Keep product labels and official brand identities accurate.
- Chat: reply visibility, long content, compact composer, menu exclusivity, focus, keyboard occlusion, and attachments.
- Library: list-to-preview handoff, persistent partial-copy indication, file capacity, and long-content reading.
- Reconcile previously fixed Projects, Activity, Scheduled, upload, and command-palette flows if related changes touch them. Expand coverage to remaining navigation, settings, notifications, dashboards, and empty or unavailable states.

## Execute and hand off

Capture the baseline, check for Manus overlap, and implement the confirmed backlog on the work branch. Fix shared layout or component causes once. Preserve user data and existing behavior outside scope. Use stable role/name locators, wait for observable UI states, and compare screenshots under the same browser, theme, viewport, and fixture. Keep traces for failures and inspect visual diffs before updating any baseline. Rerun the affected journeys, relevant repository checks, and nearby regressions. Share before/after images, pass/fail evidence, remaining limitations, and the branch and commit. Give Manus a copyable note with scope, merge pointers, and work already completed.

## References

- [Playwright best practices](https://playwright.dev/docs/best-practices), [visual comparisons](https://playwright.dev/docs/test-snapshots), and [Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) for reflow, focus visibility, target size, and status messages
- [GOV.UK error messages](https://design-system.service.gov.uk/components/error-message/) and [error summary](https://design-system.service.gov.uk/components/error-summary/) for concise recovery guidance and retaining input
