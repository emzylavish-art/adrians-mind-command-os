import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});

async function shot(page, name) {
  await page.screenshot({ path: `${root}/${name}.png`, fullPage: false });
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const notes = [];
try {
  await desktop.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await desktop.waitForTimeout(800);
  await shot(desktop, "visual-chat-desktop");
  for (const label of ["Build", "Intelligence", "EVE", "Plugins"]) {
    await desktop.getByRole("button", { name: label, exact: true }).first().click();
    await desktop.waitForTimeout(700);
    await shot(desktop, `visual-${label.toLowerCase()}-desktop`);
    notes.push(label);
  }
  await desktop.getByRole("button", { name: "Open Settings" }).click();
  await desktop.waitForTimeout(600);
  await shot(desktop, "visual-settings-desktop");
} catch (error) {
  notes.push(error instanceof Error ? error.message : String(error));
  await shot(desktop, "visual-desktop-error").catch(() => undefined);
}

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await phone.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await phone.waitForTimeout(800);
  await shot(phone, "visual-chat-phone");
  const menu = phone.getByRole("button", { name: "Open menu" });
  if (await menu.count()) {
    await menu.click();
    await phone.waitForTimeout(400);
    await shot(phone, "visual-phone-drawer");
  }
} catch (error) {
  notes.push(error instanceof Error ? error.message : String(error));
  await shot(phone, "visual-phone-error").catch(() => undefined);
}
console.log(JSON.stringify({ notes }));
await browser.close();
