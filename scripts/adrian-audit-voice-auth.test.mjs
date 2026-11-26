import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { settleWithin } from "./sign-out-plan.mjs";
import { handleVoiceStt } from "../src/lib/mind/voice/http.server.ts";
import { runSpeakAction, snapshotSpeakRetryParams } from "../src/lib/mind/voice/speak-action.ts";
import { readVoicePipeline, writeVoicePipeline, voiceStagePlan, speakWithBrowser } from "../src/lib/mind/voice/stage-routing.ts";
import { verifiedSessionIdentity, SessionIdentityConflictError, verifiedSupabaseCandidate } from "../src/lib/auth/session-user.ts";
import { handleSessionIdentity } from "../src/lib/auth/session-http.ts";
import { createSessionIdentityStore, readSessionIdentity } from "../src/lib/auth/session-state.ts";
import { handleAuthPopupRequest } from "../src/lib/auth/popup.server.ts";
import { popupMessageToken, waitForPopupToken } from "../src/lib/auth/popup-message.ts";
import { runPreSignInSignOut } from "./sign-out-plan.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useComposerDraft } from "../src/lib/mind/use-composer-draft.ts";

const sttRequest = (extra = {}) => new Request("https://mind.test/api/mind/voice/stt", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ audioBase64: Buffer.alloc(64, 1).toString("base64"), mime: "audio/webm", ...extra }),
});
const sttDeps = (fetchImpl) => ({ requireUser: async () => crypto.randomUUID(), halted: async () => false, env: { XAI_API_KEY: "fixture-xai", OPENAI_API_KEY: "fixture-openai" }, fetchImpl });

test("AA004: transcription failure never authorizes an implicit paid provider switch", async () => {
  for (const status of [401, 429, 503, 200]) {
    const calls = [];
    const response = await handleVoiceStt(sttRequest(), sttDeps(async (url) => {
      calls.push(String(url));
      return Response.json({ text: "" }, { status });
    }));
    assert.equal((await response.json()).ok, false);
    assert.deepEqual(calls, ["https://api.x.ai/v1/stt"]);
  }
});

test("AA004: explicit OpenAI is the sole transcription provider; free-only and invalid selections dispatch nothing", async () => {
  const calls = [];
  const deps = sttDeps(async (url) => { calls.push(String(url)); return Response.json({ text: "fixture transcript" }); });
  const result = await (await handleVoiceStt(sttRequest({ provider: "openai" }), deps)).json();
  assert.deepEqual(result, { ok: true, text: "fixture transcript", provider: "OpenAI" });
  assert.deepEqual(calls, ["https://api.openai.com/v1/audio/transcriptions"]);
  calls.length = 0;
  for (const extra of [{ provider: "openai", freeOnly: true }, { provider: "unknown" }]) {
    assert.equal((await (await handleVoiceStt(sttRequest(extra), deps)).json()).ok, false);
  }
  assert.equal(calls.length, 0);
});

test("AA003: selected text-only provider answers independently of speech engine; failed playback retry does not resend", async () => {
  const prefs = { answerMode: "selected", transcription: "openai", speechOutput: "browser" };
  assert.deepEqual(voiceStagePlan({ preferences: prefs, selectedProvider: "gemini", requestedModel: "gemini-fixture", freeOnly: false }), {
    ok: true, input: "OpenAI", answer: "gemini", output: "Browser speech", model: "gemini-fixture",
  });
  let answers = 0;
  const deps = {
    capture: async () => ({ ok: true, audioBase64: "fixture" }),
    transcribe: async () => ({ ok: true, text: "question", provider: "OpenAI" }),
    chatTurn: async () => { answers++; return { ok: true, text: "fixture Gemini answer", provider: "gemini" }; },
    synthesize: async () => ({ ok: false, error: "Browser speech is unavailable" }),
    play: async () => {},
  };
  const first = await runSpeakAction(snapshotSpeakRetryParams({}), deps);
  assert.equal(first.ok, false);
  assert.equal(first.params.reply, "fixture Gemini answer");
  assert.equal(first.params.chatCommitted, true);
  await runSpeakAction(first.params, deps);
  assert.equal(answers, 1);
});

test("AA003: voice pipeline preferences stay owner scoped and survive reload", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const prefs = { answerMode: "selected", transcription: "openai", speechOutput: "xai" };
  assert.equal(writeVoicePipeline("owner-A", prefs, storage), true);
  assert.deepEqual(readVoicePipeline("owner-A", storage), prefs);
  assert.equal(readVoicePipeline("owner-B", storage).transcription, "xai");
  assert.equal(writeVoicePipeline(null, prefs, storage), false);
});

test("AA003: browser speech waits for playback, respects volume and aborts delayed speech", async () => {
  const controller = new AbortController();
  let utterance;
  let canceled = 0;
  const speaking = speakWithBrowser({ text: "saved answer", signal: controller.signal, volume: 0,
    makeUtterance: (text) => ({ text }), synthesis: { speak: (value) => { utterance = value; }, cancel: () => { canceled++; } },
  });
  assert.equal(utterance.volume, 0);
  controller.abort();
  await assert.rejects(speaking, { name: "AbortError" });
  assert.equal(canceled, 1);
  assert.equal(utterance.onend, null);
});

test("AA057: canonical identity accepts one verified source and blocks disagreement", async () => {
  const a = { id: "owner-a", email: "a@example.test" };
  const b = { id: "owner-b", email: "b@example.test" };
  for (const candidates of [{ supabaseUser: a, betterAuthUser: null }, { supabaseUser: null, betterAuthUser: a }, { supabaseUser: a, betterAuthUser: a }]) {
    assert.equal(verifiedSessionIdentity(candidates).id, a.id);
  }
  assert.throws(() => verifiedSessionIdentity({ supabaseUser: a, betterAuthUser: b }), SessionIdentityConflictError);
  const response = await handleSessionIdentity(new Request("https://mind.test/api/mind/session"), async () => verifiedSessionIdentity({ supabaseUser: a, betterAuthUser: b }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.user, null);
  assert.equal(body.status, "conflict");
  assert.equal(JSON.stringify(body).includes("example.test"), false);
});

test("AA057/058: identity loading, service failure and sign-out are different; old owner response cannot win", async () => {
  const pending = [];
  const store = createSessionIdentityStore(() => new Promise((resolve) => pending.push(resolve)));
  const first = store.refresh("account-a");
  const second = store.refresh("account-b");
  assert.equal(store.getSnapshot().status, "pending");
  pending[1]({ status: "authenticated", user: { id: "b", email: null }, error: null });
  await second;
  pending[0]({ status: "authenticated", user: { id: "a", email: null }, error: null });
  await first;
  assert.equal(store.getSnapshot().user.id, "b");
  const failed = await readSessionIdentity(async () => Response.json({ status: "unavailable", user: { id: "a" } }, { status: 503 }), "/session", null);
  assert.equal(failed.user, null);
  assert.equal(failed.status, "unavailable");
  const signedOut = await readSessionIdentity(async () => Response.json({ status: "signed-out", user: null }), "/session", null);
  assert.equal(signedOut.status, "signed-out");
});

test("AA059: popup completion binds origin, window and transaction; malformed tokens are ignored", () => {
  const popup = {};
  const expected = { origin: "https://mind.test", popup, transactionId: "attempt-a" };
  const good = { origin: expected.origin, source: popup, data: { source: "grok-auth-popup", transactionId: "attempt-a", token: "fixture" } };
  assert.deepEqual(popupMessageToken(good, expected), { accepted: true, token: "fixture" });
  for (const event of [{ ...good, origin: "https://other.test" }, { ...good, source: {} }, { ...good, data: { ...good.data, transactionId: "attempt-b" } }, { ...good, data: { ...good.data, token: {} } }]) {
    assert.deepEqual(popupMessageToken(event, expected), { accepted: false });
  }
});

test("AA059: canceled popup listener is removed and cannot complete a later attempt", async () => {
  const listeners = new Set();
  const intervals = new Map();
  const timeouts = new Map();
  let next = 0;
  const host = {
    location: { origin: "https://mind.test" },
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    setInterval: (fn) => { intervals.set(++next, fn); return next; }, clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn, delay) => { timeouts.set(++next, { fn, delay }); return next; }, clearTimeout: (id) => timeouts.delete(id),
  };
  const popup = { closed: true };
  const waiting = waitForPopupToken(popup, "attempt-a", host);
  [...intervals.values()][0]();
  [...timeouts.values()].find((timer) => timer.delay === 400).fn();
  assert.equal(await waiting, null);
  assert.equal(listeners.size, 0);
  assert.equal(timeouts.size, 0);
});

test("AA060: switching a known deployed account stops if prior sign-out is not confirmed", async () => {
  let cleared = false;
  await assert.rejects(runPreSignInSignOut({ livePreview: false, hasBearer: false, requireConfirmation: true,
    requestSignOut: async () => { throw new Error("fixture network failure"); }, clearToken: () => { cleared = true; }, timeoutMs: 20,
  }), /Account switching stopped/);
  assert.equal(cleared, false);
});

test("AA060: the actual draft hook saves immediately and recovers only under its original owner", async (t) => {
  const previousWindow = globalThis.window;
  const saved = new Map();
  globalThis.window = { sessionStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) }, dispatchEvent: () => true };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  let update;
  function Fixture({ owner }) {
    const [, setDraft] = useComposerDraft(JSON.stringify([owner, "chat-a"]), "text", "", true);
    update = setDraft;
    return null;
  }
  renderToStaticMarkup(createElement(Fixture, { owner: "owner-a" }));
  update("unsent owner-a work");
  assert.equal(saved.size, 1, "stored synchronously before navigation or sign-out");
  await assert.rejects(runPreSignInSignOut({ livePreview: false, hasBearer: false, requireConfirmation: true, requestSignOut: async () => { throw new Error("failed"); }, clearToken: () => {}, timeoutMs: 20 }));
  let restored;
  renderToStaticMarkup(createElement(Fixture, { owner: "owner-b" }));
  update((text) => { restored = text; return text; });
  assert.equal(restored, "");
  renderToStaticMarkup(createElement(Fixture, { owner: "owner-a" }));
  update((text) => { restored = text; return text; });
  assert.equal(restored, "unsent owner-a work");
});


test("AA057: an unavailable identity authority cannot silently select the other account", async () => {
  assert.equal(verifiedSupabaseCandidate({ user: null, error: { name: "AuthSessionMissingError" } }), null);
  assert.deepEqual(verifiedSupabaseCandidate({ user: { id: "owner-a", email: "a@example.test" }, error: null }), { id: "owner-a", email: "a@example.test" });
  for (const name of ["AuthRetryableFetchError", "AuthApiError", "Error"]) {
    let selected = false;
    const response = await handleSessionIdentity(new Request("https://mind.test/api/mind/session"), async () => {
      const supabaseUser = verifiedSupabaseCandidate({ user: null, error: { name } });
      selected = true;
      return verifiedSessionIdentity({ supabaseUser, betterAuthUser: { id: "other-owner", email: null } });
    });
    assert.equal(response.status, 503);
    assert.equal(selected, false);
    assert.equal((await response.json()).user, null);
  }
});


test("AA059/060: a gesture-opened waiting popup starts no OAuth until account cleanup finishes", async () => {
  let calls = 0;
  let callback;
  const transactionId = "12217a31-cf09-404b-a624-64634b871201";
  const deps = { sessionTokenCookie: "fixture-session", start: async (input) => {
    calls++; callback = input.body.callbackURL;
    return Response.json({ url: "https://fixture-oauth.test/authorize" });
  } };
  const base = `https://mind.test/auth/popup?providerId=fixture&transactionId=${transactionId}`;
  const waiting = await handleAuthPopupRequest(new Request(base + "&wait=1"), deps);
  assert.equal(waiting.status, 200);
  assert.match(await waiting.text(), /Preparing sign-in/);
  assert.equal(calls, 0);
  const invalid = await handleAuthPopupRequest(new Request("https://mind.test/auth/popup?providerId=fixture"), deps);
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
  const started = await handleAuthPopupRequest(new Request(base), deps);
  assert.equal(started.status, 302);
  assert.equal(calls, 1);
  assert.equal(new URL(callback).searchParams.get("transactionId"), transactionId);
  const completed = await handleAuthPopupRequest(new Request(callback, { headers: { cookie: "fixture-session=fixture-token" } }), deps);
  const html = await completed.text();
  assert.match(html, new RegExp(`"transactionId":"${transactionId}"`));
  assert.equal(completed.headers.get("cache-control"), "no-store");
});


test("AA060: blocked or early-canceled popup leaves the old account untouched", async () => {
  const source = ts.createSourceFile("auth-client.ts", readFileSync(new URL("../src/lib/auth/client.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const signInNode = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "signIn");
  const compiled = ts.transpileModule(signInNode.getText(source).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let reads = 0;
  let ended = 0;
  const bind = (popup) => {
    const context = {
      inLivePreview: () => true, openSignInPopup: () => popup, settleWithin,
      window: { location: { hostname: "mind.test", pathname: "/" } }, previewPathPrefix: () => null,
      getBearerToken: () => "fixture", fetch: () => { throw new Error("real fetch forbidden"); },
      readSessionIdentity: async () => { reads++; if (popup) popup.closed = true; return { status: "authenticated", user: { id: "owner-a", sessionSource: "better-auth" } }; },
      runPreSignInSignOut: async () => { ended++; },
    };
    return new Function(...Object.keys(context), compiled + "\nreturn signIn;")(...Object.values(context));
  };
  await assert.rejects(bind(null)("fixture"), /current session was kept/);
  assert.equal(reads, 0); assert.equal(ended, 0);
  await assert.rejects(bind({ closed: false, close: () => {} })("fixture"), /canceled before account switching/);
  assert.equal(reads, 1); assert.equal(ended, 0);
});
