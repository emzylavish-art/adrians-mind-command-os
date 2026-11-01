import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveVoiceSession } from "./live-session.ts";
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
    assert.ok(phases.includes("interrupted") || phases.includes("user_speaking") || phases.includes("assistant_speaking"));
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
    created!.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "   " });
    created!.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello live" });
    created!.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello live" });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(users, ["hello live"]);
    session.end();
    setLiveVoiceOccupied(false);
  });
});
