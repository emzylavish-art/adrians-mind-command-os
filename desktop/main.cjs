const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

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
  } catch (error) {
    window.loadURL(`data:text/plain,${encodeURIComponent(String(error.message || error))}`);
  }
});

app.on("window-all-closed", () => app.quit());
