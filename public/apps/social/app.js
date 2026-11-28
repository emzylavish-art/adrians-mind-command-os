const $ = s => document.querySelector(s);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function stored(storage,key,fallback="") {try{return storage.getItem(key)||fallback;}catch{return fallback;}}
function remember(storage,key,value) {try{storage.setItem(key,value);}catch{setNote("Browser storage is unavailable. Keep this tab open for this session.");}}
function forget(storage,key) {try{storage.removeItem(key);}catch{}}
const legacySecret=stored(localStorage,"adrian-secret");
if(legacySecret){remember(sessionStorage,"adrian-secret",legacySecret);forget(localStorage,"adrian-secret");}
const secretMeta = $('meta[name="adrian-secret"]');
const baseInput = $("#api-base");
const secretInput = $("#api-secret");
const titles = {today:"Today", leads:"Leads", campaigns:"Campaigns", review:"Review", pipeline:"Pipeline", connections:"Connections"};
let data = {leads:[],drafts:[],campaigns:[],pipeline:[]};
let fresh = false;
let activeRefresh;
let currentPage = "today";
let viewVersion = 0;
const rendered = new WeakMap();
let campaignFilter = "";
let leadPage = 0;
let reviewIndex = 0;
const edited = new Map();
baseInput.value = stored(localStorage,"adrian-base") || (["localhost","127.0.0.1"].includes(location.hostname) ? location.origin : "");
secretInput.value = secretMeta?.content || stored(sessionStorage,"adrian-secret") || "";
function setNote(text) { $("#action-status").textContent = text; }
function explain(error) { return error?.message || "The service could not finish this request."; }
function paintList(selector, markup) {
  const element = $(selector);
  if (rendered.get(element) === markup) return;
  element.innerHTML = markup;
  rendered.set(element, markup);
}
function empty(title, text) { return '<div class="empty"><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p></div>'; }
function route() {
  const name = location.hash.slice(1) || "today";
  const page = Object.hasOwn(titles, name) ? name : "today";
  currentPage = page;
  viewVersion += 1;
  document.querySelectorAll(".view").forEach(el => {el.hidden = el.id !== page;});
  document.querySelectorAll(".sidebar a").forEach(el => {
    if (el.hash === "#"+page) el.setAttribute("aria-current","page");
    else el.removeAttribute("aria-current");
  });
  $("#panel-title").textContent = titles[page];
  window.scrollTo({top:0,behavior:"instant"});
}
window.addEventListener("hashchange", () => {
  route();
  void refreshSection(currentPage, viewVersion);
});
route();
let theme = stored(localStorage,"amcos.theme.v1") || "dark";
function paintTheme() {
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle").textContent = theme === "dark" ? "Light appearance" : "Dark appearance";
}
paintTheme();
$("#theme-toggle").onclick = () => {theme = theme === "dark" ? "light" : "dark"; remember(localStorage,"amcos.theme.v1",theme);paintTheme();};
$("#save-connect").onclick = () => {
  remember(localStorage,"adrian-base",baseInput.value.trim());
  remember(sessionStorage,"adrian-secret",secretInput.value.trim());
  forget(localStorage,"adrian-secret");
  viewVersion += 1;
  void refresh(true);
};
async function call(path, options={}) {
  const base = baseInput.value.trim().replace(/\/$/,"");
  if (!base) throw new Error("Connect your Social service in Connections to see your customers.");
  const response = await fetch(base+path,{signal:AbortSignal.timeout(20000),...options,
    headers:{"Content-Type":"application/json","X-Adrian-Secret":secretInput.value.trim(),...options.headers}});
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your connection needs authorization. Update it in Connections.");
    let detail = "Request failed ("+response.status+"). Your work is preserved.";
    try {const body=await response.json();if(typeof body.detail === "string") detail=body.detail;} catch {}
    throw new Error(detail);
  }
  return response.json();
}
async function act(path, body) {
  if (!fresh) {setNote("Refresh your connection before changing this item.");return;}
  if(document.body.classList.contains("busy"))return;
  document.body.classList.add("busy");
  const buttons=[...document.querySelectorAll("button:not(:disabled)")];
  buttons.forEach(b=>b.disabled=true);
  try {
    const result=await call(path,{method:"POST",body:JSON.stringify(body)});
    setNote(result.reason || (result.status === "queued" ? "Reply queued. Waiting for delivery confirmation." : "Saved."));
    document.body.classList.remove("busy");
    await refresh();
    return result;
  } catch(error) {setNote(explain(error));}
  finally {document.body.classList.remove("busy");buttons.forEach(b=>b.disabled=false);document.querySelectorAll("[data-approve],[data-reject],[data-save]").forEach(b=>b.disabled=!fresh || b.dataset.held==="true");}
}
const statusNames = {first_reply:"First reply",reply_due:"Reply due",waiting:"Waiting for customer",held:"Held",stopped:"Stopped"};
function leadRow(lead) {
  const urgent = lead.age_hours>=24 && ["first_reply","reply_due"].includes(lead.status);
  return '<article class="lead-row"><div><strong>'+esc(lead.display_name || lead.tiktok_user_id)+'</strong><small>'+esc(lead.account_id)+' · '+esc(lead.campaign || "Campaign unknown")+'</small></div><p class="excerpt">'+esc(lead.latest_message)+'</p><div><span class="badge '+(urgent?"urgent":"")+'">'+esc(statusNames[lead.status])+' · '+esc(lead.age_hours)+'h</span><br><button class="secondary" data-lead="'+esc(lead.id)+'">Open</button></div></article>';
}
function renderLeads() {
  const filter=$("#lead-filter").value;
  const search=$("#search").value.toLowerCase();
  const rows=data.leads.filter(l=>(!campaignFilter || l.campaign === campaignFilter) &&
    (filter==="all" || (filter==="overdue" ? l.age_hours>=24 && ["first_reply","reply_due"].includes(l.status) : l.status===filter)) &&
    [l.display_name,l.latest_message,l.campaign,l.account_id].join(" ").toLowerCase().includes(search));
  leadPage=Math.min(leadPage,Math.max(0,Math.ceil(rows.length/25)-1));
  $("#leads-page").textContent=rows.length? (leadPage*25+1)+"–"+Math.min(rows.length,(leadPage+1)*25)+" of "+rows.length : "0 leads";
  $("#leads-prev").disabled=leadPage===0;
  $("#leads-next").disabled=(leadPage+1)*25>=rows.length;
  paintList("#lead-list", rows.slice(leadPage*25,(leadPage+1)*25).map(leadRow).join("") || empty("No matching conversations","Try another filter or search. Connected sources determine which leads appear here."));
  const due=data.leads.filter(l=>["first_reply","reply_due"].includes(l.status));
  paintList("#today-list", due.slice(0,10).map(leadRow).join("") || empty("Your worklist is clear","No captured conversations are awaiting a response. Check source coverage in Connections."));
  $("#today-list").setAttribute("aria-busy","false");
  $("#first-count").textContent=due.filter(l=>l.status==="first_reply").length;
  $("#overdue-count").textContent=due.filter(l=>l.age_hours>=24).length;
}
function renderPipeline() {
  $("#pipeline-list").innerHTML=data.pipeline.map(p=>'<article class="lead-row"><div><strong>'+esc(p.display_name)+'</strong><small>'+esc(p.account_id)+'</small></div><p>'+esc(p.notes)+'</p><div><span class="badge">'+esc(p.stage)+'</span><br><button class="secondary" data-lead="'+esc(p.id)+'">Open</button></div></article>').join("") || empty("Your pipeline starts with a conversation","Open a lead and choose its stage to track a booking, sale or support request.");
}
function renderReview() {
  $("#review-count").textContent=data.drafts.length || "";
  $("#draft-count").textContent=data.drafts.length;
  reviewIndex=Math.min(reviewIndex,Math.max(0,data.drafts.length-1));
  $("#review-page").textContent=data.drafts.length ? "Reply "+(reviewIndex+1)+" of "+data.drafts.length : "0 replies";
  $("#review-prev").disabled=reviewIndex===0;
  $("#review-next").disabled=reviewIndex>=data.drafts.length-1;
  const reviewMarkup = data.drafts.slice(reviewIndex,reviewIndex+1).map(d=>{
    const id=d.jeff_output.draft_id;
    const lead=data.leads.find(l=>l.id===d.contact_id);
    return '<article class="review-card">'+(d.action==='draft_held'?'<p class="badge urgent">Manual handling required</p>':'')+'<h3>'+esc(lead?.display_name || d.account_id)+'</h3><small>'+esc(lead?.campaign || "Campaign unknown")+' · '+esc(d.timestamp)+'</small><div class="review-columns"><div><small>Original conversation</small><blockquote>'+esc(lead?.latest_message || "Open the conversation to verify its context.")+'</blockquote><button class="secondary" data-lead="'+esc(d.contact_id)+'">Conversation</button></div><label>Your reply<textarea data-draft="'+esc(id)+'" aria-label="Reply for '+esc(lead?.display_name || d.account_id)+'">'+esc(edited.get(id) ?? d.draft_text)+'</textarea></label></div><div class="actions"><button data-approve="'+esc(id)+'" '+(d.action==='draft_held'?'disabled data-held="true"':'')+'>Approve reply</button><button class="secondary" data-save="'+esc(id)+'">Save revision</button><button class="secondary" data-reject="'+esc(id)+'">Reject</button></div></article>';
  }).join("") || empty("All caught up","Replies appear here when the drafter has prepared them. New leads stay in Today while drafting is unavailable.");
  paintList("#draft-list", reviewMarkup);
  $("#draft-list").querySelectorAll("[data-approve],[data-save],[data-reject]").forEach(button => {
    button.disabled = !fresh || button.dataset.held === "true";
  });
}
function renderCampaigns() {
  $("#campaign-list").innerHTML=data.campaigns.map(c=>'<article class="campaign-card"><small>'+esc(c.platform)+' · '+esc(c.business)+'</small><h3>'+esc(c.name)+'</h3><p>'+esc(c.offer)+'</p><strong>'+c.leads+' captured leads</strong><p>'+esc(c.goal)+' · '+esc(c.status)+'</p><button class="secondary" data-campaign="'+esc(c.name)+'">View leads</button></article>').join("") || empty("Give your next campaign a home","Add the offer and provider campaign ID. Only attributed captured inquiries contribute to its lead count.");
}
$("#x-import").addEventListener("click", async () => {
  const result = await act("/api/sources/x/import", {});
  if (!result) return;
  if (result.status === "recent_page_checked") {
    const coverage = result.additional_pages ? " Older messages remain available from X." : "";
    setNote(result.accepted + " imported · " + result.duplicate + " already collected." + coverage);
  } else {
    setNote("X import: " + result.status.replaceAll("_", " "));
  }
});

$("#media-prepare").addEventListener("click", async () => {
  const file = $("#media-file").files[0];
  if (!file || file.size > 5 * 1024 * 1024) {
    setNote("Choose a JPEG, PNG or WebP image no larger than 5 MiB.");
    return;
  }
  const button = $("#media-prepare");
  button.disabled = true;
  try {
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",", 2)[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const result = await call("/api/media/images", {method: "POST", body: JSON.stringify({data: encoded})});
    const base = baseInput.value.trim().replace(/\/$/, "");
    const response = await fetch(base + "/api/media/images/" + encodeURIComponent(result.id), {
      headers: {"X-Adrian-Secret": secretInput.value.trim()}, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Prepared image is unavailable.");
    const download = $("#media-download");
    if (download.href.startsWith("blob:")) URL.revokeObjectURL(download.href);
    download.href = URL.createObjectURL(await response.blob());
    download.hidden = false;
    setNote("Image ready at " + result.width + " × " + result.height + ".");
  } catch (error) {
    setNote(explain(error));
  } finally {
    button.disabled = false;
  }
});

async function refreshSchedule() {
  const panel = $("#schedule-status");
  try {
    const {items} = await call("/api/schedule");
    const rows = items.map(item => {
      const open = ["scheduled", "review_due", "approved"].includes(item.state);
      const approve = open && item.platform === "x" && item.state !== "approved"
        ? '<button type="button" data-schedule-approve="' + esc(item.id) + '">Approve X publication</button>' : "";
      const cancel = open ? '<button type="button" class="secondary" data-schedule-cancel="'
        + esc(item.id) + '">Cancel</button>' : "";
      const receipt = item.receipt ? '<p>Post ID ' + esc(item.receipt) + '</p>' : "";
      return '<article class="card"><strong>' + esc(item.platform) + ' · '
        + esc(new Date(item.due_at).toLocaleString()) + '</strong><p>' + esc(item.body)
        + '</p><p>' + esc(item.state.replaceAll("_", " ")) + '</p>' + receipt
        + '<div class="actions">' + approve + cancel + '</div></article>';
    });
    panel.innerHTML = rows.join("") || '<p>No posts scheduled for review.</p>';
  } catch {
    panel.textContent = "Publishing calendar unavailable.";
  }
}

async function refreshAnalytics() {
  const panel = $("#analytics-status");
  try {
    const report = await call("/api/analytics");
    const rows = report.sources.map(item => '<li>' + esc(item.source) + ' · ' +
      esc(item.messages) + ' messages from ' + esc(item.contacts) + ' contacts</li>');
    panel.innerHTML = '<p>Source: local Social records</p><p>' + esc(report.pending_review) +
      ' pending review · ' + esc(report.confirmed_deliveries) + ' confirmed deliveries</p>' +
      (rows.length ? '<ul>' + rows.join("") + '</ul>' : '<p>No recorded inbound activity.</p>');
  } catch {
    panel.textContent = "Social analytics unavailable.";
  }
}

$("#schedule-form").addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const form = event.currentTarget;
  try {
    values.due_at = new Date(values.due_at).toISOString();
    await call("/api/schedule", {method: "POST", body: JSON.stringify(values)});
    form.reset();
    setNote("Post saved for review.");
    await refreshSchedule();
  } catch (error) {
    setNote(explain(error));
  }
});

$("#schedule-status").addEventListener("click", async event => {
  const button = event.target.closest("[data-schedule-approve],[data-schedule-cancel]");
  if (!button || button.disabled) return;
  const approve = Boolean(button.dataset.scheduleApprove);
  const id = button.dataset.scheduleApprove || button.dataset.scheduleCancel;
  button.disabled = true;
  try {
    await call("/api/schedule/" + encodeURIComponent(id) + (approve ? "/approve" : "/cancel"), {method: "POST"});
    if (approve) setNote("X publication approved for the scheduled time.");
    await refreshSchedule();
  } catch (error) {
    setNote(explain(error));
  } finally {
    button.disabled = false;
  }
});

async function refreshBots() {
  const panel = $("#bot-status");
  try {
    const status = await call("/api/bots");
    const rows = Object.entries(status.workers).map(([name, worker]) => {
      const heartbeat = worker.last_heartbeat
        ? new Date(worker.last_heartbeat * 1000).toLocaleString() : "No check-in";
      return '<div class="card"><strong>' + esc(name) + '</strong> · ' +
        esc(worker.state.replaceAll("_", " ")) + ' · ' + esc(heartbeat) + '</div>';
    });
    panel.innerHTML = rows.join("") || '<p>Supervisor unavailable.</p>';
  } catch {
    panel.textContent = "Worker status unavailable.";
  }
}

async function refreshSection(page, version) {
  const ifCurrent = (selector, promise, paint) => promise.then(value => {
    if (version === viewVersion) paint(value);
  }).catch(error => {
    // Preserve already rendered data while a section is temporarily unavailable.
    if (version === viewVersion) $(selector).dataset.error = explain(error);
  });

  if (page === "campaigns") {
    await ifCurrent("#campaign-list", call("/api/campaigns"), value => {
      delete $("#campaign-list").dataset.error;
      data.campaigns = value.items;
      renderCampaigns();
    });
  } else if (page === "pipeline") {
    await Promise.all([
      ifCurrent("#pipeline-list", call("/api/pipeline"), value => {
        delete $("#pipeline-list").dataset.error;
        data.pipeline = value.items;
        renderPipeline();
      }),
      ifCurrent("#weekly-digest", call("/api/digest"), digest => {
        delete $("#weekly-digest").dataset.error;
        $("#weekly-digest").innerHTML = '<h3>This week · ' + esc(new Date(digest.week).toLocaleDateString())
          + '</h3><dl><div><dt>New inquiries</dt><dd>' + esc(digest.new_inbound)
          + '</dd></div><div><dt>Awaiting reply</dt><dd>' + esc(digest.awaiting_reply)
          + '</dd></div><div><dt>Over 24 hours</dt><dd>' + esc(digest.overdue_24h)
          + '</dd></div></dl>';
      }),
    ]);
  } else if (page === "connections") {
    await Promise.all([
      ifCurrent("#connection-evidence", call("/api/connections"), connections => {
        delete $("#connection-evidence").dataset.error;
        $("#connection-evidence").innerHTML = '<h3>Current Social host</h3><p>'
          + esc(connections.host.os) + ' · ' + esc(connections.host.id)
          + '</p><p>Cloud mirror · ' + esc(connections.cloud.status) + '<br>VPS · '
          + esc(connections.vps.resource_id || "Not configured") + ' · '
          + esc(connections.vps.status) + '</p>' + connections.sources.map(source => '<p>'
          + esc(source.account_id) + ' · ' + esc(source.status) + ' · checked '
          + esc(new Date(source.checked_at).toLocaleString()) + '</p>').join("");
        $("#telegram-state").textContent = connections.telegram.configured
          ? "Bot credentials saved. Send a test alert to verify delivery."
          : "Add your bot token and owner chat to enable alerts.";
      }),
      ifCurrent("#limits-form", call("/api/config"), config => {
        delete $("#limits-form").dataset.error;
        if (!$("#limits-form").contains(document.activeElement)) {
          $("#limits-form [name=us]").value = config.limits.per_contact_daily.US;
          $("#limits-form [name=ng]").value = config.limits.per_contact_daily.NG;
          $("#limits-form [name=account]").value = config.limits.per_account_daily;
        }
        if (!$("#timing-form").contains(document.activeElement)) {
          $("#timing-form [name=min]").value = config.timing.gap_min_seconds;
          $("#timing-form [name=max]").value = config.timing.gap_max_seconds;
        }
      }),
    ]);
  }
  document.querySelectorAll(".view:not([hidden]) details[open]").forEach(detail => {
    detail.dispatchEvent(new Event("social-refresh"));
  });
}

function bindDetail(panel, load) {
  const detail = $(panel).closest("details");
  const refreshOpen = () => { if (detail.open && !detail.closest(".view")?.hidden) void load(); };
  detail.addEventListener("toggle", refreshOpen);
  detail.addEventListener("social-refresh", refreshOpen);
}

bindDetail("#bot-status", refreshBots);
bindDetail("#schedule-status", refreshSchedule);
bindDetail("#analytics-status", refreshAnalytics);
bindDetail("#optouts", async () => {
  try {
    const {items} = await call("/api/optouts");
    $("#optouts").innerHTML = items.map(lead => '<div class="row">' + esc(lead.display_name)
      + ' · ' + esc(lead.opt_out_type) + '</div>').join("")
      || empty("No recorded opt-outs", "Stops are retained here when captured.");
  } catch (error) { $("#optouts").textContent = explain(error); }
});
bindDetail("#audit", async () => {
  try {
    const {items} = await call("/api/audit");
    $("#audit").innerHTML = items.map(item => '<div class="row"><strong>' + esc(item.action)
      + '</strong><p>' + esc(item.timestamp) + '</p></div>').join("")
      || empty("No activity yet", "Recorded actions appear here.");
  } catch (error) { $("#audit").textContent = explain(error); }
});

async function refresh(replace = false) {
  if (document.querySelector(".busy")) return;
  if (activeRefresh && replace !== true) return;
  activeRefresh?.abort();
  const request = new AbortController();
  activeRefresh = request;
  $("#refresh").disabled = true;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
    const [leads, drafts, status] = await Promise.all([
      "/api/leads", "/api/drafts", "/api/status?include_queues=false",
    ].map(path => call(path, {signal})));
    if (request.signal.aborted) return;
    fresh = true;
    data.leads = leads.items;
    data.drafts = drafts.items;
    const active = document.activeElement;
    const editId = active?.dataset.draft;
    const start = active?.selectionStart, end = active?.selectionEnd;
    renderLeads();
    renderReview();
    if (editId && !active.isConnected) {
      const field = [...document.querySelectorAll("[data-draft]")].find(element => element.dataset.draft === editId);
      field?.focus({preventScroll:true});
      field?.setSelectionRange(start, end);
    }
    $("#runtime-state").textContent = "Service " + status.state;
    $("#link-state").dataset.state = "online";
    $("#link-state").textContent = "Connected · Updated " + new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    $("#sessions").innerHTML=(status.sessions || []).map(s=>'<div class="row"><strong>'+esc(s.account_id)+'</strong><p>'+esc(s.status)+' · '+esc(s.kill_reason || "")+'</p>'+["start","pause","stop"].map(a=>'<button class="secondary" data-account="'+esc(s.account_id)+'" data-account-action="'+a+'">'+a+'</button>').join("")+(s.status==="killed"?'<button class="secondary" data-account="'+esc(s.account_id)+'" data-resume="resume">Resume after reconnect</button>':"")+'</div>').join("");
    const accounts = exportForm.elements.account_id;
    const accountValue = accounts.value;
    accounts.replaceChildren(...(status.sessions || []).map(session => new Option(session.account_id, session.account_id)));
    if ([...accounts.options].some(option => option.value === accountValue)) accounts.value = accountValue;
    $("#health").innerHTML = "<dt>Disk free</dt><dd>" + esc(formatBytes(status.health.disk_free_bytes)) + "</dd>";
    void refreshSection(currentPage, viewVersion);
  } catch (error) {
    if (request.signal.aborted) return;
    fresh = false;
    $("#link-state").dataset.state = "offline";
    $("#link-state").textContent = explain(error) + (data.leads.length ? " Last loaded conversations remain visible." : "");
    $("#runtime-state").textContent = "Service unavailable";
    if (!data.leads.length) {
      $("#today-list").setAttribute("aria-busy", "false");
      paintList("#today-list", empty("Connect your Social service", "Open Connections to authorize the service on your computer."));
      paintList("#lead-list", empty("Lead data unavailable", "Your service connection needs attention."));
      paintList("#draft-list", empty("Review data unavailable", "Reconnect to retrieve pending replies."));
    }
    document.querySelectorAll("[data-approve],[data-reject],[data-save]").forEach(button => button.disabled = true);
  } finally {
    if (activeRefresh === request) {
      activeRefresh = null;
      $("#refresh").disabled = false;
    }
  }
}
const exportForm = $("#tiktok-export");
exportForm.closest("details").addEventListener("toggle", async event => {
  if (!event.currentTarget.open) return;
  try {
    const {items} = await call("/api/campaigns");
    const select = exportForm.elements.campaign_id;
    const previous = select.value;
    select.replaceChildren(new Option("No campaign", ""), ...items.map(item => new Option(item.name, item.id)));
    if (items.some(item => item.id === previous)) select.value = previous;
  } catch (error) { setNote(explain(error)); }
});
exportForm.addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(exportForm));
  if (!values.file || values.file.size > 2_000_000) {
    setNote("Choose a CSV no larger than 2 MB.");
    return;
  }
  try {
    const {file, ...body} = values;
    body.csv_text = await file.text();
    body.campaign_id ||= null;
    const result = await act("/api/intake/import/tiktok-csv", body);
    if (result) $("#tiktok-export-result").textContent =
      result.accepted + " imported · " + result.duplicates + " duplicates · " + result.invalid + " invalid";
  } catch (error) { setNote(explain(error)); }
});

$("#refresh").onclick = () => refresh(true);
$("#import-inquiries").onclick=async()=>{
  try {
    const body=JSON.parse($("#import-json").value);
    const result=await act("/api/intake/import",body);
    if(result)$("#import-result").textContent=result.received+" rows processed · "+result.duplicates+" duplicates. "+result.rows.filter(r=>r.status==="invalid").map(r=>"Row "+r.row+": "+r.reason).join(" ");
  } catch(error) {$("#import-result").textContent="Check the JSON export before importing.";}
};
$("#leads-prev").onclick=()=>{leadPage=Math.max(0,leadPage-1);renderLeads();};
$("#leads-next").onclick=()=>{leadPage+=1;renderLeads();};
function changeReview(step) {
  document.querySelectorAll("[data-draft]").forEach(el=>edited.set(el.dataset.draft,el.value));
  reviewIndex=Math.min(Math.max(0,reviewIndex+step),Math.max(0,data.drafts.length-1));
  renderReview();
}
$("#review-prev").onclick=()=>changeReview(-1);
$("#review-next").onclick=()=>changeReview(1);
$("#search").oninput=()=>{leadPage=0;renderLeads();};
$("#lead-filter").onchange=()=>{campaignFilter="";renderLeads();};
document.addEventListener("input",event=>{if(event.target.dataset.draft) edited.set(event.target.dataset.draft,event.target.value);});
document.addEventListener("click",async event=>{
  const el=event.target.closest("button,a");
  if(!el) return;
  if(el.dataset.filter) {$("#lead-filter").value=el.dataset.filter;campaignFilter="";renderLeads();}
  if(el.dataset.campaign) {campaignFilter=el.dataset.campaign;$("#lead-filter").value="all";location.hash="leads";renderLeads();}
  if(el.dataset.stage) {
    const id=el.dataset.stage;
    await act("/api/pipeline",{contact_id:id,stage:$("#stage-value").value,notes:$("#stage-notes").value});
    return;
  }
  if(el.dataset.lead) {
    try {
      const result=await call("/api/leads/"+encodeURIComponent(el.dataset.lead));
      $("#lead-detail-body").innerHTML='<h2>'+esc(result.contact.display_name)+'</h2>'+'<div class="pipeline-editor"><label>Stage<select id="stage-value">'+["new","qualified","conversation","booked","won","lost","support"].map(stage=>'<option>'+stage+'</option>').join("")+'</select></label><label>Outcome or next step<textarea id="stage-notes" maxlength="4000"></textarea></label><button data-stage="'+esc(result.contact.id)+'">Save stage</button></div>'+result.messages.map(m=>'<div class="message"><small>'+esc(m.direction)+' · '+esc(m.sent_at)+'</small>'+esc(m.body)+'</div>').join("");
      let pipeline = data.pipeline;
      if (currentPage !== "pipeline") {
        try { pipeline = (await call("/api/pipeline")).items; }
        catch { setNote("Conversation loaded. Pipeline status is unavailable."); }
      }
      const current = pipeline.find(item => item.id === result.contact.id);
      if(current){$("#stage-value").value=current.stage;$("#stage-notes").value=current.notes;}
      if(!$("#lead-detail").open)$("#lead-detail").showModal();
    } catch(error) {setNote(explain(error));}
  }
  if(el.dataset.save) {
    const id=el.dataset.save;
    const result=await act("/api/drafts/revise",{draft_id:id,text:edited.get(id)});
    if(result?.status==="draft_pending")edited.delete(id);
  }
});
$("#telegram-form").onsubmit=async event=>{
  event.preventDefault();
  if(!fresh){setNote("Refresh your connection first.");return;}
  try {
    await call("/api/connections/telegram",{method:"PUT",body:JSON.stringify({...Object.fromEntries(new FormData(event.target)), enable_approvals: $("#telegram-approvals").checked})});
    event.target.reset();
    setNote("Bot connection saved.");
    refresh();
  } catch(error) {setNote(explain(error));}
};
$("#telegram-test").onclick=async()=>{
  const result=await act("/api/connections/telegram/test",{});
  if(result)setNote(result.sent?"Telegram confirmed test message "+result.message_id+".":result.reason);
};
$("#new-campaign").onclick=()=>{$("#campaign-form").hidden=false;$("#campaign-form input").focus();};
$("#cancel-campaign").onclick=()=>{$("#campaign-form").hidden=true;$("#new-campaign").focus();};
$("#campaign-form").onsubmit=async event=>{
  event.preventDefault();
  const button=event.target.querySelector('[type=submit]');
  button.disabled=true;
  const result=await act("/api/campaigns",Object.fromEntries(new FormData(event.target)));
  button.disabled=false;
  if(result?.id){event.target.reset();event.target.hidden=true;$("#new-campaign").focus();}
};
function formatBytes(n){return Number.isFinite(n)?(n/1024**3).toFixed(1)+" GB":"Unknown";}
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
    const id=event.target.dataset.approve;
    const original=data.drafts.find(d=>d.jeff_output.draft_id===id)?.draft_text;
    if(edited.has(id) && edited.get(id)!==original) {setNote("Save this revision before approving it.");return;}
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
setInterval(()=>{if(!document.hidden && !document.querySelector("input:focus,textarea:focus,select:focus"))refresh();},15000);
