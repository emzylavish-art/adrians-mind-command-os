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
});
