/** Local production-UI transitions with synthetic storage/streams. No live API request is forwarded. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { installVisualFixture, VISUAL_FIXTURES } from "./fixture-states.mjs";

const origin = new URL(process.env.BASE_URL || "http://127.0.0.1:4199").origin;
const output = resolve(process.env.VISUAL_ARTIFACT_DIR || "artifacts/visual-transitions");
mkdirSync(output, { recursive: true });
const report = { revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()), generatedAt: new Date().toISOString(), synthetic: true, origin, checks: [], failures: [] };
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
report.browserVersion = browser.version();
const at = "2026-01-01T00:00:00.000Z";
const chat = (id, count) => ({ id, title: `Synthetic conversation ${id}`, memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [], messages: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, role: index % 2 ? "assistant" : "user", content: `Fixture ${id} message ${index}. ` + "This is synthetic text for reading-position and layout verification. ".repeat(7), at, ...(index % 2 ? { provider: "fixture", model: "synthetic-model" } : {}) })) });
const longHistory = 250;
const initialHistory = 100;
const lastLongMessage = `#message-long-a-${longHistory - 1}`;
const workspace = { ...VISUAL_FIXTURES["chat-interrupted"].workspace(), chats: [chat("long-a", longHistory), chat("long-b", 30)] };
const observations = {};
let startupPage;
async function observedState(page) {
  return page.evaluate(() => {
    const pane = document.querySelector("#chat-thread > section > .overflow-auto");
    const pagePane = document.querySelector('main.main-stage > div.min-h-0.flex-1');
    const drawer = document.querySelector('[aria-label="Workspace navigation"]');
    return { path: location.pathname + location.search, view: document.querySelector("#mind-workspace")?.dataset.view,
      pane: pane ? { top: pane.scrollTop, height: pane.scrollHeight, viewport: pane.clientHeight, tailDistance: pane.scrollHeight - pane.scrollTop - pane.clientHeight } : null,
      pagePane: pagePane ? { top: pagePane.scrollTop, height: pagePane.scrollHeight, viewport: pagePane.clientHeight, overflowAnchor: getComputedStyle(pagePane).overflowAnchor } : null,
      messageIds: [...document.querySelectorAll("article.turn")].map((node) => node.id),
      activeElement: document.activeElement?.outerHTML.slice(0, 500), selection: document.getSelection()?.toString(),
      drawer: drawer ? { role: drawer.getAttribute("role"), width: drawer.getBoundingClientRect().width, height: drawer.getBoundingClientRect().height } : null,
      streamStarted: window.__syntheticTurn?.started ?? 0 };
  });
}
async function navigate(page, path, view) {
  await page.evaluate((next) => { history.pushState(null, "", next); dispatchEvent(new PopStateEvent("popstate")); }, path);
  await page.locator(`#mind-workspace[data-view="${view}"]`).waitFor({ state: "visible" });
}
async function check(page, id, run) {
  try {
    const detail = await run();
    const screenshot = `transition-${id}.png`; await page.screenshot({ path: resolve(output, screenshot), fullPage: false });
    report.checks.push({ id, status: "passed", detail: detail || null, observations: observations[id] || null, screenshot });
    console.log(`PASS ${id}`);
  } catch (error) {
    const screenshot = `transition-${id}-failed.png`; await page.screenshot({ path: resolve(output, screenshot), fullPage: false }).catch(() => {});
    report.failures.push({ id, status: "failed", error: error instanceof Error ? error.message : String(error), observations: { ...observations[id], afterFailure: await observedState(page).catch(() => null) }, screenshot });
    console.log(`FAIL ${id}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const transport = await installVisualFixture(context, origin, "chat-interrupted", { workspace });
  await context.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.__syntheticTurn = { started: 0, done: null };
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin !== location.origin || url.pathname !== "/api/mind/turn") return realFetch(input, init);
      if ((init?.method || "GET") === "GET") return new Response(JSON.stringify({ operationId: `1760000000000-${crypto.randomUUID()}` }), { headers: { "content-type": "application/json" } });
      if (init?.method !== "POST") return new Response("Fixture method refused", { status: 405 });
      const partial = "## Synthetic streamed heading\n\n```js\nconst fixture = ";
      const complete = "## Synthetic streamed heading\n\n```js\nconst fixture = true;\n```\n\n" + "Synthetic completed paragraph. ".repeat(120);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ start(controller) {
        window.__syntheticTurn.started++;
        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: partial })}\n\n`));
        window.__syntheticTurn.done = () => { controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ text: complete, provider: "fixture", model: "synthetic-model", usage: null, usedIds: [], requestId: "synthetic-no-provider" })}\n\n`)); controller.close(); };
      } });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    };
  });
  // Vite may invalidate its initial client graph while discovering dependencies.
  // Warm that graph in a separate page before measuring any workspace transition.
  const warmup = await context.newPage();
  startupPage = warmup;
  await warmup.goto(origin, { waitUntil: "domcontentloaded" });
  try {
    await warmup.locator('#mind-workspace[data-workspace-ready="true"]').waitFor({ timeout: 15000 });
  } catch {
    await warmup.reload({ waitUntil: "domcontentloaded" });
    await warmup.locator('#mind-workspace[data-workspace-ready="true"]').waitFor();
  }
  await warmup.close();
  const page = await context.newPage();
  startupPage = page;
  await page.goto(origin + "/?section=chat&chat=long-a", { waitUntil: "domcontentloaded" });
  await page.locator(lastLongMessage).waitFor();
  const pane = page.locator("#chat-thread > section > .overflow-auto");
  await check(page, "long-chat-reading-position", async () => {
    assert.equal(await page.locator("article.turn").count(), initialHistory);
    await pane.hover();
    await page.mouse.wheel(0, -5000);
    await page.getByRole("button", { name: "Jump to latest", exact: true }).waitFor();
    const before = await pane.evaluate((element) => element.scrollTop);
    observations["long-chat-reading-position"] = { expectedTop: before, before: await observedState(page) };
    await navigate(page, "/?section=chat&chat=long-b", "chat"); await page.locator("#message-long-b-29").waitFor();
    observations["long-chat-reading-position"].chatB = await observedState(page);
    await navigate(page, "/?section=chat&chat=long-a", "chat"); await page.locator(lastLongMessage).waitFor();
    await page.waitForFunction((expected) => Math.abs(document.querySelector("#chat-thread > section > .overflow-auto").scrollTop - expected) < 3, before, { timeout: 5000 });
    return { initialRenderedMessages: initialHistory, totalMessages: longHistory, restoredScrollTop: before, navigation: "same-document history route changes" };
  });
  await check(page, "earlier-and-reveal-message", async () => {
    await pane.evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole("button", { name: `Load earlier messages (${longHistory - initialHistory})`, exact: true }).click();
    await page.waitForFunction((expected) => document.querySelectorAll("article.turn").length === expected, initialHistory * 2);
    assert.equal(await page.locator("#message-long-a-0").count(), 0, "The oldest message must still be outside the render window before reveal.");
    await page.getByRole("button", { name: "Search workspace", exact: true }).click();
    await page.getByRole("combobox", { name: "Search", exact: true }).fill("Fixture long-a message 0.");
    await page.locator('[id="palette-hit-chat-long-a-message-long-a-0"]').click();
    await page.locator("#message-long-a-0").waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "message-long-a-0", undefined, { timeout: 5000 });
    return { afterLoadEarlier: initialHistory * 2, revealedOldestMessage: true };
  });
  await check(page, "stream-to-markdown-tail", async () => {
    await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
    observations["stream-to-markdown-tail"] = { beforeSend: await observedState(page) };
    const composer = page.locator("form.thread-composer");
    await composer.getByRole("textbox", { name: "Message", exact: true }).fill("Run the synthetic stream layout fixture");
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(() => window.__syntheticTurn.started === 1, undefined, { timeout: 10000 });
    await page.getByText("Synthetic streamed heading", { exact: false }).filter({ visible: true }).first().waitFor();
    observations["stream-to-markdown-tail"].partial = await observedState(page);
    await page.evaluate(() => window.__syntheticTurn.done());
    await page.getByRole("heading", { name: "Synthetic streamed heading", exact: true }).waitFor();
    await page.waitForFunction(() => { const p = document.querySelector("#chat-thread > section > .overflow-auto"); return p.scrollHeight - p.scrollTop - p.clientHeight < 4; }, undefined, { timeout: 5000 });
    return { stream: "in-page synthetic ReadableStream", liveProviderCalls: 0, completionProvider: "fixture" };
  });
  await check(page, "build-buffer-symbol-and-dependency", async () => {
    await navigate(page, "/?section=build", "build");
    const sections = page.getByRole("navigation", { name: "Build sections" });
    await sections.getByRole("button", { name: "Task", exact: true }).click();
    await page.getByText("Workspace and advanced controls", { exact: true }).click();
    await page.getByRole("button", { name: "Browse", exact: true }).click();
    await sections.getByRole("button", { name: "Editor", exact: true }).click();
    await page.getByRole("complementary", { name: "File tree", exact: true }).getByRole("button", { name: "fixture.ts", exact: true }).click();
    await page.getByText("Symbols and dependencies · current buffer", { exact: true }).click();
    await page.getByRole("button", { name: "fixture · function · exported · line 2", exact: true }).waitFor();
    await page.locator('.cm-content[contenteditable="true"]').fill('import { dependency } from "./dependency";\nexport function renamedFixture() { return dependency; }\n');
    await page.getByRole("button", { name: "renamedFixture · function · exported · line 2", exact: true }).click();
    await page.waitForFunction(() => document.getSelection()?.toString() === "renamedFixture", undefined, { timeout: 5000 });
    await page.getByText("Showing unsaved draft syntax.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Open dependency.ts", exact: true }).click();
    await page.getByRole("tablist", { name: "Open files", exact: true }).getByRole("tab", { name: "dependency.ts", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.cm-content[contenteditable="true"]')?.textContent.includes("export const dependency = 1;"));
    assert.equal(await page.getByRole("tablist", { name: "Open files", exact: true }).getByRole("tab", { name: "dependency.ts", exact: true }).getAttribute("aria-selected"), "true");
    await page.getByRole("tablist", { name: "Open files", exact: true }).getByRole("tab", { name: "fixture.ts •", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cm-content[contenteditable="true"]')?.textContent.includes("renamedFixture"));
    return { language: "TypeScript", selectedSymbol: "renamedFixture", unsavedDraftRetained: true, relatedFile: "dependency.ts", relatedWorkspace: "hosted", apiResponses: "synthetic read/list only; no provider or file writes" };
  });
  report.desktopTransport = transport.summary(); await context.close();

  const providerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const providerModels = { gemini: "gemini-fixture-model", openrouter: "fixture/free-model:free" };
  const providerTransport = await installVisualFixture(providerContext, origin, "chat-interrupted", { providerModels, preserveOnReload: true });
  const requests = [];
  const providerPath = origin + "/?section=chat&chat=fixture-chat";
  let selectedRoute;
  await providerContext.route((url) => url.origin === origin && url.pathname === "/api/mind/turn", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ json: { operationId: `1760000000000-${crypto.randomUUID()}` } });
    }
    if (request.method() !== "POST") return route.abort("blockedbyclient");
    const { provider, requestedModel, freeOnly } = request.postDataJSON();
    requests.push({ provider, requestedModel, freeOnly });
    if (provider !== selectedRoute || requestedModel !== providerModels[selectedRoute] || (freeOnly === true) !== (provider === "openrouter")) {
      return route.fulfill({ status: 409, json: { ok: false, error: "The fixture received a different route than the selected provider." } });
    }
    const done = { text: `Synthetic ${provider} response`, provider, model: requestedModel, usage: null, usedIds: [], requestId: `fixture-${provider}-receipt` };
    return route.fulfill({ contentType: "text/event-stream", body: `event: done\ndata: ${JSON.stringify(done)}\n\n` });
  });
  const providerPage = await providerContext.newPage();
  await providerPage.goto(providerPath, { waitUntil: "domcontentloaded" });
  await providerPage.locator("#message-fixture-message").waitFor();
  for (const provider of Object.keys(providerModels)) {
    await check(providerPage, `selected-${provider}-immediate-send-and-reload`, async () => {
      selectedRoute = provider;
      const initialCount = requests.length;
      const controls = providerPage.getByRole("button", { name: "Open controls", exact: true });
      const choice = providerPage.getByTestId(`control-module-${provider}`);
      const composer = providerPage.locator("form.thread-composer");
      await providerPage.waitForFunction(() => Object.keys(localStorage).some((key) => key.endsWith(".amcos.failover.v1") && localStorage.getItem(key) === "none"));
      await composer.getByRole("textbox", { name: "Message", exact: true }).fill("Synthetic provider routing check");
      await controls.click();
      await choice.click();
      await composer.getByRole("button", { name: "Send", exact: true }).click();
      const reply = providerPage.locator("article.turn-assistant").filter({ hasText: `Synthetic ${provider} response` });
      await reply.waitFor();
      assert.match(await reply.innerText(), new RegExp(`${provider} · ${providerModels[provider]}`));
      assert.equal(requests.length, initialCount + 1);
      assert.deepEqual({ ...requests.at(-1), freeOnly: requests.at(-1).freeOnly === true }, { provider, requestedModel: providerModels[provider], freeOnly: provider === "openrouter" });
      await providerPage.screenshot({ path: resolve(output, `transition-${provider}-synthetic-receipt.png`) });
      await providerPage.reload({ waitUntil: "domcontentloaded" });
      await controls.click();
      await choice.waitFor();
      assert.equal(await choice.getAttribute("aria-checked"), "true");
      await providerPage.keyboard.press("Escape");
      await providerPage.getByTestId("controls-menu").waitFor({ state: "hidden" });
      assert.equal(requests.length, initialCount + 1);
      return { provider, model: providerModels[provider], paidFallbackEnabled: false, reloadSelection: true, inference: "mocked HTTP response" };
    });
    const menu = providerPage.getByTestId("controls-menu");
    if (await menu.isVisible()) {
      await providerPage.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
    }
  }
  report.providerTransport = providerTransport.summary();
  report.providerRequests = requests;
  await providerContext.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: "block" });
  const mobileTransport = await installVisualFixture(mobile, origin, "chat-interrupted", { workspace });
  // A seeded message exists only after client hydration; the SSR home alone is not an interaction-ready signal.
  const phone = await mobile.newPage(); await phone.goto(origin + "/?section=chat&chat=long-a", { waitUntil: "domcontentloaded" }); await phone.locator(lastLongMessage).waitFor();
  await check(phone, "mobile-keyboard-viewport-and-draft", async () => {
    const composer = phone.locator("form.thread-composer");
    const message = composer.getByRole("textbox", { name: "Message", exact: true });
    const draft = "Synthetic keyboard draft";
    await message.fill(draft);
    const normalHeight = await phone.evaluate(() => Math.round(window.visualViewport.height));
    const keyboardHeight = normalHeight - 300;
    try {
      // Shrink only the visible viewport, as an overlay keyboard does.
      await phone.evaluate((height) => {
        const viewport = window.visualViewport;
        Object.defineProperty(viewport, "height", { configurable: true, value: height });
        viewport.dispatchEvent(new Event("resize"));
      }, keyboardHeight);
      await phone.waitForFunction((height) => {
        const pane = document.querySelector(".transcript-pane");
        const composer = document.querySelector("form.thread-composer");
        if (!pane || !composer) return false;
        const bounds = composer.getBoundingClientRect();
        return parseFloat(document.documentElement.style.getPropertyValue("--mind-visible-height")) === height
          && pane.clientHeight > 48
          && pane.getBoundingClientRect().bottom <= bounds.top + 1
          && bounds.bottom >= height - 24 && bounds.bottom <= height + 1
          && pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 2;
      }, keyboardHeight);
      assert.equal(await message.evaluate((node) => document.activeElement === node), true);
      assert.equal(await message.inputValue(), draft);
      await phone.screenshot({ path: resolve(output, "transition-mobile-keyboard-open.png"), fullPage: false, clip: { x: 0, y: 0, width: 390, height: keyboardHeight } });
    } finally {
      await phone.evaluate(() => {
        const viewport = window.visualViewport;
        delete viewport.height;
        viewport.dispatchEvent(new Event("resize"));
      });
    }
    await phone.waitForFunction((height) => {
      const pane = document.querySelector(".transcript-pane");
      return parseFloat(document.documentElement.style.getPropertyValue("--mind-visible-height")) === height
        && pane && pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 2;
    }, normalHeight);
    assert.equal(await message.inputValue(), draft);
    return { normalHeight, keyboardHeight, input: "synthetic visual viewport resize", retainedDraftAndFocus: true };
  });
  await navigate(phone, "/?section=command", "command"); await phone.locator("#command-home").waitFor();
  await check(phone, "mobile-drawer-current-focus", async () => {
    const open = phone.getByRole("button", { name: "Open menu", exact: true }); await open.click();
    observations["mobile-drawer-current-focus"] = { afterClick: await observedState(phone) };
    const drawer = phone.getByRole("dialog", { name: "Workspace navigation" }); await drawer.waitFor();
    await drawer.getByRole("button", { name: "Projects", exact: true }).click();
    await phone.locator('#mind-workspace[data-view="projects"]').waitFor();
    const primary = phone.locator('nav[aria-label="Primary"]');
    const primaryVisible = await primary.isVisible();
    if (primaryVisible) assert.equal(await primary.getByRole("button", { name: "Projects", exact: true }).getAttribute("aria-current"), "page");
    await open.click(); assert.equal(await drawer.getByRole("button", { name: "Projects", exact: true }).getAttribute("aria-current"), "page");
    await phone.keyboard.press("Shift+Tab");
    assert.equal(await drawer.evaluate((node) => node.contains(document.activeElement)), true);
    await phone.keyboard.press("Tab");
    assert.equal(await drawer.getByRole("button", { name: "Close menu", exact: true }).evaluate((node) => document.activeElement === node), true);
    await drawer.evaluate(async (node) => { await Promise.all(node.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map((animation) => animation.finished.catch(() => {}))); });
    await phone.screenshot({ path: resolve(output, "transition-mobile-drawer-open.png"), fullPage: false });
    await phone.keyboard.press("Escape"); await drawer.waitFor({ state: "hidden" });
    assert.equal(await open.evaluate((node) => document.activeElement === node), true);
    return { currentRoute: "projects", visibleDrawerCurrentState: "page", focusTrap: true, escapeRestoredFocus: true, primaryVisible, primaryExplanation: primaryVisible ? "Current page checked on both visible navigation surfaces" : "Existing mobile shell CSS hides the legacy bottom navigation; current page checked on the visible drawer" };
  });
  await check(phone, "theme-light-dark", async () => {
    await navigate(phone, "/?section=settings&pane=general", "settings");
    for (const theme of ["light", "dark"]) {
      await phone.getByRole("button", { name: new RegExp(`^(?:✓ )?${theme === "light" ? "Light" : "Dark"}$`) }).click();
      await phone.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
      assert.equal(await phone.evaluate(() => localStorage.getItem("amcos.theme.v1")), theme);
      await phone.screenshot({ path: resolve(output, `transition-mobile-${theme}.png`), fullPage: false });
    }
    return { themes: ["light", "dark"], savedLocally: true };
  });
  await check(phone, "page-reading-position", async () => {
    await navigate(phone, "/?section=settings&pane=data", "settings");
    await phone.getByRole("heading", { name: "Data and retention", exact: true }).waitFor();
    const scroller = phone.locator('main.main-stage > div.min-h-0.flex-1');
    await scroller.hover(); await phone.mouse.wheel(0, 1600);
    await phone.waitForFunction(() => document.querySelector('main.main-stage > div.min-h-0.flex-1')?.scrollTop > 300, undefined, { timeout: 5000 });
    await phone.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await scroller.evaluate((node) => node.scrollTop);
    observations["page-reading-position"] = { expectedTop: before, before: await observedState(phone) };
    await navigate(phone, "/?section=projects", "projects");
    observations["page-reading-position"].shortPage = await observedState(phone);
    await navigate(phone, "/?section=settings&pane=data", "settings");
    await phone.getByRole("heading", { name: "Data and retention", exact: true }).waitFor();
    await phone.waitForFunction((expected) => Math.abs(document.querySelector('main.main-stage > div.min-h-0.flex-1').scrollTop - expected) < 3, before, { timeout: 5000 });
    return { longPage: "Settings Data", shorterPage: "Projects", restoredScrollTop: before, input: "real mouse wheel" };
  });
  await check(phone, "mobile-drawer-reduce-and-resize", async () => {
    try {
      await phone.emulateMedia({ reducedMotion: "reduce" });
      await phone.getByRole("button", { name: "Open menu", exact: true }).click();
      const drawer = phone.getByRole("dialog", { name: "Workspace navigation" }); await drawer.waitFor();
      const animation = await drawer.evaluate((node) => ({ name: getComputedStyle(node).animationName, duration: getComputedStyle(node).animationDuration }));
      assert.equal(animation.name, "none");
      await phone.setViewportSize({ width: 1000, height: 844 });
      await phone.waitForFunction(() => !document.querySelector("aside.nav-drawer-open"), undefined, { timeout: 5000 });
      const focus = await phone.evaluate(() => ({ inRail: Boolean(document.activeElement?.closest("aside.rail")), visible: Boolean(document.activeElement?.getClientRects().length), activeElement: document.activeElement?.outerHTML.slice(0, 500), bodyOverflow: document.body.style.overflow, modal: document.querySelector("aside.rail")?.getAttribute("aria-modal") }));
      observations["mobile-drawer-reduce-and-resize"] = { animation, desktopFocus: focus };
      assert.equal(focus.visible, true); assert.notEqual(focus.bodyOverflow, "hidden"); assert.equal(focus.modal, null);
      return { reducedMotionAnimation: animation, desktopBreakpointClosedModal: true, visibleFocus: true, focusLocation: focus.inRail ? "sidebar" : "still-visible menu trigger", bodyScrollUnlocked: true };
    } finally { await phone.setViewportSize({ width: 390, height: 844 }); await phone.emulateMedia({ reducedMotion: "no-preference" }); }
  });
  await check(phone, "lazy-build-and-voice", async () => {
    await navigate(phone, "/?section=build", "build"); await phone.getByRole("navigation", { name: "Build sections" }).waitFor();
    await navigate(phone, "/?section=voice", "voice"); await phone.getByRole("heading", { name: "Voice Cloning Studio", exact: true }).waitFor();
    return { buildModule: "rendered", voiceStudioModule: "rendered", providerOperations: "all intercepted; none invoked" };
  });
  report.mobileTransport = mobileTransport.summary(); await mobile.close();

  for (const outcome of ["rejected", "accepted"]) {
    const videoContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const videoTransport = await installVisualFixture(videoContext, origin, "chat-interrupted");
    await videoContext.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const state = window.__syntheticVideo = { starts: [], statuses: [], answerStart: null, answerStatus: null };
      const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
        if (url.origin !== location.origin || url.pathname !== "/api/mind/media/generate") return originalFetch(input, init);
        let body = {}; try { body = JSON.parse(init?.body || "{}"); } catch { /* Unknown operations stay refused. */ }
        if (init?.method === "POST" && body.kind === "video" && body.action === "start") {
          state.starts.push(body);
          return new Promise((resolve) => { state.answerStart = (value, status) => resolve(reply(value, status)); });
        }
        if (init?.method === "POST" && body.kind === "video" && body.action === "status") {
          state.statuses.push(body);
          return new Promise((resolve) => { state.answerStatus = (value, status) => resolve(reply(value, status)); });
        }
        if (body.action === "recover") return reply({ ok: true, operations: [] });
        return reply({ ok: false, error: "Synthetic media operation refused; no provider call." }, 503);
      };
    });
    const videoPage = await videoContext.newPage();
    await videoPage.clock.install();
    await videoPage.goto(origin + "/?section=chat&chat=fixture-chat", { waitUntil: "domcontentloaded" });
    await videoPage.locator("#message-fixture-message").waitFor();
    await check(videoPage, `video-delayed-start-${outcome}`, async () => {
      await navigate(videoPage, "/?section=command", "command");
      await videoPage.getByRole("button", { name: "Create a video", exact: true }).click();
      await videoPage.getByTestId("home-command").fill(`Synthetic ${outcome} video start; no provider may be called`);
      await videoPage.getByTestId("home-command").press("Enter");
      await videoPage.waitForFunction(() => window.__syntheticVideo.starts.length === 1);
      await videoPage.getByText("Submitting the video with a saved recovery reference. No automatic generation retry will occur.", { exact: true }).filter({ visible: true }).waitFor();
      await videoPage.clock.fastForward(5500);
      assert.equal(await videoPage.getByText(/Video accepted|Rendering is in progress|Rendering video|saved video job is rendering/i).filter({ visible: true }).count(), 0);
      assert.equal(await videoPage.evaluate(() => window.__syntheticVideo.statuses.length), 0);
      await videoPage.screenshot({ path: resolve(output, `transition-video-${outcome}-submitting.png`), fullPage: false });
      if (outcome === "rejected") {
        await videoPage.evaluate(() => window.__syntheticVideo.answerStart({ ok: false, error: "Synthetic video start rejected before acceptance." }, 503));
        await videoPage.getByText("Synthetic video start rejected before acceptance.", { exact: true }).filter({ visible: true }).first().waitFor();
        await videoPage.clock.fastForward(5500);
        assert.equal(await videoPage.getByText("Submitting the video with a saved recovery reference. No automatic generation retry will occur.", { exact: true }).filter({ visible: true }).count(), 0);
        assert.equal(await videoPage.getByText(/Video accepted|Rendering is in progress|Rendering video|saved video job is rendering/i).filter({ visible: true }).count(), 0);
        assert.equal(await videoPage.evaluate(() => window.__syntheticVideo.statuses.length), 0);
      } else {
        await videoPage.evaluate(() => {
          const state = window.__syntheticVideo;
          const { operationId, chatId, prompt, aspectRatio, duration, resolution } = state.starts[0];
          const at = new Date().toISOString();
          state.job = { ownerId: "dev-user", operationId, chatId, prompt, settings: { aspectRatio, duration, resolution }, requestId: "synthetic-video-accepted", model: "synthetic-video-model", state: "accepted", createdAt: at, updatedAt: at, expiresAt: null, url: "", error: "", temporary: false };
          state.answerStart({ ok: true, state: "pending", job: state.job, requestId: state.job.requestId, model: state.job.model }, 200);
        });
        await videoPage.getByText("The saved video job is rendering. You can leave this view and resume status checks in Media recovery.", { exact: true }).filter({ visible: true }).waitFor();
        await videoPage.clock.fastForward(5500);
        await videoPage.waitForFunction(() => window.__syntheticVideo.statuses.length === 1);
        const status = await videoPage.evaluate(() => window.__syntheticVideo.statuses[0]);
        assert.equal(status.operationId, await videoPage.evaluate(() => window.__syntheticVideo.starts[0].operationId));
        await videoPage.evaluate(() => {
          const state = window.__syntheticVideo;
          const job = { ...state.job, state: "completed", url: "https://fixture.invalid/synthetic-retained-video.mp4", updatedAt: new Date().toISOString() };
          state.answerStatus({ ok: true, state: "done", job, url: job.url, requestId: job.requestId, model: job.model }, 200);
        });
        await videoPage.getByText("Video is ready in its original conversation. Its saved operation is available in Media recovery.", { exact: true }).filter({ visible: true }).waitFor();
        await videoPage.clock.fastForward(5500);
        assert.equal(await videoPage.evaluate(() => window.__syntheticVideo.statuses.length), 1);
      }
      assert.equal(await videoPage.evaluate(() => window.__syntheticVideo.starts.length), 1);
      return { outcome, delayedStartMs: 5500, startRequests: 1, statusRequests: await videoPage.evaluate(() => window.__syntheticVideo.statuses.length), receipt: outcome === "accepted" ? "synthetic-video-accepted" : null, timing: "Playwright synthetic clock", mediaTransport: "in-page synthetic fetch; all other API/external traffic intercepted", liveProviderCalls: 0 };
    });
    report[`video${outcome}Transport`] = videoTransport.summary();
    await videoContext.close();
  }
} catch (error) {
  const screenshot = "transition-startup-failed.png";
  if (startupPage && !startupPage.isClosed()) await startupPage.screenshot({ path: resolve(output, screenshot) }).catch(() => {});
  report.failures.push({ id: "startup", status: "failed", error: error instanceof Error ? error.message : String(error), screenshot });
}
finally { await browser.close(); }
writeFileSync(resolve(output, "transitions.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures.length, output })); process.exitCode = report.failures.length ? 1 : 0;
