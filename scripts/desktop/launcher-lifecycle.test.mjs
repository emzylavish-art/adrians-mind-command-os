import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const source = await readFile(new URL("../../desktop/main.cjs", import.meta.url), "utf8");
async function launcher({ missing = false, ready = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "native-launcher-"));
  const windows = [], spawned = [], dialogs = [], outcomes = [];
  const app = new EventEmitter(); Object.assign(app, { isPackaged: true, getPath: () => dir, getVersion: () => "0.9.1", whenReady: async () => undefined, quit: () => { app.emit("before-quit"); for (const window of windows) window.close(); } });
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.url = ""; this.destroyed = false; this.hidden = false; this.webContents = Object.assign(new EventEmitter(), { getURL: () => this.url, setWindowOpenHandler: () => undefined }); windows.push(this); }
    async loadURL(url) { this.url = url; }
    show() { this.hidden = false; } hide() { this.hidden = true; } focus() {} isDestroyed() { return this.destroyed; }
    setTitle() {} setProgressBar() {}
    close() { let prevented = false; this.emit("close", { preventDefault() { prevented = true; } }); if (!prevented) this.destroyed = true; }
  }
  const menu = { value: null, buildFromTemplate: value => value, setApplicationMenu(value) { this.value = value; } };
  const tray = class extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() { this.destroyed = true; } };
  const electron = { app, BrowserWindow: Window, clipboard: { writeText: value => outcomes.push(value) }, globalShortcut: {}, Menu: menu, Tray: tray, nativeImage: { createFromBuffer: () => ({ resize() { return this; } }) }, session: { defaultSession: { webRequest: { onBeforeRequest: (_filter, handler) => { outcomes.push(handler); } } } }, dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; } } };
  const realFs = require("node:fs");
  const fs = { ...realFs, existsSync: value => value.includes("app-server") ? !missing : realFs.existsSync(value) };
  const childProcess = { spawn: (executable, args, options) => { const child = Object.assign(new EventEmitter(), { exitCode: null, killed: false, stderr: new EventEmitter(), kill() { this.killed = true; } }); spawned.push({ executable, args, options, child }); return child; } };
  const runtime = require("../../desktop/runtime-contract.cjs");
  const context = { require: name => name === "electron" ? electron : name === "node:fs" ? fs : name === "node:child_process" ? childProcess : name === "./runtime-build.json" ? { product: "adrians-mind", build: 9, version: "0.9.1", revision: "b".repeat(40), artifactId: "fixture-artifact", dirty: true } : name === "./runtime-contract.cjs" ? { ...runtime, waitForRuntime: async (_url, _child, identity) => { if (!ready) throw new Error("synthetic_ready_failure"); return { ...identity, storage: "ready" }; } } : name === "./dictation-companion.cjs" ? { startCompanion: () => ({ close: () => outcomes.push("companion-stopped") }) } : name.startsWith("./") ? require(path.resolve("desktop", name)) : name === "../public/desktop-update.json" ? require("../../public/desktop-update.json") : require(name), __dirname: path.resolve("desktop"), process: { env: {}, platform: "linux", arch: "x64", resourcesPath: dir, execPath: "/synthetic/adrian" }, Buffer, console, URL, AbortController, setTimeout, clearTimeout, fetch: () => { throw new Error("Unexpected external fetch in launcher fixture"); } };
  vm.runInNewContext(source, context, { filename: "desktop/main.cjs" });
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  return { app, windows, spawned, dialogs, menu, outcomes, dir, cleanup: () => rm(dir, { recursive: true, force: true }), setPreference: value => writeFile(path.join(dir, "desktop-preferences.json"), JSON.stringify({ deviceId: "fixture", ...value })) };
}
test("missing package opens actionable recovery without starting server or deleting data", async () => {
  const f = await launcher({ missing: true });
  try { assert.equal(f.spawned.length, 0); assert.equal(f.windows.length, 2); const recovery = decodeURIComponent(f.windows[1].url); assert.match(recovery, /Retry local server/); assert.match(recovery, /not been reset or deleted/); assert.match(recovery, /Copy safe diagnostics/); }
  finally { await f.cleanup(); }
});
test("verified startup loads local app, later child death opens recovery without replacing renderer", async () => {
  const f = await launcher();
  try {
    assert.equal(f.windows[0].url, "http://127.0.0.1:41731"); const main = f.windows[0];
    assert.match(f.spawned[0].options.env.ADRIAN_RUNTIME_SECRET, /^[a-f0-9]{64}$/); assert.match(f.spawned[0].args[1], /native-network.cjs/);
    f.spawned[0].child.emit("exit", 1); await new Promise(resolve => setImmediate(resolve));
    assert.equal(main.url, "http://127.0.0.1:41731"); assert.equal(main.destroyed, false); assert.match(decodeURIComponent(f.windows[1].url), /local server stopped/); assert.equal(f.spawned.length, 1);
  } finally { await f.cleanup(); }
});
test("close explicitly asks or hides, but actual quit closes window and kills owned child", async () => {
  const f = await launcher();
  try {
    f.windows[0].close(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.windows[0].destroyed, false); assert.equal(f.dialogs.at(-1).message, "Close Adrian's Mind");
    await f.setPreference({ closeBehavior: "hide", networkPolicy: "local-only" }); f.windows[0].close(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.windows[0].hidden, true);
    f.app.quit(); assert.equal(f.windows[0].destroyed, true); assert.equal(f.spawned[0].child.killed, true);
  } finally { await f.cleanup(); }
});
