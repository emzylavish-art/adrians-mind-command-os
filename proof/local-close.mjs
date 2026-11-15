import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = { groups: [], approvals: [] };

async function menu(label) {
  await page.getByRole("button", { name: "Open menu" }).click();
  const item = page.getByRole("button", { name: label, exact: true });
  if (!(await item.count())) await page.getByRole("dialog", { name: "Workspace navigation" }).locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(250);
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await menu("Build");
await page.getByRole("navigation", { name: "Build sections" }).getByRole("button", { name: "Actions", exact: true }).click();
const cannot = (await page.getByTestId("cannot-run").textContent()) || "";
report.labels = {
  browserPointer: cannot.includes("Browser pointer on your PC"),
  microphone: cannot.includes("Microphone after the browser closes"),
};
for (const id of ["file_read", "file_write", "file_delete", "terminal"]) {
  if (!(await page.getByTestId(`run-${id}`).isDisabled())) throw new Error(`${id} was runnable before approval`);
  await page.getByTestId(`approve-${id}`).click();
  if (await page.getByTestId(`run-${id}`).isDisabled()) throw new Error(`${id} stayed disabled after approval`);
  await page.getByTestId(`run-${id}`).click();
  await page.getByTestId(`owner-result-${id}`).waitFor({ timeout: 20000 });
  report.approvals.push({ id, result: (await page.getByTestId(`owner-result-${id}`).textContent())?.trim() });
}
await page.screenshot({ path: `${root}/hosted-approvals.png` });

for (const [section, nav, bands] of [
  ["Research", "Research page", ["Ask", "Saved", "Files"]],
  ["Library", "Library groups", ["Files", "Preview"]],
  ["Scheduled", "Schedule groups", ["Jobs", "New job"]],
  ["Build", "Build sections", ["Actions", "Workspace", "Message", "Editor"]],
]) {
  await menu(section);
  for (const band of bands) {
    await page.getByRole("navigation", { name: nav }).getByRole("button", { name: band, exact: true }).click();
    report.groups.push(`${section}:${band}`);
  }
}
await menu("EVE");
for (const band of ["Talk", "Status", "Pairing", "Tasks", "Figure", "Records"]) {
  await page.getByRole("navigation", { name: "EVE groups" }).getByRole("button", { name: band, exact: true }).click();
  report.groups.push(`EVE:${band}`);
}

await menu("Build");
await page.getByRole("navigation", { name: "Build sections" }).getByRole("button", { name: "Actions", exact: true }).click();
await page.getByTestId("owner-flow-speak").click();
await page.getByTestId("speak-face").waitFor();
report.speakFace = await page.getByTestId("speak-face").getAttribute("src");
report.stopOnSpeak = await page.getByRole("button", { name: "Emergency stop" }).count();
await page.getByRole("button", { name: "Place call" }).click();
await page.getByTestId("speak-status").filter({ hasText: "Spoken:" }).waitFor({ timeout: 80000 });
report.spoken = (await page.getByTestId("speak-status").textContent())?.trim();
await page.screenshot({ path: `${root}/speak-close-proof.png` });
await page.getByRole("button", { name: "End call" }).click();
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.labels.browserPointer || !report.spoken?.startsWith("Spoken:") || report.approvals.length !== 4) process.exit(1);
