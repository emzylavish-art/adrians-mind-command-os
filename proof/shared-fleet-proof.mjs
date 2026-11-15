import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("details.nav-more > summary").click();
  await page.getByRole("button", { name: "Bots" }).click();
  const fleet = page.locator("[data-testid='shared-fleet']");
  await fleet.waitFor({ timeout: 15000 });
  const count = await page.locator("[data-testid='fleet-bot']").count();
  const text = await fleet.innerText();
  await page.screenshot({ path: "/home/ubuntu/adrians-mind-command-os/proof/shared-fleet.png", fullPage: false });
  const blocked = await page.locator("[data-testid='fleet-blocked']").innerText();
  const split = await page.locator("[data-testid='fleet-split']").innerText();
  const ok = count === 9 && text.includes("adrian-core") && text.includes("file_read") && blocked.includes("Mouse, keyboard, and browser stay blocked.") && split.includes("Windows installer") && split.includes("These nine can close locally");
  console.log(JSON.stringify({ ok, count }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
