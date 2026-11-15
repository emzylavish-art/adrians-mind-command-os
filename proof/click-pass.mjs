import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = { pages: [], speak: {}, failures: [] };

function note(error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(700);

const sections = ["Build", "Intelligence", "Research", "Projects", "Library", "Plugins", "Scheduled"];
for (const label of sections) {
  try {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: label, exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const buttons = await page.locator("button:visible").count();
    report.pages.push({ label, overflow, buttons });
    await page.screenshot({ path: `${root}/click-${label.toLowerCase()}-phone.png` });
  } catch (error) {
    note(`${label}: ${error instanceof Error ? error.message : error}`);
  }
}

try {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  await page.waitForTimeout(300);
  for (const name of ["Files", "Message", "Editor", "Actions"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(250);
  }
  report.pages.push({ label: "Build sections", ok: true });
  await page.getByTestId("owner-flow-speak").click();
  await page.getByTestId("speak-face").waitFor({ timeout: 8000 });
  const face = await page.getByTestId("speak-face").getAttribute("src");
  report.speak.face = face;
  report.speak.stop = await page.getByRole("button", { name: /Emergency stop|Clear stop/ }).count();
  await page.getByRole("button", { name: "Voice settings" }).click();
  await page.getByRole("button", { name: "Voice", exact: false }).first().click();
  await page.getByRole("button", { name: "Close voice settings" }).click();
  await page.getByRole("button", { name: "Transcript" }).click();
  await page.getByRole("button", { name: "Mute speaker" }).click();
  await page.getByRole("button", { name: "Unmute speaker" }).click();
  await page.screenshot({ path: `${root}/click-speak-phone.png` });
  report.speak.open = true;
  await page.getByRole("button", { name: "End call" }).click();
  await page.getByTestId("speak-stage").waitFor({ state: "hidden", timeout: 5000 });
  report.speak.closed = true;
} catch (error) {
  note(`Speak: ${error instanceof Error ? error.message : error}`);
  await page.screenshot({ path: `${root}/click-speak-phone.png` }).catch(() => undefined);
}

try {
  await page.getByRole("button", { name: "Open Settings" }).click({ timeout: 4000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${root}/click-settings-phone.png` });
  report.pages.push({ label: "Settings", overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) });
} catch (error) {
  note(`Settings: ${error instanceof Error ? error.message : error}`);
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.failures.length) process.exit(1);
