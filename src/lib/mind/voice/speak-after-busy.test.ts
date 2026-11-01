import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RealtimeVoiceSession, REALTIME_ENDPOINT } from "./realtime-session.ts";


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

function forceMessages(sent: string[]): unknown[] {
  return sent
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((msg) => msg && msg.type === "conversation.item.create" && msg.item?.type === "force_message");
}

describe("Direct testAudio speak regression", () => {
  it("transcript → speakText while captureOnly busy → Speaking after response.done", async () => {
    let created: FakeSocket | undefined;
    const statuses: string[] = [];
    const transcripts: string[] = [];
    const stubOutput = {
      interrupt() {},
      async playPcm16Base64() {},
      get isPlaying() { return false; },
    };
    const session = new RealtimeVoiceSession(
      {
        onStatus: (s) => statuses.push(s),
        onTranscript: (t) => transcripts.push(t),
      },
      stubOutput as never,
      (url) => {
        assert.equal(url, REALTIME_ENDPOINT);
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test", { captureOnly: true, testAudioKind: "hello" });
    const socket = created as FakeSocket;

    socket.emitMessage({ type: "response.created" });
    assert.ok(socket.sent.some((l) => l.includes("response.cancel")));

    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello",
    });
    assert.deepEqual(transcripts, ["hello"]);
    session.speakText("It is about noon.");
    assert.equal(forceMessages(socket.sent).length, 0, "must not force_message while responseBusy");

    socket.emitMessage({ type: "response.done" });
    const forced = forceMessages(socket.sent);
    assert.equal(forced.length, 1);
    assert.match(JSON.stringify(forced[0]), /noon/);

    socket.emitMessage({ type: "response.output_audio.delta", delta: Buffer.alloc(16).toString("base64") });
    assert.ok(statuses.includes("speaking"), `statuses=${statuses.join(",")}`);
    session.close();
  });
});
