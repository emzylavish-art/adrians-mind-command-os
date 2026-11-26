import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { editorRequestKey, canApplyEditorResult } from "./editor-request.ts";
import { readBuildSourceReceipt } from "./source-receipt.ts";

const source = readFileSync(new URL("../../../components/mind/code-ide.tsx", import.meta.url), "utf8");
const complete = source.slice(source.indexOf("  async function complete()"), source.indexOf("  async function debug()"));
const debug = source.slice(source.indexOf("  async function debug()"), source.indexOf("  return (\n    <div className=\"code-ide\""));
function mountedHandlers(fetcher: typeof fetch) {
  const body = ts.transpileModule(`
    let props = { selectedId: "A", selected: "a.ts", text: "alpha", debugAvailable: true };
    let key = editorRequestKey(props.selectedId, props.text);
    const generation = { current: 0 }; const current = { current: { key, generation: 0 } };
    let dirty = false, toolBusy = false, breakLine = 1;
    const state = { completions: [], notice: "", debug: "", busy: false };
    const setToolBusy = (value) => { state.busy = value; toolBusy = value; };
    const setToolNotice = (value) => { state.notice = value; };
    const setCompletions = (value) => { state.completions = value; };
    const setDebugText = (value) => { state.debug = value; };
    ${complete}\n${debug}
    return { complete, debug, state, select: (id, text) => { props = { ...props, selectedId: id, selected: id + ".ts", text }; key = editorRequestKey(id, text); current.current = { key, generation: ++generation.current }; }, disableDebug: () => { props.debugAvailable = false; } };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("fetch", "editorRequestKey", "canApplyEditorResult", body)(fetcher, editorRequestKey, canApplyEditorResult);
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

test("C5 actual Build handler distinguishes saved execution, verified save and failed save", async () => {
  const app = readFileSync(new URL("../../../components/mind/build-workspace.tsx", import.meta.url), "utf8");
  const runBuild = app.slice(app.indexOf('  async function runBuild(policy:'), app.indexOf('  async function planWithGrok()'));
  const body = ts.transpileModule(`
    const props = { ownerId: "owner-A", freeOnly: false }; const haltedRef = { current: false }; const planOwner = { current: "owner-A" };
    const prompt = "Inspect fixture file"; const cwd = "/fixture"; const mode = "plan"; const sessionId = "";
    const companion = { onlineAgentIds: ["fixture-pc"] }; const active = false;
    const submittingBuild = { current: false }, pollSequence = { current: 0 };
    const buffersRef = { current: { f: { workspace: "fixture-pc", cwd: "/fixture", path: "a.ts", saved: "revision A", draft: "revision B" } } };
    const state = { notice: "", receipt: null }; const setExecutionChoice = () => {}; const setLoading = () => {}; const setEvents = () => {};
    const setNotice = (value) => { state.notice = value; }; const setExecutionReceipt = (value) => { state.receipt = value; };
    const setBuffers = (fn) => { buffersRef.current = fn(buffersRef.current); }; const setJob = () => {}; const setPanel = () => {};
    const localStorage = { setItem: () => {} }; const sessionStorage = { getItem: () => null };
    const refreshJob = async () => {}; const setSessionId = () => {}; const setLastDiff = () => {};
    ${runBuild}
    return { runBuild, state, buffersRef };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  for (const policy of ["saved", "save", "failure"] as const) {
    let writes = 0, dispatches = 0;
    const h = new Function("fetch", "runFileOperation", body)(async () => { dispatches++; return Response.json({ ok: true, jobId: "fixture-job" }); }, async (_operation: string, _path: string, text: string, extra: { expectedContent: string }) => { writes++; assert.equal(extra.expectedContent, "revision A"); return policy === "failure" ? null : { path: "a.ts", before: "revision A", after: text }; });
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
