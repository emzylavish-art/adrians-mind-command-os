import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { installVisualFixture } from "./fixture-states.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:4195").origin;
assert(new URL(origin).hostname === "127.0.0.1", "Only the isolated fixture server is supported.");
const output = resolve(process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/browser-zoom");
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "mind-browser-zoom-"));
const extension = join(temporary, "extension");
mkdirSync(extension);
writeFileSync(join(extension, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "Fixture tab zoom",
  version: "1.0",
  permissions: ["tabs"],
  background: { service_worker: "worker.js" },
}));
writeFileSync(join(extension, "worker.js"), "chrome.runtime.onStartup.addListener(() => {});\n");

const report = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  environment: "headless Chromium, local synthetic workspace",
  status: "failed",
};
let context;
let page;
try {
  context = await chromium.launchPersistentContext(join(temporary, "profile"), {
    channel: "chromium",
    headless: true,
    viewport: null,
    reducedMotion: "reduce",
    args: ["--window-size=1024,768", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const name = "chat-interrupted";
  const count = 500;
  const chatId = "fixture-chat";
  const fixture = {
    chats: [{
      id: chatId,
      title: "Synthetic browser zoom",
      messages: Array.from({ length: count }, (_, index) => ({
        id: `zoom-${index}`,
        role: index % 2 ? "assistant" : "user",
        content: `Synthetic turn ${index}. A long transcript for verifying browser zoom and composer reachability.`,
        at: "2026-01-01T00:00:00Z",
      })),
    }],
  };
  const transport = await installVisualFixture(context, origin, name, { workspace: fixture });
  const ready = (tab) => tab.locator('#mind-workspace[data-workspace-ready="true"]');
  const warmup = context.pages()[0] ?? await context.newPage();
  await warmup.goto(origin, { waitUntil: "domcontentloaded" });
  try {
    await ready(warmup).waitFor({ timeout: 15_000 });
  } catch {
    await warmup.reload({ waitUntil: "domcontentloaded" });
    await ready(warmup).waitFor({ timeout: 15_000 });
  }
  await warmup.close();
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = `${origin}/?section=chat&chat=${chatId}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const latest = page.locator(`#message-zoom-${count - 1}`);
  await latest.waitFor();
  const before = await page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio }));
  report.zoom = await worker.evaluate(async (target) => {
    const tabs = globalThis.chrome.tabs;
    const tab = (await tabs.query({})).find((entry) => entry.url === target);
    if (tab?.id === undefined) throw new Error("Could not locate the synthetic tab.");
    const original = await tabs.getZoom(tab.id);
    await tabs.setZoom(tab.id, 2);
    return { original, applied: await tabs.getZoom(tab.id) };
  }, url);
  assert.deepEqual(report.zoom, { original: 1, applied: 2 });
  await page.waitForFunction(({ width, ratio }) => Math.abs(innerWidth * 2 - width) <= 2 && devicePixelRatio === ratio * 2, before);
  const composer = page.locator("form.thread-composer");
  const message = composer.getByRole("textbox", { name: "Message", exact: true });
  const draft = "Synthetic draft at 200 percent browser zoom";
  await message.fill(draft);
  await page.waitForFunction(() => {
    const transcript = document.querySelector(".transcript-pane");
    const form = document.querySelector("form.thread-composer");
    const send = form?.querySelector('button[type="submit"]');
    if (!transcript || !form || !send) return false;
    const bounds = form.getBoundingClientRect();
    const control = send.getBoundingClientRect();
    const hit = document.elementFromPoint(control.x + control.width / 2, control.y + control.height / 2);
    return transcript.clientHeight > 48
      && transcript.getBoundingClientRect().bottom <= bounds.top + 1
      && bounds.bottom >= innerHeight - 24 && bounds.bottom <= innerHeight + 1
      && transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 2
      && send.contains(hit);
  });
  assert.equal(await message.inputValue(), draft);
  assert.equal(await message.evaluate((node) => node === document.activeElement), true);
  await page.screenshot({ path: join(output, "chat-browser-zoom-200.png") });
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio }));
  report.originalViewport = before;
  report.transport = transport.summary();
  assert.deepEqual(errors, []);
  report.status = "passed";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (page) await page.screenshot({ path: join(output, "chat-browser-zoom-failed.png"), timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  writeFileSync(join(output, "browser-zoom.json"), JSON.stringify(report, null, 2) + "\n");
  await context?.close();
  rmSync(temporary, { recursive: true, force: true });
}
