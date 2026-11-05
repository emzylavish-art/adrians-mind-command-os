import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveVoiceSession } from "./live-session.ts";
import type { SpeakEvent } from "../voice/speak-state/index.ts";
import { SharedAudioOutput } from "../voice/audio-output.ts";
import { isLiveVoiceOccupied, setLiveVoiceOccupied } from "./occupancy.ts";
import { REALTIME_ENDPOINT } from "../voice/realtime-session.ts";

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

const okProbe = async () => ({ ok: true as const });

describe("LiveVoiceSession", () => {
  it("single-flight refuses overlapping start", async () => {
    setLiveVoiceOccupied(false);
    let mintCount = 0;
    let created: FakeSocket | undefined;
    const session = new LiveVoiceSession(
      {},
      {
        mintSecret: async () => {
          mintCount += 1;
          await new Promise((r) => setTimeout(r, 50));
          return { ok: true, value: "tok", expiresAt: Date.now() + 60_000 };
        },
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created;
        },
      },
    );
    const a = session.start();
    const b = session.start();
    await Promise.allSettled([a, b]);
    assert.equal(mintCount, 1);
    session.end();
    setLiveVoiceOccupied(false);
  });

  it("barge-in mid-delta sends response.cancel", async () => {
    setLiveVoiceOccupied(false);
    const output = new SharedAudioOutput();
    let created: FakeSocket | undefined;
    const phases: string[] = [];
    let now = 10_000;
    const session = new LiveVoiceSession(
      { onState: (s) => phases.push(s.phase) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        output,
        probeMic: okProbe,
        skipMic: true,
        now: () => now,
        socketFactory: (url, protocols) => {
          assert.equal(url, REALTIME_ENDPOINT);
          assert.deepEqual(protocols, ["xai-client-secret.ephemeral"]);
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created;
        },
      },
    );
    await session.start();
    assert.ok(created);
    // Avoid SharedAudioOutput (no AudioContext in node): mark assistant playing via delta then jump past echo guard.
    const silent = Buffer.alloc(320).toString("base64");
    created!.emitMessage({ type: "response.output_audio.delta", delta: silent });
    now += 1000; // past BARGE_IN_ECHO_GUARD_MS
    created!.emitMessage({ type: "input_audio_buffer.speech_started" });
    assert.ok(created!.sent.some((line) => line.includes("response.cancel")));
    assert.ok(
      phases.includes("interrupted") ||
        phases.includes("user_speaking") ||
        phases.includes("assistant_speaking"),
    );
    session.end();
    setLiveVoiceOccupied(false);
  });

  it("refuses start when overlay mic is open", async () => {
    setLiveVoiceOccupied(false);
    const errors: string[] = [];
    const session = new LiveVoiceSession(
      { onError: (m) => errors.push(m) },
      {
        mintSecret: async () => ({ ok: true, value: "x", expiresAt: 0 }),
        isOverlayMicOpen: () => true,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
      },
    );
    await session.start();
    assert.ok(errors.some((e) => /overlay mic/i.test(e)));
    assert.equal(isLiveVoiceOccupied(), false);
  });

  it("reconnect gives up after max attempts", async () => {
    setLiveVoiceOccupied(false);
    const errors: string[] = [];
    let created: FakeSocket | undefined;
    const session = new LiveVoiceSession(
      { onError: (e) => errors.push(e) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    await session.start();
    assert.ok(created);
    (session as unknown as { reconnectAttempt: number }).reconnectAttempt = 3;
    (session as unknown as { intentionalClose: boolean }).intentionalClose = false;
    created!.close();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(errors.some((e) => /reconnect/i.test(e)));
    session.end();
    setLiveVoiceOccupied(false);
  });

  it("End mid-connect aborts pending mint and returns to off", async () => {
    setLiveVoiceOccupied(false);
    const phases: string[] = [];
    let mintStarted = false;
    let mintAborted = false;
    const session = new LiveVoiceSession(
      { onState: (s) => phases.push(`${s.phase}`) },
      {
        mintSecret: async (signal) => {
          mintStarted = true;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => resolve(), 5_000);
            signal?.addEventListener(
              "abort",
              () => {
                mintAborted = true;
                clearTimeout(timer);
                reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
              },
              { once: true },
            );
          });
          return { ok: true, value: "late", expiresAt: Date.now() + 60_000 };
        },
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        socketFactory: () => new FakeSocket(),
      },
    );
    const startP = session.start();
    for (let i = 0; i < 50 && !mintStarted; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(session.state.phase, "connecting");
    session.end("canceled");
    assert.equal(session.state.phase, "off");
    await Promise.allSettled([startP]);
    assert.equal(mintAborted, true);
    assert.equal(session.state.phase, "off");
    assert.ok(phases.includes("connecting"));
    assert.equal(phases.at(-1), "off");
    setLiveVoiceOccupied(false);
  });

  it("timeout-to-error when mic probe throws ConnectTimeoutError", async () => {
    setLiveVoiceOccupied(false);
    const { ConnectTimeoutError } = await import("./connect-timeout.ts");
    const errors: string[] = [];
    const session = new LiveVoiceSession(
      { onError: (m) => errors.push(m) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: async () => {
          throw new ConnectTimeoutError(
            "mic",
            "Microphone did not respond in time. Check permissions or connect a mic, then try again.",
          );
        },
        skipMic: true,
      },
    );
    await session.start();
    assert.ok(errors.some((e) => /Microphone did not respond/i.test(e)));
    await new Promise((r) => setTimeout(r, 80)); // fail() settles error → off
    assert.equal(session.state.phase, "off");
    setLiveVoiceOccupied(false);
  });

  it("pressMic while connecting cancels instead of stacking starts", async () => {
    setLiveVoiceOccupied(false);
    let mintCount = 0;
    const session = new LiveVoiceSession(
      {},
      {
        mintSecret: async (signal) => {
          mintCount += 1;
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 2_000);
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
              },
              { once: true },
            );
          });
          return { ok: true, value: "x", expiresAt: Date.now() + 60_000 };
        },
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        socketFactory: () => new FakeSocket(),
      },
    );
    const p = session.pressMic();
    for (let i = 0; i < 50 && session.state.phase !== "connecting"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(session.state.phase, "connecting");
    // Wait until mint begins (connecting is set before mint).
    for (let i = 0; i < 50 && mintCount < 1; i++) await new Promise((r) => setTimeout(r, 10));
    await session.pressMic(); // cancel
    await Promise.allSettled([p]);
    assert.equal(session.state.phase, "off");
    assert.ok(mintCount <= 1);
    setLiveVoiceOccupied(false);
  });

  it("accepts user transcript and ignores empty/garbage via dedupe path", async () => {
    setLiveVoiceOccupied(false);
    const users: string[] = [];
    let created: FakeSocket | undefined;
    const session = new LiveVoiceSession(
      { onUserTranscript: (t) => users.push(t) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    await session.start();
    created!.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "   ",
    });
    created!.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello live",
    });
    created!.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello live",
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(users, ["hello live"]);
    session.end();
    setLiveVoiceOccupied(false);
  });

  it("publishes speak-state session, xai_realtime mode, and vad barge-in", async () => {
    setLiveVoiceOccupied(false);
    let created: FakeSocket | undefined;
    let now = 20_000;
    const events: SpeakEvent[] = [];
    const session = new LiveVoiceSession(
      {},
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        now: () => now,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    session.speakState.bus.subscribe((event) => events.push(event));
    await session.start();
    const silent = Buffer.alloc(320).toString("base64");
    created!.emitMessage({ type: "response.output_audio.delta", delta: silent });
    now += 1_000;
    created!.emitMessage({ type: "input_audio_buffer.speech_started" });
    session.requestBargeIn("manual");
    session.requestBargeIn("esc");
    assert.ok(
      events.some((event) => event.type === "session.start" || event.type === "session.resume"),
    );
    assert.ok(
      events.some((event) => event.type === "pipeline.mode" && event.mode === "xai_realtime"),
    );
    assert.ok(events.some((event) => event.type === "tts.start"));
    const vad = events.find((event) => event.type === "bargein" && event.source === "vad");
    assert.ok(vad && vad.type === "bargein" && vad.tts_utterance_id);
    assert.equal(vad.session_id.length > 0, true);
    assert.ok(events.some((event) => event.type === "bargein" && event.source === "manual"));
    assert.ok(events.some((event) => event.type === "bargein" && event.source === "esc"));
    assert.ok(created!.sent.some((line) => line.includes("response.cancel")));
    session.end();
    assert.ok(events.some((event) => event.type === "session.end" && event.reason === "user"));
    setLiveVoiceOccupied(false);
  });

  it("does not emit vad barge-in inside the 400ms echo guard", async () => {
    setLiveVoiceOccupied(false);
    let created: FakeSocket | undefined;
    let now = 8_000;
    const events: SpeakEvent[] = [];
    const session = new LiveVoiceSession(
      {},
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        now: () => now,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    session.speakState.bus.subscribe((event) => events.push(event));
    await session.start();
    const silent = Buffer.alloc(320).toString("base64");
    created!.emitMessage({ type: "response.output_audio.delta", delta: silent });
    now += 100;
    created!.emitMessage({ type: "input_audio_buffer.speech_started" });
    assert.equal(
      events.some((event) => event.type === "bargein"),
      false,
    );
    assert.equal(
      created!.sent.some((line) => line.includes("response.cancel")),
      false,
    );
    session.end();
    setLiveVoiceOccupied(false);
  });
});
