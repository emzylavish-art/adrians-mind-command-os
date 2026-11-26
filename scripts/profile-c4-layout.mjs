/** Isolated schedule/IDE-chrome CSS fixture. Not a full application or device test.
 * CHROMIUM_EXECUTABLE and optional CHROMIUM_ARGS_JSON select an installed browser. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const shellCss = readFileSync(new URL("../src/components/mind/gpt-shell.css", import.meta.url), "utf8");
const baseCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const tokens = baseCss.match(/@theme\s*\{[^}]*\}/)?.[0].replace("@theme", ":root") ?? "";
const lightTokens = baseCss.match(/html\[data-theme="light"\]\s*\{[^}]*\}/)?.[0] ?? "";
const timezone = "America/Argentina/Buenos_Aires";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", ...JSON.parse(process.env.CHROMIUM_ARGS_JSON ?? "[]")] });
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    ${tokens}\n${lightTokens}
    *{box-sizing:border-box}body{margin:0;font:16px system-ui;padding:16px}.w-full{width:100%}.min-h-11{min-height:44px}.mt-1{margin-top:4px}.px-3{padding-inline:12px}.text-sm{font-size:14px}
    ${shellCss}
    </style></head><body><main class="main-stage"><div id="owner-scheduled" class="solid-form"><div class="job-fields">
    <label>Name<input class="w-full min-h-11 mt-1 px-3 text-sm" value="Morning notes"></label>
    <label>Task instruction<textarea class="w-full min-h-11 text-sm">Fixture task</textarea></label>
    <label>Time zone<input id="timezone" class="w-full min-h-11 mt-1 px-3 text-sm" aria-label="Time zone" value="${timezone}"></label>
    <label>Time<input type="time" class="w-full min-h-11 mt-1 px-3 text-sm" value="09:30"></label>
    <label>Agent<select class="w-full min-h-11 mt-1 px-3 text-sm"><option>Fixture agent</option></select></label><div><button>Save job</button></div>
    </div></div><div class="code-ide"><aside>Files</aside><section><div class="code-ide-tabs"><div class="code-ide-tab"><button>fixture.ts</button></div></div><div class="code-ide-editor"><div class="cm-editor">Editor chrome fixture</div></div></section></div></main></body></html>`);
  const geometry = [];
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const result = await page.evaluate(() => {
      const field = document.getElementById("timezone");
      const rect = field.getBoundingClientRect();
      return { viewport: innerWidth, timezoneWidth: Number(rect.width.toFixed(2)), value: field.value,
        documentWidth: document.documentElement.scrollWidth,
        fieldsInsideViewport: [...document.querySelectorAll("#owner-scheduled input,#owner-scheduled textarea,#owner-scheduled select")]
          .every(input => { const box=input.getBoundingClientRect(); return box.left>=0 && box.right<=innerWidth; }) };
    });
    assert.equal(result.value, timezone); assert.equal(result.fieldsInsideViewport, true);
    assert.ok(result.documentWidth <= width, "no horizontal document overflow");
    if (width >= 1100) assert.ok(result.timezoneWidth >= 200, "desktop time-zone control at least 200px");
    geometry.push(result);
  }
  const themes = [];
  for (const theme of ["dark", "light"]) {
    themes.push(await page.evaluate(theme => {
      document.documentElement.dataset.theme=theme;
      const aside=getComputedStyle(document.querySelector(".code-ide aside"));
      const tab=getComputedStyle(document.querySelector(".code-ide-tab button"));
      return {theme, surfaceToken:getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim(), asideBackground:aside.backgroundColor, tabColor:tab.color};
    },theme));
  }
  assert.notEqual(themes[0].asideBackground, themes[1].asideBackground, "IDE chrome follows the selected surface theme");
  assert.notEqual(themes[0].tabColor, themes[1].tabColor, "IDE tab text follows the selected foreground theme");
  console.log(JSON.stringify({chromium:await browser.version(), evidence:"Actual gpt-shell CSS and theme tokens in isolated representative schedule/IDE chrome markup; minimal Tailwind sizing utilities reproduced explicitly; CodeMirror and full application not mounted; no physical device", geometry, themes},null,2));
} finally { await browser.close(); }
