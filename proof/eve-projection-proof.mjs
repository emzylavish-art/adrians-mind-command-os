import { chromium } from "playwright";

const outNight = "/home/ubuntu/adrians-mind-command-os/proof/eve-projection-night.png";
const outOcean = "/home/ubuntu/adrians-mind-command-os/proof/eve-projection-ocean.png";

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const result = { ok: false, night: null, ocean: null, error: null };
try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("Switch between Chat, Build, Intelligence, and EVE").click();
  await page.getByRole("menuitem", { name: /EVE/ }).click();
  const box = page.getByLabel("Ask EVE");
  await box.waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
  await page.locator(".eve-stage-panel").screenshot({ path: "/home/ubuntu/adrians-mind-command-os/proof/eve-body-first.png" });
  await page.locator(".eve-stage-panel").screenshot({ path: "/home/ubuntu/adrians-mind-command-os/proof/eve-body-finished.png" });
  await box.fill("project a night sky");
  await page.waitForFunction(() => document.querySelector("[data-testid='eve-projection-label']")?.textContent?.includes("Night sky"));
  await page.waitForTimeout(700);
  result.night = await page.evaluate(() => {
    const swatch = document.querySelector("[data-testid='eve-projection-swatch']");
    const stage = document.querySelector("[data-testid='human-stage']");
    const note = document.querySelector("[data-testid='eve-projection']")?.textContent ?? "";
    return {
      label: document.querySelector("[data-testid='eve-projection-label']")?.textContent ?? "",
      swatch: swatch ? getComputedStyle(swatch).backgroundColor : "",
      stageProjection: stage?.getAttribute("data-projection") ?? "",
      note,
    };
  });
  await page.screenshot({ path: outNight });
  await box.fill("show the ocean");
  await page.waitForFunction(() => document.querySelector("[data-testid='eve-projection-label']")?.textContent?.includes("Ocean"));
  await page.waitForTimeout(700);
  result.ocean = await page.evaluate(() => {
    const swatch = document.querySelector("[data-testid='eve-projection-swatch']");
    const stages = [...document.querySelectorAll("[data-testid='human-stage']")].map((node) => node.getAttribute("data-projection"));
    const note = document.querySelector("[data-testid='eve-projection']")?.textContent ?? "";
    return {
      label: document.querySelector("[data-testid='eve-projection-label']")?.textContent ?? "",
      swatch: swatch ? getComputedStyle(swatch).backgroundColor : "",
      stageProjection: stages,
      note,
    };
  });
  await page.screenshot({ path: outOcean });
  const expression = page.getByLabel("Expression");
  if (await expression.count()) {
    await expression.selectOption("speaking");
    await page.waitForTimeout(500);
    await page.locator(".eve-stage-panel").first().screenshot({ path: "/home/ubuntu/adrians-mind-command-os/proof/eve-speaking.png" });
    result.speaking = await page.locator("[data-testid='human-stage']").first().getAttribute("data-viseme");
  }
  await page.getByTestId("owner-flow").scrollIntoViewIfNeeded();
  const run = page.getByTestId("run-file_write");
  result.runBefore = await run.isDisabled();
  await page.getByTestId("approve-file_write").click();
  result.runAfter = await run.isDisabled();
  result.exact = await page.locator("[data-testid='owner-action-file_write']").innerText();
  await page.screenshot({ path: "/home/ubuntu/adrians-mind-command-os/proof/owner-run-on.png" });
  await page.getByTestId("eve-talk-open").click();
  await page.getByTestId("speak-face").waitFor({ timeout: 8000 });
  result.speakFace = await page.getByTestId("speak-face").getAttribute("src");
  await page.screenshot({ path: "/home/ubuntu/adrians-mind-command-os/proof/speak-face.png" });
  result.ok = result.night.swatch !== result.ocean.swatch
    && result.night.label.includes("Night sky")
    && result.ocean.label.includes("Ocean")
    && result.ocean.note.includes("Windows desktop is not changed")
    && result.runBefore === true
    && result.runAfter === false
    && result.speakFace === "/brand/eve-idle.jpg";
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: "/home/ubuntu/adrians-mind-command-os/proof/eve-projection-error.png" }).catch(() => undefined);
} finally {
  console.log(JSON.stringify(result));
  await browser.close();
}
if (!result.ok) process.exit(1);
