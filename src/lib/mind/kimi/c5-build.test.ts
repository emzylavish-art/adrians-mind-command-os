import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { readBuildSourceReceipt } from "./source-receipt.ts";
import { loadModeInstructions } from "../mode-instructions.ts";
import { applyBuildSave, matchesBuildSave } from "./build-review.ts";

const source = readFileSync(new URL("../../../components/mind/code-ide.tsx", import.meta.url), "utf8");
const toolBody = source.slice(source.indexOf("  async function runTool("), source.indexOf('  return (\n    <div className="code-ide"'));
const resetBody = source.slice(source.indexOf("    toolAttempt.current?.abort();"), source.indexOf("    return () => { toolAttempt.current?.abort();", source.indexOf("    toolAttempt.current?.abort();")));
function mountedHandlers(fetcher: typeof fetch) {
  const body = ts.transpileModule(`
    let props = { selectedId: "A", selected: "A.ts", text: "alpha", busy: false };
    const toolAttempt = { current: null }, selection = { current: { id: "A", text: "alpha" } };
    let debugAllowed = true; const breakLine = 1;
    const state = { completions: [], notice: "", debug: "", busy: false };
    const setToolBusy = value => { state.busy = value; };
    const setToolNotice = value => { state.notice = value; };
    const setCompletions = value => { state.completions = value; };
    const setDebugText = value => { state.debug = value; };
    ${toolBody}
    return { complete: () => runTool("complete"), debug: () => runTool("debug"), state,
      select(id, text) { ${resetBody} props = { ...props, selectedId: id, selected: id + ".ts", text }; selection.current = { id, text }; },
      disableDebug() { debugAllowed = false; }
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("fetch", body)(fetcher);
}

test("C5 actual Complete handler rejects an old file response after a new selection", async () => {
  const pending: ((value: Response) => void)[] = [];
  const h = mountedHandlers((() => new Promise((resolve) => pending.push(resolve))) as typeof fetch);
  const first = h.complete();
  h.select("B", "beta");
  const second = h.complete();
  pending[1](Response.json({ ok: true, completions: ["beta"] })); await second;
  pending[0](Response.json({ ok: true, completions: ["alpha"] })); await first;
  assert.deepEqual(h.state.completions, ["beta"]);
});
test("C5 actual Debug handler clears pending on failure and refuses unavailable runtime", async () => {
  let calls = 0;
  const h = mountedHandlers((async () => { calls++; throw Error("fixture network"); }) as typeof fetch);
  await h.debug();
  assert.equal(h.state.busy, false);
  assert.match(h.state.notice, /No pause was confirmed/);
  h.disableDebug(); await h.debug();
  assert.equal(calls, 1);
});
test("C5 execution receipt records exact source identities and rejects malformed revisions", () => {
  const receipt = { workspace: "fixture-computer", cwd: "/fixture", policy: "saved", files: [{ path: "a.ts", sha256: "a".repeat(64) }] };
  assert.deepEqual(readBuildSourceReceipt(receipt), receipt);
  assert.equal(readBuildSourceReceipt({ ...receipt, files: [{ path: "../other", sha256: "a".repeat(64) }] }), null);
  assert.equal(readBuildSourceReceipt({ ...receipt, files: [{ path: "a.ts", sha256: "unknown" }] }), null);
});

test("C5 actual emergency-stop handler retries activation without releasing local protection", async () => {
  const app = readFileSync(new URL("../../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const stopHandlers = app.slice(app.indexOf("  function toggleStop()"), app.indexOf("  function explain(text:"));
  const body = ts.transpileModule(`
    const wsRef = { current: { halted: false, schedules: [{ enabled: true }] } };
    const turnOwner = { current: "owner-A" }; const stopSyncFlight = { current: null }; const clearedStop = { current: false };
    const turnAbort = { current: null }, agentAbort = { current: null };
    const readExecutionControl = async () => ({ state: "on", revision: "fixture" });
    const stopVoiceSession = () => {}; const pushAudit = (ws) => ws; const haltFleet = (ws) => ws;
    const state = { sync: null, notice: "", error: null }; let stopConfirmed = false;
    const setWs = (fn) => { wsRef.current = fn(wsRef.current); }; const setError = (value) => { state.error = value; };
    const setNotice = (value) => { state.notice = value; }; const setSpeakCall = () => {};
    const setStopSync = (value) => { state.sync = value; stopConfirmed = value.state === "confirmed"; };
    ${stopHandlers}
    return { toggleStop, pressEmergencyStop, clearEmergencyStop, wsRef, state, turnOwner };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const calls: boolean[] = [];
  const h = new Function("setExecutionHalt", body)(async ({ data }: { data: { on: boolean } }) => {
    calls.push(data.on);
    return calls.length === 1 ? { ok: false, error: "fixture offline" } : { ok: true, cancellation: { cancelled: 1, pending: 1, unknown: 0 } };
  });
  await h.pressEmergencyStop();
  assert.equal(h.wsRef.current.halted, true);
  assert.equal(h.wsRef.current.schedules[0].enabled, false);
  assert.equal(h.state.sync.state, "unconfirmed");
  await h.toggleStop();
  assert.deepEqual(calls, [true, true]);
  assert.equal(h.wsRef.current.halted, true);
  assert.equal(h.state.sync.state, "confirmed");
  assert.match(h.state.notice, /awaiting runtime confirmation/);
  await h.clearEmergencyStop();
  assert.deepEqual(calls, [true, true, false]);
  assert.equal(h.wsRef.current.schedules[0].enabled, false);
});

test("C5 a new emergency stop survives an older pending release and reasserts the server stop", async () => {
  const app = readFileSync(new URL("../../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const stopHandlers = app.slice(app.indexOf("  function toggleStop()"), app.indexOf("  function explain(text:"));
  const body = ts.transpileModule(`
    const wsRef = { current: { halted: false, schedules: [{ enabled: true }] } };
    const turnOwner = { current: "owner-A" }; const stopSyncFlight = { current: null }; const clearedStop = { current: false };
    const turnAbort = { current: null }, agentAbort = { current: null };
    const readExecutionControl = async () => ({ state: "on", revision: "fixture" });
    const stopVoiceSession = () => {}; const pushAudit = (ws) => ws; const haltFleet = (ws) => ws;
    const state = { sync: null, notice: "", error: null, published: [] }; let stopConfirmed = false;
    const setWs = (fn) => { wsRef.current = fn(wsRef.current); state.published.push(wsRef.current.halted); };
    const setError = (value) => { state.error = value; }; const setNotice = (value) => { state.notice = value; }; const setSpeakCall = () => {};
    const setStopSync = (value) => { state.sync = value; stopConfirmed = value.state === "confirmed"; };
    ${stopHandlers}
    return { pressEmergencyStop, clearEmergencyStop, wsRef, state };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  for (const acknowledgeNewStop of [true, false]) {
    const calls: boolean[] = [];
    let release!: (value: { ok: boolean }) => void;
    const h = new Function("setExecutionHalt", body)(async ({ data }: { data: { on: boolean } }) => {
      calls.push(data.on);
      if (!data.on) return new Promise(resolve => { release = resolve; });
      if (calls.length === 3 && !acknowledgeNewStop) throw Error("fixture stop response lost");
      return { ok: true };
    });
    await h.pressEmergencyStop();
    const releasing = h.clearEmergencyStop();
    await Promise.resolve();
    await h.pressEmergencyStop();
    assert.equal(h.wsRef.current.halted, true);
    assert.deepEqual(calls, [true, false], "New activation waits for the older release to settle");
    release({ ok: true }); await releasing;
    assert.deepEqual(calls, [true, false, true]);
    assert.equal(h.wsRef.current.halted, true);
    assert.equal(h.state.published.includes(false), false, "Older release must never publish an unhalted workspace");
    assert.equal(h.state.sync.state, acknowledgeNewStop ? "confirmed" : "unconfirmed");
    assert.equal(h.wsRef.current.schedules[0].enabled, false);
  }
});

test("C5 actual Build handler distinguishes saved execution, verified save and failed save", async () => {
  const app = readFileSync(new URL("../../../components/mind/build-workspace.tsx", import.meta.url), "utf8");
  const runBuild = app.slice(app.indexOf('  function withTaskFile('), app.indexOf('  async function planWithGrok('));
  const rememberSave = app.slice(app.indexOf('  function rememberVerifiedSave('), app.indexOf('  async function checkFileState('));
  const body = ts.transpileModule(`
    const props = { ownerId: "owner-A", freeOnly: false, composer: { staged: { name: "brief.txt", text: "review brief contents" }, images: [] } }; const haltedRef = { current: false }; const planOwner = { current: "owner-A" };
    const prompt = "Inspect fixture file"; const cwd = "/fixture"; const mode = "plan"; const sessionId = "";
    const branch = ""; const sourceChatId = undefined; const workMedia = undefined; const projectId = null;
    const ownerKey = props.ownerId; const pendingSource = { current: undefined }; const pendingSourceKey = "pending"; const lastJobKey = "last";
    const mounted = {current:true}; const selectedFile = "f"; const preferenceStorage = { getItem: () => null }; const collectAccountSkillApplications = () => [];
    const companion = { onlineAgentIds: ["fixture-pc"] }; const active = false;
    const submittingBuild = { current: false }, pollSequence = { current: 0 };
    const buffersRef = { current: { f: { workspace: "fixture-pc", cwd: "/fixture", path: "a.ts", saved: "revision A", draft: "revision B" } } };
    const state = { notice: "", receipt: null }; const setExecutionChoice = () => {}; const setLoading = () => {}; const setEvents = () => {};
    const setNotice = (value) => { state.notice = value; }; const setExecutionReceipt = (value) => { state.receipt = value; };
    const setBuffers = (fn) => { buffersRef.current = fn(buffersRef.current); }; const setJob = () => {}; const setPanel = () => {}; const setBand = () => {}; const setBuildReceipt = () => {}; const setResultSource = () => {};
    const localStorage = { setItem: () => {}, removeItem: () => {} }; const sessionStorage = { getItem: () => null };
    const refreshJob = async () => {}; const setSessionId = () => {}; const setLastDiff = () => {};
    ${rememberSave}
    ${runBuild}
    return { runBuild, state, buffersRef };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  for (const policy of ["saved", "save", "failure"] as const) {
    let writes = 0, dispatches = 0;
    const h = new Function("fetch", "runFileOperation", "matchesBuildSave", "applyBuildSave", "loadModeInstructions", body)(async (_url: string, init: RequestInit) => { dispatches++; const request = JSON.parse(String(init.body)); assert.match(request.prompt, /Attached file brief\.txt:\nreview brief contents/); return Response.json({ ok: true, jobId: request.jobKey }); }, async (_operation: string, _path: string, text: string, extra: { expectedContent: string }) => { writes++; assert.equal(extra.expectedContent, "revision A"); return policy === "failure" ? null : { workspace: "fixture-pc", cwd: "/fixture", path: "a.ts", before: "revision A", after: text }; }, matchesBuildSave, applyBuildSave, loadModeInstructions);
    await h.runBuild(policy === "saved" ? "saved" : "save");
    assert.equal(writes, policy === "saved" ? 0 : 1);
    assert.equal(dispatches, policy === "failure" ? 0 : 1);
    assert.equal(h.buffersRef.current.f.draft, "revision B");
    if (policy === "failure") assert.match(h.state.notice, /No Build task started/);
    else {
      const expected = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(policy === "save" ? "revision B" : "revision A"));
      const hex = Array.from(new Uint8Array(expected), (byte) => byte.toString(16).padStart(2, "0")).join("");
      assert.equal(h.state.receipt.files[0].sha256, hex);
    }
  }
});
