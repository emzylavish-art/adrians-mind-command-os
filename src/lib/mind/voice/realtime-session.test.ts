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
    const partials: string[] = [];
    const statuses: string[] = [];
    const session = new RealtimeVoiceSession(
      {
        onStatus: (status) => statuses.push(status),
        onTranscript: (text) => transcripts.push(text),
        onPartialTranscript: (text) => partials.push(text),
        onAssistantTranscript: (text) => transcripts.push(`assistant:${text}`),
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
    await session.connect("ephemeral-test");
    assert.equal(session.isOpen, true);
    assert.deepEqual(statuses, ["connecting"], "Opening a socket alone does not establish microphone capture");
    assert.ok(created);
    const socket = created as FakeSocket;
    assert.ok(socket.sent.some((line: string) => line.includes("session.update")));
    socket.emitMessage({ type: "conversation.item.input_audio_transcription.updated", transcript: "hello word" });
    socket.emitMessage({ type: "conversation.item.input_audio_transcription.updated", transcript: "hello world" });
    assert.deepEqual(partials, ["hello word", "hello world"]);
    assert.deepEqual(transcripts, []);
    socket.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello world" });
    assert.deepEqual(transcripts, ["hello world"]);
    socket.emitMessage({ type: "response.output_audio_transcript.delta", delta: "Ready " });
    socket.emitMessage({ type: "response.output_audio_transcript.done", transcript: "Ready now." });
    assert.deepEqual(transcripts, ["hello world", "assistant:Ready now."]);
    session.interruptPlayback();
    assert.equal(socket.sent.some((line: string) => line.includes("response.cancel")), false);
    socket.emitMessage({ type: "response.created" });
    session.interruptPlayback();
    assert.ok(socket.sent.some((line: string) => line.includes("response.cancel")));
    session.close();
    socket.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "late" });
    assert.deepEqual(transcripts, ["hello world", "assistant:Ready now."]);
  });

  it("in local orchestration transcribes input and suppresses the native answer", async () => {
    const socket = new FakeSocket();
    const heard: string[] = [];
    const output = new SharedAudioOutput();
    let played = 0;
    output.playPcm16Base64 = async () => { played++; };
    const session = new RealtimeVoiceSession({
      onTranscript: (text) => heard.push(text),
      onAssistantTranscript: () => assert.fail("Native voice must not duplicate the conductor reply"),
    }, output, () => { queueMicrotask(() => socket.openNow()); return socket; }, { transcriptOnly: true });
    await session.connect("test-token");
    socket.emitMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hello" });
    socket.emitMessage({ type: "response.created" });
    socket.emitMessage({ type: "response.output_audio.delta", delta: "AA==" });
    socket.emitMessage({ type: "response.output_audio_transcript.done", transcript: "A duplicate" });
    assert.deepEqual(heard, ["Hello"]);
    assert.equal(played, 0);
    assert.equal(socket.sent.filter((value) => JSON.parse(value).type === "response.cancel").length, 1);
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
    assert.ok(update!.includes('"transcription"'), update);
    assert.ok(update!.includes("grok-transcribe"), update);
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
    const grants: Array<(stream: MediaStream) => void> = [];
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
      () => new Promise<MediaStream>((resolve) => { grants.push(resolve); }),
    );
    await session.connect("ephemeral-test");
    const capture = session.startCapture();
    assert.equal(grants.length, 1);
    session.stopCapture();
    const secondCapture = session.startCapture();
    assert.equal(grants.length, 2, "stop should allow a fresh explicit capture request");
    session.close();
    for (const grant of grants) {
      grant({ getTracks: () => [{ stop: () => { stopped += 1; } }] } as unknown as MediaStream);
    }
    await Promise.all([capture, secondCapture]);
    assert.equal(stopped, 2);
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
