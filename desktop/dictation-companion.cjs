const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const COMPANION_PORT = 4198;
const SHORTCUT = "CommandOrControl+Shift+Space";

function escapeSendKeys(text) {
  return text.replace(/[+^%~(){}[\]]/g, (char) => `{${char}}`);
}

function decideInsert(input) {
  const text = String(input.text || "").trim();
  if (!text) return { inserted: false, kept: "", note: "No words were captured. Nothing was inserted." };
  if (input.platform === "win32" && input.typed) {
    return { inserted: true, kept: text, note: "Inserted at the Windows caret. Nothing was sent." };
  }
  return { inserted: false, kept: text, note: "The words were kept. Nothing was sent." };
}

async function typeAtCaret(text, platform = process.platform) {
  const safe = escapeSendKeys(text);
  if (platform !== "win32") return false;
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${safe.replace(/'/g, "''")}')`], { timeout: 8000, windowsHide: true });
  return true;
}

function startCompanion(deps) {
  let widget = null;
  let held = "";
  const electron = deps.electron;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.socket.remoteAddress && !request.socket.remoteAddress.endsWith("127.0.0.1") && request.socket.remoteAddress !== "::1") {
      send(403, { ok: false, error: "Only this computer can use dictation." });
      return;
    }
    if (url.pathname === "/summon" && request.method === "POST") {
      show();
      send(200, { ok: true });
      return;
    }
    if (url.pathname === "/done" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const text = String(body.text || held || "").trim();
      let typed = false;
      try {
        if (text && process.platform === "win32") typed = await typeAtCaret(text);
      } catch {
        typed = false;
      }
      if (!typed && text) deps.clipboard.writeText(text);
      held = text;
      send(200, decideInsert({ text, platform: process.platform, typed }));
      return;
    }
    if (url.pathname === "/cancel" && request.method === "POST") {
      held = "";
      send(200, { ok: true, note: "Cancelled. The recording was discarded." });
      return;
    }
    if (url.pathname === "/exit" && request.method === "POST") {
      send(200, { ok: true });
      deps.onExit?.();
      return;
    }
    send(404, { ok: false });
  });
  server.listen(COMPANION_PORT, "127.0.0.1");

  function show() {
    if (widget && !widget.isDestroyed()) {
      widget.show();
      widget.focus();
      return;
    }
    widget = new electron.BrowserWindow({
      width: 320,
      height: 168,
      title: "Dictation",
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    widget.loadFile(deps.page);
    widget.on("closed", () => { widget = null; });
  }

  const shortcutOk = electron.globalShortcut.register(SHORTCUT, show);
  return {
    port: COMPANION_PORT,
    shortcut: shortcutOk ? SHORTCUT : "",
    show,
    close() {
      server.close();
      electron.globalShortcut.unregister(SHORTCUT);
      if (widget && !widget.isDestroyed()) widget.close();
    },
  };
}

module.exports = { COMPANION_PORT, SHORTCUT, escapeSendKeys, decideInsert, startCompanion };
