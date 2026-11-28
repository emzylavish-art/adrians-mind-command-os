import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";

const executablePath = process.env.MIND_BROWSER_FIXTURE_CHROMIUM;
if (!executablePath) throw Error("Set MIND_BROWSER_FIXTURE_CHROMIUM to an installed Chromium executable.");
const directory = await mkdtemp(resolve(tmpdir(), "adrian-passkey-"));
const port = "4290";
const origin = "http://localhost:" + port;
const auth = origin + "/api/auth";
const settings = "/?section=settings&pane=sessions";
let browser;
const mailLog = resolve(directory, "mail.jsonl");
const mailFixture = resolve(directory, "mail.mjs");
await writeFile(mailFixture, `import { appendFile } from "node:fs/promises";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (target, options) => {
  if (String(target) !== "https://api.resend.com/emails") return originalFetch(target, options);
  await appendFile(${JSON.stringify(mailLog)}, options.body + String.fromCharCode(10));
  return Response.json({ id: "isolated-fixture-mail" });
};`);
const readMail = async () => (await readFile(mailLog, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
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
    ADRIAN_ACCOUNT_EMAIL_FROM: "Adrian <account@example.test>",
    ADRIAN_ACCOUNT_EMAIL_KEY: "fixture-only",
    NODE_OPTIONS: "--import=" + mailFixture,
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
  const factors = page.getByRole("region", { name: "Password authenticator" });
  const factorRoute = auth + "/two-factor/";
  const factorPost = (action, data, client = context.request, requestOrigin = origin) =>
    client.post(factorRoute + action, { headers: { origin: requestOrigin }, data });
  assert.equal((await factorPost("enable", { password }, context.request, "https://outside.example")).status(), 403);
  await factors.getByLabel("Current password").fill(password);
  await factors.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = await factors.getByLabel("Authenticator setup key").textContent();
  const otp = createOTP(base32.decode(secret));
  const recovery = await factors.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").first().textContent();
  assert.ok(recovery);
  assert.equal((await (await context.request.get(origin + "/api/mind/sessions")).json()).passwordAuthenticator, false);
  await factors.getByLabel("Authenticator code").fill(await otp.totp());
  const verification = page.waitForResponse(factorRoute + "verify-totp");
  await factors.getByRole("button", { name: "Confirm authenticator" }).click();
  const enrollment = await verification;
  assert.equal(enrollment.status(), 200, await enrollment.text());
  assert.equal((await (await context.request.get(origin + "/api/mind/sessions")).json()).passwordAuthenticator, true);
  await context.request.post(auth + "/sign-out", { headers: { origin }, data: {} });
  await page.goto(origin + "/login?next=" + encodeURIComponent(settings), { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill("passkey-owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  const passwordAttempt = page.waitForResponse(auth + "/sign-in/email");
  await page.getByTestId("login-password-submit").click();
  const passwordResponse = await passwordAttempt;
  const passwordResult = await passwordResponse.json();
  assert.equal(passwordResult.twoFactorRedirect, true, JSON.stringify({ status: passwordResponse.status(), code: passwordResult.code }));
  await page.getByLabel("Authenticator code", { exact: true }).waitFor();
  assert.equal((await context.request.get(origin + "/api/mind/sessions")).status(), 409);
  assert.equal((await factorPost("verify-totp", { code: await otp.totp(), trustDevice: true })).status(), 400);
  const wrong = (Number(await otp.totp()) + 1) % 1_000_000;
  assert.equal((await factorPost("verify-totp", { code: String(wrong).padStart(6, "0") })).ok(), false);
  await page.getByLabel("Authenticator code", { exact: true }).fill(await otp.totp());
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.getByRole("button", { name: "Refresh verified sessions" }).waitFor();
  assert.equal((await (await context.request.get(auth + "/owner")).json()).user.id, owner);

  const passwordChallenge = async (passwordToUse = password) => {
    await context.request.post(auth + "/sign-out", { headers: { origin }, data: {} });
    const response = await context.request.post(auth + "/sign-in/email", {
      headers: { origin }, data: { email: "passkey-owner@example.test", password: passwordToUse },
    });
    assert.equal((await response.json()).twoFactorRedirect, true);
  };
  await passwordChallenge();
  assert.equal((await factorPost("verify-backup-code", { code: recovery })).status(), 200);
  assert.equal((await (await context.request.get(auth + "/owner")).json()).user.id, owner);
  await passwordChallenge();
  assert.equal((await factorPost("verify-backup-code", { code: recovery })).ok(), false);
  assert.equal((await factorPost("verify-totp", { code: await otp.totp() })).status(), 200);
  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  const accountEmail = "passkey-owner@example.test";
  const requestReset = (email) => recoveryContext.request.post(auth + "/request-password-reset", { headers: { origin }, data: { email } });
  const unknown = await requestReset("unknown@example.test");
  const unverified = await requestReset(accountEmail);
  assert.deepEqual(await unknown.json(), await unverified.json());
  assert.deepEqual(await readMail(), []);
  await page.goto(origin + settings, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Refresh verified sessions" }).click();
  await page.getByRole("button", { name: "Send verification email" }).click();
  await page.getByText("The sender accepted your verification email.", { exact: false }).waitFor();
  const [verifyMail] = await readMail();
  assert.deepEqual(verifyMail.to, [accountEmail]);
  const verificationUrl = verifyMail.text.match(/https?:[^\s]+/)[0];
  assert.equal(new URL(verificationUrl).origin, origin);
  assert.equal((await context.request.get(verificationUrl, { maxRedirects: 0 })).status(), 302);
  assert.equal((await (await context.request.get(origin + "/api/mind/sessions")).json()).recoveryEmail.verified, true);

  await recoveryPage.goto(origin + "/login", { waitUntil: "domcontentloaded" });
  await recoveryPage.getByRole("button", { name: "Forgot password?" }).click();
  await recoveryPage.getByLabel("Verified account email").fill(accountEmail);
  await recoveryPage.getByRole("button", { name: "Request a reset link" }).click();
  await recoveryPage.getByText("If this email is eligible", { exact: false }).waitFor();
  const [, resetMail] = await readMail();
  assert.deepEqual(resetMail.to, [accountEmail]);
  const resetUrl = new URL(resetMail.text.match(/https?:[^\s]+/)[0]);
  assert.equal(resetUrl.origin, origin);
  const resetToken = new URLSearchParams(resetUrl.hash.slice(1)).get("reset");
  await requestReset(accountEmail);
  const [, , newerMail] = await readMail();
  const newerUrl = new URL(newerMail.text.match(/https?:[^\s]+/)[0]);
  const newerToken = new URLSearchParams(newerUrl.hash.slice(1)).get("reset");
  const pending = await browser.newContext();
  const pendingResponse = await pending.request.post(auth + "/sign-in/email", {
    headers: { origin }, data: { email: accountEmail, password },
  });
  assert.equal((await pendingResponse.json()).twoFactorRedirect, true);
  const newPassword = randomBytes(18).toString("hex");
  assert.match(resetToken, /^[A-Za-z0-9_-]{20,100}$/);
  await recoveryPage.goto(resetUrl.href, { waitUntil: "domcontentloaded" });
  try {
    await recoveryPage.getByLabel("New password").fill(newPassword, { timeout: 10_000 });
  } catch (error) {
    const state = await recoveryPage.evaluate(() => ({ pathname: location.pathname, hasRecoveryFragment: location.hash.includes("reset"), headings: Array.from(document.querySelectorAll("h1")).map(node => node.textContent) }));
    throw Error("Reset link view did not load: " + JSON.stringify(state), { cause: error });
  }
  await recoveryPage.getByRole("button", { name: "Change password" }).click();
  await recoveryPage.getByText("Password changed. Sign in with your new password.").waitFor();
  assert.equal(new URL(recoveryPage.url()).hash, "");
  assert.equal((await recoveryContext.request.post(auth + "/reset-password", { headers: { origin }, data: { token: resetToken, newPassword } })).ok(), false);
  assert.equal((await recoveryContext.request.post(auth + "/reset-password", { headers: { origin }, data: { token: newerToken, newPassword } })).ok(), false);
  assert.equal((await factorPost("verify-totp", { code: await otp.totp() }, pending.request)).ok(), false);
  await pending.close();
  assert.equal((await context.request.get(origin + "/api/mind/sessions")).ok(), false, "The prior session was revoked");
  await recoveryContext.close();
  assert.equal((await context.request.post(auth + "/sign-in/email", { headers: { origin }, data: { email: accountEmail, password } })).ok(), false);
  await passwordChallenge(newPassword);
  assert.equal((await factorPost("verify-totp", { code: await otp.totp() })).status(), 200);
  assert.equal((await factorPost("disable", { password: newPassword })).status(), 200);
  assert.equal((await (await context.request.get(origin + "/api/mind/sessions")).json()).passwordAuthenticator, false);

  const receipt = {
    actualChromium: true, enrollmentReadback: true, accountIsolation: true,
    crossOriginAndUnauthenticatedRegistrationDenied: true, signInRestoredOwner: true, removalReadback: true,
    passwordRequiresAuthenticator: true, wrongCodeDenied: true, singleUseRecovery: true, disableReadback: true,
    verifiedRecoveryEmail: true, passwordResetTokenSingleUse: true, resetRevokedOldSession: true, resetPreservedAuthenticator: true,
    resetInvalidatedOtherLinksAndPendingChallenges: true,
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
