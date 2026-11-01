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

/** Stub output that stays "playing" until end() is called. */
class StickyOutput extends SharedAudioOutput {
  private stuck = false;
  private ended: (() => void) | null = null;
  override get isPlaying() {
    return this.stuck;
  }
  override setEndedListener(listener: (() => void) | null) {
    this.ended = listener;
  }
  override async playPcm16Base64() {
    this.stuck = true;
  }
  override interrupt() {
    this.stuck = false;
    this.ended = null;
  }
  end() {
    this.stuck = false;
    this.ended?.();
  }
}

describe("speaking until playback ends", () => {
  it("stays Speaking after response.done while local audio is still playing", async () => {
    let created: FakeSocket | undefined;
    const output = new StickyOutput();
    const statuses: string[] = [];
    const session = new RealtimeVoiceSession(
      { onStatus: (s) => statuses.push(s) },
      output,
      (_url, _protocols) => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test", { captureOnly: true });
    const socket = created as FakeSocket;
    session.speakText("Hello there.");
    assert.ok(statuses.includes("speaking"));
    // Simulate PCM chunk then server done while local buffer still draining.
    socket.emitMessage({
      type: "response.output_audio.delta",
      delta: Buffer.from(new Int16Array(480).buffer).toString("base64"),
    });
    socket.emitMessage({ type: "response.done" });
    assert.equal(statuses.at(-1), "speaking", "must not drop to listening on request end");
    output.end();
    assert.equal(statuses.at(-1), "listening");
    session.close();
  });
});
