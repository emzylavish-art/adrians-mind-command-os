import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { isolateWorkspace } from "./isolate-workspace.mjs";

const origin = process.env.BASE_URL ?? "http://127.0.0.1:4195";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use an isolated local preview.");
const artifacts = process.env.VISUAL_ARTIFACT_DIR ?? "/tmp/mind-os-bot-journey";
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch();
try {
  for (const spec of [{ width: 390, height: 844, theme: "dark" }, { width: 1280, height: 900, theme: "light" }]) {
    const { theme, ...viewport } = spec;
    const context = await browser.newContext({ viewport, reducedMotion: "reduce", serviceWorkers: "block" });
    await isolateWorkspace(context, origin);
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.addInitScript((value) => localStorage.setItem("amcos.theme.v1", value), theme);
    const capture = (name) => page.screenshot({ path: join(artifacts, `${theme}-${name}.png`) });
    const button = (name) => page.getByRole("button", { name, exact: true });
    async function jump(label) {
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Search", exact: true }).fill(label);
      await page.getByRole("option", { name: new RegExp(`^${label} Go to$`, "i") }).click();
    }
    await page.goto(origin, { waitUntil: "networkidle" });
    await jump("Bots");
    await page.getByRole("heading", { name: "Your bots", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Archived bots/ }).count(), 0);
    await page.getByText("Start from a template", { exact: true }).click();
    const artwork = page.locator('img[src="/brand/bot-template-studio.webp"]');
    await artwork.scrollIntoViewIfNeeded();
    await artwork.evaluate((el) => el.decode());
    await capture("templates");
    await page.getByText("Start from a template", { exact: true }).click();
    await button("Create bot").click();
    await page.getByLabel("Bot name").fill("Sample review bot");
    await page.getByLabel("Instructions").fill("Write a short review of the sample project.");
    await button("Check capabilities").click();
    await page.getByText(/1 selected · 1 available/).waitFor();
    await page.getByLabel("Bot name").scrollIntoViewIfNeeded();
    await capture("builder");
    await button("Save bot").click();
    await page.getByText("Sample review bot saved.").waitFor();
    await button("Open chat").scrollIntoViewIfNeeded();
    await capture("saved");

    await button("Open chat").click();
    await jump("Bots");
    await button("Open chat").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("amcos.workspace.v1")).chats.filter((chat) => chat.agentId).length === 1);
    await jump("Bots");
    await button("Run task").click();
    assert.ok(await page.getByLabel("Choose agent", { exact: true }).inputValue());
    await page.getByLabel("Task", { exact: true }).fill("List the saved projects");
    await button("Queue run").click();
    await button("Run worker once").click();
    await button("Run worker once").click();
    await page.getByText(/Sample review bot · completed/).waitFor();
    await jump("Bots");
    await button("Schedule").click();
    await page.getByLabel("Job name").fill("Daily review");
    await page.getByLabel("Hour", { exact: true }).fill("27");
    await button("Add daily job").click();
    await page.getByText("Enter a whole hour from 0 to 23.").waitFor();
    await page.getByLabel("Hour", { exact: true }).fill("10");
    await page.getByLabel("Time zone").fill("UTC");
    await button("Add daily job").click();
    await page.getByText("Daily review", { exact: true }).waitFor();
    await jump("Bots");
    await page.getByText("Manage Sample review bot", { exact: true }).click();
    await button("Archive").click();
    await button("Confirm archive").click();
    await jump("Scheduled");
    await button("Jobs").click();
    await page.getByText("Agent archived", { exact: true }).waitFor();
    await capture("archive-blocker");
    await jump("Bots");
    await button("Archived bots (1)").click();
    await button("Restore Sample review bot").click();
    await page.getByText("Sample review bot restored.").waitFor();
    console.log(`${theme} ${viewport.width}×${viewport.height}: save, reopen, local run, schedule validation, archive and restore passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
