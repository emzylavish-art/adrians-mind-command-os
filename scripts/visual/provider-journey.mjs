// Start an isolated local app with GEMINI_API_KEY=fixture-only and no real credentials.
// Run BASE_URL=http://127.0.0.1:8080 node scripts/visual/provider-journey.mjs.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { isolateWorkspace } from "./isolate-workspace.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:4195").origin;
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use an isolated local preview.");

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "Gemini BYOK Fixture",
  host: "fixture.invalid",
  defaultModel: "gemini-2.5-flash-lite",
  models: ["gemini-2.5-flash-lite"],
  status: "catalogued",
  lastError: "",
  hasKey: true,
};
const customId = `custom:${row.id}:${row.defaultModel}`;
const models = new Map([
  ["gemini", { provider: "gemini", model: "gemini-2.0-flash" }],
  [customId, { provider: row.label, model: row.defaultModel }],
]);

async function openControls(page) {
  const controls = page.getByRole("button", { name: "Open controls", exact: true });
  if (await controls.getAttribute("aria-expanded") !== "true") await controls.click();
}

async function selectProvider(page, id) {
  await openControls(page);
  if (id === "gemini") {
    await page.getByTestId("control-module-gemini").click();
    return;
  }
  await page.getByText("Connect a new service", { exact: true }).click();
  const apiKeys = page.locator("details").filter({ has: page.getByTestId("custom-ai-providers") }).last();
  if (!await apiKeys.evaluate((element) => element.open)) await apiKeys.locator(":scope > summary").click();
  await page.getByRole("button", { name: `Use ${row.label} ${row.defaultModel} in chat`, exact: true }).click();
}

async function verifyHistory(page, saved) {
  for (const { text, provider, model } of saved) {
    const turn = page.locator("article.turn-assistant").filter({ has: page.getByText(text, { exact: true }) });
    await turn.waitFor();
    const heading = await turn.locator(":scope > p").first().innerText();
    assert.ok(heading.startsWith(`${provider} · ${model} ·`), `Wrong historical attribution: ${heading}`);
  }
}

for (const order of [["gemini", customId], [customId, "gemini"]]) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1363, height: 936 }, serviceWorkers: "block" });
    try {
      await isolateWorkspace(context, origin);
      await context.route(`${origin}/api/mind/providers`, (route) => {
        assert.equal(route.request().method(), "GET", "Choosing a model must not edit the provider registry");
        return route.fulfill({ json: { ok: true, providers: [row] } });
      });
      const requests = [];
      await context.route(`${origin}/api/mind/turn`, (route) => {
        if (route.request().method() === "GET") {
          return route.fulfill({ json: { operationId: `${Date.now()}-${crypto.randomUUID()}` } });
        }
        assert.match(route.request().headers()["x-mind-turn-id"] || "", /^\d{13}-/);
        const body = route.request().postDataJSON();
        requests.push(body);
        const identity = models.get(body.provider);
        if (!identity) return route.fulfill({ status: 400, json: { error: "Unexpected fixture provider" } });
        const done = { ...identity, text: `Fixture reply ${requests.length}`, usedIds: [], usage: null, requestId: `fixture-${requests.length}` };
        return route.fulfill({ contentType: "text/event-stream", body: `event: delta\ndata: ${JSON.stringify({ text: done.text })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n` });
      });

      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(origin, { waitUntil: "networkidle" });
      const saved = [];
      for (const id of order) {
        await selectProvider(page, id);
        await verifyHistory(page, saved);
        const input = page.getByRole("textbox", { name: "Message", exact: true });
        await input.fill(`Provider acceptance ${saved.length + 1}`);
        await input.press("Enter");
        const text = `Fixture reply ${saved.length + 1}`;
        await page.locator("article.turn-assistant").getByText(text, { exact: true }).waitFor();
        // Reload at the first observable completed reply, without waiting for storage or a debounce.
        await page.reload({ waitUntil: "domcontentloaded" });
        saved.push({ text, ...models.get(id) });
        await verifyHistory(page, saved);
        assert.equal(requests.length, saved.length);
        assert.equal(requests.at(-1).provider, id);
        await openControls(page);
        const selected = page.getByTestId(`control-module-${id}`);
        await selected.waitFor();
        assert.equal(await selected.getAttribute("aria-checked"), "true");
        console.log(`PASS first send, immediate reload, selection and attribution: ${id} (turn ${saved.length})`);
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
