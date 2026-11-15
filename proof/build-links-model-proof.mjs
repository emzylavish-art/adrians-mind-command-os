import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const result = { ok: false };
try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "Plugins", exact: true }).first().click();
  await page.getByRole("heading", { name: "Build links" }).waitFor({ timeout: 10000 });
  const kimiHeading = await page.getByRole("heading", { name: "Kimi links" }).count();
  result.kimiHeading = kimiHeading;
  result.buildLinks = true;
  await page.screenshot({ path: `${root}/build-links-proof.png` });
  await page.getByLabel("Switch between Chat, Build, Intelligence, and EVE").click();
  await page.getByRole("menuitem", { name: /^Chat/ }).click();
  const field = page.getByLabel("Command");
  await field.waitFor({ timeout: 10000 });
  await field.fill("Reply with the single word ready.");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  const notice = page.locator("[data-testid='composer-notice'], .voice-copy").first();
  await notice.waitFor({ timeout: 45000 });
  await page.waitForFunction(() => {
    const text = document.querySelector(".voice-copy")?.textContent ?? "";
    return /Responded .+ · .+/.test(text) || /Ran .+/.test(text);
  }, { timeout: 45000 }).catch(() => undefined);
  result.notice = (await notice.textContent())?.trim() ?? "";
  result.named = /Responded .+ · .+/.test(result.notice);
  await page.screenshot({ path: `${root}/model-reply-proof.png` });
  result.ok = result.buildLinks === true && kimiHeading === 0 && result.named === true;
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  await page.screenshot({ path: `${root}/model-reply-proof.png` }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
if (!result.ok) process.exit(1);
