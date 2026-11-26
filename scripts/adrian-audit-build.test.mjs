import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleIdeTools } from "../src/lib/mind/kimi/ide.server.ts";
import { canDebugFile } from "../src/lib/mind/kimi/ide-capabilities.ts";
import { createBuildPlanningGate } from "../src/lib/mind/kimi/build-lifecycle.ts";
import { boundAbortSignal } from "../src/lib/mind/turn-timeouts.ts";
import { setPcPairingDirectory, enqueueJob, acceptJob, completeJob, requestJobCancel, cancelOwnerBuildJobs, readJob } from "../src/lib/mind/pc-pairing/store.ts";
import { setHaltDirectory } from "../src/lib/mind/halt-file.ts";
import { setDurableHalt, readHaltState } from "../src/lib/mind/halt.server.ts";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeEditorTheme, observeCodeEditorTheme } from "../src/lib/mind/kimi/editor-theme.ts";

const ideRequest = (body) => new Request("https://mind.test/api/mind/build/ide", { method: "POST", headers: { "content-type": "application/json", origin: "https://mind.test" }, body: JSON.stringify(body) });

test("AA010: actual editor renders no empty result strip, and disabled Debug has an availability explanation", async () => {
  const sourceUrl = new URL("../src/components/mind/code-ide.tsx", import.meta.url);
  const require = createRequire(sourceUrl);
  const compiled = ts.transpileModule(readFileSync(sourceUrl, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleCode = compiled.replace(/^import ["'][^"']+\.css["'];?$/gm, "").replace(/from\s+(["'])([^"']+)\1/g, (_, quote, specifier) => {
    let path;
    if (specifier.startsWith("@/")) {
      path = fileURLToPath(new URL(`../src/${specifier.slice(2)}`, import.meta.url));
      if (!existsSync(path)) path += ".ts";
    } else path = require.resolve(specifier);
    return `from ${quote}${pathToFileURL(path).href}${quote}`;
  });
  const { CodeIde } = await import(`data:text/javascript;base64,${Buffer.from(moduleCode).toString("base64")}`);
  const noop = () => {};
  const markup = renderToStaticMarkup(createElement(CodeIde, {
    ownerId: "owner-a", files: [], matches: [], tabs: [], dirty: [], selectedId: "", selected: "", text: "", busy: false, notice: null, newName: "",
    onSelectTab: noop, onOpenMatch: noop, onNewName: noop, onCreate: noop, onOpen: noop, onCloseTab: noop, onChange: noop, onSave: noop, onCheck: noop,
  }));
  assert.doesNotMatch(markup, /class="code-ide-results"/);
  assert.match(markup, /disabled=""[^>]*title="Checking debugger availability/);
  assert.match(markup, /role="status">Checking debugger availability/);
});

test("AA010: live shell appearance reconfigures CodeMirror without losing dirty text or cursor selection", () => {
  const appearance = new Compartment();
  const dirtyText = "const unsavedValue = 17;\nconsole.log(unsavedValue);";
  let state = EditorState.create({
    doc: dirtyText,
    selection: { anchor: 6, head: 18 },
    extensions: [appearance.of(codeEditorTheme(false))],
  });
  const root = { dataset: { theme: "dark" } };
  let changed;
  let disconnected = false;
  let changes = 0;
  class ThemeObserver {
    constructor(callback) { changed = callback; }
    observe(target, options) {
      assert.equal(target, root);
      assert.deepEqual(options, { attributes: true, attributeFilter: ["data-theme"] });
    }
    disconnect() { disconnected = true; }
  }
  const stop = observeCodeEditorTheme(root, (light) => {
    changes++;
    state = state.update({ effects: appearance.reconfigure(codeEditorTheme(light)) }).state;
  }, ThemeObserver);
  assert.equal(state.facet(EditorView.darkTheme), true);
  root.dataset.theme = "light";
  changed();
  assert.equal(state.facet(EditorView.darkTheme), false);
  assert.equal(state.doc.toString(), dirtyText);
  assert.deepEqual({ anchor: state.selection.main.anchor, head: state.selection.main.head }, { anchor: 6, head: 18 });
  changed();
  assert.equal(changes, 2, "an unchanged attribute does not reconfigure the editor again");
  root.dataset.theme = "dark";
  changed();
  assert.equal(state.facet(EditorView.darkTheme), true);
  assert.equal(state.doc.toString(), dirtyText);
  stop();
  assert.equal(disconnected, true, "unmount releases the document observer");
});

test("AA009: website Debug advertises actual unavailable capability and never dispatches a debugger", async () => {
  let executions = 0;
  const deps = { requireUser: async () => "owner-a", debug: async () => { executions++; return { ok: true, pausedLine: 2, locals: [] }; } };
  const capability = await (await handleIdeTools(ideRequest({ action: "capabilities" }), deps)).json();
  assert.equal(capability.debug, false);
  assert.match(capability.reason, /pairing a PC does not enable/);
  const response = await handleIdeTools(ideRequest({ action: "debug", path: "a.js", line: 2 }), deps);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "debug_unavailable");
  assert.equal(executions, 0);
  const completion = await handleIdeTools(ideRequest({ action: "complete", path: "a.js", text: "const currentValue=1;\ncurrent", line: 2, column: 7 }), deps);
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).ok, true);
});

test("AA009: local Debug keeps dirty, busy, workspace and halt guards", async () => {
  assert.equal(canDebugFile({ capability: true, selected: true, hosted: true, dirty: false, busy: false }), true);
  for (const condition of [{ capability: false }, { selected: false }, { hosted: false }, { dirty: true }, { busy: true }]) {
    assert.equal(canDebugFile({ capability: true, selected: true, hosted: true, dirty: false, busy: false, ...condition }), false);
  }
  let executions = 0;
  const response = await handleIdeTools(ideRequest({ action: "debug", path: "a.js" }), { requireUser: async () => "dev-user", halted: async () => true, debug: async () => { executions++; return { ok: true, pausedLine: 1, locals: [] }; } });
  assert.equal(response.status, 403);
  assert.equal(executions, 0);
});

test("AA024: emergency stop aborts deferred planning and makes late chunks/results obsolete", async () => {
  const gate = createBuildPlanningGate();
  const attempt = gate.begin("owner-a", false);
  const bounded = boundAbortSignal(attempt.controller.signal, 30_000);
  let finishProvider;
  const provider = new Promise((resolve) => { finishProvider = resolve; });
  const accepted = [];
  const pending = provider.then((result) => { if (gate.isCurrent(attempt, "owner-a", false)) accepted.push(result); });
  gate.stop();
  assert.equal(bounded.signal.aborted, true);
  finishProvider("late plan");
  await pending;
  assert.deepEqual(accepted, []);
  assert.equal(gate.finish(attempt), false);
  const next = gate.begin("owner-b", false);
  assert.equal(gate.isCurrent(next, "owner-a", false), false);
  assert.equal(gate.isCurrent(next, "owner-b", false), true);
  assert.equal(gate.begin("owner-b", false), null);
  gate.stop();
  assert.equal(gate.begin("owner-b", true), null);
  bounded.cleanup();
});

test("AA023: account halt cancels queued Build jobs and requests running cancellation without a mounted screen", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "adrian-build-halt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  setPcPairingDirectory(join(dir, "jobs"));
  setHaltDirectory(join(dir, "halt"));
  const envKeys = ["DATABASE_URL", "POSTGRES_URL", "VERCEL", "GROK_PROJECT_ID"];
  const old = new Map(envKeys.map((key) => [key, process.env[key]]));
  envKeys.forEach((key) => delete process.env[key]);
  t.after(() => {
    for (const [key, value] of old) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const make = (ownerId, kind = "kimi-acp") => enqueueJob({ ownerId, agentId: "fixture-agent", kind, command: "fixture only", confirm: false });
  const queued = make("a");
  const running = make("a");
  acceptJob("fixture-agent", running.id);
  const finished = make("a");
  acceptJob("fixture-agent", finished.id);
  completeJob({ jobId: finished.id, agentId: "fixture-agent", ok: true, output: "already completed" });
  const other = make("b");
  const shell = make("a", "shell");
  const result = await setDurableHalt("a", true);
  assert.deepEqual(result, { ok: true, halted: true, cancellation: { cancelled: 2, pending: 1, unknown: 0 }, buildCancellation: { queuedCancelled: 1, cancellationRequested: 1, unconfirmed: 0 } });
  assert.equal(readJob(queued.id).status, "cancelled");
  assert.equal(readJob(running.id).status, "cancel_requested");
  assert.equal(readJob(finished.id).status, "done");
  assert.equal(readJob(other.id).status, "queued");
  assert.equal(readJob(shell.id).status, "cancelled");
  await setDurableHalt("a", false);
  assert.equal(readJob(queued.id).status, "cancelled", "clearing stop never restarts canceled work");
  const concurrentOn = setDurableHalt("a", true);
  const concurrentOff = setDurableHalt("a", false);
  await Promise.all([concurrentOn, concurrentOff]);
  assert.equal(await readHaltState("a"), "off");
});

test("AA023: completion before stop and explicit runtime cancellation remain different outcomes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "adrian-build-outcome-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  setPcPairingDirectory(dir);
  const make = () => {
    const job = enqueueJob({ ownerId: "a", agentId: "fixture-agent", kind: "kimi-acp", command: "fixture only", confirm: false });
    acceptJob("fixture-agent", job.id);
    requestJobCancel("a", job.id);
    return job;
  };
  const completed = make();
  assert.equal(completeJob({ jobId: completed.id, agentId: "fixture-agent", ok: true, output: "finished" }).status, "done");
  const canceled = make();
  assert.equal(completeJob({ jobId: canceled.id, agentId: "fixture-agent", ok: false, cancelled: true }).status, "cancelled");
  const uncertain = make();
  assert.equal(completeJob({ jobId: uncertain.id, agentId: "fixture-agent", ok: false }).status, "error");
  assert.deepEqual(cancelOwnerBuildJobs("b"), { queuedCancelled: 0, cancellationRequested: 0, unconfirmed: 0 });
});
