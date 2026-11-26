import { memorySendRevision, checkMemorySendRevision } from "../src/lib/mind/memory-send-policy.ts";
import { memoryPolicyRevision, validateMemoryDispatch } from "../src/lib/mind/memory/dispatch-policy.ts";
import { effectiveContextPolicy } from "../src/lib/mind/memory/context-policy.ts";
import { retrieveProjectPassages } from "../src/lib/mind/knowledge.ts";
import { projectInstructionsForChat } from "../src/lib/mind/project-workspace.ts";
import { collectAccountSkillApplications } from "../src/lib/mind/skill-activation.ts";
import { loadModelControls } from "../src/lib/mind/model-tiers.ts";
import { researchReferencesInText } from "../src/lib/mind/research-reports.ts";
import { failureKindForAction } from "../src/lib/mind/recovery-inbox.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { memoriesForChat, emptyWorkspace, workspaceForChat, pushAudit, pushUsage, sha256 } from "../src/lib/mind/workspace.ts";
import { currentMemoryContext } from "../src/lib/mind/context-permission.ts";
import { completedHistory, checkpointReply } from "../src/lib/mind/partial-reply.ts";
import { chatTurnBody, isLogicRouteId, respondedRouteLabel } from "../src/lib/mind/logic-routes.ts";
import { relevantMemories } from "../src/lib/mind/memory/relevant.ts";
import { eveAccessNotes } from "../src/lib/mind/eve-access.ts";
import { routeForBotChat } from "../src/lib/mind/bot-model.ts";
import { chosenProvider, failover } from "../src/lib/mind/providers.ts";
import { historyForDeliver, resolveChatMessages, shouldBlockForEmergencyStop, snapshotImages } from "../src/lib/mind/retry-fidelity.ts";
import { prepareRetry, withReplyVersion } from "../src/lib/mind/transcript.ts";
import { contextReceiptNotice } from "../src/lib/mind/context-budget.ts";
import { consumeMindTurn, checkTurnReceipt, prepareTurnId, shouldStoreReply, STOPPED_REPLY } from "../src/lib/mind/live-turn.ts";
import { boundAbortSignal } from "../src/lib/mind/turn-timeouts.ts";
import { applyExecutionUsage } from "../src/lib/mind/execution-usage.ts";
import { classifyHonestFailure, honestFailureAuditAction, normalizeClientFailureMessage, imageRetryPlan } from "../src/lib/mind/failure-states.ts";

const source = ts.createSourceFile("command-app.tsx", readFileSync(new URL("../src/components/mind/command-app.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compiled = new Map();
function callback(name, context) {
  if (!compiled.has(name)) {
    let selected;
    const visit = (node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) selected = node; else if (!selected) ts.forEachChild(node, visit); };
    visit(source); assert.ok(selected, `${name} exists in the actual mounted component`);
    compiled.set(name, ts.transpileModule(`const selected = ${selected.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  }
  return new Function(...Object.keys(context), compiled.get(name) + "\nreturn selected;")(...Object.values(context));
}
const defer = () => { let resolve; let reject; return { promise: new Promise((yes, no) => { resolve = yes; reject = no; }), resolve: (value) => resolve(value), reject: (error) => reject(error) }; };
const event = (name, payload) => `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
function done(text = "fixture Gemini answer") {
  return event("done", { text, model: "fixture-gemini-model", provider: "gemini", requestId: "fixture-provider-request", usage: { prompt_tokens: 12, completion_tokens: 7 }, usedIds: [] });
}
const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });
function fixture(overrides = {}) {
  const ws = emptyWorkspace();
  const at = "2026-01-01T00:00:00.000Z";
  const chat = { id: "chat-a", title: "Fixture", messages: [], retrievalLog: [], memory: "on", temporary: false, projectId: "project-a", createdAt: at, autonomy: "ask" };
  ws.chats = [chat];
  ws.projects = [{ id: "project-a", name: "Project A", description: "", createdAt: at }, { id: "project-b", name: "Project B", description: "", createdAt: at }];
  ws.memories = [
    { id: "global-secret", text: "secret global preference", scope: "global", archived: false, alwaysApply: true, versions: [], createdAt: at, updatedAt: at },
    { id: "project-secret", text: "secret project A", scope: "project", projectId: "project-a", archived: false, alwaysApply: true, versions: [], createdAt: at, updatedAt: at },
    { id: "other-secret", text: "secret unrelated project B", scope: "project", projectId: "project-b", archived: false, alwaysApply: true, versions: [], createdAt: at, updatedAt: at },
  ];
  ws.files = [{ id: "file-a", name: "project-a-notes", text: "private project A text", projectId: "project-a", bytes: 22, createdAt: at }];
  const original = structuredClone(ws);
  const operationId = `${Date.now()}-${crypto.randomUUID()}`;
  const calls = { network: [], errors: [], reports: [], notices: [], announcements: [], workspaceUpdates: 0 };
  const state = { busy: false, liveText: "", turnChat: null, failure: null, speak: {} };
  const listeners = new Map();
  const context = {
    accountPending: false, account: { id: "owner-a" }, draftOwner: "owner-a", turnOwner: { current: "owner-a" },
    turnInFlight: { current: false }, turnAbort: { current: null }, turnGen: { current: 0 }, deliverStoredUser: { current: false },
    wsRef: { current: ws }, providerChoice: "gemini", modelTier: "Fast", grokConfigured: false, grokModel: null,
    liveProviders: { gemini: true }, providerModels: { gemini: "selected-gemini-model" }, discovered: [], logicRoute: null, logicRoutes: [],
    composerEffort: "normal", consultModel: "grok", consultModules: [], failoverPolicy: "none", routingMode: "single", ADRIAN_MIND_IDENTITY: "fixture identity",
    memorySendRevision, checkMemorySendRevision, memoryPolicyRevision, validateMemoryDispatch, effectiveContextPolicy, retrieveProjectPassages,
    projectInstructionsForChat, collectAccountSkillApplications, preferenceStorage: { getItem: () => null }, enabledSkills: {}, loadModelControls,
    currentFreeOnly: { current: false }, researchHistory: [], researchReferencesInText, memoriesForChat, withReplyVersion, failureKindForAction,
    ensureChatMedia: async (chat) => chat,
    snapshotImages, shouldBlockForEmergencyStop, routeForBotChat, isLogicRouteId, chosenProvider, failover,
    resolveSendPath: () => ({ path: "direct" }), completedHistory, resolveChatMessages, historyForDeliver,
    currentMemoryContext, workspaceForChat, relevantMemories, eveAccessNotes, chatTurnBody, contextReceiptNotice,
    historyTextForImages: (text) => text, // This fixture has no image inputs.
    checkpointReply, shouldStoreReply, STOPPED_REPLY, applyExecutionUsage, pushUsage, pushAudit, respondedRouteLabel,
    classifyHonestFailure, honestFailureAuditAction, normalizeClientFailureMessage, sha256, boundAbortSignal,
    setTurnChat: (value) => { state.turnChat = value; }, setBusy: (value) => { state.busy = value; }, setLiveText: (value) => { state.liveText = value; },
    setError: (value) => calls.errors.push(value), setFailure: (value) => { state.failure = typeof value === "function" ? value(state.failure) : value; },
    setToolTimeline: () => {}, setGenerationStatus: (value) => calls.announcements.push(value), setNotice: (value) => calls.notices.push(value),
    setLastResolvedTier: () => {}, setLastModelUsed: () => {},
    speakStageOpenRef: { current: true }, setSpeakCall: (value) => { state.speak = typeof value === "function" ? value(state.speak) : value; },
    reportEmergencyStop: () => calls.reports.push({ message: "halted" }),
    reportFailure: (message, kind, target, retry) => { const report = { message, kind, target, retry }; calls.reports.push(report); state.failure = report; },
    getBearerToken: () => null, previewPathPrefix: () => "",
    window: { location: { hostname: "mind.test", pathname: "/" } },
    document: { hidden: false, addEventListener: (type, work) => listeners.set(type, work), removeEventListener: (type) => listeners.delete(type) },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    ...overrides,
  };
  context.setWs = (update) => { calls.workspaceUpdates++; context.wsRef.current = typeof update === "function" ? update(context.wsRef.current) : update; };
  const network = async (url, options) => {
    calls.network.push({ url: String(url), method: options?.method, body: options?.body ? JSON.parse(options.body) : null });
    if (options?.method === "GET") {
      if (String(url).includes("operationId=")) return Response.json({ state: "processing_or_unknown", ownerId: "owner-a", executions: [] });
      return Response.json({ operationId });
    }
    return sse(event("delta", { text: "fixture Gemini answer" }) + done());
  };
  context.network = overrides.network ?? network;
  context.prepareTurnId = overrides.prepareTurnId ?? ((url, headers, signal) => prepareTurnId(url, headers, signal, context.network));
  context.prepareTurn = async (url, headers, signal) => ({ operationId: await context.prepareTurnId(url, headers, signal), timeoutMs: 10000 });
  context.consumeMindTurn = overrides.consumeMindTurn ?? ((input) => consumeMindTurn({ ...input, fetchImpl: context.network }));
  context.checkTurnReceipt = (url, id, headers, signal) => checkTurnReceipt(url, id, headers, signal, context.network);
  context.selectRetryMessages = callback("selectRetryMessages", {});
  context.reconcileSend = callback("reconcileSend", context);
  const deliver = callback("deliver", context);
  const start = (options) => deliver(original.chats[0], "secret question", original, false, [], options);
  const retryLast = async () => {
    let pending;
    callback("retryLast", { ...context, busy: state.busy, active: context.wsRef.current.chats[0], prepareRetry, imageRetryPlan,
      toImageAttachments: (images) => images ?? [], deliver: (...args) => { pending = deliver(...args); return pending; }, setError: context.setError,
    })();
    await pending;
  };
  return { context, calls, state, start, deliver, retryLast, original, operationId, listeners };
}

test("AA020/021: actual deliver captures newly revoked memory after preparation, not its stale chat argument", async () => {
  const prepared = defer();
  const entered = defer();
  const host = fixture({ prepareTurnId: async () => { entered.resolve(); return prepared.promise; } });
  const run = host.start({ accessNotes: [{ id: "stale-access", text: "must not survive" }] });
  await entered.promise;
  host.context.wsRef.current = { ...host.context.wsRef.current, chats: host.context.wsRef.current.chats.map((chat) => ({ ...chat, memory: "off" })) };
  prepared.resolve(host.operationId);
  assert.equal(await run, "fixture Gemini answer");
  const dispatched = host.calls.network.find((call) => call.method === "POST");
  assert.equal(dispatched.body.memory, "off");
  assert.deepEqual(dispatched.body.memoryContext, []);
  assert.equal(JSON.stringify(dispatched.body).includes("secret global preference"), false);
  assert.equal(host.state.busy, false);
});

test("AA020/021: memory revocation, project switch or note change during hashing prevents provider dispatch", async () => {
  for (const change of ["memory", "project", "note"]) {
    const hashed = defer(); const entered = defer();
    const host = fixture({ sha256: async () => { entered.resolve(); return hashed.promise; } });
    const run = host.start({ accessNotes: [{ id: "placeholder", text: "placeholder" }] });
    await entered.promise;
    const ws = host.context.wsRef.current;
    if (change === "memory") ws.chats[0].memory = "off";
    if (change === "project") ws.chats[0].projectId = "project-b";
    if (change === "note") ws.memories[0].text = "replacement preference";
    hashed.resolve("fixture-hash");
    assert.equal(await run, null);
    assert.equal(host.calls.network.filter((call) => call.method === "POST").length, 0);
    assert.equal(ws.usage.length, 0);
    assert.equal(host.context.wsRef.current.chats[0].messages[0].delivery, "failed");
    assert.match(host.calls.errors.at(-1), /Memory or project access changed/);
    assert.equal(host.state.busy, false); assert.equal(host.context.turnInFlight.current, false);
  }
});

test("AA020/061: owner change or emergency halt during fingerprint calculation cannot dispatch the prepared body", async () => {
  for (const change of ["owner", "halt", "removed-chat"]) {
    const hashed = defer(); const entered = defer();
    const host = fixture({ sha256: async () => { entered.resolve(); return hashed.promise; } });
    const run = host.start();
    await entered.promise;
    if (change === "owner") host.context.turnOwner.current = "owner-b";
    if (change === "halt") host.context.wsRef.current.halted = true;
    if (change === "removed-chat") host.context.wsRef.current.chats = [];
    hashed.resolve("fixture-hash");
    assert.equal(await run, null);
    assert.equal(host.calls.network.filter((call) => call.method === "POST").length, 0);
    assert.equal(host.context.wsRef.current.usage.length, 0);
    assert.equal(host.context.turnInFlight.current, false);
    assert.equal(host.listeners.size, 0);
  }
});

test("AA039/040: an interrupted long stream preserves every received character and retry performs only receipt GET", async () => {
  const all = "first ".repeat(5000) + "second ".repeat(4000);
  const host = fixture();
  const defaultNetwork = host.context.network;
  host.context.network = async (url, options) => {
    if (options.method === "POST") {
      host.calls.network.push({ url: String(url), method: "POST", body: JSON.parse(options.body) });
      return sse(event("delta", { text: all.slice(0, 30000) }) + event("delta", { text: all.slice(30000) }));
    }
    return defaultNetwork(url, options);
  };
  assert.equal(await host.start(), null);
  const chat = host.context.wsRef.current.chats[0];
  const partial = chat.messages.find((message) => message.replyStatus === "interrupted");
  assert.equal(partial.content, all);
  assert.equal(chat.messages.filter((message) => message.replyStatus === "complete").length, 0);
  assert.equal(chat.messages[0].delivery, "unconfirmed");
  assert.equal(host.context.wsRef.current.usage[0].kind, "unknown");
  host.calls.network.length = 0;
  host.context.wsRef.current.chats[0].memory = "off";
  await host.retryLast();
  assert.deepEqual(host.calls.network.map((call) => call.method), ["GET"]);
  assert.equal(host.calls.network[0].body, null, "recovery carries no former memory or conversation body");
  assert.ok(host.calls.network[0].url.includes(encodeURIComponent(host.operationId)));
  assert.equal(partial.content, all);
});

test("AA039/040: a stopped partial remains incomplete and account-expired recovery never posts again", async () => {
  const host = fixture();
  const defaultNetwork = host.context.network;
  host.context.network = async (url, options) => {
    if (options.method === "POST") {
      host.calls.network.push({ url: String(url), method: "POST", body: JSON.parse(options.body) });
      return sse(event("delta", { text: "received before stop" }) + event("canceled", { error: "fixture canceled" }));
    }
    return defaultNetwork(url, options);
  };
  await host.start();
  assert.equal(host.context.wsRef.current.chats[0].messages[0].delivery, "stopped");
  assert.equal(host.context.wsRef.current.chats[0].messages.find((message) => message.replyStatus === "interrupted").content, "received before stop");
  host.calls.network.length = 0;
  host.context.network = async (url, options) => { host.calls.network.push({ url: String(url), method: options.method }); return Response.json({ error: "expired" }, { status: 401 }); };
  await host.retryLast();
  assert.deepEqual(host.calls.network.map((call) => call.method), ["GET"]);
  assert.match(host.calls.reports.at(-1).message, /original account/);
});

test("AA039/044: completed long reply replaces its checkpoint once, preserves text and reports the actual answer provider", async () => {
  const text = "complete text ".repeat(5000);
  const host = fixture();
  const defaultNetwork = host.context.network;
  host.context.network = async (url, options) => options.method === "POST" ? sse(event("delta", { text }) + done(text)) : defaultNetwork(url, options);
  assert.equal(await host.start(), text);
  const replies = host.context.wsRef.current.chats[0].messages.filter((message) => message.role === "assistant");
  assert.equal(replies.length, 1); assert.equal(replies[0].replyStatus, "complete"); assert.equal(replies[0].content, text);
  assert.equal(host.context.wsRef.current.usage.length, 1);
  assert.equal(host.context.wsRef.current.usage[0].provider, "gemini");
  assert.equal(host.context.wsRef.current.usage[0].requestId, "fixture-provider-request");
  assert.match(host.state.speak.answerReceipt, /gemini.*fixture-gemini-model.*fixture-provider-request/);
});

test("AA044/061: pending auth and failed preparation create no provider execution or sent message", async () => {
  const pending = fixture({ accountPending: true });
  assert.equal(await pending.start(), null);
  assert.equal(pending.calls.network.length, 0);
  assert.equal(pending.context.wsRef.current.chats[0].messages.length, 0);
  const failed = fixture();
  failed.context.network = async (url, options) => { failed.calls.network.push({ url: String(url), method: options.method }); return Response.json({ error: "expired" }, { status: 401 }); };
  assert.equal(await failed.start(), null);
  assert.deepEqual(failed.calls.network.map((call) => call.method), ["GET"]);
  assert.equal(failed.context.wsRef.current.usage.length, 0);
  assert.equal(failed.context.wsRef.current.chats[0].messages.length, 0);
  assert.match(failed.calls.errors.at(-1), /same account/);
});

test("AA044: an explicit server rejection before dispatch is not recorded as a provider execution", async () => {
  const host = fixture();
  const defaultNetwork = host.context.network;
  host.context.network = async (url, options) => options.method === "POST" ? Response.json({ ok: false, error: "fixture authorization expired before dispatch" }, { status: 401, headers: { "x-mind-primary-dispatched": "0" } }) : defaultNetwork(url, options);
  await host.start();
  assert.equal(host.context.wsRef.current.usage.length, 0);
  assert.equal(host.context.wsRef.current.chats[0].messages[0].delivery, "failed");
});


test("AA040/044: fingerprint preparation failure is a failed unsent message, not uncertain provider delivery", async () => {
  const host = fixture({ sha256: async () => { throw new Error("fixture fingerprint unavailable"); } });
  assert.equal(await host.start(), null);
  assert.equal(host.calls.network.filter((call) => call.method === "POST").length, 0);
  assert.equal(host.context.wsRef.current.usage.length, 0);
  assert.equal(host.context.wsRef.current.chats[0].messages[0].delivery, "failed");
  assert.equal(host.state.busy, false);
});


test("AA040/061: delayed recovery for the old owner cannot update the new owner's workspace or failure UI", async () => {
  const receipt = defer(); const started = defer();
  const host = fixture();
  host.context.network = async (url, options) => {
    host.calls.network.push({ url: String(url), method: options.method });
    started.resolve(); return receipt.promise;
  };
  const recovery = host.deliver(host.original.chats[0], "old text with old memory", host.original, true, [], {
    request: { id: host.operationId, body: { memoryContext: [{ id: "old-note", text: "must never resend" }] } },
  });
  await started.promise;
  host.context.turnOwner.current = "owner-b";
  receipt.resolve(Response.json({ state: "responded", ownerId: "owner-a", executions: [] }));
  assert.equal(await recovery, null);
  assert.deepEqual(host.calls.network.map((call) => call.method), ["GET"]);
  assert.equal(host.calls.workspaceUpdates, 0);
  assert.equal(host.calls.reports.length, 0);
});

test("AA044: a dispatched provider failure preserves known request metadata and partial usage without inventing zero", async () => {
  const host = fixture();
  const defaultNetwork = host.context.network;
  host.context.network = async (url, options) => options.method === "POST" ? Response.json({
    ok: false, error: "fixture upstream failure after processing", provider: "gemini", model: "reported-model", requestedModel: "selected-gemini-model",
    requestId: "failed-provider-request", usage: { prompt_tokens: 55 }, executionLocation: "hosted",
  }, { status: 503, headers: { "x-mind-primary-dispatched": "1" } }) : defaultNetwork(url, options);
  assert.equal(await host.start(), null);
  assert.equal(host.context.wsRef.current.usage.length, 1);
  const usage = host.context.wsRef.current.usage[0];
  assert.equal(usage.requestId, "failed-provider-request");
  assert.equal(usage.model, "reported-model"); assert.equal(usage.requestedModel, "selected-gemini-model");
  assert.equal(usage.promptTokens, 55); assert.equal(usage.completionTokens, null);
  assert.equal(usage.kind, "partial"); assert.equal(usage.outcome, "unknown");
  assert.equal(usage.executionLocation, "hosted");
  assert.equal(host.context.wsRef.current.chats[0].messages.some((message) => message.replyStatus === "complete"), false);
});
