import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RealtimeVoiceSession, REALTIME_ENDPOINT } from "./realtime-session.ts";
import { SharedAudioOutput } from "./audio-output.ts";

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

describe("RealtimeVoiceSession", () => {
  it("connects with ephemeral protocol and cancels on interrupt", async () => {
    let created: FakeSocket | undefined;
    const output = new SharedAudioOutput();
    const transcripts: string[] = [];
    const session = new RealtimeVoiceSession(
      { onTranscript: (text) => transcripts.push(text) },
      output,
      (url, protocols) => {
        assert.equal(url, REALTIME_ENDPOINT);
        assert.deepEqual(protocols, ["xai-client-secret.ephemeral-test"]);
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test");
    assert.equal(session.isOpen, true);
    assert.ok(created);
    const socket = created as FakeSocket;
    assert.ok(socket.sent.some((line: string) => line.includes("session.update")));
    socket.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello world" });
    assert.deepEqual(transcripts, ["hello world"]);
    session.interruptPlayback();
    assert.ok(socket.sent.some((line: string) => line.includes("response.cancel")));
    session.close();
  });

  it("session.update uses allowlisted voice (corrupt falls back to eve)", async () => {
    let created: FakeSocket | undefined;
    const session = new RealtimeVoiceSession(
      {},
      new SharedAudioOutput(),
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
      { voice: "not-a-real-voice" },
    );
    await session.connect("ephemeral-test");
    const update = created!.sent.find((line) => line.includes("session.update"));
    assert.ok(update);
    assert.ok(update!.includes('"voice":"eve"'), update);
    session.close();
  });

  it("setMuted toggles isMuted and clears level", async () => {
    let created: FakeSocket | undefined;
    const levels: number[] = [];
    const session = new RealtimeVoiceSession(
      { onLevel: (level) => levels.push(level) },
      new SharedAudioOutput(),
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test");
    session.setMuted(true);
    assert.equal(session.isMuted, true);
    session.setMuted(false);
    assert.equal(session.isMuted, false);
    session.close();
  });

  it("stops microphone tracks granted after the user ends capture", async () => {
    let created: FakeSocket | undefined;
    let grantMic: ((stream: MediaStream) => void) | undefined;
    let stopped = 0;
    const session = new RealtimeVoiceSession(
      {},
      new SharedAudioOutput(),
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
      {},
      () => new Promise<MediaStream>((resolve) => { grantMic = resolve; }),
    );
    await session.connect("ephemeral-test");
    const capture = session.startCapture();
    assert.equal(typeof grantMic, "function");
    session.close();
    grantMic!({ getTracks: () => [{ stop: () => { stopped += 1; } }] } as unknown as MediaStream);
    await capture;
    assert.equal(stopped, 1);
    assert.equal(session.isCapturing, false);
  });

  it("ignores a permission rejection after the user has ended capture", async () => {
    let created: FakeSocket | undefined;
    let rejectMic: ((error: Error) => void) | undefined;
    const session = new RealtimeVoiceSession(
      {},
      new SharedAudioOutput(),
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
      {},
      () => new Promise<MediaStream>((_resolve, reject) => { rejectMic = reject; }),
    );
    await session.connect("ephemeral-test");
    const capture = session.startCapture();
    session.close();
    rejectMic!(new DOMException("Permission denied", "NotAllowedError"));
    await assert.doesNotReject(capture);
    assert.equal(session.isCapturing, false);
  });
});
