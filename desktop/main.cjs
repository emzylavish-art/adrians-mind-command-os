const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createWriteStream, existsSync, mkdirSync, rmSync } = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const http = require("node:http");
const path = require("node:path");
const {
  CLOUD_ORIGIN,
  LOCAL_BUILD,
  PUBLIC_FEED,
  UPDATE_PATH,
  chooseCloud,
  decideUpdate,
  hashesMatch,
  isAllowedDownloadUrl,
} = require("./cloud-update.cjs");

const PORT = "41731";
const HOST = "127.0.0.1";

function serverRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, "app-server");
  return path.join(__dirname, "app-server");
}

function missingRuntime(root) {
  return ["server/index.mjs", "server/_libs/pglite.data", "server/_libs/pglite.wasm", "server/_libs/initdb.wasm"]
    .filter((rel) => !existsSync(path.join(root, rel)));
}

function waitForServer(url, child) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error("The local Adrian's Mind server stopped before it opened."));
        return;
      }
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      request.on("error", retry);
      request.setTimeout(1500, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > 45000) {
        reject(new Error("Adrian's Mind did not open on this PC."));
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

function startServer() {
  const root = serverRoot();
  const entry = path.join(root, "server", "index.mjs");
  const dataRoot = path.join(app.getPath("userData"), "data");
  return spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ADRIAN_DATA_DIR: dataRoot,
      HOST,
      PORT,
      NITRO_HOST: HOST,
      NITRO_PORT: PORT,
    },
    stdio: "inherit",
    windowsHide: true,
  });
}

async function readCloud() {
  async function readOne(url, allowPlain) {
    const response = await fetch(url, {
      redirect: allowPlain ? "follow" : "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!allowPlain && !type.includes("json")) return null;
    const body = type.includes("json") ? await response.json() : JSON.parse(await response.text());
    return body;
  }
  const vercel = await readOne(`${CLOUD_ORIGIN}${UPDATE_PATH}`, false).catch(() => null);
  const published = await readOne(PUBLIC_FEED, true).catch(() => null);
  return chooseCloud(vercel, published);
}

async function downloadVerified(url, sha256, size) {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isAllowedDownloadUrl(current, hop)) return null;
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(120000) });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      current = new URL(next, current).toString();
      continue;
    }
    if (!response.ok || !response.body) return null;
    const declared = Number(response.headers.get("content-length") || size);
    if (declared !== size) return null;
    const dir = path.join(app.getPath("temp"), "adrians-mind-update");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "AdriansMind-Setup.exe");
    const part = `${file}.part`;
    const hash = createHash("sha256");
    let written = 0;
    await pipeline(
      Readable.fromWeb(response.body),
      async function* count(source) {
        for await (const chunk of source) {
          written += chunk.length;
          if (written > size) throw new Error("download exceeded published size");
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(part),
    );
    if (written !== size || !hashesMatch(sha256, hash.digest("hex"))) {
      rmSync(part, { force: true });
      return null;
    }
    rmSync(file, { force: true });
    require("node:fs").renameSync(part, file);
    return file;
  }
  return null;
}

function launchInstaller(file) {
  if (process.platform !== "win32") return false;
  if (file.includes("\"") || file.includes("\n") || file.includes("\r")) return false;
  const script = path.join(app.getPath("temp"), "adrian-update.cmd");
  require("node:fs").writeFileSync(script, `@echo off\r\ntimeout /t 2 /nobreak >nul\r\nstart "" "${file}"\r\n`);
  spawn("cmd.exe", ["/d", "/c", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  return true;
}

async function checkCloud(window) {
  if (window.isDestroyed()) return;
  let remote = null;
  try {
    remote = await readCloud();
  } catch {
    remote = null;
  }
  const decision = decideUpdate(LOCAL_BUILD, remote);
  if (decision.action !== "install" || !decision.url || !remote) return;
  const file = await downloadVerified(decision.url, remote.sha256, remote.size).catch(() => null);
  if (!file) return;
  if (launchInstaller(file)) app.quit();
}

app.whenReady().then(async () => {
  const missing = missingRuntime(serverRoot());
  if (missing.length > 0) {
    const window = new BrowserWindow({ width: 720, height: 240, title: "Adrian's Mind", autoHideMenuBar: true });
    window.loadURL(`data:text/plain,${encodeURIComponent("Adrian's Mind is missing " + missing.join(", ") + ".")}`);
    return;
  }
  const child = startServer();
  app.on("before-quit", () => {
    if (!child.killed) child.kill();
  });
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Adrian's Mind",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  try {
    await waitForServer(`http://${HOST}:${PORT}/`, child);
    await window.loadURL(`http://${HOST}:${PORT}/`);
    setTimeout(() => checkCloud(window), 8000);
    setInterval(() => checkCloud(window), 30 * 60 * 1000);
  } catch (error) {
    window.loadURL(`data:text/plain,${encodeURIComponent(String(error.message || error))}`);
  }
});

app.on("window-all-closed", () => app.quit());
