// Serve a local development fixture without real credentials.
// BASE_URL=http://127.0.0.1:8080 node scripts/visual/chat-layout.mjs
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, webkit } from "playwright";
import { isolateWorkspace } from "./isolate-workspace.mjs";
import { assertSkillReceiptRows, skillReceiptFixture } from "./skill-receipt-fixture.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:4195").origin;
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use an isolated local preview.");
const engine = process.env.BROWSER_ENGINE ?? "chromium";
assert(["chromium", "webkit"].includes(engine));
const serviceState = process.env.FIXTURE_SERVICE_STATE ?? "unavailable";
assert(["unavailable", "empty-mcp"].includes(serviceState));
const counts = (process.env.FIXTURE_COUNTS ?? "1,50,500,2000").split(",").map(Number);
assert(counts.every((count) => Number.isInteger(count) && count > 0 && count <= 5000));
const artifactDir = resolve(process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/c3-chat-layout");
mkdirSync(artifactDir, { recursive: true });
function sourceDigest() {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "scripts", "migrations", "package.json", "vite.config.ts"], { encoding: "utf8" }).split("\0").filter((file) => file && !/\.test\./.test(file) && /\.(?:[cm]?[jt]sx?|json|css|sql|html)$/.test(file)).sort();
  const digest = createHash("sha256");
  for (const file of [...new Set(files)]) digest.update(file + "\0").update(readFileSync(file)).update("\0");
  return { sha256: digest.digest("hex"), files: new Set(files).size };
}
const report = {
  schema: "mind-layout-fixture/v2", engine, origin, generatedAt: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedDiffSha256: createHash("sha256").update(execFileSync("git", ["diff", "HEAD"], { maxBuffer: 32 * 1024 * 1024 })).digest("hex"),
  sourceState: sourceDigest(),
  environment: "local-synthetic-no-provider", serviceState, textScaleMode: "persisted owner accessibility preference", browserVersion: null, states: [], navigation: [], failures: [],
  proposedTargets: { interactionEventMs: 200, largestContentfulPaintMs: 2500, cumulativeLayoutShift: 0.1, status: "proposed fixture review targets, not established production release guarantees" },
  metricLimits: "Headless local Chromium/WebKit and synthetic accounts; no physical-device or production latency claim. Event timing reports the slowest observed interaction, not a full field INP score. Browser heap is Chromium's optional JS-heap estimate only.",
};
async function centerIsReachable(locator) {
  return locator.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === button;
  });
}

const viewports = process.env.FIXTURE_QUICK === "true" ? [[390, 844, 100]] : [[390, 844, 100], [844, 390, 100], [320, 500, 100], [1024, 768, 200]];
for (const [width, height, rootPercent] of viewports) {
  const browser = await ({ chromium, webkit })[engine].launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, ...(engine === "chromium" ? { args: ["--disable-gpu", "--disable-dev-shm-usage"] } : {}) });
  report.browserVersion = browser.version();
  let page, context;
  const label = `${engine}-${width}x${height}-${rootPercent}`;
  try {
    context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" });
    try {
      await context.tracing.start({ screenshots: true, snapshots: true });
      await isolateWorkspace(context, origin);
      await context.route((url) => ["https:", "http:"].includes(url.protocol) && url.origin !== origin, (route) => route.abort());
      // No fixture may reach a server function or mutation. Service health is mocked unavailable.
      await context.route((url) => url.origin === origin && (url.pathname.startsWith("/api/") || url.pathname.includes("/_serverFn/")), (route) => {
        if (serviceState === "empty-mcp" && route.request().method() === "GET" && new URL(route.request().url()).pathname === "/api/mind/mcp/servers") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ servers: [] }) });
        }
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, configured: false, error: "Isolated fixture: external services unavailable." }) });
      });
      await context.addInitScript(({ appOrigin, counts, rootPercent, skillReceipts }) => {
        if (location.origin !== appOrigin) return;
        if (new URLSearchParams(location.search).get("section") === "chat") {
          window.__mindFixtureHomeMounted = false;
          new MutationObserver(() => {
            if (document.getElementById("command-home")) window.__mindFixtureHomeMounted = true;
          }).observe(document, { childList: true, subtree: true });
        }
        const metrics = { supported: PerformanceObserver.supportedEntryTypes ?? [], lcpMs: null, cls: 0, layoutShifts: [], interactions: [], longTasks: [], observedAt: 0 };
        window.__mindFixturePerformance = metrics;
        let clsWindowStart = 0, clsLast = 0, clsWindowValue = 0;
        const observe = (type, receive, extra = {}) => {
          if (!metrics.supported.includes(type)) return;
          try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) receive(entry); }).observe({ type, buffered: true, ...extra }); } catch { /* unsupported metric stays explicitly unavailable */ }
        };
        observe("largest-contentful-paint", (entry) => { metrics.lcpMs = entry.startTime; });
        observe("layout-shift", (entry) => {
          if (entry.hadRecentInput) return;
          if (metrics.layoutShifts.length < 100) metrics.layoutShifts.push({
            value: entry.value, startTime: entry.startTime,
            sources: (entry.sources ?? []).map(({ node, previousRect, currentRect }) => ({
              tag: node?.nodeName ?? null,
              id: node?.id || null,
              classes: typeof node?.className === "string" ? node.className.slice(0, 160) : null,
              previous: { x: previousRect.x, y: previousRect.y, width: previousRect.width, height: previousRect.height },
              current: { x: currentRect.x, y: currentRect.y, width: currentRect.width, height: currentRect.height },
            })),
          });
          if (clsLast === 0 || entry.startTime - clsLast > 1000 || entry.startTime - clsWindowStart > 5000) { clsWindowStart = entry.startTime; clsWindowValue = entry.value; } else clsWindowValue += entry.value;
          clsLast = entry.startTime; metrics.cls = Math.max(metrics.cls, clsWindowValue);
        });
        observe("event", (entry) => { if (entry.interactionId && metrics.interactions.length < 500) metrics.interactions.push({ id: entry.interactionId, name: entry.name, duration: entry.duration }); }, { durationThreshold: 16 });
        observe("longtask", (entry) => { if (metrics.longTasks.length < 200) metrics.longTasks.push(entry.duration); });
        const chats = counts.map((count) => ({
          id: "layout-" + count,
          title: "Layout fixture " + count,
          messages: Array.from({ length: count }, (_, i) => ({
            id: "turn-" + i,
            at: "2026-01-01T12:00:00Z",
            role: i % 2 ? "assistant" : "user",
            ...(i === count - 1 && i % 2 ? { skillReceipts } : {}),
            content: "Turn " + i + ". " + (i % 7 === 0 ? "## Structured fixture\n\n| Source | State |\n| --- | --- |\n| Synthetic | Unverified |\n\n```typescript\nconst fixture = true;\n```\n\n" : "") + "Sample message for testing conversation reflow. ".repeat(8),
          })),
        }));
        const projects = Array.from({ length: 300 }, (_, i) => ({ id: `fixture-project-${i}`, name: `Fixture project ${i}`, description: "Synthetic local project; no remote destination.", createdAt: "2026-01-01T12:00:00Z" }));
        const files = Array.from({ length: 300 }, (_, i) => ({ id: `fixture-file-${i}`, name: `Fixture-document-${i}.txt`, text: "Synthetic document text for local rendering.", bytes: 43, projectId: projects[i].id, createdAt: "2026-01-01T12:00:00Z" }));
        localStorage.setItem("amcos.workspace.v1", JSON.stringify({ chats, projects, files, deletedChatIds: ["fixture-deleted-conversation"], deletedMemoryIds: ["fixture-deleted-note"] }));
        localStorage.setItem("amcos.account-preferences.v1.dev-user.amcos.accessibility.v1", JSON.stringify({ textScale: rootPercent, contrast: "standard", spacing: "standard" }));
      }, { appOrigin: origin, counts, rootPercent, skillReceipts: skillReceiptFixture() });
      // Vite can invalidate the cold dependency graph before measurements begin.
      if (width === viewports[0][0] && height === viewports[0][1]) {
        const warmup = await context.newPage();
        const ready = warmup.locator('#mind-workspace[data-workspace-ready="true"]');
        await warmup.goto(origin, { waitUntil: "domcontentloaded" });
        try {
          await ready.waitFor({ timeout: 15_000 });
        } catch {
          await warmup.reload({ waitUntil: "domcontentloaded" });
          await ready.waitFor();
        }
        await warmup.close();
      }
      page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const consoleErrors = [];
      page.on("pageerror", (error) => consoleErrors.push(error.message));
      await page.goto(origin);
      await page.locator('#mind-workspace[data-workspace-ready="true"]').waitFor();
      const home = page.locator("#command-home");
      await home.getByRole("heading", { level: 1 }).waitFor();
      const greeting = await home.locator(".masthead").boundingBox();
      const homeBox = await home.boundingBox();
      assert(greeting && homeBox && greeting.y - homeBox.y < 80, "Large blank gap before the Home greeting.");
      const homeTrigger = home.locator("details.composer-more > summary");
      await homeTrigger.click();
      await page.getByTestId("home-composer-more-menu").getByRole("button", { name: "Attach", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByTestId("home-composer-more-menu").waitFor({ state: "hidden" });
      for (const count of counts) {
        const startedAt = performance.now();
        await page.goto(origin + "/?section=chat&chat=layout-" + count);
        await page.locator('#mind-workspace[data-workspace-ready="true"]').waitFor();
        await page.locator(`#message-turn-${count - 1}`).waitFor({ state: "attached" });
        assert.equal(await page.evaluate(() => window.__mindFixtureHomeMounted), false, "A direct conversation link must open without mounting Home first.");
        const navigationMs = performance.now() - startedAt;
        assert.equal(await page.locator("article.turn").count(), Math.min(count, 100), "The initial transcript render must stay bounded.");
        await page.waitForFunction((percent) => Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - 16 * percent / 100) < 0.1, rootPercent);
        const settingsTrigger = page.getByRole("button", { name: "Chat settings", exact: true });
        await settingsTrigger.click();
        const settings = page.locator("#thread-chat-settings[open]");
        await settings.getByLabel("Conversation style", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await settings.waitFor({ state: "hidden" });
        assert(await settingsTrigger.evaluate((element) => document.activeElement === element), "Chat settings lost focus on Escape.");
        // Larger saved text may make the bounded header scroll. Every displayed
        // action must remain reachable in that region, not just the Send row.
        const headerActions = page.locator("header.topbar > button, header.topbar [data-testid='header-controls'] > button, header.topbar .surface-switch > button");
        for (const action of await headerActions.all()) {
          if (!(await action.isVisible())) continue;
          await action.scrollIntoViewIfNeeded();
          assert(await centerIsReachable(action), "Unreachable header action: " + (await action.getAttribute("aria-label") || await action.textContent()));
        }
        await page.locator("header.topbar").evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
        let skillReceiptReview = { state: "not-applicable", reason: "No final assistant message in this case." };
        if (count > 1 && count % 2 === 0) {
          const turn = page.locator(`#message-turn-${count - 1}`);
          const detailsToggle = turn.getByText("Response details", { exact: true });
          await detailsToggle.click();
          const skillDetails = turn.locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Skills considered (4)" }) });
          const skillSummary = skillDetails.locator("summary");
          await skillSummary.click();
          assert(await skillDetails.evaluate((element) => element.open), "Skills considered did not open.");
          skillReceiptReview = assertSkillReceiptRows(await skillDetails.locator("li").allTextContents());
          await page.screenshot({ path: resolve(artifactDir, `${label}-${count}-skill-receipts.png`) });
          await skillSummary.click();
          assert(!(await skillDetails.evaluate((element) => element.open)), "Skills considered did not close.");
          await detailsToggle.click();
        }
        const composer = page.locator("form.thread-composer");
        const message = composer.getByRole("textbox", { name: "Message", exact: true });
        const interactionStart = performance.now();
        await message.fill("An editable draft");
        await message.pressSequentially(" typed", { delay: 15 });
        const editMs = performance.now() - interactionStart;
        assert(editMs < 5000, `Draft editing exceeded the 5s fixture ceiling (${editMs}ms).`);
        if (count >= 50) {
          await page.getByTestId('composer-image-input').setInputFiles({
            name: "release-" + "long-file-name-".repeat(12) + "review.png",
            mimeType: "image/png",
            buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAWJVMogAAAAASUVORK5CYII=", "base64"),
          });
          await composer.getByRole("list", { name: "Attached images" }).waitFor();
          await message.fill(Array(15).fill("Multiline draft").join("\n"));
        }
        assert(await centerIsReachable(composer.getByRole("button", { name: "Send", exact: true })), `Send clipped on ${width}×${height} / ${count} turns.`);
        await page.screenshot({ path: resolve(artifactDir, `${label}-${count}-turns.png`) });
        const metrics = await page.evaluate(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const observed = window.__mindFixturePerformance;
          const heap = performance.memory;
          const interactionMs = observed?.interactions.length ? Math.max(...observed.interactions.map((entry) => entry.duration)) : null;
          return { lcpMs: observed?.lcpMs ?? null, cls: observed?.supported.includes("layout-shift") ? observed.cls : null, layoutShifts: observed?.layoutShifts ?? [], maxObservedInteractionMs: interactionMs, interactionEntries: observed?.interactions.length ?? 0, eventTiming: observed?.supported.includes("event") ? "supported; events below16ms may not be reported" : "unsupported", longTaskCount: observed?.longTasks.length ?? null, maxLongTaskMs: observed?.longTasks.length ? Math.max(...observed.longTasks) : null, heap: heap ? { usedJsBytes: heap.usedJSHeapSize, totalJsBytes: heap.totalJSHeapSize, limitJsBytes: heap.jsHeapSizeLimit } : null, supported: observed?.supported ?? [] };
        });
        const proposedTargetReview = { lcpWithin2500ms: metrics.lcpMs === null ? null : metrics.lcpMs <= 2500, observedInteractionWithin200ms: metrics.maxObservedInteractionMs === null ? null : metrics.maxObservedInteractionMs <= 200, clsWithinPointOne: metrics.cls === null ? null : metrics.cls <= 0.1 };
        report.states.push({ label, count, navigationMs, editMs, renderedMessages: await page.locator("article.turn").count(), skillReceiptReview, metrics, proposedTargetReview, consoleErrors: [...consoleErrors] });
        if (count === counts[0] && serviceState === "unavailable") {
          await page.getByTestId("alerts-toggle").click();
          const alerts = page.getByTestId("alerts-panel");
          await alerts.getByRole("button", { name: /(?:MCP.*could not be loaded|Notion status could not be read).*View activity/i }).first().waitFor();
          assert.equal(await page.getByTestId("failure-banner").count(), 0, "Background connection checks must leave the chat viewport intact.");
          await page.keyboard.press("Escape");
          await alerts.waitFor({ state: "hidden" });
        }

        assert.equal(consoleErrors.length, 0, "Unexpected application error in fixture.");
        if (count === 1) continue;
        const chip = await composer.getByRole("listitem").first().boundingBox();
        assert(chip && chip.x >= 0 && chip.x + chip.width <= width + 1, "Attachment extends outside viewport.");
        const trigger = composer.locator("details.composer-more > summary");
        await trigger.click();
        const menu = page.getByTestId("composer-more-menu");
        await menu.waitFor();
        for (const button of await menu.getByRole("button").all()) {
          await button.scrollIntoViewIfNeeded();
          assert(await centerIsReachable(button), "Unreachable action in More: " + await button.textContent());
        }
        await trigger.focus();
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        assert(await trigger.evaluate((element) => document.activeElement === element), "More lost focus on Escape.");
        const transcript = page.locator("#chat-thread > section > .overflow-auto");
        await transcript.hover();
        await page.mouse.wheel(0, -400);
        await page.getByRole("button", { name: "Jump to latest" }).click();
        await page.waitForFunction(() => {
          const el = document.querySelector("#chat-thread > section > .overflow-auto");
          return el && el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
        });
        if (count > 100) {
          const earlier = page.getByRole("button", { name: /^Load earlier messages/ });
          await earlier.scrollIntoViewIfNeeded();
          await earlier.click();
          await page.waitForFunction(() => document.querySelectorAll("article.turn").length === 200);
          assert.equal(await page.locator("article.turn").count(), 200, "Loading history must add one bounded page.");
        }
      }
      const navigation = { label, drawerFocus: "not-mobile", breakpointCleanup: "not-mobile", workspaceDialog: "unchecked", projectsScrollBefore: null, projectsScrollAfter: null };
      const openMenu = page.getByRole("button", { name: "Open menu", exact: true });
      if (await openMenu.isVisible()) {
        await openMenu.click();
        const drawer = page.getByRole("dialog", { name: "Workspace navigation", exact: true });
        await drawer.waitFor();
        await drawer.evaluate((node) => {
          const controls = [...node.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length > 0 && getComputedStyle(item).visibility !== "hidden");
          controls.at(-1)?.focus();
        });
        await page.keyboard.press("Tab");
        assert(await drawer.evaluate((node) => node.contains(document.activeElement)), "Tab escaped the mobile drawer.");
        await page.keyboard.press("Escape"); await drawer.waitFor({ state: "hidden" });
        assert(await openMenu.evaluate((node) => document.activeElement === node), "Drawer Escape lost trigger focus.");
        navigation.drawerFocus = "passed";
        await openMenu.click(); await drawer.waitFor();
        await page.setViewportSize({ width: 1024, height });
        await drawer.waitFor({ state: "hidden" });
        assert(await page.evaluate(() => document.body.style.overflow !== "hidden"), "Drawer scroll lock remained after desktop transition.");
        await page.waitForFunction(() => Boolean(document.activeElement?.closest(".rail") && document.activeElement.getClientRects().length));
        await page.setViewportSize({ width, height }); navigation.breakpointCleanup = "passed";
      }
      const navigate = async (name, view) => {
        if (await openMenu.isVisible()) await openMenu.click();
        await page.locator("aside.rail").getByRole("button", { name, exact: true }).click();
        await page.locator(`#mind-workspace[data-view="${view}"]`).waitFor();
      };
      await navigate("Projects", "projects");
      for (const item of await page.locator("aside.rail nav .nav-item").all()) {
        if (!(await item.isVisible())) continue;
        assert(await item.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "Sidebar label clipped at the saved text scale: " + await item.textContent());
      }
      const createProject = page.locator("#new-project-button");
      await createProject.click();
      const projectDialog = page.getByRole("dialog", { name: "Create project", exact: true });
      await projectDialog.waitFor();
      assert(await projectDialog.evaluate((element) => element.matches(":modal")), "The shared dialog did not enter native modal containment.");
      await projectDialog.evaluate((element) => {
        const controls = [...element.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],select:not([disabled])')].filter((node) => node.getClientRects().length > 0);
        controls.at(-1)?.focus();
      });
      await page.keyboard.press("Tab");
      assert(await projectDialog.evaluate((element) => element.contains(document.activeElement)), "Focus escaped the shared modal dialog.");
      await createProject.evaluate((element) => element.focus());
      assert(await projectDialog.evaluate((element) => element.contains(document.activeElement)), "A background control accepted focus while a modal dialog was open.");
      await page.keyboard.press("Escape");
      await projectDialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement === document.getElementById("new-project-button"));
      navigation.workspaceDialog = "passed";
      const scroller = page.locator("main.main-stage > div.min-h-0.flex-1");
      navigation.projectsScrollBefore = await scroller.evaluate((element) => { element.scrollTop = Math.min(600, element.scrollHeight - element.clientHeight); return element.scrollTop; });
      assert(navigation.projectsScrollBefore > 100, "Project fixture did not produce a scrollable workspace.");
      await navigate("Library", "files"); await navigate("Projects", "projects");
      navigation.projectsScrollAfter = await scroller.evaluate((element) => element.scrollTop);
      assert(Math.abs(navigation.projectsScrollAfter - navigation.projectsScrollBefore) <= 2, "Returning from Library lost Projects reading position.");
      report.navigation.push(navigation);
      await page.screenshot({ path: resolve(artifactDir, `${label}-projects-navigation.png`) });
      console.log(`PASS ${label}, ${counts.join("/")} messages, bounded render, text scale, keyboard focus and attachment.`);
    } catch (error) {
      if (page && !page.isClosed()) {
        const state = await page.evaluate(() => ({
          focus: document.activeElement?.outerHTML.slice(0, 500),
          geometry: ["#chat-thread", "#chat-thread > section", ".thread-composer", ".thread-draft", ".thread-composer .composer-toolbar", ".thread-composer .composer-send", "main.main-stage", '[data-testid="failure-banner"]'].map((selector) => {
            const element = document.querySelector(selector); if (!element) return { selector, missing: true };
            const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
            return { selector, x: box.x, y: box.y, width: box.width, height: box.height, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, display: style.display, minHeight: style.minHeight, maxHeight: style.maxHeight, overflow: style.overflow, flex: style.flex, gridRows: style.gridTemplateRows };
          }),
          menus: [...document.querySelectorAll("details.composer-more")].map((node) => ({ open: node.open, childOpen: node.querySelector("[popover]")?.matches(":popover-open"), display: node.querySelector("[popover]") ? getComputedStyle(node.querySelector("[popover]")).display : null, html: node.outerHTML.slice(0, 600) })),
        })).catch(() => null);
        writeFileSync(resolve(artifactDir, `${label}-failure-state.json`), JSON.stringify(state, null, 2));
      }
      if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifactDir, `${label}-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await context.tracing.stop({ path: resolve(artifactDir, `${label}-trace.zip`) });
      await context.close();
    }
  } catch (error) {
    report.failures.push({ label, error: error instanceof Error ? error.stack : String(error) });
    if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifactDir, `${label}-failure.png`) }).catch(() => {});
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await browser.close();
    writeFileSync(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  }
}
report.finalSourceState = sourceDigest();
if (report.finalSourceState.sha256 !== report.sourceState.sha256) report.failures.push({ label: "source-state", error: "Source code changed during the fixture. Repeat the run against a stable revision before accepting its proof." });
writeFileSync(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
if (report.failures.length) process.exitCode = 1;
