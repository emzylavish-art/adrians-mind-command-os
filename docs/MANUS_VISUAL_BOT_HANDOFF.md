# Adrian’s Mind OS handoff for Manus

Work branch `codex/visual-qa-foundation`, based on `e1c88b2`. Merge the changes from this branch into your existing work. The implementation lives in the branch, including the generated asset and the Playwright journeys.

## Implemented

| Surface | Changes to carry forward |
| --- | --- |
| Bots and agents | A saved bot has a stable ID, instructions, optional project context, selected local run tools, and an explicit capability check. Open chat reuses the linked conversation. New conversation creates another thread. Edit increments the version, Duplicate makes a separate draft, and Archive and Restore keep existing history. Active runs block configuration changes. |
| Runs and schedules | Bot actions preselect the right agent. The browser worker limits project-scoped local reads to the selected project. Run history and Needs attention are visible. The schedule form validates agent, hour, and time zone. Archived bots are marked as blocked and a job can be reassigned. |
| Navigation | Browser Back and Forward restore application sections. Search and pins focus the selected bot, project, run, or file where applicable. Related diagnostics sit under their own disclosure on the bot screen. |
| Chat and media | Mobile rename has Save and Cancel. Editing a message opens a separate edited conversation and keeps the original transcript. Starter actions preserve typed text. Attachments can be removed before sending. Answer tabs support arrows, Home, and End. Code headings stay outside the horizontal scroll area. The image viewer supports Escape and returns focus. Imagine edit has an independent prompt and shows the failure where the user can retry it. |
| Library and Projects | Opening a file reveals its preview. Project cards link to project-scoped chats, files, and notes. Library accepts PDF text and shows partial copies. A full library asks the owner to free a slot before accepting another upload. |
| Research, Explore, and Skills | Research blocks blank and duplicate requests and preserves the visible report on failure. Explore has pressed category states and query-specific empty states. Skill cards show their own run results and disable inactive runs. |
| Settings and recovery | Appearance follows changes in system preference and its reset affects the theme. Voice reset updates the selected voice. Provider entry clears credentials when switching provider or endpoint and offers a complete discovered-model selector. Help links to Safe Keys. Local owner-key copy displays configured, missing, copied, and clipboard error states. Memory transfer opens the archive pane directly. Archive import shows counts and matches before confirmation. The server-copy overwrite has a separate confirmation. |
| UI and accessibility | Bot creation and management come first on the page. Theme-aware cards and buttons keep labels legible. The original generated template illustration is under the template disclosure. The branch includes the reusable audit skill and checks for horizontal overflow, navigation failures, and axe findings. |

## Reproduce the checks

Use an isolated checkout with dependencies installed and no live provider credentials. Start each preview before its corresponding browser test. The clipboard preview uses a synthetic key that the test compares in Chromium. The browser tests block workspace synchronization and keep their data in disposable browser contexts.

```sh
NODE_TEST_CONTEXT=visual-audit node_modules/.bin/vite --host 127.0.0.1 --port 4195 --strictPort
```

```sh
node scripts/visual/bot-journey.mjs
BASE_URL=http://127.0.0.1:4195 VISUAL_ARTIFACT_DIR=/tmp/mind-os-visual-audit npm run visual:audit
npm run typecheck
npm run check:auth -- --dev-url http://127.0.0.1:4195
```

```sh
NODE_TEST_CONTEXT=visual-audit XAI_API_KEY=visual-audit-fixture-only-copy-sentinel node_modules/.bin/vite --host 127.0.0.1 --port 4196 --strictPort
```

```sh
node scripts/visual/workspace-recovery.mjs
```

The repository test script completed with 226 script tests and 1,347 source tests passing. Four checks were skipped by the test runner. The run used the package test arguments with Node test concurrency capped at six and a temporary directory for the PGlite fixtures.

The Playwright navigation sweep covered 68 desktop and mobile states across both themes. It recorded zero navigation failures, horizontal document overflow, and axe findings in that sweep. The focused journeys completed the local bot lifecycle and verified PDF preview, clipboard copy, browser history, and archive preview and cancellation. The development build completed locally and reported bundle-size and dependency directive warnings.

## Screenshots

- [Before and after in desktop light mode](visual-proof/bots-before-after.webp)
- [Templates and saved bot in mobile dark mode, builder in desktop light mode](visual-proof/bot-journey.webp)

## Merge and release gates

- Reconcile `command-app.tsx`, `fleet-panels.tsx`, `workspace.ts`, and `fleet.ts` against your unpushed work. Keep the shared bot ID and backward-compatible workspace fields. Retain the archive and clipboard safety gates when resolving conflicts.
- Owner keys can be copied from the machine that hosts the local preview. Hosted recovery of saved provider or MCP credentials remains an authenticated storage design decision. The clipboard test used one synthetic owner key.
- Bot conversations use Chat’s selected model. Changing a bot’s instructions applies to new conversations. Per-bot model configuration, uploaded bot knowledge, publishing and sharing, and hosted scheduling or external action parity require separate implementation and account checks.
- Provider credits, Paperclip and hosted worker availability, real MCP connection and execution, OAuth, and media generation still need live environment validation. The local workflow verifies the behavior that is available in the browser. The deployment remains with Manus.
