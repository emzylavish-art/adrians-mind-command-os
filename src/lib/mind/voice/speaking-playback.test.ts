import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RealtimeVoiceSession, REALTIME_ENDPOINT } from "./realtime-session.ts";
import { SharedAudioOutput } from "./audio-output.ts";
import { pcm16MonoDurationMs } from "./voice-chat-turn.ts";

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

  it("does not insert Listening between Thinking and Speaking", async () => {
    let created: FakeSocket | undefined;
    const statuses: string[] = [];
    const output = new StickyOutput();
    const session = new RealtimeVoiceSession(
      {
        onStatus: (s) => statuses.push(s),
        onTranscript: () => {
          session.speakText("It is about noon.");
        },
      },
      output,
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test", { captureOnly: true });
    const socket = created as FakeSocket;
    // Auto-reply busy so speakText queues, then cancel done flushes.
    socket.emitMessage({ type: "response.created" });
    socket.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "What time is it?",
    });
    assert.equal(statuses.includes("processing"), true);
    // Cancel of auto-reply completes — must not leave a Listening gap before Speaking.
    socket.emitMessage({ type: "response.done" });
    const proc = statuses.indexOf("processing");
    const speak = statuses.indexOf("speaking", proc);
    assert.ok(speak > proc, `statuses=${statuses.join(">")}`);
    const slice = statuses.slice(proc, speak + 1);
    assert.equal(slice.includes("listening"), false, `gap in ${slice.join(">")}`);
    session.close();
  });

  it("reports PCM duration matching byte count / sample rate", async () => {
    let created: FakeSocket | undefined;
    let seen: { durationMs: number; pcmBytes: number; sampleRate: number } | null = null;
    const output = new StickyOutput();
    const session = new RealtimeVoiceSession(
      { onReplyAudioDuration: (info) => { seen = info; } },
      output,
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test", { captureOnly: true });
    const socket = created as FakeSocket;
    session.speakText("It is about noon.");
    // 0.8s @ 24kHz mono PCM16 = 38400 bytes
    const bytes = 38400;
    const delta = Buffer.alloc(bytes).toString("base64");
    socket.emitMessage({ type: "response.output_audio.delta", delta });
    socket.emitMessage({ type: "response.done" });
    output.end();
    assert.ok(seen);
    assert.equal(seen!.durationMs, pcm16MonoDurationMs(bytes, 24000));
    assert.equal(seen!.durationMs, 800);
    session.close();
  });
});
