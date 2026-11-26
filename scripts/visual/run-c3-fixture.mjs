#!/usr/bin/env node
/** Run server and browser in one isolated process environment. No credentials or database URLs. */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const directory = resolve(process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/c3-chat-layout");
mkdirSync(directory, { recursive: true });
const fixtureData = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "c3-visual-preview-"));
const port = Number(process.env.FIXTURE_PORT ?? 4195);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port.");
const env = {
  PATH: `${resolve("node_modules/.bin")}:${process.env.PATH ?? ""}`,
  TMPDIR: process.env.TMPDIR ?? directory,
  ADRIAN_DATA_DIR: fixtureData,
  XAI_INFERENCE_ENV_FILE: resolve(directory, "no-provider-credentials.env"),
  VITE_AUTH_ENABLED: "false", NODE_OPTIONS: "--max-old-space-size=2048",
};
const log = createWriteStream(resolve(directory, "server.log"));
const server = spawn(process.execPath, ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
const origin = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`Fixture server exited ${server.exitCode}.`);
    try { const response = await fetch(origin + "/__app-env", { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch { /* wait for local compilation only */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Local fixture server did not become ready.");
  execFileSync(process.execPath, ["scripts/check-auth-invariant.mjs", "--dev-url", origin], { env, stdio: "inherit" });
  const child = spawn(process.execPath, [process.env.FIXTURE_SCRIPT ?? "scripts/visual/chat-layout.mjs"], { env: { ...env, BASE_URL: origin, BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH, BROWSER_ENGINE: process.env.BROWSER_ENGINE ?? "chromium", FIXTURE_QUICK: process.env.FIXTURE_QUICK ?? "false", FIXTURE_COUNTS: process.env.FIXTURE_COUNTS ?? "1,50,500,2000", FIXTURE_SERVICE_STATE: process.env.FIXTURE_SERVICE_STATE ?? "unavailable", VISUAL_ARTIFACT_DIR: directory }, stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); });
} finally {
  if (server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  log.end();
  rmSync(fixtureData, { recursive: true, force: true });
}
