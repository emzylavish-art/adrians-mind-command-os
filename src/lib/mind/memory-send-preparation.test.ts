import { currentMemoryContext } from "./context-permission.ts";
import { completedHistory, checkpointReply } from "./partial-reply.ts";
import { withReplyVersion } from "./transcript.ts";
import { checkTurnReceipt } from "./live-turn.ts";
import { failureKindForAction } from "./recovery-inbox.ts";
import { effectiveContextPolicy } from "./memory/context-policy.ts";
import { memoryPolicyRevision, validateMemoryDispatch } from "./memory/dispatch-policy.ts";
import { retrieveProjectPassages } from "./knowledge.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { describe, it } from "node:test";
import { addMemory, createChat, deleteMemory, emptyWorkspace, memoriesForChat, pushAudit, pushUsage, reviseMemory, sha256 } from "./workspace.ts";
import { memorySendRevision, checkMemorySendRevision } from "./memory-send-policy.ts";
import { chatTurnBody, isLogicRouteId, respondedRouteLabel } from "./logic-routes.ts";
import { boundAbortSignal } from "./turn-timeouts.ts";
import { consumeMindTurn, prepareTurn, shouldStoreReply, STOPPED_REPLY } from "./live-turn.ts";
import { historyForDeliver, resolveChatMessages, shouldBlockForEmergencyStop, snapshotImages } from "./retry-fidelity.ts";
import { relevantMemories } from "./memory/relevant.ts";
import { normalizeBotKnowledge, routeForBotChat } from "./bot-model.ts";
import { chosenProvider, failover } from "./providers.ts";
import { exactModelForChat } from "./selection-sync.ts";
import { historyTextForImages } from "./media/pack.ts";
import { normalizeClientFailureMessage } from "./failure-states.ts";
import { parseCustomProviderChoice } from "./provider-catalog.ts";
import type { Chat, Workspace } from "./types.ts";

const app = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url).pathname.replace("/lib/components/", "/components/"), "utf8");
function actualFunction(start: string, end: string) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `actual handler boundaries exist: ${start}`);
  return app.slice(a, b);
}
const code = stripTypeScriptTypes(
  actualFunction("  async function reconcileSend(", "  function stopReply()") + "\n" +
  actualFunction("function selectRetryMessages(", "type BrowserSpeechRec ="),
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Executes the checked-in deliver handler, not a copy of its privacy decision. */
function harness(options: { pause?: "prepare" | "fingerprint"; uncertainFirst?: boolean } = {}) {
  const created = createChat(emptyWorkspace(), { memory: "on", autonomy: "ask", temporary: false, projectId: null });
  const initial = addMemory(created.ws, { scope: "global", text: "SYNTHETIC_PRIVATE_MARKER blue preference", source: "fixture", projectId: null, chatId: null });
  initial.memories[0].alwaysApply = true;
  const wsRef = { current: initial };
  const inFlight = { current: false };
  const reached = deferred(), release = deferred();
  const errors: string[] = [];
  const posts: { id: string | null; body: Record<string, unknown> }[] = [];
  const receiptIds: string[] = [];
  let prepared = 0, failed = false;
  let failure: { retry: (() => void) | null; message: string } | null = null;
  const fetchImpl = (async (_url, init) => {
    if (init?.method === "GET") {
      const id = new URL(String(_url), "https://fixture.test").searchParams.get("operationId");
      if (id) {
        assert.equal(init.body, undefined);
        receiptIds.push(id);
        return Response.json({ state: "processing_or_unknown", ownerId: "fixture-owner" });
      }
      if (options.pause === "prepare") { reached.resolve(); await release.promise; }
      prepared++;
      return Response.json({ operationId: `${1795637700000 + prepared}-00000000-0000-4000-8000-000000000001` });
    }
    const body = JSON.parse(String(init?.body));
    posts.push({ id: new Headers(init?.headers).get("x-mind-turn-id"), body });
    if (options.uncertainFirst && !failed) { failed = true; throw new Error("fixture dropped before server arrival"); }
    return new Response('event: done\ndata: {"text":"fixture answer","provider":"grok","model":"fixture-model","usage":null,"usedIds":[],"requestId":"fixture-receipt"}\n\n', { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const noop = () => undefined;
  const context = vm.createContext({
    document: { hidden: false, addEventListener: noop, removeEventListener: noop },
    completedHistory, checkpointReply, withReplyVersion, currentMemoryContext, accountPending: false, account: { id: "fixture-owner" },
    speakStageOpenRef: { current: false }, checkTurnReceipt: (url: string, id: string, headers: HeadersInit) => checkTurnReceipt(url, id, headers, undefined, fetchImpl),
    crypto, TextEncoder, TextDecoder, AbortController, DOMException, setTimeout, clearTimeout, Date,
    window: { location: { hostname: "fixture.test", pathname: "/" } },
    turnInFlight: inFlight, turnOwner: { current: "fixture-owner" }, draftOwner: "fixture-owner", wsRef,
    turnAbort: { current: null }, turnGen: { current: 0 }, deliverStoredUser: { current: false },
    providerChoice: "grok", modelTier: "Fast", grokConfigured: true, grokModel: null, providerModels: {},
    logicRoute: null, logicRoutes: [], discovered: [], liveProviders: {}, failoverPolicy: "none",
    composerEffort: "Fast", routingMode: "A", consultModel: "grok", consultModules: [], ADRIAN_MIND_IDENTITY: "fixture identity",
    failureKindForAction, normalizeBotKnowledge, routeForBotChat, chosenProvider, failover, isLogicRouteId, exactModelForChat, parseCustomProviderChoice,
    resolveSendPath: () => ({ path: "direct" }), getBearerToken: () => "", previewPathPrefix: () => "",
    setGenerationStatus: noop, setTurnChat: noop, setLiveText: noop, setToolTimeline: noop, setLastResolvedTier: noop, setLastModelUsed: noop, setBusy: noop, setNotice: noop,
    setError: (error: string | null) => { if (error) errors.push(error); },
    setFailure: (value: typeof failure | ((current: typeof failure) => typeof failure)) => { failure = typeof value === "function" ? value(failure) : value; },
    setWs: (value: Workspace | ((current: Workspace) => Workspace)) => { wsRef.current = typeof value === "function" ? value(wsRef.current) : value; },
    pushAudit, pushUsage, historyTextForImages, memorySendRevision, checkMemorySendRevision,
    classifyHonestFailure: () => "chat_failed", honestFailureAuditAction: (value: string) => value,
    normalizeClientFailureMessage,
    reportFailure: (message: string, _kind: string, _target: string, retry: (() => void) | null) => { failure = { message, retry }; },
    chatTurnBody, memoriesForChat, relevantMemories, boundAbortSignal, historyForDeliver, resolveChatMessages, shouldBlockForEmergencyStop, snapshotImages, respondedRouteLabel, shouldStoreReply, STOPPED_REPLY,
    sha256: async (text: string) => { if (options.pause === "fingerprint") { reached.resolve(); await release.promise; } return sha256(text); },
    prepareTurn: (url: string, headers: HeadersInit, signal: AbortSignal) => prepareTurn(url, headers, signal, fetchImpl),
    ensureChatMedia: async (chat: Chat) => chat, effectiveContextPolicy, memoryPolicyRevision, validateMemoryDispatch, retrieveProjectPassages,
    currentFreeOnly: { current: false }, researchReferencesInText: () => [], researchHistory: [], preferenceStorage: null, enabledSkills: [],
    collectAccountSkillApplications: () => [], loadModelControls: () => ({}), projectInstructionsForChat: () => "",
    requestAnimationFrame: (callback: () => void) => { callback(); return 1; }, cancelAnimationFrame: noop,
    consumeMindTurn: (input: Parameters<typeof consumeMindTurn>[0]) => consumeMindTurn({ ...input, fetchImpl }),
  });
  vm.runInContext(code, context);
  const deliver = vm.runInContext("deliver", context) as (chat: Chat, text: string, source: Workspace) => Promise<string | null>;
  return {
    ws: () => wsRef.current,
    setWs: (next: Workspace) => { wsRef.current = next; },
    start: (source = wsRef.current) => deliver(source.chats[0], "What is my blue preference?", source),
    posts, receiptIds, errors, reached: reached.promise, release: release.resolve,
    async retry() {
      assert.ok(failure?.retry, "actual failure banner offers retry");
      failure.retry();
      for (let i = 0; i < 50 && inFlight.current; i++) await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(inFlight.current, false);
    },
  };
}

describe("C5 memory privacy at the actual send boundary", () => {
  for (const pause of ["prepare", "fingerprint"] as const) {
    for (const mutation of ["delete", "correct", "archive", "off"] as const) {
      it(`stops stale memory when ${mutation} happens during ${pause}`, async () => {
        const h = harness({ pause });
        const pending = h.start();
        await Promise.race([h.reached, pending.then(() => assert.fail("Send ended before the intended mutation point: " + h.errors.join(" "))) ]);
        const ws = h.ws(), note = ws.memories[0];
        h.setWs(mutation === "delete" ? deleteMemory(ws, note.id) : mutation === "correct" ? reviseMemory(ws, note.id, "new corrected preference") : mutation === "archive" ? { ...ws, memories: ws.memories.map(n => ({ ...n, archived: true })) } : { ...ws, chats: ws.chats.map(chat => ({ ...chat, memory: "off" })) });
        h.release(); await pending;
        if (pause === "prepare" && mutation === "off") {
          assert.equal(h.posts.length, 1);
          assert.deepEqual(h.posts[0].body.memoryContext, []);
          assert.equal(JSON.stringify(h.posts[0].body).includes("SYNTHETIC_PRIVATE_MARKER"), false);
        } else {
          assert.equal(h.posts.length, 0);
          assert.ok(h.errors.some(error => /Memory or project access changed|saved context changed/i.test(error)));
        }
      });
    }
  }
  it("unchanged context reaches the transport normally", async () => {
    const h = harness(); await h.start();
    assert.equal(h.posts.length, 1); assert.ok(JSON.stringify(h.posts[0].body).includes("SYNTHETIC_PRIVATE_MARKER"));
  });
  for (const mutation of ["off", "delete", "correct"] as const) {
    it(`blocks original uncertain retry after ${mutation} and permits a deliberate fresh request`, async () => {
      const h = harness({ uncertainFirst: true }); await h.start();
      const ws = h.ws();
      h.setWs(mutation === "off" ? { ...ws, chats: ws.chats.map(chat => ({ ...chat, memory: "off" })) } : mutation === "delete" ? deleteMemory(ws, ws.memories[0].id) : reviseMemory(ws, ws.memories[0].id, "new preference"));
      await h.retry(); assert.equal(h.posts.length, 1);
      await h.start(); assert.equal(h.posts.length, 2);
      assert.notEqual(h.posts[0].id, h.posts[1].id); assert.ok(!JSON.stringify(h.posts[1].body).includes("SYNTHETIC_PRIVATE_MARKER"));
    });
  }
  it("unchanged uncertain retry checks exactly the original operation without posting its payload", async () => {
    const h = harness({ uncertainFirst: true }); await h.start(); await h.retry();
    assert.equal(h.posts.length, 1); assert.deepEqual(h.receiptIds, [h.posts[0].id]);
  });
  it("refuses a stale supplied workspace that predates memory deletion", async () => {
    const h = harness(); const old = structuredClone(h.ws());
    h.setWs(deleteMemory(h.ws(), h.ws().memories[0].id));
    await h.start(old); assert.equal(h.posts.length, 0);
  });
});
