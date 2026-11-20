# Advanced audit drills

## 1. Prove the harness reached the intended screen

- Check the origin and unique app marker first. Use a disposable browser context. Capture the build identifier, browser channel, viewport, theme and fixture names. Confirm the actual theme after hydration. Wait for a screen-specific heading, selected control, or ready state before capture. For visual comparison, use matching engines, OS, fonts and devices; wait for required fonts and images.
- The current repository's `BASE_URL=<verified-local-origin> npm run visual:audit` is a navigation and axe sweep. Inspect its state list and failures. At the time of research, the runner searches inside `aside` even after opening the mobile menu. Check the current drawer's structure and use role and name locators in a focused Playwright run when the sweep cannot reach it. Confirm the expected destination heading after every navigation. A failed locator is a coverage gap until diagnosed.
- Use real Edge via Playwright's `msedge` channel when available and record when using bundled Chromium instead. Use WebKit for a cross-engine sample, and a real phone for soft-keyboard, safe-area and browser-toolbar behavior. A small desktop viewport and WebKit emulation cannot establish how these work on an actual iPhone.
- Use Playwright for journey behavior and visual artifacts, the existing axe integration for automated accessibility checks, and DevTools traces for movement and responsiveness. Use an existing component harness for isolated state matrices if one is already present. Avoid adding competing runners for the same job.

Sources: [Microsoft Edge and Playwright](https://learn.microsoft.com/en-us/microsoft-edge/playwright/), [Playwright actionability](https://playwright.dev/docs/actionability), [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots), [axe-core](https://github.com/dequelabs/axe-core), [Storybook testing](https://storybook.js.org/docs/writing-tests/).

## 2. Find why a button moved or stopped receiving clicks

1. Record the intended target and adjacent controls at rest, immediately after interaction, and once the UI settles. For asynchronous actions, hold a mocked response and capture pending and resolved states separately. Take a screenshot and record control bounds, document and local container scroll positions, and the actual hit-tested element at the intended tap point. Check that any movement is a predictable consequence of the action.
2. If a normal Playwright click times out, inspect which element intercepted the click and whether the target was still animating. Avoid forced clicks because they hide exactly this class of failure. Inspect overflow clipping, stacking contexts, invisible overlays, sticky boundaries, and focus hidden under fixed chrome. Open panel A, open B, dismiss B, and check which control has focus and whether A stays open by design.
3. In browser Performance tools, record the interaction. Identify what moved and what caused the movement: a banner insertion, font swap, image decode, spinner replacement, or content reflow. Compare screenshots during the action because some user-triggered movement does not count toward CLS. For sluggish controls inspect the interaction trace and compare input delay, handler time, and next-paint delay where measurable. Label results as local measurements and reserve population-level claims for field data.
4. For a short mobile Chat thread, exercise writing, multiline expansion, scrolling up while a fixture streams, returning to the latest reply, opening More, and showing/hiding the keyboard. Measure usable conversation space and visible composer position against the visual viewport, not just document height. Repeat with a long code block and a large attachment label. Check that delayed content never steals a tap or pulls someone away from a reply they are reading.

Sources: [Debug layout shifts](https://web.dev/articles/debug-layout-shifts), [Optimize CLS](https://web.dev/articles/optimize-cls), [Optimize INP](https://web.dev/articles/optimize-inp), [Chrome mobile viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior), [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion/).

## 3. Audit the gap between UI state and data state

Make a before → pending → outcome → retry/reopen matrix. Tie each transition to the initiating item and action. Mock the application's local boundary with Playwright routing or approved server fixtures. Browser routing does not control server-to-provider requests, so use a server-side fixture or stop at the UI boundary when necessary. Track whether a test hit its mock. Keep fake keys and test records isolated.

| Journey | Stress case | Expected user-visible behavior |
| --- | --- | --- |
| Chat / Research | Start request A then B, let B finish first, switch report while A is pending | The active result still belongs to the active item. Pending and error states appear in context. Draft and prior content survive failures. |
| Safe Keys / APIs / MCP | Missing, configured, local-only, expired, unavailable, timeout, retry | Each row explains its actual state and next allowed action. Copy success matches the fake key and the clicked row. An empty inventory differs from a failed check. |
| Library / Archive | Long name, partial copy, duplicate ID, limit reached, cancel, reload | The preview opens and truthfully describes what is retained or replaced. Navigation and focus recover. Cancellation leaves the fixture unchanged. |
| Bots / Agents / Scheduled | Local creation, reopening, missing prerequisite, duplicate submit, approval or failure | The saved item is visible and attributable. Controls reflect the current lifecycle. Connected status has evidence separate from local creation. |
| Streaming / dashboard | Partial response, missing series, reconnect, stale status and slow asset | Current, partial, and stale states are distinguishable. Useful context remains readable and pending updates cannot overwrite the wrong view. |

Retest a failed action from its visible recovery control. Verify it uses the original input or explains that input changed. Look for silent fallback, contradictory status, double submission, false success, and a result that only looks saved until reload. Confirm behavior only in the environment tested.

Sources: [Playwright API mocking](https://playwright.dev/docs/mock), [GOV.UK error messages](https://design-system.service.gov.uk/components/error-message/), [Atlassian message patterns](https://atlassian.design/foundations/content/designing-messages).

## 4. Identify information hierarchy and generic design

- Give a reviewer a task without naming a button. On a first-viewport screenshot, identify the title, next likely action, current state, and destination to return to. Measure how far down the first useful item starts and count steps to get there. With actual participants, record completion, wrong turns, and observations; label an agent's walkthrough as a heuristic review rather than a user study.
- Group by user goals, distinguish navigation from filters, and use headings at real section boundaries. Compare two or three neighboring screens to find redundant headings, inconsistent spacing, magic font sizes, excessive borders, low-contrast helper text and accents competing with the primary action. Trace repeated styles to shared tokens before proposing a page-specific override.
- Test long-form reply measure independently of general page width. Test metadata density, long strings, and a label that wraps onto three lines. Evaluate short/narrow and large layouts for different constraints. Check cases where splitting into panes helps comparison, and cases where it shrinks the area needed for reading.
- Match message size to its scope. Put field and row errors beside their source, with concise recovery guidance. Use a page-level error only when the page or task is affected. Distinguish first use, no search matches, filtered-out content, unavailable service, and completed work. Screenshot loading → empty/error transitions to check for jumps and premature messages.
- On a crowded screen, count competing calls to action, repeated labels, and explanatory lines before the first usable result. Propose a lower-density arrangement and verify that secondary details remain findable. Keep original Mind OS typography, icon language and brand decisions coherent when adapting a workflow seen in ChatGPT, Grok, Perplexity or Manus. Compare task patterns without copying proprietary screens or inventing competitor capabilities.

Sources: [Figma design foundations on YouTube](https://www.youtube.com/watch?v=o9CloFonY0E) (type hierarchy around 06:46, layouts around 12:22, spacing around 16:36), [NN/g visible error messages on YouTube](https://www.youtube.com/watch?v=uSPnunOsSEI) (placement around 00:32, impact around 01:39), [USWDS typography](https://designsystem.digital.gov/components/typography/), [Carbon empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states), [NIST usability testing](https://www.nist.gov/programs-projects/usability-testing). Video cues come from public descriptions and chapter listings. Use the linked written guidance to verify any decision that needs more detail.

## 5. Check keyboard, touch, announcements and motion

- Pick the expected browser/ARIA pattern before asserting keys. Tabs with actual tab panels use the tab pattern. A filter chip can use a pressed button. Check initial dialog focus, Tab boundaries, Escape, trigger restoration, and a sensible fallback when the original trigger was deleted.
- Run axe on a populated state and the open panel or error state where applicable. Check zoom/reflow, actual text spacing, contrast of text and interactive boundaries, focus obscured by sticky UI, and touch targets under WCAG 2.2 with applicable exceptions. Manually check keyboard order, announcement timing, high-contrast/forced colors, and reduced motion. A pass from the automated runner does not establish conformance.
- Test fast open/close, reduced motion, scroll anchoring and interruption. Prefer motion that explains what opened or moved. If a dashboard animation obscures status or an action, capture it in motion and compare with a reduced-motion or static alternative.

Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [WAI tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [WAI modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [Deque keyboard testing demo on YouTube](https://www.youtube.com/watch?v=U76W6H1J74k). The demo is a learning reference; use built-in keyboard controls and the existing open-source axe integration for the audit.

## 6. Decide where an image adds value

- Classify each visual's job as brand identification, action recognition, explanation, or atmosphere. For provider identification use the official mark with a visible name or accessible equivalent. Verify each brand's usage terms even when the mark comes from a public icon collection. Inspect missing, wrong-brand, duplicate and low-contrast assets.
- For original artwork prepare a brief during analysis: subject, purpose, intended screen, aspect ratio, focal point, crop margins, palette and visual constraints. On execute, generate only where justified. Test the image at actual size in both themes, preserve a stable layout before decode, verify background and edge treatment, and provide an accessible text alternative where the image conveys meaning. Avoid generated text and fabricated company marks.
- Compare the screen with the artwork hidden once. If the task becomes clearer without it, use the smaller layout. Use the screenshot after normal image loading and a second image with the asset missing or slow.

Sources: [Atlassian illustration guidance](https://atlassian.design/foundations/illustrations/), [OpenAI image prompting](https://openai.com/academy/image-generation/), [WAI alt text decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/), [Simple Icons mark and license disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).

## 7. Audit the AI-specific interaction contract

- Capture the same task in three states: before delegation, while an action awaits approval or runs, and after completion or failure. Ask what a user can infer at each point about which model or agent is acting, what inputs it is using, what requires permission, and what was completed. Check whether the UI distinguishes a proposed action, an approved action, and an observed outcome.
- Try correcting one input, canceling a run, rejecting a proposed action, and resuming from a known failure with a fixture. Look for controls disappearing before people can use them, lost drafts, logs that claim more than the visible result, and status badges that confuse agent creation with runtime readiness. Expose next steps beside the failed action without making an unconfigured service look active.
- For answers, inspect the handling of uncertain, partial, and stopped responses, attachment scope, and source provenance. Verify citations and tool actions against fixture evidence. Test that streamed status updates remain comprehensible visually and avoid overwhelming assistive technology.

Sources: [Microsoft HAX guidelines](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/), [Google PAIR mental models](https://pair.withgoogle.com/guidebook-v2/chapter/mental-models/) and [graceful failure](https://pair.withgoogle.com/guidebook-v2/chapter/errors-failing/).

## 8. Keep the next pass useful

Use one ledger row per observed case with `commit | surface/entry | user task | browser/viewport/theme | fixture | action | expected | actual | evidence | priority | verification status`. Add before, pending, settled and reopened images as applicable. Inspect and share the images, naming the exact moment and what is visible. Include a trace or source location when a still image cannot support the finding.

At the end of each pass, choose the next area from gaps in entries, devices, roles, failure states, or accessibility. Review known findings only when a new edge case or suspected regression changes the question. Write a concrete acceptance check before proposing implementation. Record which unknown required research, what source supported the method, and what remains unverified. If the product implementation is not yet authorized, end with evidence and a prioritized backlog.
