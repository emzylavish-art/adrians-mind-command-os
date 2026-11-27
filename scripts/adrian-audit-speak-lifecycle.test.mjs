import { loadVoiceStages, VOICE_STAGES_KEY } from "../src/lib/mind/voice/provider-selection.ts";
import { snapshotImages } from "../src/lib/mind/retry-fidelity.ts";
import { resolveSendPath } from "../src/lib/mind/composer-modes.ts";
import { snapshotSpeakRetryParams } from "../src/lib/mind/voice/speak-action.ts";
import { createVoiceStagesReceipt, recordVoiceStage, recordVoicePlayback, storeVoiceReceipt } from "../src/lib/mind/voice/stage-receipts.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { runMountedSpeak } from "../src/lib/mind/voice/speak-click.ts";
import { speakWithBrowser } from "../src/lib/mind/voice/stage-routing.ts";
import { resolveVoiceMode } from "../src/lib/mind/voice/errors.ts";

// Execute the actual component callbacks against safe, deferred effects. These
// fixtures prove lifecycle/routing behavior, not physical microphone/device audio.
const commandSource = ts.createSourceFile("command-app.tsx", readFileSync(new URL("../src/components/mind/command-app.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const stageSource = ts.createSourceFile("speak-stage.tsx", readFileSync(new URL("../src/components/mind/speak-stage.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(source, predicate) {
  let match;
  const visit = (node) => { if (!match && predicate(node)) match = node; if (!match) ts.forEachChild(node, visit); };
  visit(source);
  assert.ok(match, "expected production callback exists");
  return match;
}
function bind(node, source, context) {
  const code = ts.transpileModule(`const selectedCallback = ${node.getText(source)};`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code}\nreturn selectedCallback;`)(...Object.values(context));
}
function callback(source, name, context) {
  return bind(find(source, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name), source, context);
}
function scopeCleanup(context) {
  const call = find(commandSource, (node) => ts.isCallExpression(node) && node.expression.getText(commandSource) === "useEffect" && node.arguments[1]?.getText(commandSource) === "[voiceScope]");
  return bind(call.arguments[0], commandSource, context)();
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const spoken = deferred();
  const storage = { getItem: () => null };
  const calls = { answer: 0, cloudSpeech: 0, captures: 0, transcriptions: [], utterances: [], notices: [], failures: [], cancel: 0 };
  const state = { speaking: false, call: { heard: "", reply: "", error: "" }, activeId: null };
  const context = {
    createVoiceStagesReceipt, recordVoiceStage, recordVoicePlayback, storeVoiceReceipt, loadVoiceStages, snapshotSpeakRetryParams,
    activeId: null, effectiveProvider: "gemini", setSpeakingMessageId: () => {}, serverDictationRef: { current: null },
    preferenceStorage: { setItem: () => {}, getItem: key => key === VOICE_STAGES_KEY ? JSON.stringify({ inputProvider: "openai", outputProvider: "browser" }) : (overrides.localStorage ?? storage).getItem(key) },
    currentFreeOnly: { current: false }, voicePipeline: { answerMode: "selected", transcription: "openai", speechOutput: "browser" },
    voiceModeRef: { current: "direct" }, speakStageOpenRef: { current: true }, voiceChoiceRef: { current: "eve" }, localStorage: storage,
    probeOllamaConductor: async () => ({ ok: false }), resolveVoiceMode,
    setError: (message) => calls.failures.push(message),
    speakGenRef: { current: 0 }, speakAbortRef: { current: null }, browserPlaybackAbort: { current: null },
    draftOwner: "owner-a", turnOwner: { current: "owner-a" }, wsRef: { current: { chats: [], halted: false } },
    voiceOutput: { current: { muted: false, volume: 0.35 } },
    setSpeaking: (value) => { state.speaking = value; }, setAvatarPresence: () => {},
    runMountedSpeak,
    captureSpeakUtterance: async () => { calls.captures++; return { ok: true, audioBase64: "fixture", mime: "audio/webm" }; },
    previewPathPrefix: () => null, getBearerToken: () => null, sanitizeAudioFilename: () => "fixture.webm",
    fetch: async (_url, options) => { calls.transcriptions.push(JSON.parse(options.body)); return Response.json({ ok: true, text: "fixture question", provider: "OpenAI" }); },
    setNotice: (message) => calls.notices.push(message),
    setSpeakCall: (value) => { state.call = typeof value === "function" ? value(state.call) : value; },
    speakChatTurn: async () => { calls.answer++; return { ok: true, text: "fixture Gemini answer" }; },
    noteSpokenText: () => {},
    speakText: async () => { calls.cloudSpeech++; return { ok: true, audio: "fixture-cloud-audio", provider: "xAI" }; },
    speakWithBrowser: (input) => speakWithBrowser({ ...input, makeUtterance: (text) => ({ text }), synthesis: {
      speak: (utterance) => { calls.utterances.push(utterance); spoken.resolve(utterance); },
      cancel: () => { calls.cancel++; }, // Deliberately emits no onend/onerror.
    } }),
    voiceSession: { current: null }, listenMintAbortRef: { current: null }, auxiliaryHistory: { current: null },
    sharedAudioOutput: { playMpegBase64: async () => {} },
    reportFailure: (message) => calls.failures.push(message), clearFailure: () => {},
    setFailure: () => {}, classifyHonestFailure: () => null, resolveXaiVoiceId: (value) => value,
    ...overrides,
  };
  context.window = { location: { hostname: "mind.test", pathname: "/" }, speechSynthesis: { cancel: () => { calls.cancel++; } } };
  context.interruptSpeakPlayback = () => { context.speakAbortRef.current?.abort(); context.browserPlaybackAbort.current?.abort(); state.speaking = false; };
  context.stopVoiceSession = context.interruptSpeakPlayback;
  const speak = callback(commandSource, "speak", context);
  return { context, calls, state, speak, spoken };
}

test("AA003: actual recorded Speak keeps its first new chat, uses selected answer route, and waits for browser completion", async () => {
  const host = fixture();
  const cleanup = scopeCleanup(host.context);
  const context = host.context;
  context.speakChatTurn = callback(commandSource, "speakChatTurn", {
    activeId: null, wsRef: context.wsRef, voiceSession: context.voiceSession,
    view: "chat", draftScope: "fixture", persistDraft: false, pendingImagesRef: { current: [] }, snapshotImages, composerEffort: "auto", resolveSendPath,
    createChat: () => ({ chat: { id: "new-chat", memory: "off", temporary: false, messages: [] } }),
    memoryChoice: "off", autonomy: "ask", temporary: false, chatProjectId: null, projectChoice: null, defaultPersonalityId: null,
    setActiveId: (id) => { host.state.activeId = id; cleanup(); }, setView: () => {},
    setWs: (next) => { context.wsRef.current = next(context.wsRef.current); }, pushAudit: (value) => value,
    preferenceStorage: context.preferenceStorage, localStorage: { getItem: () => null }, speakStylePersonality: () => "fixture-style", parseCreateBot: () => null,
    deliver: async (_chat, _text, _source, _resume, _images, options) => {
      host.calls.answer++;
      assert.equal(options.selectedProviderOnly, true, "voice cannot consult another model instead of the selected provider");
      return "fixture Gemini answer";
    },
  });
  const speak = callback(commandSource, "speak", context);
  let settled = false;
  const result = speak("").then((value) => { settled = true; return value; });
  const utterance = await host.spoken.promise;
  assert.equal(host.state.activeId, "new-chat");
  assert.equal(host.calls.answer, 1);
  assert.equal(host.calls.cloudSpeech, 0);
  assert.equal(host.calls.transcriptions[0].provider, "openai");
  assert.equal(utterance.text, "fixture Gemini answer");
  assert.equal(utterance.volume, 0.35);
  assert.equal(settled, false, "request completion is not playback completion");
  utterance.onend();
  assert.deepEqual(await result, { ok: true, speech: "played" });
  assert.equal(host.state.speaking, false);
});

test("AA003: muting while the selected answer is delayed saves it without synthesis or false playback success", async () => {
  const answer = deferred();
  const started = deferred();
  const host = fixture({ speakChatTurn: async () => { started.resolve(); return answer.promise; } });
  const result = host.speak("");
  await started.promise;
  host.context.voiceOutput.current = { muted: true, volume: 0.35 };
  answer.resolve({ ok: true, text: "answer completed while muted" });
  assert.deepEqual(await result, { ok: true, speech: "muted" });
  assert.equal(host.state.call.reply, "answer completed while muted");
  assert.equal(host.calls.cloudSpeech, 0);
  assert.equal(host.calls.utterances.length, 0);
  assert.match(host.calls.notices.at(-1), /muted/);
});

test("AA003: mute aborts active browser audio even when the engine emits no cancellation event", async () => {
  const host = fixture();
  const result = host.speak("saved answer");
  await host.spoken.promise;
  const attribute = find(commandSource, (node) => ts.isJsxAttribute(node) && node.name.getText(commandSource) === "onOutputSettings");
  const changeOutput = bind(attribute.initializer.expression, commandSource, host.context);
  changeOutput(true, 0.35);
  assert.deepEqual(await result, { ok: true, speech: "muted" });
  assert.equal(host.state.speaking, false);
  assert.equal(host.calls.failures.length, 0);
  assert.ok(host.calls.cancel > 0);
});

test("AA003: owner change or interruption rejects a late answer without mutating the new owner's voice UI", async () => {
  for (const change of ["owner", "interrupt"]) {
    const answer = deferred();
    const started = deferred();
    const host = fixture({ speakChatTurn: async () => { started.resolve(); return answer.promise; } });
    const pending = host.speak("");
    await started.promise;
    if (change === "owner") host.context.turnOwner.current = "owner-b";
    else host.context.interruptSpeakPlayback();
    answer.resolve({ ok: true, text: "late old answer" });
    await pending;
    assert.equal(host.state.call.reply, "");
    assert.equal(host.calls.utterances.length, 0);
    assert.equal(host.calls.cloudSpeech, 0);
  }
});

test("AA003: actual SpeakStage ask callback ignores delayed close/reopen results and reports muted replies accurately", async () => {
  const old = deferred();
  const current = deferred();
  let requested = 0;
  const state = { reply: "", notice: "", asking: false, line: "" };
  const context = {
    props: { signedIn: true, halted: false, onAsk: () => (++requested === 1 ? old.promise : current.promise) },
    speakerMutedRef: { current: false }, speechCutRef: { current: false }, outputGeneration: { current: 0 },
    line: "first question", asking: false, callGeneration: { current: 0 }, openRef: { current: true },
    setAsking: (value) => { state.asking = value; }, setShowTranscript: () => {},
    setReply: (value) => { state.reply = value; }, setNotice: (value) => { state.notice = value; }, setLine: (value) => { state.line = value; },
  };
  const ask = callback(stageSource, "ask", context);
  const pendingOld = ask();
  const closeEffect = find(stageSource, (node) => ts.isCallExpression(node) && node.expression.getText(stageSource) === "useEffect" && node.arguments[0]?.getText(stageSource).includes('classList.add("eve-call-open")'));
  const close = bind(closeEffect.arguments[0], stageSource, {
    ...context, props: { ...context.props, open: true },
    document: { activeElement: null, documentElement: { classList: { add: () => {}, remove: () => {} } } },
    HTMLElement: class {}, dialogRef: { current: null }, mediaGeneration: { current: 0 }, held: { current: false },
    stopVideo: () => {}, setSettingsOpen: () => {}, setConnecting: () => {}, setRecordingPending: () => {}, setSpeakerMuted: () => {},
  })();
  context.openRef.current = false;
  close();
  assert.equal(state.asking, false, "closing settles the old pending indicator");
  context.openRef.current = true;
  const pendingCurrent = ask();
  current.resolve({ reply: "current answer", speech: "muted" });
  await pendingCurrent;
  assert.equal(state.reply, "current answer");
  assert.equal(state.notice, "Reply saved. Speaker muted.");
  old.resolve({ reply: "old answer", speech: "played" });
  await pendingOld;
  assert.equal(state.reply, "current answer");
  assert.equal(state.notice, "Reply saved. Speaker muted.");
  assert.equal(state.asking, false);
});


test("AA003: denied microphone and free-only recorded input dispatch no transcription or answer", async () => {
  let answers = 0;
  const denied = fixture({ captureSpeakUtterance: async () => { throw new DOMException("denied", "NotAllowedError"); }, speakChatTurn: async () => { answers++; return { ok: true, text: "unexpected" }; } });
  assert.equal((await denied.speak("")).ok, false);
  assert.equal(denied.calls.transcriptions.length, 0);
  assert.equal(answers, 0);
  const free = fixture({ currentFreeOnly: { current: true } });
  assert.equal((await free.speak("")).ok, false);
  assert.equal(free.calls.captures, 0);
  assert.equal(free.calls.transcriptions.length, 0);
  assert.equal(free.calls.answer, 0);
});


test("AA003: browser read-aloud outside Speak preserves the saved volume", async () => {
  const host = fixture({ speakStageOpenRef: { current: false }, localStorage: { getItem: (key) => key === "adrian-speak-volume" ? "25" : null } });
  const pending = host.speak("saved answer");
  const utterance = await host.spoken.promise;
  assert.equal(utterance.volume, 0.25);
  utterance.onend();
  assert.deepEqual(await pending, { ok: true, speech: "played" });
});
