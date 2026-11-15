import { chromium } from "playwright";

const out = "/home/ubuntu/adrians-mind-command-os/proof/eve-body-finished.png";
const replaced = "/home/ubuntu/adrians-mind-command-os/proof/eve-body-first.png";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("Switch between Chat, Build, Intelligence, and EVE").click();
  await page.getByRole("menuitem", { name: /EVE/ }).click();
  await page.getByLabel("Ask EVE").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator(".eve-stage-panel").screenshot({ path: out });
  await page.locator(".eve-stage-panel").screenshot({ path: replaced });
  console.log(JSON.stringify({ ok: true, out }));
} finally {
  await browser.close();
}
