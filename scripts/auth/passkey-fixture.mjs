import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const executablePath = process.env.MIND_BROWSER_FIXTURE_CHROMIUM;
if (!executablePath) throw Error("Set MIND_BROWSER_FIXTURE_CHROMIUM to an installed Chromium executable.");
const directory = await mkdtemp(resolve(tmpdir(), "adrian-passkey-"));
const port = "4290";
const origin = "http://localhost:" + port;
const auth = origin + "/api/auth";
const settings = "/?section=settings&pane=sessions";
let browser;
const child = spawn(process.execPath, ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", port, "--strictPort"], {
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    PATH: resolve("node_modules/.bin") + ":" + process.env.PATH,
    ADRIAN_DATA_DIR: directory,
    XAI_INFERENCE_ENV_FILE: resolve(directory, "no-provider-credentials.env"),
    VITE_AUTH_ENABLED: "true",
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    ADRIAN_PASSKEY_ORIGIN: origin,
  },
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 90 && child.exitCode === null; attempt++) {
    try {
      if ((await fetch(origin + "/__app-env", { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; }
    } catch { /* server warming */ }
    await delay(500);
  }
  assert.equal(ready, true, "Local app ready");
  browser = await chromium.launch({ executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();
  const devtools = await context.newCDPSession(page);
  await devtools.send("WebAuthn.enable");
  await devtools.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  const password = randomBytes(18).toString("hex");
  async function signUp(client, name) {
    const response = await client.post(auth + "/sign-up/email", {
      headers: { origin }, data: { name, email: name + "@example.test", password },
    });
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).user.id;
  }
  const unrelated = await browser.newContext();
  assert.equal((await unrelated.request.get(auth + "/passkey/generate-register-options")).status(), 401);
  const owner = await signUp(context.request, "passkey-owner");
  await signUp(unrelated.request, "different-owner");
  assert.equal((await context.request.get(auth + "/passkey/generate-register-options", {
    headers: { origin: "https://outside.example" },
  })).status(), 403);
  await page.goto(origin + settings, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Refresh verified sessions" }).click({ timeout: 60_000 });
  const panel = page.getByRole("region", { name: "Passkeys" });
  await panel.getByRole("textbox", { name: "Passkey name" }).fill("Fixture security key");
  await panel.getByRole("button", { name: "Add passkey" }).click();
  await panel.getByText("Passkey enrollment confirmed.", { exact: true }).waitFor();
  const registered = await (await context.request.get(auth + "/passkey/list-user-passkeys")).json();
  assert.equal(registered.length, 1);
  assert.deepEqual(await (await unrelated.request.get(auth + "/passkey/list-user-passkeys")).json(), []);
  assert.equal((await unrelated.request.post(auth + "/passkey/delete-passkey", {
    headers: { origin }, data: { id: registered[0].id },
  })).ok(), false);
  await unrelated.close();

  const signedOut = await context.request.post(auth + "/sign-out", { headers: { origin }, data: {} });
  assert.equal(signedOut.status(), 200, await signedOut.text());
  assert.equal((await context.request.get(auth + "/passkey/list-user-passkeys")).status(), 401);
  await page.goto(origin + "/login?next=" + encodeURIComponent(settings), { waitUntil: "domcontentloaded" });
  const verified = page.waitForResponse(auth + "/passkey/verify-authentication");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  const signIn = await verified;
  assert.equal(signIn.status(), 200);
  await page.getByRole("button", { name: "Refresh verified sessions" }).click();
  assert.equal(new URL(page.url()).searchParams.get("pane"), "sessions");
  assert.equal((await (await context.request.get(auth + "/owner")).json()).user.id, owner);
  await panel.getByRole("button", { name: "Refresh passkeys" }).click();
  page.once("dialog", dialog => void dialog.accept());
  await panel.getByRole("button", { name: "Remove Fixture security key" }).click();
  await panel.getByText("Passkey removal confirmed.", { exact: true }).waitFor();
  assert.deepEqual(await (await context.request.get(auth + "/passkey/list-user-passkeys")).json(), []);
  const receipt = {
    actualChromium: true, enrollmentReadback: true, accountIsolation: true,
    crossOriginAndUnauthenticatedRegistrationDenied: true, signInRestoredOwner: true, removalReadback: true,
  };
  console.log(JSON.stringify(receipt));
  if (process.env.VISUAL_ARTIFACT_DIR) {
    const artifacts = resolve(process.env.VISUAL_ARTIFACT_DIR);
    await mkdir(artifacts, { recursive: true });
    await writeFile(resolve(artifacts, "passkey-fixture.json"), JSON.stringify(receipt, null, 2) + "\n");
  }
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await rm(directory, { recursive: true, force: true });
}
