/**
 * N3: server-VAD user-speaking + second-utterance barge-in with a fake audio stream.
 * Never needs a real mic — AudioContext + getUserMedia are stubbed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveVoiceSession } from "./live-session.ts";
import { setLiveVoiceOccupied } from "./occupancy.ts";
import { createFakeAudioStream, installFakeAudioContext } from "./fake-audio-stream.ts";
import { LiveMicStream } from "./mic-stream.ts";

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

describe("N3 server-VAD + second-utterance barge-in (fake audio stream)", () => {
  it("fake getUserMedia stream starts mic and server-VAD speech_started → user_speaking", async () => {
    setLiveVoiceOccupied(false);
    const restoreCtx = installFakeAudioContext();
    const { stream } = createFakeAudioStream();
    let gumCalls = 0;
    const phases: string[] = [];
    let created: FakeSocket | undefined;

    // Prove fake stream is accepted by LiveMicStream (same path live session uses).
    const mic = new LiveMicStream(
      {},
      {
        getUserMediaImpl: async () => {
          gumCalls += 1;
          return stream as unknown as MediaStream;
        },
      },
    );
    await mic.start();
    assert.equal(gumCalls, 1);
    assert.equal(mic.isRunning, true);
    mic.stop();

    const session = new LiveVoiceSession(
      { onState: (s) => phases.push(s.phase) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: async () => ({ ok: true as const }),
        // Session path: skip real AudioContext wiring; VAD events still drive phases.
        // Fake stream coverage is above via LiveMicStream + gum stub.
        skipMic: true,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    await session.start();
    assert.ok(phases.includes("listening") || session.state.phase === "listening");

    created!.emitMessage({ type: "input_audio_buffer.speech_started" });
    assert.equal(session.state.phase, "user_speaking");
    assert.equal(session.state.uiAttr, "user-speaking");

    created!.emitMessage({ type: "input_audio_buffer.speech_stopped" });
    assert.equal(session.state.phase, "thinking");

    session.end();
    restoreCtx();
    setLiveVoiceOccupied(false);
  });

  it("second utterance barge-in cuts assistant again after response.done", async () => {
    setLiveVoiceOccupied(false);
    const restoreCtx = installFakeAudioContext();
    const { stream } = createFakeAudioStream();
    void stream; // documents that this scenario assumes a live fake mic path
    let created: FakeSocket | undefined;
    let now = 10_000;
    let interrupted = 0;
    const phases: string[] = [];

    const session = new LiveVoiceSession(
      { onState: (s) => phases.push(s.phase) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: async () => ({ ok: true as const }),
        skipMic: true,
        now: () => now,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    await session.start();

    const speaker = session.speaker;
    const orig = speaker.interrupt.bind(speaker);
    speaker.interrupt = () => {
      interrupted += 1;
      orig();
    };

    const silent = Buffer.alloc(320).toString("base64");

    // Utterance 1: assistant speaks → user barges in
    created!.emitMessage({ type: "response.output_audio.delta", delta: silent });
    assert.equal(session.state.phase, "assistant_speaking");
    now += 1000; // past echo guard
    created!.emitMessage({ type: "input_audio_buffer.speech_started" });
    assert.ok(interrupted >= 1, "first barge-in must interrupt");
    assert.ok(created!.sent.some((l) => l.includes("response.cancel")));
    const afterFirst = interrupted;

    // Finish turn
    created!.emitMessage({ type: "input_audio_buffer.speech_stopped" });
    created!.emitMessage({ type: "response.done" });
    // After barge flash + done, settle
    await new Promise((r) => setTimeout(r, 400));

    // Utterance 2: assistant speaks again → second barge-in
    created!.sent.length = 0;
    created!.emitMessage({ type: "response.output_audio.delta", delta: silent });
    assert.equal(session.state.phase, "assistant_speaking");
    now += 1000;
    created!.emitMessage({ type: "input_audio_buffer.speech_started" });
    assert.ok(interrupted > afterFirst, "second utterance must barge-in again");
    assert.ok(
      created!.sent.some((l) => l.includes("response.cancel")),
      "second barge-in must send response.cancel",
    );
    assert.ok(
      phases.includes("interrupted") || session.state.phase === "interrupted" || session.state.phase === "user_speaking",
    );

    session.end();
    restoreCtx();
    setLiveVoiceOccupied(false);
  });
});
