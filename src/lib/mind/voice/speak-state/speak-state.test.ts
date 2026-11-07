import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BARGE_IN_ECHO_GUARD_MS, TTS_VAD_SUSTAIN_MS } from "../../voice-live/barge-in.ts";
import { micPermissionFromError, readAudioDeviceId } from "../../voice-live/mic-stream.ts";
import { SpeakState } from "./controller.ts";
import type { SpeakEvent } from "./events.ts";
import { createMemoryStorage, type SpeakSessionStorage } from "./persistence.ts";
import {
  LEVEL_INTERVAL_MS,
  VAD_END_HOLD_MS,
  VAD_START_HOLD_MS,
  vadProbFromLinearRms,
} from "./signal.ts";

const ECHO_RMS = 0.12;
const LOUD_RMS = 0.4;

function harness(storage?: SpeakSessionStorage) {
  let t = 1_000;
  let n = 0;
  const events: SpeakEvent[] = [];
  const speak = new SpeakState({
    storage: storage ?? createMemoryStorage(),
    now: () => t,
    createId: () => `id-${++n}`,
  });
  const stop = speak.bus.subscribe((event) => events.push(event));
  return {
    speak,
    events,
    stop,
    set(ms: number) {
      t = ms;
    },
    of<T extends SpeakEvent["type"]>(type: T) {
      return events.filter(
        (event): event is Extract<SpeakEvent, { type: T }> => event.type === type,
      );
    },
  };
}

describe("speak state permission", () => {
  it("emits prompt, granted with device id, and denied without duplicates", () => {
    const h = harness();
    h.speak.setPermission("prompt", null);
    h.speak.setPermission("prompt", null);
    h.speak.setPermission("granted", "mic-a");
    h.speak.setPermission("granted", "mic-a");
    h.speak.setPermission("denied", null);
    const perms = h.of("mic.permission");
    assert.deepEqual(
      perms.map((event) => [event.state, event.device_id]),
      [
        ["prompt", null],
        ["granted", "mic-a"],
        ["denied", null],
      ],
    );
    assert.ok(perms.every((event) => event.session_id && event.ts_ms > 0));
  });

  it("ends the session on revocation and the next begin resumes", () => {
    const storage = createMemoryStorage();
    const first = harness(storage);
    first.speak.begin("speak_button");
    const previous = first.speak.session_id;
    first.speak.setPermission("granted", "mic-a");
    first.set(2_000);
    first.speak.setPermission("denied", "mic-a");
    const ended = first.of("session.end");
    assert.equal(ended.length, 1);
    assert.equal(ended[0]?.reason, "permission_revoked");
    assert.equal(first.speak.isActive, false);

    const second = harness(storage);
    second.speak.begin("speak_button");
    const resumed = second.of("session.resume");
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0]?.prev_session_id, previous);
    assert.notEqual(second.speak.session_id, previous);
    assert.equal(second.of("session.start").length, 0);
  });

  it("keeps the session when the device id changes and resumes after the mic disappears", () => {
    const storage = createMemoryStorage();
    const h = harness(storage);
    h.speak.begin("speak_button");
    h.speak.setPermission("granted", "mic-a");
    h.speak.setMicOpen(true);
    h.set(1_500);
    h.speak.setPermission("granted", "mic-b");
    assert.equal(h.of("session.end").length, 0);
    assert.equal(h.speak.deviceId, "mic-b");
    h.set(1_800);
    h.speak.setPermission("granted", null);
    assert.equal(h.of("session.end").at(-1)?.reason, "device_change");

    const next = harness(storage);
    next.speak.begin("speak_button");
    assert.equal(next.of("session.resume").length, 1);
    assert.equal(next.of("session.resume")[0]?.reason, "speak_button");
  });

  it("maps getUserMedia denial and reads the audio device id", () => {
    assert.equal(
      micPermissionFromError(Object.assign(new Error("nope"), { name: "NotAllowedError" })),
      "denied",
    );
    assert.equal(micPermissionFromError(new Error("Microphone permission was denied.")), "denied");
    assert.equal(
      micPermissionFromError(Object.assign(new Error("missing"), { name: "NotFoundError" })),
      null,
    );
    const id = readAudioDeviceId({
      getAudioTracks: () => [{ getSettings: () => ({ deviceId: "built-in" }) }],
    });
    assert.equal(id, "built-in");
    assert.equal(readAudioDeviceId({ getAudioTracks: () => [] }), null);
  });
});

describe("speak state levels and VAD", () => {
  it("emits levels only while the mic is open and granted, near 50 Hz", () => {
    const h = harness();
    h.speak.begin("speak_button");
    h.speak.pushLevel(LOUD_RMS);
    assert.equal(h.of("mic.level").length, 0);
    h.speak.setPermission("granted", "mic-a");
    h.speak.pushLevel(LOUD_RMS);
    assert.equal(h.of("mic.level").length, 0);
    h.speak.setMicOpen(true);
    h.set(3_000);
    h.speak.pushLevel(LOUD_RMS);
    h.set(3_000 + LEVEL_INTERVAL_MS - 1);
    h.speak.pushLevel(LOUD_RMS);
    h.set(3_000 + LEVEL_INTERVAL_MS);
    h.speak.pushLevel(0.2);
    const levels = h.of("mic.level");
    assert.equal(levels.length, 2);
    assert.ok(levels[0]!.rms_db < 0);
    assert.ok(levels[0]!.vad_prob > 0.7 && levels[0]!.vad_prob <= 1);
    h.speak.setMicOpen(false);
    h.set(4_000);
    h.speak.pushLevel(LOUD_RMS);
    assert.equal(h.of("mic.level").length, 2);
  });

  it("emits speech start and end from local energy", () => {
    const h = harness();
    h.speak.begin("speak_button");
    h.speak.setPermission("granted", "mic-a");
    h.speak.setMicOpen(true);
    h.set(5_000);
    h.speak.pushLevel(LOUD_RMS);
    h.set(5_000 + VAD_START_HOLD_MS);
    h.speak.pushLevel(LOUD_RMS);
    const started = h.of("vad.speech_start");
    assert.equal(started.length, 1);
    assert.equal(started[0]?.duration_ms, VAD_START_HOLD_MS);
    h.set(5_000 + VAD_START_HOLD_MS + 20);
    h.speak.pushLevel(0);
    h.set(5_000 + VAD_START_HOLD_MS + 20 + VAD_END_HOLD_MS);
    h.speak.pushLevel(0);
    const ended = h.of("vad.speech_end");
    assert.equal(ended.length, 1);
    assert.ok((ended[0]?.duration_ms ?? 0) >= VAD_END_HOLD_MS);
  });
});

describe("speak state echo gating and manual barge-in", () => {
  it("ignores echo and short spikes, then barges in on sustained speech after the guard", () => {
    const h = harness();
    h.speak.begin("speak_button");
    h.speak.setPermission("granted", "mic-a");
    h.speak.setMicOpen(true);
    h.set(10_000);
    h.speak.ingest({ type: "tts.start", utterance_id: "utt-1" });
    assert.ok(vadProbFromLinearRms(ECHO_RMS) < 0.72);

    h.set(10_050);
    h.speak.pushLevel(LOUD_RMS);
    h.set(10_050 + TTS_VAD_SUSTAIN_MS);
    h.speak.pushLevel(LOUD_RMS);
    assert.equal(h.of("vad.speech_start").length, 1);
    assert.equal(h.of("bargein").length, 0);

    h.set(10_000 + BARGE_IN_ECHO_GUARD_MS);
    h.speak.pushLevel(LOUD_RMS);
    const barges = h.of("bargein");
    assert.equal(barges.length, 1);
    assert.equal(barges[0]?.source, "vad");
    assert.equal(barges[0]?.tts_utterance_id, "utt-1");
    assert.equal(barges[0]?.session_id, h.speak.session_id);
  });

  it("does not treat TTS echo or a short loud burst as barge-in", () => {
    const echo = harness();
    echo.speak.begin("speak_button");
    echo.speak.setPermission("granted", "mic-a");
    echo.speak.setMicOpen(true);
    echo.set(15_000);
    echo.speak.ingest({ type: "tts.start", utterance_id: "utt-echo" });
    echo.set(15_200);
    echo.speak.pushLevel(ECHO_RMS);
    echo.set(16_500);
    echo.speak.pushLevel(ECHO_RMS);
    assert.equal(echo.of("vad.speech_start").length, 0);
    assert.equal(echo.of("bargein").length, 0);

    const h = harness();
    h.speak.begin("speak_button");
    h.speak.setPermission("granted", "mic-a");
    h.speak.setMicOpen(true);
    h.set(20_000);
    h.speak.ingest({ type: "tts.start", utterance_id: "utt-2" });
    h.set(20_000 + BARGE_IN_ECHO_GUARD_MS + 50);
    h.speak.pushLevel(LOUD_RMS);
    h.set(20_000 + BARGE_IN_ECHO_GUARD_MS + 50 + TTS_VAD_SUSTAIN_MS - 40);
    h.speak.pushLevel(LOUD_RMS);
    assert.equal(h.of("bargein").length, 0);
  });

  it("fires manual and esc barge-in during the echo guard and with no utterance", () => {
    const h = harness();
    h.speak.begin("speak_button");
    h.set(30_000);
    h.speak.ingest({ type: "tts.start", utterance_id: "utt-3" });
    h.set(30_050);
    h.speak.bargeIn("manual");
    h.speak.bargeIn("esc");
    const during = h.of("bargein");
    assert.deepEqual(
      during.map((event) => event.source),
      ["manual", "esc"],
    );
    assert.ok(during.every((event) => event.tts_utterance_id === "utt-3"));

    h.speak.ingest({ type: "tts.end", utterance_id: "utt-3" });
    h.speak.bargeIn("esc");
    const last = h.of("bargein").at(-1);
    assert.equal(last?.source, "esc");
    assert.equal(last?.tts_utterance_id, null);
  });
});

describe("speak state session continuity", () => {
  it("resumes an open session across a new controller and starts fresh after a clean end", () => {
    const storage = createMemoryStorage();
    const first = harness(storage);
    first.speak.begin("speak_button");
    const previous = first.speak.session_id;
    assert.equal(first.of("pipeline.mode").at(-1)?.mode, "xai_realtime");
    assert.ok(first.of("session.start")[0]?.session_id);

    const reloaded = harness(storage);
    reloaded.speak.begin("reload");
    const resume = reloaded.of("session.resume");
    assert.equal(resume.length, 1);
    assert.equal(resume[0]?.prev_session_id, previous);
    assert.equal(resume[0]?.reason, "reload");
    reloaded.speak.end("user");

    const again = harness(storage);
    again.speak.begin("speak_button");
    assert.equal(again.of("session.start").length, 1);
    assert.equal(again.of("session.resume").length, 0);
    assert.equal(again.of("session.start")[0]?.prev_session_id, undefined);
  });

  it("resumes after an in-page reconnect", () => {
    const h = harness();
    h.speak.begin("speak_button");
    const previous = h.speak.session_id;
    h.speak.armResume("reconnect");
    h.set(4_000);
    h.speak.begin("reconnect");
    const resume = h.of("session.resume");
    assert.equal(resume.length, 1);
    assert.equal(resume[0]?.prev_session_id, previous);
    assert.equal(resume[0]?.reason, "reconnect");
    assert.notEqual(h.speak.session_id, previous);
  });

  it("keeps ts_ms monotonic when the clock jumps backward and fills pipeline fields", () => {
    const h = harness();
    h.set(500);
    h.speak.begin("speak_button");
    const before = h.events.at(-1)!.ts_ms;
    h.set(10);
    h.speak.ingest({ type: "stt.final", text: "hello", latency_ms: 40 });
    h.speak.ingest({ type: "pipeline.mode", mode: "whisper_loop" });
    const stamped = h.events.slice(-2);
    assert.ok(stamped[0]!.ts_ms > before);
    assert.ok(stamped[1]!.ts_ms > stamped[0]!.ts_ms);
    assert.equal(stamped[0]?.type, "stt.final");
    if (stamped[0]?.type === "stt.final") {
      assert.equal(stamped[0].text, "hello");
      assert.equal(stamped[0].latency_ms, 40);
      assert.equal(stamped[0].session_id, h.speak.session_id);
    }
    assert.equal(h.speak.pipelineMode, "whisper_loop");
  });
});
