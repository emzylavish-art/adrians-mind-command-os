(() => {
function mountSocialPanel(root) {
  const baseInput = root.querySelector("#api-base");
  const secretInput = root.querySelector("#api-secret");
  const note = root.querySelector("#connect-note");
  const linkState = root.querySelector("#link-state");
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
  const groupHome = { operate: "overview", inbox: "accounts", guard: "guard", record: "records" };
  const lifetime = new AbortController();
  const standalone = root.hasAttribute("data-standalone");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const localConnection = standalone && (loopback || location.protocol === "file:");
  const runtimeState = root.querySelector("#runtime-state");
  const actionResult = root.querySelector("#action-result");
  const refreshButton = root.querySelector("#refresh-status");
  let connection = null;
  let previouslyVerified = false;

  function selectCurrent(button, current) {
    if (current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }

  function showPanel(panel, focus = false) {
    if (!Object.hasOwn(titles, panel)) panel = "overview";
    const group = groups[panel];
    root.querySelectorAll(".panel").forEach(item => { item.hidden = item.id !== panel; });
    root.querySelectorAll(".section-nav button").forEach(button => {
      button.hidden = button.dataset.group !== group;
      selectCurrent(button, button.dataset.panel === panel);
    });
    root.querySelectorAll(".social-groups button").forEach(button => selectCurrent(button, button.dataset.group === group));
    const heading = root.querySelector("#panel-title");
    heading.textContent = titles[panel];
    if (focus) heading.focus();
    if (standalone && location.hash !== `#${panel}`) history.replaceState(history.state, "", `#${panel}`);
  }

  showPanel(standalone ? location.hash.slice(1) : "overview");
  root.addEventListener("click", event => {
    const group = event.target.closest(".social-groups [data-group]");
    if (group) showPanel(groupHome[group.dataset.group], true);
    const panel = event.target.closest("[data-panel]");
    if (panel) showPanel(panel.dataset.panel, !panel.closest("nav"));
  }, { signal: lifetime.signal });

  function saved(key, fallback) {
    if (!localConnection) return fallback;
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setNote(text) {
    actionResult.hidden = false;
    actionResult.textContent = text;
  }

  function paintConnection(state, label, detail) {
    runtimeState.dataset.state = state;
    runtimeState.textContent = label;
    if (linkState.textContent !== detail) linkState.textContent = detail;
    updateControls();
  }

  function explain(error) {
    let message = String(error && error.message || error || "");
    if (connection?.secret) message = message.replaceAll(connection.secret, "[redacted]");
    message = message.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (message.length > 160) message = message.slice(0, 160) + "…";
    if (error?.status === 401 || error?.status === 403) return "The Social service refused these credentials.";
    if (error?.status === 404) return "Adrian Social was unavailable at that address.";
    if (error?.responseLost || error?.name === "TimeoutError") return "The PC response could not be verified.";
    if (error?.status) return `The Social service refused the request (HTTP ${error.status}).`;
    return message || "A read did not finish. The panel stays Not connected.";
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return "Unavailable";
    const gb = value / 1024 / 1024 / 1024;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(value / 1024 / 1024)} MB`;
  }

  function formatUptime(value) {
    if (!Number.isFinite(value) || value < 0) return "Unavailable";
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  function readConnection() {
    const address = baseInput.value.trim();
    const secret = secretInput.value.trim();
    if (!address || !secret) throw new Error("Enter the service URL and local secret.");
    let url;
    try { url = new URL(address); } catch { throw new Error("Enter a valid service URL."); }
    const localHttp = loopback && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:";
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Enter the service address without a path, query, or credentials. Remote connections require HTTPS.");
    }
    return { base: url.origin, secret };
  }

  baseInput.value = saved("adrian-base", localConnection && loopback ? location.origin : "");
  secretInput.value = localConnection
    ? (document.querySelector('meta[name="adrian-secret"]')?.content || saved("adrian-secret", ""))
    : "";

  async function call(path, options = {}) {
    const target = connection;
    if (!target) throw new Error("Connect to your PC first.");
    let response;
    try {
      response = await fetch(target.base + path, {
        ...options,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12_000)]),
        headers: { "Content-Type": "application/json", "X-Adrian-Secret": target.secret },
      });
    } catch {
      throw Object.assign(new Error("The PC response could not be verified."), { responseLost: true });
    }
    if (!response.ok) throw Object.assign(new Error("Social request refused."), { status: response.status });
    return response.json();
  }

  root.querySelector("#save-connect").onclick = () => {
    if (busy) return;
    let next;
    try { next = readConnection(); }
    catch (error) { note.textContent = explain(error); return; }
    if (localConnection) {
      try {
        localStorage.setItem("adrian-base", next.base);
        localStorage.setItem("adrian-secret", next.secret);
      } catch { /* This open dashboard can still use the inputs. */ }
    }
    if (connection?.base !== next.base || connection?.secret !== next.secret) {
      previouslyVerified = false;
      edited.clear();
      originalValues.clear();
      for (const id of ["#sessions", "#ready", "#draft-list", "#optouts", "#audit", "#captures", "#health"]) {
        root.querySelector(id).textContent = "";
      }
      root.querySelector("#config-json").value = "";
      actionResult.hidden = true;
      actionResult.textContent = "";
      for (const id of ["#count-accounts", "#count-ready", "#count-drafts"]) root.querySelector(id).textContent = "—";
      root.querySelector("#weights").textContent = "Model files will be checked when the PC responds.";
    }
    connection = next;
    freshStatus = false;
    note.textContent = "Checking the connection.";
    paintConnection("checking", "Checking", "Checking status and records on the selected PC.");
    void refresh();
  };

  function card(title, meta, extra = "") {
    return `<div class="card"><strong>${escapeHtml(title)}</strong><p class="meta">${escapeHtml(meta)}</p>${extra ? `<div class="row-actions">${extra}</div>` : ""}</div>`;
  }

  function empty(text) {
    return card(text, "");
  }

  let refreshGeneration = 0;
  let freshStatus = false;
  const edited = new Set();
  const originalValues = new Map();
  const formValues = {
    "limits-form": (config) => ({ us: config.limits.per_contact_daily.US, ng: config.limits.per_contact_daily.NG, account: config.limits.per_account_daily }),
    "timing-form": (config) => ({ min: config.timing.gap_min_seconds, max: config.timing.gap_max_seconds }),
  };
  for (const id of Object.keys(formValues)) {
    root.querySelector("#" + id).addEventListener("input", () => edited.add(id));
  }
  function renderConfig(config) {
    for (const [id, valuesFor] of Object.entries(formValues)) {
      const values = valuesFor(config);
      if (Object.values(values).some(value => !Number.isFinite(value))) throw new Error("Invalid PC settings response.");
      if (edited.has(id)) continue;
      originalValues.set(id, JSON.stringify(values));
      for (const [key, value] of Object.entries(values)) root.querySelector("#" + id).elements.namedItem(key).value = value;
    }
  }
  function maySave(form, config) {
    if (!originalValues.has(form.id)) {
      setNote("Load the PC settings before saving.");
      return false;
    }
    if (JSON.stringify(formValues[form.id](config)) === originalValues.get(form.id)) return true;
    if (!window.confirm("These settings changed on the PC. Replace them with the values in this form?")) {
      setNote("Your draft is still here. The PC settings were kept.");
      return false;
    }
    return true;
  }

  function renderStatus(status) {
    if (![status.sessions, status.ready, status.drafts].every(Array.isArray)) throw new Error("The PC did not return complete account, queue, and draft status.");
    const accounts = status.sessions || [];
    const ready = status.ready || [];
    const drafts = status.drafts || [];
    const setCount = (id, value) => {
      const node = root.querySelector(id);
      if (node) node.textContent = String(value);
    };
    setCount("#count-accounts", accounts.length);
    setCount("#count-ready", ready.length);
    setCount("#count-drafts", drafts.length);
    const weights = status.weights || {};
    const weightLine = root.querySelector("#weights");
    if (weightLine) {
      weightLine.textContent = `Dev choice file: ${weights.dev_choice || "unknown"}. Jeff weight: ${weights.jeff || "unknown"}. Jeff tokenizer: ${weights.jeff_tokenizer || "unknown"}. A missing Jeff file keeps an ordinary inbound at weights_unavailable. That writes a local row and sends nothing.`;
    }
    root.querySelector("#sessions").innerHTML = accounts.map((item) => {
      const cls = item.status === "killed" ? "dead" : item.status === "running" ? "live" : "";
      const id = escapeHtml(item.account_id);
      return `<div class="row ${cls}"><strong>${id}</strong>
        <p class="meta">${escapeHtml(item.status)} · ${escapeHtml(item.kill_reason || "no kill reason")}</p>
        <div class="row-actions">
        <button type="button" data-account="${id}" data-account-action="start">Start</button>
        <button type="button" data-account="${id}" data-account-action="pause">Pause</button>
        <button type="button" data-account="${id}" data-account-action="stop">Stop</button>
        ${item.status === "killed" ? `<button type="button" data-account="${id}" data-resume="resume">Resume</button>` : ""}
      </div></div>`;
    }).join("") || empty("No sessions");
    root.querySelector("#ready").innerHTML = ready.length
      ? ready.map((item) => {
          const id = escapeHtml(item.id || "");
          const refresh = id ? `<button type="button" data-refresh="${id}">Refresh score</button>` : "";
          return card(item.summary || item.display_name || "Contact", `${item.account_id || "account"} · ${item.region || ""}`, refresh);
        }).join("")
      : empty("No ready contacts");
    root.querySelector("#draft-list").innerHTML = drafts.length
      ? drafts.map((item) => {
          const id = escapeHtml((item.jeff_output || {}).draft_id || "");
          const account = escapeHtml(item.account_id || "unknown account");
          const buttons = id ? `<button type="button" data-approve="${id}">Approve</button> <button type="button" data-reject="${id}">Reject</button>` : "";
          return card(item.draft_text || "Empty draft", `${account} · ${id}`, buttons);
        }).join("")
      : empty("No pending drafts");
    const health = status.health || {};
    const percentText = value => Number.isFinite(value) && value >= 0 && value <= 100 ? `${value}%` : "Unavailable";
    const meter = (label, text, percent) => {
      const valid = Number.isFinite(percent) && percent >= 0 && percent <= 100;
      const bar = valid ? `<span class="bar" aria-hidden="true"><i style="width:${percent}%"></i></span>` : "";
      return `<div class="meter-card"><dt>${label}</dt><dd>${escapeHtml(text)}</dd>${bar}</div>`;
    };
    root.querySelector("#health").innerHTML = `
      ${meter("CPU", percentText(health.cpu_percent), health.cpu_percent)}
      ${meter("RAM", percentText(health.ram_percent), health.ram_percent)}
      ${meter("Disk free", formatBytes(health.disk_free_bytes))}
      ${meter("Uptime", formatUptime(health.uptime_seconds))}`;
  }

  let busy = false;
  let refreshing = false;

  function updateControls() {
    const controls = "#global-controls button, #sessions button, #ready button, #draft-list button, #account-form button, #limits-form button, #timing-form button, #export-config, #import-config, #save-panel, #screen-capture, #remote-backup, #local-backup, #download-backup, #restore-local, #check-update";
    root.querySelectorAll(controls).forEach(button => {
      const allowStop = previouslyVerified && button === root.querySelector('#global-controls [data-action="stop"]');
      button.disabled = busy || (!freshStatus && !allowStop);
    });
    refreshButton.disabled = !connection || refreshing || busy;
    root.querySelector("#save-connect").disabled = busy;
  }

  async function refresh() {
    if (!connection) return;
    const generation = ++refreshGeneration;
    refreshing = true;
    updateControls();
    const parts = [
      ["status", "/api/status", renderStatus],
      ["settings", "/api/config", renderConfig],
      ["opt-outs", "/api/optouts", opt => {
        if (!Array.isArray(opt.items)) throw new Error("Invalid opt-out response.");
        root.querySelector("#optouts").innerHTML = opt.items.map(item =>
          card(item.display_name || item.tiktok_user_id || "Contact", item.opt_out_type || "clear")).join("") || empty("No opt-outs");
      }],
      ["audit", "/api/audit", audit => {
        if (!Array.isArray(audit.items)) throw new Error("Invalid audit response.");
        root.querySelector("#audit").innerHTML = audit.items.slice(0, 20)
          .map(item => card(item.action, `${item.timestamp || ""} ${item.contact_id || ""}`)).join("") || empty("No audit rows");
      }],
      ["captures", "/api/captures", captures => {
        if (!Array.isArray(captures.items)) throw new Error("Invalid captures response.");
        root.querySelector("#captures").innerHTML = captures.items
          .map(item => card(item.name || "Panel", item.stored_at || item.text || "")).join("") || empty("No saved captures");
      }],
    ];
    let serviceState = "unknown";
    const results = await Promise.allSettled(parts.map(async ([name, path, paint]) => {
      const data = await call(path);
      if (generation !== refreshGeneration || lifetime.signal.aborted) return;
      paint(data);
      if (name === "status") serviceState = data.state || "unknown";
    }));
    if (generation !== refreshGeneration || lifetime.signal.aborted) return;
    refreshing = false;
    const failures = parts.filter((_, index) => results[index].status === "rejected").map(([name]) => name);
    const core = results.slice(0, 4);
    freshStatus = core.every(result => result.status === "fulfilled");
    previouslyVerified ||= freshStatus;
    const refused = core.some(result => result.status === "rejected" && [401, 403].includes(result.reason?.status));
    if (refused) {
      previouslyVerified = false;
      note.textContent = "Check the service address and local secret.";
      paintConnection("error", "Access refused", "The PC refused this connection. Check the service address and local secret.");
    } else if (!freshStatus) {
      const detail = `Could not verify ${failures.join(", ")}. Displayed records may be stale.`;
      note.textContent = detail;
      paintConnection("error", previouslyVerified ? "Data stale" : "Disconnected", detail);
    } else {
      const labels = { running: "Running", paused: "Paused", stopped: "Stopped", killed: "Stopped by safeguard" };
      const detail = failures.length ? `Connected to your PC. Could not refresh ${failures.join(", ")}.` : "Connected to your PC. Status and records are current.";
      note.textContent = detail;
      paintConnection("connected", labels[serviceState] ?? "Connected", detail);
    }
  }

  async function runAction(run, { requiresFresh = true, refreshAfter = false } = {}) {
    if (busy || !connection || (requiresFresh && !freshStatus)) return;
    busy = true;
    updateControls();
    setNote("Waiting for the PC response.");
    try {
      await run();
      if (refreshAfter) await refresh();
    } catch (error) {
      if (lifetime.signal.aborted) return;
      setNote(`${explain(error)} Check the saved records before repeating a write.`);
      if (refreshAfter) await refresh();
    } finally {
      busy = false;
      updateControls();
    }
  }

  function act(path, body) {
    const approvedStop = path === "/api/control" && body.scope === "global" && body.action === "stop" && previouslyVerified;
    return runAction(async () => {
      const result = await call(path, { method: "POST", body: JSON.stringify(body) });
      if (result?.status === "queued") setNote("Queued. Delivery has not been confirmed.");
      else if (result?.status === "not_wired") setNote("Screen capture is unavailable. Nothing was recorded.");
      else if (result?.status === "stored_local" && result.sent === false) setNote("Local backup stored on the PC. Nothing was sent.");
      else if (result?.sent === false) setNote("The PC reported that nothing was sent.");
      else if (result?.score !== undefined && result.summary && !result.delivered) setNote("Score refreshed. Nothing was sent.");
      else setNote("The PC responded. Check the updated records for the action outcome.");
    }, { requiresFresh: !approvedStop, refreshAfter: true });
  }

  root.querySelector("#global-controls").onclick = async (event) => {
    const action = event.target.closest("button[data-action]")?.dataset.action;
    if (!action) return;
    await act("/api/control", { scope: "global", action });
  };

  root.addEventListener("click", event => {
    const control = event.target.closest("#sessions button, #ready button, #draft-list button");
    if (!control || !freshStatus || busy) return;
    const { account, accountAction, resume, refresh: refreshId, approve, reject } = control.dataset;
    if (account && accountAction) void act("/api/control", { scope: "account", action: accountAction, account_id: account });
    if (resume && account) void act("/api/resume", { account_id: account, confirm: "resume" });
    if (refreshId) void act(`/api/refresh/${encodeURIComponent(refreshId)}`, {});
    if (approve) void act("/api/drafts/approve", { draft_id: approve });
    if (reject) void act("/api/drafts/reject", { draft_id: reject });
  }, { signal: lifetime.signal });

  function applySettings(form, write) {
    form.onsubmit = event => {
      event.preventDefault();
      const snapshot = new FormData(form);
      void runAction(async () => {
        const config = await call("/api/config");
        if (!maySave(form, config)) return;
        write(config, snapshot);
        await call("/api/config", { method: "PUT", body: JSON.stringify({ config }) });
        originalValues.set(form.id, JSON.stringify(formValues[form.id](config)));
        if (JSON.stringify([...snapshot]) === JSON.stringify([...new FormData(form)])) edited.delete(form.id);
        setNote("Settings saved on the PC.");
      }, { refreshAfter: true });
    };
  }
  applySettings(root.querySelector("#limits-form"), (config, values) => {
    config.limits.per_contact_daily.US = Number(values.get("us"));
    config.limits.per_contact_daily.NG = Number(values.get("ng"));
    config.limits.per_account_daily = Number(values.get("account"));
  });
  applySettings(root.querySelector("#timing-form"), (config, values) => {
    const min = Number(values.get("min"));
    const max = Number(values.get("max"));
    if (min > max) throw new Error("The maximum gap must be at least the minimum gap.");
    config.timing.gap_min_seconds = min;
    config.timing.gap_max_seconds = max;
  });

  root.querySelector("#export-config").onclick = () => {
    const field = root.querySelector("#config-json");
    const previous = field.value;
    void runAction(async () => {
      const payload = await call("/api/config/export");
      if (typeof payload.config !== "string") throw new Error("The PC did not return settings text.");
      if (field.value === previous) field.value = payload.config;
      setNote(field.value === payload.config ? "Settings copied into the text field." : "The settings draft changed while exporting and was kept.");
    });
  };

  root.querySelector("#import-config").onclick = () => {
    let config;
    try {
      config = JSON.parse(root.querySelector("#config-json").value);
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
    } catch { setNote("Enter a valid settings JSON object."); return; }
    void runAction(async () => {
      await call("/api/config", { method: "PUT", body: JSON.stringify({ config }) });
      setNote("Settings imported on the PC.");
    }, { refreshAfter: true });
  };

  root.querySelector("#account-form").onsubmit = async (event) => {
    event.preventDefault();
    await act("/api/accounts", {
      account_id: event.target.account_id.value,
      label: event.target.label.value,
    });
  };

  root.querySelector("#save-panel").onclick = async () => {
    const text = root.querySelector("#panel-title").textContent + " " + (linkState ? linkState.textContent : "");
    await act("/api/captures", { name: root.querySelector("#panel-title").textContent, text });
  };

  root.querySelector("#screen-capture").onclick = () => act("/api/captures/screen", {});
  root.querySelector("#remote-backup").onclick = () => act("/api/backup/remote", {});
  root.querySelector("#local-backup").onclick = () => act("/api/backup/local", {});

  root.querySelector("#download-backup").onclick = () => runAction(async () => {
    const found = await call("/api/backup/local");
    if (!found.blob_b64) { setNote("No local backup was found on the PC."); return; }
    const bytes = Uint8Array.from(atob(found.blob_b64), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = found.file || "adrian-social-backup.enc";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("Encrypted backup downloaded to this device.");
  });

  root.querySelector("#restore-local").onclick = () => runAction(async () => {
    const found = await call("/api/backup/local");
    if (!found.blob_b64) { setNote("No local backup was found on the PC."); return; }
    const result = await call("/api/backup/local/restore", {
      method: "POST",
      body: JSON.stringify({ confirm: "restore", blob_b64: found.blob_b64 }),
    });
    setNote(result.restored ? "Settings restored from the local backup." : "The PC refused to restore the local backup.");
  }, { refreshAfter: true });

  root.querySelector("#check-update").onclick = () => runAction(async () => {
    const result = await call("/api/update");
    const text = result.update_available
      ? `Version ${result.latest} is available. This check did not install it.`
      : `No update reported. Current version ${result.current || "unknown"}.`;
    root.querySelector("#update-note").textContent = text;
    setNote(text);
  });

  refreshButton.onclick = () => { if (!busy) void refresh(); };
  updateControls();
  if (localConnection && baseInput.value && secretInput.value) {
    try { connection = readConnection(); paintConnection("checking", "Checking", "Checking status and records on the selected PC."); void refresh(); }
    catch { /* The local configuration can be repaired from Connect. */ }
  }
  const interval = setInterval(() => { if (!busy && !refreshing) void refresh(); }, 15_000);
  return () => {
    lifetime.abort();
    clearInterval(interval);
    baseInput.value = "";
    secretInput.value = "";
    connection = null;
  };

}

const panel = document.currentScript?.closest("[data-adrian-social]")
  ?? document.querySelector("[data-adrian-social][data-standalone]");
if (panel?.isConnected) {
  const dispose = mountSocialPanel(panel);
  panel.addEventListener("adrian-social:dispose", dispose, { once: true });
  panel.dispatchEvent(new Event("adrian-social:ready"));
}
})();
