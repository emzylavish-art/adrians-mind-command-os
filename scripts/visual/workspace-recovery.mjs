import assert from "node:assert/strict";
import { chromium } from "playwright";
import { isolateWorkspace } from "./isolate-workspace.mjs";

const origin = process.env.BASE_URL ?? "http://127.0.0.1:4196";
const fixtureKey = "visual-audit-fixture-only-copy-sentinel";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use an isolated local preview.");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await isolateWorkspace(context, origin);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(`${origin}/?section=help`, { waitUntil: "networkidle" });
  const search = page.getByRole("textbox", { name: "Search help" });
  const keyTopic = page.getByRole("button", { name: /Copy a saved API key/ });
  const noResults = page.getByText(/No help topics match this search/);
  await search.fill("copy key");
  await keyTopic.waitFor();
  assert.equal(await noResults.count(), 0);
  await search.fill("no match test 98");
  await noResults.waitFor();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await keyTopic.click();

  // Check slot metadata before opening the copy action, then verify only the fixture.
  const slot = page.getByTestId("owner-key-module");
  await slot.getByText("Configured · inel", { exact: true }).waitFor();
  await slot.getByRole("button", { name: "Copy Module", exact: true }).click();
  await slot.getByRole("status").filter({ hasText: "Copied" }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied === fixtureKey, "Clipboard should contain the synthetic test key");
  await page.evaluate(() => navigator.clipboard.writeText(""));

  await page.goBack();
  await page.getByRole("heading", { name: "Help", exact: true }).waitFor();
  await page.goForward();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();

  await page.goto(`${origin}/?section=files`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.locator('input[type=file][accept*="application/pdf"]').setInputFiles({
    name: "review.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Length 40 >> stream\n(Proof from a file) Tj\nendstream endobj\n"),
  });
  await page.getByText("Proof from a file", { exact: true }).waitFor();

  await page.goto(`${origin}/?section=memory`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Imports & Exports", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Save note", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Open import settings", exact: true }).click();
  const importFile = page.getByLabel("Import archive", { exact: true });
  await importFile.waitFor();
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export archive", exact: true }).click();
  const download = await downloadReady;
  await importFile.setInputFiles(await download.path());
  await page.getByRole("table").getByRole("row").filter({ hasText: "Files" }).getByRole("cell", { name: "1", exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  assert.equal(await page.getByRole("table").count(), 0);
  console.log("Help search, synthetic clipboard copy, browser history, Library PDF preview, and archive preview/cancel passed.");
} finally {
  await browser.close();
}
