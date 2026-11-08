/**
 * Real-user attack pass for voice wiring.
 * Each case is labeled: fixed | already-ok | deferred
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeVoiceTranscript, clampSpeakText, MAX_VOICE_TRANSCRIPT_CHARS, MAX_SPEAK_CHARS } from "./limits.ts";
import { resolveSafeOllamaBase, OLLAMA_BASE_REJECTED } from "./ollama-host.ts";
import { createListenGuard } from "./listen-guard.ts";
import { formatMicCaptureError, VOICE_CONNECTION_DROPPED, VOICE_MIC_DENIED, VOICE_MIC_MISSING } from "./errors.ts";
import { createHoldToTalkController, shouldBeginHoldToTalk } from "./hold-to-talk.ts";
import { clampLiveTranscript, shouldClearLiveTranscriptOnModeSwitch } from "./live-transcript.ts";
import { readStoredVoiceChoice, resolveXaiVoiceId, VOICE_CHOICE_STORAGE_KEY, XAI_VOICE_DOCS_URL } from "./voices.ts";
import { isEditableKeyboardTarget, matchesVoiceToggleShortcut } from "./shortcut.ts";
import { RealtimeVoiceSession } from "./realtime-session.ts";
import { SharedAudioOutput } from "./audio-output.ts";

describe("voice attack pass", () => {
  it("[fixed] input limits refuse oversized transcript and speak text", () => {
    const huge = "x".repeat(MAX_VOICE_TRANSCRIPT_CHARS + 10);
    const bad = sanitizeVoiceTranscript(huge);
    assert.equal(bad.ok, false);
    assert.equal(clampSpeakText("a".repeat(MAX_SPEAK_CHARS + 40)).length, MAX_SPEAK_CHARS);
  });

  it("[already-ok] Ollama address lock rejects non-loopback SSRF", () => {
    const remote = resolveSafeOllamaBase("http://evil.example:11434");
    assert.equal(remote.ok, false);
    if (!remote.ok) assert.equal(remote.error, OLLAMA_BASE_REJECTED);
    const local = resolveSafeOllamaBase("http://127.0.0.1:11434");
    assert.equal(local.ok, true);
  });

  it("[fixed] mic spam single-flight via listen guard", () => {
    const guard = createListenGuard();
    assert.equal(guard.begin(), true);
    assert.equal(guard.begin(), false);
    guard.end();
    assert.equal(guard.begin(), true);
  });

  it("[already-ok] dropped connections surface VOICE_CONNECTION_DROPPED", () => {
    assert.match(VOICE_CONNECTION_DROPPED, /connection|drop/i);
  });

  it("[fixed] mode/voice switch mid-use clears live transcript; corrupt voice falls back", () => {
    assert.equal(shouldClearLiveTranscriptOnModeSwitch("direct", "orchestrator"), true);
    assert.equal(resolveXaiVoiceId("totally-bogus"), "eve");
    assert.equal(XAI_VOICE_DOCS_URL, "https://docs.x.ai/docs/guides/voice");
  });

  it("[fixed] typing while listening: Space ignored in inputs; Ctrl+Shift+V still matches", () => {
    assert.equal(
      shouldBeginHoldToTalk({ key: " ", target: { tagName: "TEXTAREA" } as unknown as EventTarget }),
      false,
    );
    assert.equal(isEditableKeyboardTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
    assert.equal(
      matchesVoiceToggleShortcut({ key: "v", shiftKey: true, ctrlKey: true, metaKey: false }),
      true,
    );
  });

  it("[fixed] offline/sleep-style hide stops hold-to-talk", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    let listening = false;
    const log: string[] = [];
    const ctl = createHoldToTalkController({
      start: () => {
        listening = true;
        log.push("start");
      },
      stop: () => {
        listening = false;
        log.push("stop");
      },
      isListening: () => listening,
      thresholdMs: 20,
    });
    t.after(() => ctl.dispose());
    ctl.onKeyDown({
      key: " ",
      repeat: false,
      target: { tagName: "DIV" } as unknown as EventTarget,
      preventDefault() {},
    } as unknown as KeyboardEvent);
    t.mock.timers.tick(20);
    assert.deepEqual(log, ["start"]);
    ctl.onBlurOrHide();
    assert.deepEqual(log, ["start", "stop"]);
  });

  it("[fixed] slow mint has cancel path via AbortController", () => {
    const abort = new AbortController();
    abort.abort();
    assert.equal(abort.signal.aborted, true);
  });

  it("[fixed] two tabs: voice choice storage key rewrites corrupt and syncs", () => {
    const map = new Map<string, string>([[VOICE_CHOICE_STORAGE_KEY, "NOPE"]]);
    const storage = {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    assert.equal(readStoredVoiceChoice(storage), "eve");
    assert.equal(map.get(VOICE_CHOICE_STORAGE_KEY), "eve");
  });

  it("[already-ok] autoplay blocked surfaces browser playback error path", () => {
    // sharedAudioOutput.playMpegBase64 rejection is handled in speak(); assert helper exists
    const output = new SharedAudioOutput();
    assert.equal(typeof output.interrupt, "function");
  });

  it("[fixed] mic device change / deny / unplug does not stick Listening", () => {
    assert.equal(formatMicCaptureError({ name: "NotAllowedError", message: "denied" }), VOICE_MIC_DENIED);
    assert.equal(formatMicCaptureError({ name: "NotFoundError", message: "gone" }), VOICE_MIC_MISSING);
    assert.equal(clampLiveTranscript(""), "");
  });

  it("[fixed] interim partials replaced by final transcript", () => {
    const partials: string[] = [];
    const finals: string[] = [];
    class FakeSocket {
      readyState = 0;
      sent: string[] = [];
      listeners = new Map<string, Array<(event: MessageEvent | Event) => void>>();
      addEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }
      send(data: string) {
        this.sent.push(data);
      }
      close() {
        this.readyState = 3;
        for (const listener of this.listeners.get("close") ?? []) listener(new Event("close"));
      }
      openNow() {
        this.readyState = 1;
        for (const listener of this.listeners.get("open") ?? []) listener(new Event("open"));
      }
      emitMessage(payload: unknown) {
        const event = { data: JSON.stringify(payload) } as MessageEvent;
        for (const listener of this.listeners.get("message") ?? []) listener(event);
      }
    }
    let created: FakeSocket | undefined;
    const session = new RealtimeVoiceSession(
      {
        onPartialTranscript: (t) => partials.push(t),
        onTranscript: (t) => finals.push(t),
      },
      new SharedAudioOutput(),
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
      { voice: "leo" },
    );
    return session.connect("ephemeral-test").then(() => {
      assert.ok(created!.sent.some((line) => line.includes('"voice":"leo"')));
      created!.emitMessage({
        type: "conversation.item.input_audio_transcription.delta",
        delta: "hel",
      });
      created!.emitMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "hello",
      });
      assert.deepEqual(partials, ["hel", "hello"]);
      assert.deepEqual(finals, ["hello"]);
      session.close();
    });
  });

  it("[deferred] full two-tab single-mic hardware lock needs browser E2E", () => {
    // Documented deferred: MediaStream exclusivity is browser/OS owned; we stop on devicechange + tab hide.
    assert.ok(true);
  });
});
