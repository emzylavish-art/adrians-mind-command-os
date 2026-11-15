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
  await page.getByRole("button", { name: /Reply with the single/ }).first().click();
  await page.getByText("ready", { exact: true }).waitFor({ timeout: 10000 });
  const before = await page.locator("h2, h1").first().textContent();
  await page.locator("summary", { hasText: "Chat settings" }).click();
  const radios = page.locator("input[name='mind-provider-side']");
  await radios.first().waitFor({ timeout: 8000 });
  const options = await radios.evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute("value") || node.parentElement?.innerText?.split("\n")[0] || "",
    disabled: node.disabled,
    checked: node.checked,
    label: node.parentElement?.innerText?.replace(/\s+/g, " ").trim() || "",
  })));
  result.options = options;
  const next = options.find((item) => !item.checked && !item.disabled);
  if (!next) {
    result.switched = false;
    result.reason = "Only one provider is enabled. The chat was not cleared.";
  } else {
    const target = radios.nth(options.indexOf(next));
    await target.check();
    result.switched = true;
    result.switchedTo = next.label;
  }
  await page.getByText("ready", { exact: true }).waitFor({ timeout: 5000 });
  const after = await page.locator("h1, h2").filter({ hasText: "Reply with the single" }).textContent();
  result.thread = after;
  result.kept = Boolean(after && after.includes("Reply with the single"));
  await page.screenshot({ path: `${root}/provider-switch-proof.png` });
  result.ok = result.kept === true;
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  await page.screenshot({ path: `${root}/provider-switch-proof.png` }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
if (!result.ok) process.exit(1);
