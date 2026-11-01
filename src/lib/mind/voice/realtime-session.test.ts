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
  it("connects with ephemeral protocol, cancels auto replies in captureOnly, and speaks after idle", async () => {
    let created: FakeSocket | undefined;
    const output = new SharedAudioOutput();
    const transcripts: string[] = [];
    const levels: number[] = [];
    const session = new RealtimeVoiceSession(
      {
        onTranscript: (text) => transcripts.push(text),
        onLevel: (level) => levels.push(level),
      },
      output,
      (url, protocols) => {
        assert.equal(url, REALTIME_ENDPOINT);
        assert.deepEqual(protocols, ["xai-client-secret.ephemeral-test"]);
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test", { captureOnly: true });
    assert.equal(session.isOpen, true);
    assert.ok(created);
    const socket = created as FakeSocket;
    assert.ok(socket.sent.some((line: string) => line.includes("session.update")));
    socket.emitMessage({ type: "response.created" });
    assert.ok(socket.sent.some((line: string) => line.includes("response.cancel")));
    socket.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello world" });
    assert.deepEqual(transcripts, ["hello world"]);
    socket.emitMessage({ type: "response.done" });
    session.speakText("Heard you.");
    assert.ok(socket.sent.some((line: string) => line.includes("force_message") && line.includes("Heard you.")));
    session.setMuted(true);
    assert.equal(session.isMuted, true);
    session.interruptPlayback();
    assert.ok(socket.sent.filter((line: string) => line.includes("response.cancel")).length >= 1);
    session.close();
  });
});
