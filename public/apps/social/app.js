const secretMeta = document.querySelector('meta[name="adrian-secret"]');
const baseInput = document.querySelector("#api-base");
const secretInput = document.querySelector("#api-secret");
const note = document.querySelector("#connect-note");
const linkState = document.querySelector("#link-state");
const titles = {
  overview: "Overview",
  run: "Run",
  connect: "Connect",
  install: "Install",
  accounts: "Accounts",
  queue: "Queue",
  drafts: "Drafts",
  guard: "Guard",
  limits: "Limits",
  machine: "Machine",
  records: "Records",
  tools: "Tools",
};
const groups = {
  overview: "operate",
  run: "operate",
  connect: "operate",
  install: "operate",
  accounts: "inbox",
  queue: "inbox",
  drafts: "inbox",
  guard: "guard",
  limits: "guard",
  machine: "guard",
  records: "record",
  tools: "record",
};
const groupTitle = { operate: "Operate", inbox: "Inbox", guard: "Guard", record: "Record" };
const groupHome = { operate: "overview", inbox: "accounts", guard: "guard", record: "records" };

function showPanel(panel) {
  const group = groups[panel] || "operate";
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("on", item.dataset.panel === panel));
  document.querySelectorAll(".panel").forEach((item) => item.classList.toggle("on", item.id === panel));
  document.querySelectorAll(".section-nav button").forEach((item) => {
    item.hidden = item.dataset.group !== group;
    item.classList.toggle("on", item.dataset.panel === panel);
  });
  document.querySelectorAll(".dock button").forEach((item) => item.classList.toggle("on", item.dataset.group === group));
  document.querySelector("#panel-title").textContent = titles[panel] || panel;
  const eyebrow = document.querySelector("#panel-group");
  if (eyebrow) eyebrow.textContent = groupTitle[group] || group;
  if (location.hash !== `#${panel}`) history.replaceState(null, "", `#${panel}`);
}

const initial = location.hash.replace("#", "");
showPanel(titles[initial] ? initial : "overview");

document.addEventListener("click", (event) => {
  const groupButton = event.target.closest(".dock [data-group]");
  if (groupButton) {
    showPanel(groupHome[groupButton.dataset.group] || "overview");
    return;
  }
  const panel = event.target.closest("[data-panel]");
  if (!panel || !panel.dataset.panel) return;
  if (event.target.closest("#global-controls, #sessions, #drafts")) return;
  showPanel(panel.dataset.panel);
});

function saved(key, fallback) {
  return localStorage.getItem(key) || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function defaultBase() {
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") return location.origin;
  return "";
}

function setNote(text) {
  note.textContent = text;
  if (linkState) linkState.textContent = text;
}

function explain(error) {
  let message = String(error && error.message || error || "");
  message = message.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (message.length > 160) message = message.slice(0, 160) + "…";
  if (message.includes("Set the service URL")) return "Service URL is empty. The PC is not contacted.";
  if (message.includes("missing local secret") || message.includes("401")) return "The key was rejected. The PC wrote nothing and sent nothing.";
  if (message.includes("404") || message.includes("File not found") || message.includes("Not Found")) {
    return "That address did not have the service. Paste the tunnel https address.";
  }
  if (message === "Failed to fetch" || message.includes("NetworkError") || message.includes("Load failed")) {
    return "The address did not answer. A closed tunnel window means the PC never sees this page.";
  }
  return message || "A read did not finish. The panel stays Not connected.";
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const gb = number / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(number / 1024 / 1024)} MB`;
}

function formatUptime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const hours = Math.floor(number / 3600);
  const minutes = Math.floor((number % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

baseInput.value = saved("adrian-base", defaultBase());
secretInput.value = secretMeta ? secretMeta.content : saved("adrian-secret", "");

document.querySelector("#save-connect").onclick = () => {
  localStorage.setItem("adrian-base", baseInput.value.trim());
  localStorage.setItem("adrian-secret", secretInput.value.trim());
  setNote("Connection saved in this browser. Reading the PC.");
  refresh();
};

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Adrian-Secret": secretInput.value.trim(),
  };
}

async function call(path, options = {}) {
  const base = baseInput.value.trim().replace(/\/$/, "");
  if (!base) throw new Error("Set the service URL first.");
  const response = await fetch(base + path, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

async function read(name, path) {
  try {
    return await call(path);
  } catch (error) {
    error.read = name;
    throw error;
  }
}

function card(title, meta, extra = "") {
  return `<div class="card"><strong>${escapeHtml(title)}</strong><p class="meta">${escapeHtml(meta)}</p>${extra}</div>`;
}

function empty(text) {
  return card(text, "");
}

async function render(status, config, opt, audit) {
  const state = document.querySelector("#runtime-state");
  state.textContent = status.state || "unknown";
  state.classList.toggle("up", status.state === "running");
  state.classList.toggle("down", status.state !== "running");
  const accounts = status.sessions || [];
  const ready = status.ready || [];
  const drafts = status.drafts || [];
  const setCount = (id, value) => {
    const node = document.querySelector(id);
    if (node) node.textContent = String(value);
  };
  setCount("#count-accounts", accounts.length);
  setCount("#count-ready", ready.length);
  setCount("#count-drafts", drafts.length);
  const weights = status.weights || {};
  const weightLine = document.querySelector("#weights");
  if (weightLine) {
    weightLine.textContent = `Dev choice file: ${weights.dev_choice || "unknown"}. Jeff weight: ${weights.jeff || "unknown"}. Jeff tokenizer: ${weights.jeff_tokenizer || "unknown"}. A missing Jeff file keeps an ordinary inbound at weights_unavailable. That writes a local row and sends nothing.`;
  }
  document.querySelector("#sessions").innerHTML = accounts.map((item) => {
    const cls = item.status === "killed" ? "dead" : item.status === "running" ? "live" : "";
    const id = escapeHtml(item.account_id);
    return `<div class="row ${cls}"><strong>${id}</strong>
      <p class="meta">${escapeHtml(item.status)} · ${escapeHtml(item.kill_reason || "no kill reason")}</p>
      <button type="button" data-account="${id}" data-account-action="start">Start</button>
      <button type="button" data-account="${id}" data-account-action="pause">Pause</button>
      <button type="button" data-account="${id}" data-account-action="stop">Stop</button>
      <button type="button" data-account="${id}" data-resume="resume">Resume</button>
    </div>`;
  }).join("") || empty("No sessions");
  document.querySelector("#ready").innerHTML = ready.length
    ? ready.map((item) => {
        const id = escapeHtml(item.id || "");
        const refresh = id ? `<button type="button" data-refresh="${id}">Refresh score</button>` : "";
        return card(item.summary || item.display_name || "Contact", `${item.account_id || "account"} · ${item.region || ""}`, refresh);
      }).join("")
    : empty("No ready contacts");
  document.querySelector("#drafts").innerHTML = drafts.length
    ? drafts.map((item) => {
        const id = escapeHtml((item.jeff_output || {}).draft_id || "");
        const account = escapeHtml(item.account_id || "unknown account");
        const buttons = id ? `<button type="button" data-approve="${id}">Approve</button> <button type="button" data-reject="${id}">Reject</button>` : "";
        return card(item.draft_text || "Empty draft", `${account} · ${id}`, buttons);
      }).join("")
    : empty("No pending drafts");
  const health = status.health || {};
  const meter = (label, text, percent) => {
    const width = Number.isFinite(Number(percent)) ? Math.max(0, Math.min(100, Number(percent))) : 0;
    const bar = Number.isFinite(Number(percent)) ? `<span class="bar"><i style="width:${width}%"></i></span>` : "";
    return `<div class="meter-card"><dt>${label}</dt><dd>${escapeHtml(text)}</dd>${bar}</div>`;
  };
  document.querySelector("#health").innerHTML = `
    ${meter("CPU", health.cpu_percent ?? "n/a", health.cpu_percent)}
    ${meter("RAM", health.ram_percent ?? "n/a", health.ram_percent)}
    ${meter("Disk free", formatBytes(health.disk_free_bytes))}
    ${meter("Uptime", formatUptime(health.uptime_seconds))}`;
  document.querySelector("#limits-form [name=us]").value = config.limits.per_contact_daily.US;
  document.querySelector("#limits-form [name=ng]").value = config.limits.per_contact_daily.NG;
  document.querySelector("#limits-form [name=account]").value = config.limits.per_account_daily;
  document.querySelector("#timing-form [name=min]").value = config.timing.gap_min_seconds;
  document.querySelector("#timing-form [name=max]").value = config.timing.gap_max_seconds;
  document.querySelector("#optouts").innerHTML = (opt.items || []).length
    ? opt.items.map((item) => card(item.display_name || item.tiktok_user_id || "Contact", item.opt_out_type || "clear")).join("")
    : empty("None");
  document.querySelector("#audit").innerHTML = (audit.items || []).slice(0, 20)
    .map((item) => card(item.action, `${item.timestamp || ""} ${item.contact_id || ""}`)).join("") || empty("No audit rows");
  try {
    const captures = await call("/api/captures");
    const rows = captures.items || [];
    document.querySelector("#captures").innerHTML = rows.length
      ? rows.map((item) => card(item.name || "panel", item.stored_at || item.text || "")).join("")
      : "";
  } catch (error) {
    document.querySelector("#captures").innerHTML = "";
  }
}

async function refresh() {
  try {
    const status = await read("status", "/api/status");
    const config = await read("config", "/api/config");
    const opt = await read("opt-outs", "/api/optouts");
    const audit = await read("audit", "/api/audit");
    await render(status, config, opt, audit);
    setNote("Live. All four reads finished.");
  } catch (error) {
    document.querySelector("#runtime-state").classList.add("down");
    const which = error.read ? `${error.read} read failed. ` : "";
    setNote(which + explain(error));
  }
}

async function act(path, body) {
  document.body.classList.add("busy");
  try {
    const result = await call(path, { method: "POST", body: JSON.stringify(body) });
    if (result && result.status === "queued") {
      setNote("Queued. Nothing is sent until the saved session confirms the line.");
    }
    if (result && result.status === "not_wired") {
      setNote("Screen capture is not wired. Nothing was recorded.");
    }
    if (result && result.sent === false) {
      setNote(result.status === "stored_local"
        ? "Local backup stored on the PC. Nothing was sent."
        : "Remote backup did not send. The PC has no remote key, or the store refused it.");
    }
    if (result && result.score !== undefined && result.summary && !result.delivered) {
      setNote("Score refreshed. Nothing was sent.");
    }
    refresh();
  } catch (error) {
    setNote(explain(error));
  } finally {
    document.body.classList.remove("busy");
  }
}

document.querySelector("#global-controls").onclick = async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  await act("/api/control", { scope: "global", action });
};

document.body.onclick = async (event) => {
  const account = event.target.dataset.account;
  const action = event.target.dataset.accountAction;
  if (account && action) {
    await act("/api/control", { scope: "account", action, account_id: account });
  }
  if (event.target.dataset.resume && account) {
    await act("/api/resume", { account_id: account, confirm: "resume" });
  }
  const refreshId = event.target.dataset.refresh;
  if (refreshId) {
    await act(`/api/refresh/${encodeURIComponent(refreshId)}`, {});
  }
  if (event.target.dataset.approve) {
    await act("/api/drafts/approve", { draft_id: event.target.dataset.approve });
  }
  if (event.target.dataset.reject) {
    await act("/api/drafts/reject", { draft_id: event.target.dataset.reject });
  }
};

document.querySelector("#limits-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const config = await call("/api/config");
    config.limits.per_contact_daily.US = Number(event.target.us.value);
    config.limits.per_contact_daily.NG = Number(event.target.ng.value);
    config.limits.per_account_daily = Number(event.target.account.value);
    await call("/api/config", { method: "PUT", body: JSON.stringify({ config }) });
    refresh();
  } catch (error) {
    setNote(explain(error));
  }
};

document.querySelector("#timing-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const config = await call("/api/config");
    config.timing.gap_min_seconds = Number(event.target.min.value);
    config.timing.gap_max_seconds = Number(event.target.max.value);
    await call("/api/config", { method: "PUT", body: JSON.stringify({ config }) });
    refresh();
  } catch (error) {
    setNote(explain(error));
  }
};

document.querySelector("#export-config").onclick = async () => {
  try {
    const payload = await call("/api/config/export");
    document.querySelector("#config-json").value = payload.config;
  } catch (error) {
    setNote(explain(error));
  }
};

document.querySelector("#import-config").onclick = async () => {
  try {
    const config = JSON.parse(document.querySelector("#config-json").value);
    await call("/api/config", { method: "PUT", body: JSON.stringify({ config }) });
    refresh();
  } catch (error) {
    setNote(explain(error));
  }
};

document.querySelector("#account-form").onsubmit = async (event) => {
  event.preventDefault();
  await act("/api/accounts", {
    account_id: event.target.account_id.value,
    label: event.target.label.value,
  });
};

document.querySelector("#save-panel").onclick = async () => {
  const text = document.querySelector("#panel-title").textContent + " " + (linkState ? linkState.textContent : "");
  await act("/api/captures", { name: document.querySelector("#panel-title").textContent, text });
};

document.querySelector("#screen-capture").onclick = () => act("/api/captures/screen", {});
document.querySelector("#remote-backup").onclick = () => act("/api/backup/remote", {});
document.querySelector("#local-backup").onclick = () => act("/api/backup/local", {});

document.querySelector("#download-backup").onclick = async () => {
  try {
    const found = await call("/api/backup/local");
    if (!found.blob_b64) {
      setNote("No local backup on the PC. Nothing downloaded. Nothing sent.");
      return;
    }
    const bytes = Uint8Array.from(atob(found.blob_b64), (char) => char.charCodeAt(0));
    const file = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = found.file || "adrian-social-backup.enc";
    link.click();
    URL.revokeObjectURL(url);
    setNote("Encrypted backup downloaded to this device. Nothing was sent.");
  } catch (error) {
    setNote(explain(error));
  }
};

document.querySelector("#restore-local").onclick = async () => {
  document.body.classList.add("busy");
  try {
    const found = await call("/api/backup/local");
    if (!found.blob_b64) {
      setNote("No local backup on the PC. Nothing restored. Nothing sent.");
      return;
    }
    const result = await call("/api/backup/local/restore", {
      method: "POST",
      body: JSON.stringify({ confirm: "restore", blob_b64: found.blob_b64 }),
    });
    setNote(result.restored
      ? "Settings restored from the local file. Nothing was sent."
      : "Restore refused. A wrong key restores nothing. Nothing was sent.");
    refresh();
  } catch (error) {
    setNote(explain(error));
  } finally {
    document.body.classList.remove("busy");
  }
};

document.querySelector("#check-update").onclick = async () => {
  try {
    const result = await call("/api/update");
    const note = document.querySelector("#update-note");
    const text = result.update_available
      ? `A newer version is listed: ${result.latest}. Nothing is installed from this button.`
      : `No install. ${result.reason || "current"}. Current version ${result.current || "unknown"}. Checked ${result.checked_at || "now"}. A fresh check waits six hours.`;
    if (note) note.textContent = text;
    setNote(text);
  } catch (error) {
    setNote(explain(error));
  }
};

refresh();
setInterval(refresh, 15000);
