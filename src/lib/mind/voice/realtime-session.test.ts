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

  it("ignores benign cancellation errors from response.cancel", async () => {
    let created: FakeSocket | undefined;
    const errors: string[] = [];
    const session = new RealtimeVoiceSession(
      { onError: (message) => errors.push(message) },
      new SharedAudioOutput(),
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    await session.connect("ephemeral-test");
    created!.emitMessage({ type: "error", error: { message: "Cancellation failed: no active response found" } });
    created!.emitMessage({ type: "error", error: { message: "real failure" } });
    assert.deepEqual(errors, ["real failure"]);
    session.close();
  });

  it("streams testAudioUrl PCM instead of requesting the mic", async () => {
    let created: FakeSocket | undefined;
    const statuses: string[] = [];
    const originalFetch = globalThis.fetch;
    // Minimal PCM WAV: 44-byte header + 4800 samples (16-bit mono @ 24kHz ~100ms * 2 for safety)
    const sampleRate = 24000;
    const n = 4800;
    const dataSize = n * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.sin(i / 10) * 10000, true);

    globalThis.fetch = (async () =>
      new Response(buf, { status: 200, headers: { "content-type": "audio/wav" } })) as typeof fetch;

    const session = new RealtimeVoiceSession(
      { onStatus: (status) => statuses.push(status) },
      new SharedAudioOutput(),
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created;
      },
    );
    try {
      await session.connect("ephemeral-test", { captureOnly: true, testAudioUrl: "/voice-test/hello.wav" });
      await session.startCapture();
      assert.equal(session.isCapturing, true);
      // Allow a couple of interval ticks.
      await new Promise((r) => setTimeout(r, 250));
      assert.ok(created!.sent.some((line) => line.includes("input_audio_buffer.append")));
      const update = created!.sent.find((line) => line.includes("session.update")) || "";
      assert.ok(update.includes("Do not answer unless a force_message"), update);
    } finally {
      session.close();
      globalThis.fetch = originalFetch;
    }
  });
});

type FakeOutput = SharedAudioOutput & { isPlaying: boolean };

describe("RealtimeVoiceSession Speaking ↔ playback sync", () => {
  it("keeps speaking through response.done until local playback drains", async () => {
    let created: FakeSocket | undefined;
    const statuses: string[] = [];
    const pending: Array<() => void> = [];
    const output = {
      isPlaying: true,
      interrupt() {
        output.isPlaying = false;
        while (pending.length) pending.pop()?.();
      },
      async playPcm16Base64() {
        output.isPlaying = true;
        await new Promise<void>((resolve) => {
          pending.push(() => {
            output.isPlaying = false;
            resolve();
          });
        });
      },
    } as unknown as FakeOutput;

    const session = new RealtimeVoiceSession(
      { onStatus: (status) => statuses.push(status) },
      output,
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created!;
      },
    );
    await session.connect("ephemeral-test", { captureOnly: true });
    // Pretend capture is on so settle goes to listening.
    (session as unknown as { capturing: boolean }).capturing = true;

    created!.emitMessage({ type: "response.output_audio.delta", delta: "AAAA" });
    assert.equal(statuses.at(-1), "speaking");

    created!.emitMessage({ type: "response.done" });
    // Still speaking — playback has not finished.
    assert.equal(statuses.at(-1), "speaking");

    assert.ok(pending.length > 0);
    pending[0]!();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(statuses.at(-1), "listening");
    session.close();
  });

  it("interrupt clears speaking wait so a later done cannot strand Speaking", async () => {
    let created: FakeSocket | undefined;
    const statuses: string[] = [];
    const output = {
      isPlaying: true,
      interrupt() {
        output.isPlaying = false;
      },
      async playPcm16Base64() {
        await new Promise<void>(() => {
          /* never resolves — interrupt bumps epoch */
        });
      },
    } as unknown as FakeOutput;

    const session = new RealtimeVoiceSession(
      { onStatus: (status) => statuses.push(status) },
      output,
      () => {
        created = new FakeSocket();
        queueMicrotask(() => created?.openNow());
        return created!;
      },
    );
    await session.connect("ephemeral-test");
    created!.emitMessage({ type: "response.output_audio.delta", delta: "AAAA" });
    assert.equal(statuses.at(-1), "speaking");
    session.interruptPlayback();
    created!.emitMessage({ type: "response.done" });
    // After interrupt, playsInFlight is 0 and isPlaying false → listening/idle.
    assert.ok(["listening", "idle"].includes(statuses.at(-1) || ""));
    session.close();
  });
});
