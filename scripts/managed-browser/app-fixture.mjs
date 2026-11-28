import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createBrowserRuntime } from "./runtime.mjs";
import { createBrowserWorker } from "./server.mjs";

const executablePath = process.env.MIND_BROWSER_FIXTURE_CHROMIUM;
if (!executablePath) throw new Error("Set MIND_BROWSER_FIXTURE_CHROMIUM to an installed Chromium executable.");
const directory = await mkdtemp(resolve(tmpdir(), "adrian-managed-browser-"));
const artifacts = resolve(process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/managed-browser");
const app = "http://127.0.0.1:4289";
const origin = "https://fixture.example";
const token = randomBytes(32).toString("hex");
const hits = [];
const worker = createBrowserRuntime({
  origins: new Set([origin]), executablePath,
  chromiumSandbox: process.env.MIND_BROWSER_FIXTURE_NO_SANDBOX !== "1",
  pin: async () => "93.184.216.34",
  load: async url => {
    hits.push(url.href);
    const document = url.pathname === "/guide" ? "<h1>Managed fixture guide</h1>" :
      '<h1>Adrian browser fixture</h1><a style="position:absolute;left:8px;top:95px" href="/guide">Read the guide</a>';
    return { contentType: "text/html", body: Buffer.from(document) };
  },
});
const http = createBrowserWorker({ runtime: worker, token });
let browser, child;
try {
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  child = spawn(process.execPath, ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", "4289", "--strictPort"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      PATH: resolve("node_modules/.bin") + ":" + process.env.PATH,
      ADRIAN_DATA_DIR: directory,
      XAI_INFERENCE_ENV_FILE: resolve(directory, "no-provider-credentials.env"),
      VITE_AUTH_ENABLED: "true",
      BETTER_AUTH_URL: app,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      ADRIAN_MANAGED_BROWSER_URL: "http://127.0.0.1:" + http.address().port,
      ADRIAN_MANAGED_BROWSER_TOKEN: token,
      ADRIAN_MANAGED_BROWSER_ORIGINS: origin,
    },
  });
  let ready = false;
  for (let attempt = 0; attempt < 80 && child.exitCode === null; attempt++) {
    try {
      if ((await fetch(app + "/__app-env", { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; }
    } catch { /* server warming */ }
    await delay(500);
  }
  assert.equal(ready, true, "Local app ready");

  browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  // Local email/password test account. The cookie is set by the real auth route.
  const signedIn = await context.request.post(app + "/api/auth/sign-up/email", {
    headers: { origin: app },
    data: { name: "Managed browser fixture", email: "fixture@example.test", password: "local-fixture-approval-2026" },
  });
  assert.equal(signedIn.status(), 200, await signedIn.text());
  const user = (await signedIn.json()).user.id;
  const secondDevice = await browser.newContext();
  const secondSignIn = await secondDevice.request.post(app + "/api/auth/sign-in/email", {
    headers: { origin: app }, data: { email: "fixture@example.test", password: "local-fixture-approval-2026" },
  });
  assert.equal(secondSignIn.status(), 200);
  const sessionCenter = app + "/api/mind/sessions";
  const priorSessions = await (await context.request.get(sessionCenter)).json();
  assert.equal(priorSessions.sessions.length, 2);
  const currentId = priorSessions.sessions.find(session => session.current).id;
  const lockdown = (id, origin) => context.request.post(sessionCenter, {
    headers: { origin }, data: { action: "lockdown", currentId: id },
  });
  assert.equal((await lockdown(currentId, "https://outside.example")).status(), 403);
  assert.equal((await lockdown("stale-current-session-id", app)).status(), 409);
  const locked = await lockdown(currentId, app);
  assert.equal(locked.status(), 200, await locked.text());
  assert.equal((await locked.json()).remainingOther, 0);
  assert.equal((await secondDevice.request.get(sessionCenter)).status(), 401);
  assert.equal((await context.request.get(sessionCenter)).status(), 200);
  await secondDevice.close();
  const route = (context, body, headers = {}) => context.request.post(app + "/api/mind/managed-browser", {
    headers: { origin: app, ...headers }, data: { owner: user, ...body },
  });
  assert.equal((await route(context, { action: "list" }, { origin: "https://other.example" })).status(), 403);
  assert.equal((await route(context, { action: "list", owner: "someone-else" })).status(), 409);
  const anonymous = await browser.newContext();
  assert.equal((await route(anonymous, { action: "list" })).status(), 401);
  await anonymous.close();

  await page.goto(app + "/?section=chat", { waitUntil: "domcontentloaded" });
  const activity = page.getByTestId("browser-activity");
  await activity.getByRole("button", { name: "Browser", exact: true }).click();
  await page.getByRole("button", { name: "Managed browser", exact: true }).click();
  const managed = page.getByRole("region", { name: "Managed browsing" });
  await managed.getByRole("textbox", { name: "Website", exact: true }).fill(origin);
  await managed.getByRole("button", { name: "Review website" }).click();
  assert.deepEqual(hits, []);
  await managed.getByRole("button", { name: "Approve and open" }).click();
  await managed.getByRole("img", { name: "Browser view of /", exact: true }).waitFor();
  await managed.getByRole("button", { name: "Take control" }).click();
  await managed.getByText("Links in this view", { exact: true }).click();
  await managed.getByRole("button", { name: "Read the guide", exact: true }).waitFor();
  const image = managed.getByRole("img", { name: "Browser view of /", exact: true });
  const bounds = await image.boundingBox();
  assert.ok(bounds);
  await image.click({ position: { x: bounds.width * 25 / 1120, y: bounds.height * 100 / 720 } });
  await managed.getByRole("img", { name: "Browser view of /guide", exact: true }).waitFor();
  await managed.getByRole("button", { name: "Hand back" }).click();
  await managed.getByRole("button", { name: "Review screenshot" }).click();
  const review = page.getByRole("dialog", { name: "Review screenshot" });
  await review.getByRole("img", { name: "Screenshot of fixture.example" }).waitFor();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, "managed-browser-screenshot-review.png") });
  await review.getByRole("button", { name: "Save screenshot" }).click();
  await page.getByRole("button", { name: "Close panel" }).click();
  await activity.getByRole("img", { name: "Screenshot of fixture.example" }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app + "/?section=build", { waitUntil: "domcontentloaded" });
  await activity.getByRole("button", { name: "Browser", exact: true }).click();
  await page.getByRole("button", { name: "Managed browser", exact: true }).click();
  await managed.getByRole("button", { name: "Check state" }).click();
  await managed.getByRole("img", { name: "Browser view of /guide", exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, "managed-browser-build-mobile.png") });
  await managed.getByRole("button", { name: "Close session" }).click();
  await managed.getByText("https://fixture.example · Closed", { exact: true }).waitFor();
  assert.deepEqual(hits, [origin + "/", origin + "/guide"]);
  await writeFile(resolve(artifacts, "managed-browser.json"), JSON.stringify({
    localAuth: true, lockdownKeptCurrentSession: true, anonymousAndCrossOriginBlocked: true, consentBeforeNavigation: true,
    chatScreenshot: true, mobileBuildRecovery: true, closed: true, externalNetworkRequests: 0,
    sandboxEnabled: process.env.MIND_BROWSER_FIXTURE_NO_SANDBOX !== "1",
  }, null, 2) + "\n");
} finally {
  await browser?.close();
  http.close();
  await worker.close();
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await Promise.race([stopped, delay(3000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await rm(directory, { recursive: true, force: true });
}
