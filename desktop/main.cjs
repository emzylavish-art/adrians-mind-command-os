const { app, BrowserWindow, clipboard, globalShortcut, dialog, Menu, Tray, nativeImage, session } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const rules = require("./cloud-update.cjs");
const { readUpdateFeed, chooseReleaseCandidates } = require("./update-contract.cjs");
const { downloadRelease, availableDiskBytes } = require("./update-download.cjs");
const { verifyInstallerPublisher } = require("./installer-auth.cjs");
const { waitForRuntime, createRestartBudget, redactDiagnostics } = require("./runtime-contract.cjs");
const { startCompanion } = require("./dictation-companion.cjs");
const platforms = require("./platform-capabilities.json");
const { nativeDestinationAllowed } = require("./native-network.cjs");
const PORT = "41731";
const HOST = "127.0.0.1";
const URL = `http://${HOST}:${PORT}`;
let mainWindow, recoveryWindow, child, companion, tray, runtimeReceipt;
let quitting = false;
let booting = false;
let updateController = null;
let checkRunning = false;
let lastCheck = null;
let diagnostics = "";
const engineChildren = [];
const restartBudget = createRestartBudget();
const bundled = (() => { try { return require("./desktop-update.json"); } catch { return require("../public/desktop-update.json"); } })();
const compiledIdentity = (() => { try { return require("./runtime-build.json"); } catch { return null; } })();
const preferencesFile = () => path.join(app.getPath("userData"), "desktop-preferences.json");
function preferences() {
  try { return { closeBehavior: "ask", networkPolicy: "local-only", ...JSON.parse(readFileSync(preferencesFile(), "utf8")) }; }
  catch { return { closeBehavior: "ask", networkPolicy: "local-only" }; }
}
function savePreferences(change) {
  mkdirSync(app.getPath("userData"), { recursive: true });
  const temporary = `${preferencesFile()}.pending`;
  writeFileSync(temporary, JSON.stringify({ ...preferences(), ...change }), { mode: 0o600 });
  renameSync(temporary, preferencesFile());
}
function appendDiagnostic(value) { diagnostics = redactDiagnostics(`${diagnostics}\n${new Date().toISOString()} ${value}`); }
function resources(name) { return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, name); }
function missingRuntime() { return ["server/index.mjs", "server/_libs/pglite.data", "server/_libs/pglite.wasm", "server/_libs/initdb.wasm"].filter(file => !existsSync(path.join(resources("app-server"), file))); }
function identity() { return { ...compiledIdentity, deviceId: preferences().deviceId }; }
function startEngines() {
  if (process.platform !== "win32" || engineChildren.length) return;
  const root = resources("engines");
  const required = ["node.exe", "ffmpeg.exe", "transcribe-cli.exe", "handy-server.mjs", "opus-server.mjs"];
  if (required.some(name => !existsSync(path.join(root, name)))) { appendDiagnostic("local_engines_missing: speech unavailable until repaired"); return; }
  for (const script of ["handy-server.mjs", "opus-server.mjs"]) {
    const engine = spawn(path.join(root, "node.exe"), [path.join(root, script)], {
      cwd: root, env: { ...process.env, ADRIAN_ENGINE_ROOT: root, ADRIAN_TRANSCRIBE: path.join(root, "transcribe-cli.exe"), ADRIAN_FFMPEG: path.join(root, "ffmpeg.exe"), ADRIAN_WHISPER_MODEL: path.join(root, "models", "whisper-tiny.en-Q8_0.gguf"), ADRIAN_OPUS_CACHE: path.join(app.getPath("userData"), "opus-cache") }, windowsHide: true, stdio: "ignore",
    });
    engine.on("error", () => appendDiagnostic(`${script}: local_engine_start_failed`));
    engine.on("exit", code => appendDiagnostic(`${script}: local_engine_stopped (${code})`));
    engineChildren.push(engine);
  }
}
function stopChildren() {
  const server = child; child = null;
  if (server && !server.killed) server.kill();
  for (const engine of engineChildren.splice(0)) if (!engine.killed) engine.kill();
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]);
function recovery(code) {
  appendDiagnostic(code);
  if (quitting) return;
  if (!recoveryWindow || recoveryWindow.isDestroyed()) recoveryWindow = new BrowserWindow({ width: 760, height: 540, title: "Adrian's Mind — recovery", parent: mainWindow, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Local runtime recovery</title><style>body{font:16px system-ui;background:#f4f1e9;color:#242824;margin:40px;line-height:1.6}h1{font-size:25px}a{display:inline-block;padding:10px;margin:4px;background:#dce5d4;color:#203627;border-radius:8px}pre{white-space:pre-wrap;font-size:12px;max-height:140px;overflow:auto}</style><h1>The local runtime needs attention</h1><p>${escapeHtml(code)}</p><p>Your data directory has not been reset or deleted. The main window is preserved so you can copy any unsaved text before reloading.</p><a href="adrian-recovery://retry">Retry local server</a><a href="adrian-recovery://diagnostics">Copy safe diagnostics</a><a href="adrian-recovery://repair">Repair instructions</a><a href="adrian-recovery://show">Show existing window</a><a href="adrian-recovery://quit">Exit app</a><pre>${escapeHtml(diagnostics)}</pre></html>`;
  recoveryWindow.webContents.removeAllListeners("will-navigate");
  recoveryWindow.webContents.on("will-navigate", (event, target) => {
    event.preventDefault();
    const action = /^adrian-recovery:\/\/([a-z]+)\/?$/.exec(target)?.[1];
    if (action === "retry") void boot(true);
    else if (action === "diagnostics") clipboard.writeText(diagnostics);
    else if (action === "show") { mainWindow?.show(); mainWindow?.focus(); }
    else if (action === "quit") app.quit();
    else if (action === "repair") void dialog.showMessageBox(recoveryWindow, { type: "info", message: "Repair preserves account data", detail: "Close the app, back up its user-data directory, and run a publisher-verified installer. Select the existing installation directory. Do not delete user data. An unsigned feed or missing package cannot authorize automatic repair.", buttons: ["OK"] });
  });
  recoveryWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void recoveryWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  recoveryWindow.show();
}
async function boot(manual = false) {
  if (booting || quitting) return;
  if (manual && !restartBudget.take()) { recovery("Retry limit reached: wait five minutes before another manual server restart."); return; }
  if (!compiledIdentity || compiledIdentity.version !== app.getVersion()) { recovery("The executable and compiled server build identity do not agree. Repair the package without deleting user data."); return; }
  const missing = missingRuntime();
  if (missing.length) { recovery(`Package resources are missing: ${missing.join(", ")}`); return; }
  booting = true;
  stopChildren();
  const secret = randomBytes(32).toString("hex");
  const expected = identity();
  const root = resources("app-server");
  const current = spawn(process.execPath, ["--require", path.join(__dirname, "native-network.cjs"), path.join(root, "server", "index.mjs")], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ADRIAN_DATA_DIR: path.join(app.getPath("userData"), "data"), ADRIAN_PC: "1", ADRIAN_RUNTIME_SECRET: secret, ADRIAN_DEVICE_ID: expected.deviceId, ADRIAN_DESKTOP_BUILD: String(expected.build), ADRIAN_DESKTOP_VERSION: expected.version, ADRIAN_DESKTOP_REVISION: expected.revision || "", ADRIAN_NATIVE_PREFERENCES: preferencesFile(), HOST, PORT, NITRO_HOST: HOST, NITRO_PORT: PORT }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  child = current;
  current.stderr?.on("data", bytes => appendDiagnostic(String(bytes)));
  current.on("error", () => { current.spawnFailed = true; if (child === current && !booting && !quitting) recovery("The local server could not start."); });
  current.on("exit", code => { if (child === current) { runtimeReceipt = null; appendDiagnostic(`local_runtime_exit: ${code}`); if (!booting && !quitting) recovery("The local server stopped. No automatic restart or retry of pending actions was started."); } });
  try {
    runtimeReceipt = await waitForRuntime(`${URL}/api/mind/local-readiness`, current, expected, secret);
    startEngines();
    if (!mainWindow.webContents.getURL() || mainWindow.webContents.getURL() === "about:blank") await mainWindow.loadURL(URL);
    else if (manual) await dialog.showMessageBox(mainWindow, { message: "Local server is ready again", detail: "The existing window was preserved. Copy unsaved text, then use View → Reload when you are ready.", buttons: ["Keep current window"] });
    recoveryWindow?.close(); recoveryWindow = null;
    mainWindow.show();
    if (!companion && process.platform === "win32") companion = startCompanion({ electron: { BrowserWindow, globalShortcut }, clipboard, page: path.join(__dirname, "dictation-widget.html"), onExit: () => app.quit() });
  } catch (error) { recovery(error.message || "The local runtime could not be verified."); }
  finally { booting = false; }
}
async function checkUpdates() {
  if (checkRunning || updateController) return;
  checkRunning = true;
  try {
    const feeds = await Promise.all([readUpdateFeed(fetch, `${rules.CLOUD_ORIGIN}${rules.UPDATE_PATH}`, "vercel"), readUpdateFeed(fetch, rules.PUBLIC_FEED, "github")]);
    const checked = chooseReleaseCandidates(feeds.filter(feed => feed.ok).map(feed => ({ source: feed.source, manifest: feed.manifest })), { installedBuild: rules.LOCAL_BUILD, platform: process.platform, arch: process.arch });
    lastCheck = { at: new Date().toISOString(), feeds, checked };
    const detail = [...feeds.filter(feed => !feed.ok).map(feed => `${feed.source}: ${feed.code} — ${feed.detail}`), ...checked.checks.map(check => `${check.source}: ${check.code} — ${check.detail}`)].join("\n");
    if (!checked.selected) { await dialog.showMessageBox(mainWindow, { message: "No eligible authenticated update", detail: detail || "Release availability is unknown.", buttons: ["Close"] }); return; }
    const manifest = checked.selected;
    const review = await dialog.showMessageBox(mainWindow, { type: "question", message: `Review Windows ${manifest.version} (build ${manifest.build})`, detail: `Publisher metadata signature verified. Download: ${manifest.size.toLocaleString()} bytes in ${manifest.fullPackage.parts.length} parts. Unpacked installation: ${manifest.installedSize.toLocaleString()} bytes. Verified completed parts are resumable. The installer signature is checked after download. Nothing installs until you approve a separate install step.\n\n${detail}`, buttons: ["Cancel", "Download / resume"], defaultId: 0, cancelId: 0 });
    if (review.response !== 1) return;
    const freeInstall = availableDiskBytes(path.dirname(process.execPath));
    if (freeInstall == null || freeInstall < manifest.installedSize + 256 * 1024 * 1024) throw new Error("The installation volume has insufficient or unverified free space. No download started. Free space or choose an alternate location with the verified installer.");
    updateController = new AbortController();
    const result = await downloadRelease(manifest, path.join(app.getPath("userData"), "updates", `${manifest.build}-${manifest.sha256.slice(0, 12)}`), { installedBuild: rules.LOCAL_BUILD, platform: process.platform, arch: process.arch, signal: updateController.signal,
      confirmPartRestart: async part => (await dialog.showMessageBox(mainWindow, { message: "This part cannot resume", detail: `${part.name}: restarting requires ${part.bytes.toLocaleString()} bytes. Other verified parts remain saved.`, buttons: ["Keep partial download", "Restart this part"], defaultId: 0, cancelId: 0 })).response === 1,
      onProgress: progress => { mainWindow.setProgressBar(progress.bytes / progress.total); mainWindow.setTitle(`Adrian's Mind — ${progress.reused ? "verified cached" : "downloading"} ${progress.name}`); },
    });
    const publisher = await verifyInstallerPublisher(result.file, manifest.installerSignerSha256);
    if (!publisher.ok) throw new Error(publisher.reason);
    if (updateController.signal.aborted) return;
    const install = await dialog.showMessageBox(mainWindow, { message: "Verified installer is ready", detail: `Package bytes and trusted installer signer match build ${manifest.build}. Save your work before continuing. The installer will let you review the installation location.`, buttons: ["Keep for later", "Exit and run installer"], defaultId: 0, cancelId: 0 });
    if (install.response !== 1) return;
    await new Promise((resolve, reject) => { const installer = spawn(result.file, [], { detached: true, stdio: "ignore", windowsHide: false }); installer.once("error", reject); installer.once("spawn", () => { installer.unref(); resolve(); }); });
    app.quit();
  } catch (error) { await dialog.showMessageBox(mainWindow, { type: "error", message: "Update did not complete", detail: redactDiagnostics(error.message || error), buttons: ["Close"] }); }
  finally { checkRunning = false; updateController = null; if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.setProgressBar(-1); mainWindow.setTitle("Adrian's Mind"); } }
}
async function closeMain(event) {
  if (quitting) return;
  event.preventDefault();
  const behavior = preferences().closeBehavior;
  if (behavior === "exit") { app.quit(); return; }
  if (behavior === "hide" && tray) { mainWindow.hide(); return; }
  const choice = await dialog.showMessageBox(mainWindow, { message: "Close Adrian's Mind", detail: "Keep running hides this window while the local server and dictation companion remain active. Exit stops this app's local processes. Independent scheduled services are separate.", buttons: ["Cancel", "Keep running in tray", "Exit app"], defaultId: 0, cancelId: 0, checkboxLabel: "Remember this choice", checkboxChecked: false });
  if (choice.response === 1 && tray) { if (choice.checkboxChecked) savePreferences({ closeBehavior: "hide" }); mainWindow.hide(); }
  if (choice.response === 2) { if (choice.checkboxChecked) savePreferences({ closeBehavior: "exit" }); app.quit(); }
}
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "App", submenu: [
      { label: "Show window", click: () => mainWindow.show() },
      { label: "Check for updates…", click: () => void checkUpdates() },
      { label: "Cancel update download", click: () => updateController?.abort() },
      { label: "Versions and capabilities…", click: () => void dialog.showMessageBox(mainWindow, { message: "Version and execution evidence", detail: `Installed executable: ${app.getVersion()}\nBundled release metadata: build ${bundled.build}, revision ${bundled.revision || "unreported"}\nLocal runtime: ${runtimeReceipt ? `authenticated build ${runtimeReceipt.build}, storage ready` : "not verified"}\nCompiled server artifact: ${compiledIdentity?.artifactId || "missing"}, revision ${compiledIdentity?.revision || "unreported"}${compiledIdentity?.dirty ? " (uncommitted build)" : ""}\nHosted website: separate deployment at ${rules.CLOUD_ORIGIN}; not used as installed-version proof\nLast update check: ${lastCheck?.at || "not checked"}\nPlatform: ${process.platform}/${process.arch}; ${platforms.targets.find(target => target.platform === process.platform && target.arch === process.arch)?.implementation || "unsupported"}; physical release verification remains unverified\nLocal engines: resource presence is not live model/speech proof.\nNetwork policy: ${preferences().networkPolicy}`, buttons: ["OK"] }) },
      { label: "Reset close-window preference", click: () => savePreferences({ closeBehavior: "ask" }) },
      { type: "separator" }, { label: "Exit", click: () => app.quit() },
    ] },
    { label: "Network", submenu: [
      { label: "Use local-only mode", click: () => { savePreferences({ networkPolicy: "local-only" }); void dialog.showMessageBox(mainWindow, { message: "Local-only mode is active", detail: "External inference is blocked. Local commands remain available. Local models and speech require their engines to be healthy; the app will report unavailable capabilities without switching to a paid provider.", buttons: ["OK"] }); } },
      { label: "Allow selected connected services…", click: async () => { const result = await dialog.showMessageBox(mainWindow, { message: "Allow selected connected services?", detail: "Requests may send selected context to connected providers and incur their normal costs. This does not authorize a screenshot model or an automatic provider fallback.", buttons: ["Stay local-only", "Allow selected services"], defaultId: 0, cancelId: 0 }); if (result.response === 1) savePreferences({ networkPolicy: "connected-services" }); } },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
    { label: "Recovery", submenu: [{ label: "Local runtime recovery", click: () => recovery(runtimeReceipt ? "The local server is currently ready." : "The local server is not verified.") }] },
  ]));
}
app.whenReady().then(async () => {
  if (!preferences().deviceId) savePreferences({ deviceId: randomUUID() });
  mainWindow = new BrowserWindow({ width: 1280, height: 800, title: "Adrian's Mind", show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.on("close", event => void closeMain(event));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // A tiny embedded icon avoids depending on an unshipped external icon file.
  const icon = nativeImage.createFromBuffer(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")).resize({ width: 16, height: 16 });
  tray = new Tray(icon); tray.setToolTip("Adrian's Mind is running"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "Show Adrian's Mind", click: () => mainWindow.show() }, { label: "Exit app", click: () => app.quit() }])); tray.on("double-click", () => mainWindow.show());
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => callback({ cancel: !nativeDestinationAllowed(details.url, preferences().networkPolicy) }));
  menu(); await boot();
}).catch(error => { appendDiagnostic(error.message || error); if (mainWindow) recovery("Desktop startup failed. Existing user data was preserved."); });
app.on("before-quit", () => { quitting = true; updateController?.abort(); companion?.close(); companion = null; stopChildren(); tray?.destroy(); tray = null; });
app.on("window-all-closed", () => { if (!quitting && !tray) app.quit(); });
