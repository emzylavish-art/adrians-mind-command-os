#!/usr/bin/env node
/**
 * AM-004: exercise real login controls in a disposable, local Chromium session.
 * Never submit credentials, initiate OAuth or call an AI model.
 * Run from the isolated GitHub Actions workflow while the local dev server lives.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(process.argv[2] || "http://127.0.0.1:8080/");
const isRunner = process.env.GITHUB_ACTIONS === "true" && Boolean(process.env.RUNNER_TEMP);
const outputDir = isRunner
  ? resolve(process.env.RUNNER_TEMP, "am-002-browser-smoke")
  : "/workspace/screenshots";
const allowDirs = isRunner ? ["/workspace", outputDir] : ["/workspace"];
const evidence = (filename) => checkedOutputPath(resolve(outputDir, filename), allowDirs);
mkdirSync(outputDir, { recursive: true });

const report = { target: new URL(base).origin, checked: [], ok: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
    const loginUrl = new URL("/login?next=%2Fdashboard", base).href;
    const response = await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `${viewport.name}: login returned non-200`);
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor({ timeout: 15000 });
    // SSR headings can appear before React has installed client event handlers.
    // Wait for the login bundle to hydrate before exercising interactive controls.
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    const password = page.getByTestId("login-password-input");
    const toggle = page.getByTestId("login-password-toggle");
    await password.waitFor();
    await page.screenshot({
      path: evidence(`login-${viewport.name}.png`),
      fullPage: false,
      caret: "initial",
    });

    // The password control must change the actual input type and ARIA state.
    assert.equal(await password.getAttribute("type"), "password");
    await toggle.click();
    assert.equal(await password.getAttribute("type"), "text", `${viewport.name}: password not revealed`);
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await toggle.click();
    assert.equal(await password.getAttribute("type"), "password", `${viewport.name}: password not hidden`);
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");

    // Sign-up and back must update the visible form, without network submission.
    await page.getByRole("tab", { name: "Sign up" }).click();
    await page.getByRole("heading", { name: "Create account" }).waitFor({ timeout: 10000 });
    assert.equal(await password.getAttribute("minlength"), "8");
    await page.getByRole("tab", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    assert.equal(await password.getAttribute("minlength"), "1");

    // Every provider button must exist. Disabled services must explain why;
    // enabled services are NOT clicked in a credential-free CI environment.
    const providerStatus = {};
    for (const id of ["google", "github", "apple", "x"]) {
      const button = page.getByTestId(`login-oauth-${id}`);
      await button.waitFor();
      const disabled = await button.isDisabled();
      if (disabled) {
        const note = page.getByTestId(`login-oauth-${id}-note`);
        assert.ok(await note.isVisible(), `${id}: disabled button has no setup explanation`);
        assert.ok((await note.innerText()).trim().length > 8);
      }
      providerStatus[id] = disabled ? "disabled_with_explanation" : "enabled_unverified";
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    assert.equal(overflow, false, `${viewport.name}: login has horizontal overflow`);
    assert.deepEqual(pageErrors, [], `${viewport.name}: uncaught browser exception`);

    // The back link must navigate; the protected dashboard must reject an
    // anonymous visitor. No signed-in provider/session test is claimed.
    await page.getByTestId("login-back-home").click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 12000 });
    const guarded = await context.newPage();
    const dash = await guarded.goto(new URL("/dashboard", base).href, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await guarded.waitForURL((url) => url.pathname === "/login", { timeout: 12000 });
    const finalPath = new URL(guarded.url()).pathname;
    assert.equal(finalPath, "/login", `${viewport.name}: anonymous dashboard accessible`);

    report.checked.push({
      viewport: viewport.name,
      loginHttpStatus: response?.status(),
      passwordToggle: "passed",
      signupTabRoundtrip: "passed",
      oauthButtons: providerStatus,
      backLink: "passed",
      anonymousDashboard: "redirected_to_login",
      dashboardFirstResponse: dash?.status() ?? null,
      horizontalOverflow: false,
      uncaughtExceptions: 0,
    });
    await context.close();
  }
  report.ok = true;
  writeFileSync(evidence("auth-interactions.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error?.message || error);
  writeFileSync(evidence("auth-interactions.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
