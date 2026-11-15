import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = { speak: {}, stop: {}, editor: [], settings: [], failures: [] };

function fail(message) {
  report.failures.push(message);
}

async function openMenu(name) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForTimeout(300);
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(600);

try {
  await openMenu("Build");
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByTestId("owner-flow-speak").click();
  await page.getByTestId("speak-face").waitFor();
  await page.getByRole("button", { name: "Place call" }).click();
  await page.getByTestId("speak-status").filter({ hasText: /Spoken:/ }).waitFor({ timeout: 75000 });
  report.speak.status = (await page.getByTestId("speak-status").textContent())?.trim();
  report.speak.reply = (await page.getByTestId("speak-reply").textContent())?.trim();
  report.speak.stopButton = await page.getByRole("button", { name: /Emergency stop|Clear stop/ }).count();
  await page.screenshot({ path: `${root}/speak-reply-phone.png` });
  await page.getByRole("button", { name: "End call" }).click();
  await page.getByTestId("speak-stage").waitFor({ state: "hidden", timeout: 8000 });
  report.speak.closed = true;
} catch (error) {
  fail(`Speak: ${error instanceof Error ? error.message : error}`);
  await page.screenshot({ path: `${root}/speak-reply-phone.png` }).catch(() => undefined);
}

try {
  if (await page.getByTestId("speak-stage").count()) await page.getByRole("button", { name: "End call" }).click().catch(() => undefined);
  await openMenu("Build");
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  const stop = page.getByTestId("owner-flow-stop");
  await stop.click();
  await page.getByTestId("owner-flow-halt").filter({ hasText: "Emergency stop is on" }).waitFor({ timeout: 8000 });
  const runDisabled = await page.getByTestId("run-file_read").isDisabled();
  report.stop.on = (await page.getByTestId("owner-flow-halt").textContent())?.trim();
  report.stop.runDisabled = runDisabled;
  await page.getByTestId("owner-flow-speak").click();
  await page.getByTestId("speak-face").waitFor();
  report.stop.speakHasStop = await page.getByRole("button", { name: /Emergency stop|Clear stop/ }).count();
  await page.screenshot({ path: `${root}/speak-stop-phone.png` });
  await page.getByRole("button", { name: "End call" }).click();
  await stop.click();
  await page.getByTestId("owner-flow-halt").filter({ hasText: "Emergency stop is off" }).waitFor({ timeout: 8000 });
  report.stop.cleared = (await page.getByTestId("owner-flow-halt").textContent())?.trim();
} catch (error) {
  fail(`Stop: ${error instanceof Error ? error.message : error}`);
  await page.screenshot({ path: `${root}/speak-stop-phone.png` }).catch(() => undefined);
}

try {
  if (await page.getByTestId("speak-stage").count()) await page.getByRole("button", { name: "End call" }).click().catch(() => undefined);
  await openMenu("Build");
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  for (const label of ["Task", "Steps", "Changes", "Files", "Terminal", "Preview", "Status"]) {
    const button = page.getByRole("button", { name: label, exact: true }).first();
    await button.click();
    await page.waitForTimeout(250);
    const heading = (await page.locator("h3").filter({ hasText: /Agent output|Execution timeline|File-change review|Code editor|Integrated terminal|Coding browser|Capability inventory/ }).first().textContent().catch(() => ""))?.trim();
    report.editor.push({ label, heading: heading || "no heading" });
  }
  const file = page.getByRole("treeitem").first();
  if (await file.count()) {
    await file.click();
    report.editor.push({ label: "file", opened: (await file.getAttribute("aria-selected")) });
    const complete = page.getByRole("button", { name: "Complete" });
    if (await complete.isEnabled()) {
      await complete.click();
      await page.waitForTimeout(800);
      report.editor.push({ label: "Complete", notice: (await page.locator(".code-ide-results, .code-ide-empty").last().textContent())?.trim().slice(0, 120) });
    } else report.editor.push({ label: "Complete", disabled: true });
    const debug = page.getByRole("button", { name: "Debug" });
    if (await debug.isEnabled()) {
      await debug.click();
      await page.waitForTimeout(800);
      report.editor.push({ label: "Debug", notice: (await page.locator("[data-testid='debug-pause'], .code-ide-results").last().textContent())?.trim().slice(0, 160) });
    } else report.editor.push({ label: "Debug", disabled: true });
  } else {
    report.editor.push({ label: "file", opened: "none listed" });
  }
  await page.screenshot({ path: `${root}/editor-buttons-phone.png` });
} catch (error) {
  fail(`Editor: ${error instanceof Error ? error.message : error}`);
  await page.screenshot({ path: `${root}/editor-buttons-phone.png` }).catch(() => undefined);
}

const rows = [
  ["Safe keys", "Safe"],
  ["Data", "device"],
  ["Safety", "Emergency stop"],
  ["Appearance", "Appearance"],
  ["Voice", "Voice"],
  ["Connections", "provider"],
  ["Personalization", "Chat"],
  ["Plugins", "Connected"],
  ["Integrations", "Integrations"],
  ["Scheduled", "Scheduled"],
  ["Tools", "Tools"],
  ["Skills", "Skills"],
  ["Memory", "Memory"],
  ["Activity", "Activity"],
  ["Help", "Help"],
];

for (const [label, expect] of rows) {
  try {
    if (!page.url().includes("8080") || await page.getByRole("heading", { name: "Settings" }).count() === 0) {
      await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("button", { name: "Open Settings" }).click();
    } else if (await page.getByRole("button", { name: "Back" }).count()) {
      await page.getByRole("button", { name: "Back" }).click();
    }
    await page.getByRole("button", { name: new RegExp(label) }).first().click();
    await page.waitForTimeout(400);
    const text = (await page.locator("main, .main-stage").first().innerText()).slice(0, 400);
    const ok = text.toLowerCase().includes(expect.toLowerCase());
    report.settings.push({ label, ok, saw: text.replace(/\s+/g, " ").slice(0, 140) });
    if (!ok) fail(`Settings ${label} did not show ${expect}`);
  } catch (error) {
    fail(`Settings ${label}: ${error instanceof Error ? error.message : error}`);
    report.settings.push({ label, ok: false });
  }
}

try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Open Settings" }).click();
  await page.getByRole("button", { name: /Security and login/ }).click();
  await page.waitForURL(/login/, { timeout: 8000 });
  report.settings.push({ label: "Security and login", ok: page.url().includes("login") });
} catch (error) {
  fail(`Settings Security: ${error instanceof Error ? error.message : error}`);
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.failures.length || !String(report.speak.status || "").includes("Spoken:")) process.exit(1);
