import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveVoiceSession } from "./live-session.ts";
import { setLiveVoiceOccupied } from "./occupancy.ts";
import { setActiveBuildSessionId } from "./active-build-session.ts";
import { BUILD_STEER_DEBOUNCE_MS } from "./build-steer-debounce.ts";

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

describe("LiveVoiceSession build steer (N4)", () => {
  it("final transcript steers active build instead of Orchestrator speak", async () => {
    setLiveVoiceOccupied(false);
    setActiveBuildSessionId(null);
    let created: FakeSocket | undefined;
    const notices: string[] = [];
    const assistants: string[] = [];
    const steers: Array<{ id: string; text: string }> = [];
    let conductorCalls = 0;

    const session = new LiveVoiceSession(
      {
        onNotice: (n) => notices.push(n),
        onAssistantTranscript: (t) => assistants.push(t),
      },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "orchestrator",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        getActiveBuildId: () => "bs_live",
        steerBuild: async ({ id, text }) => {
          steers.push({ id, text });
          return { ok: true, session: { id, status: "running", pendingSteerCount: 1 }, steered: true };
        },
        runConductor: async () => {
          conductorCalls += 1;
          return { ok: true, text: "should not speak", model: "x" };
        },
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );

    await session.start();
    created!.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "make the button blue",
    });
    await new Promise((r) => setTimeout(r, BUILD_STEER_DEBOUNCE_MS + 80));
    assert.deepEqual(steers, [{ id: "bs_live", text: "make the button blue" }]);
    assert.equal(conductorCalls, 0);
    assert.equal(assistants.length, 0);
    assert.equal(session.state.steeringBuild, true);
    assert.ok(notices.some((n) => /Steering build/i.test(n)));
    assert.ok(!created!.sent.some((l) => l.includes("force_message")));
    session.end();
    setLiveVoiceOccupied(false);
    setActiveBuildSessionId(null);
  });

  it("falls back to Direct path when steer says clearActive", async () => {
    setLiveVoiceOccupied(false);
    let created: FakeSocket | undefined;
    const notices: string[] = [];
    const session = new LiveVoiceSession(
      { onNotice: (n) => notices.push(n) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        getActiveBuildId: () => "bs_gone",
        steerBuild: async () => ({
          ok: false,
          error: "That build session was not found. Voice will use Direct/Orchestrator instead.",
          httpStatus: 404,
          clearActive: true,
          fallback: true,
        }),
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    await session.start();
    created!.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello after build",
    });
    await new Promise((r) => setTimeout(r, BUILD_STEER_DEBOUNCE_MS + 80));
    assert.ok(notices.some((n) => /not found|Direct\/Orchestrator/i.test(n)));
    // Direct: no force_message; phase moves thinking/listening
    assert.ok(!created!.sent.some((l) => l.includes("force_message")));
    session.end();
    setLiveVoiceOccupied(false);
    setActiveBuildSessionId(null);
  });

  it("keeps barge-in working while a build id is active", async () => {
    setLiveVoiceOccupied(false);
    let created: FakeSocket | undefined;
    let now = 10_000;
    let interrupted = 0;
    const session = new LiveVoiceSession(
      {},
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        getActiveBuildId: () => "bs_live",
        now: () => now,
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );
    await session.start();
    const silent = Buffer.alloc(320).toString("base64");
    created!.emitMessage({ type: "response.output_audio.delta", delta: silent });
    const speaker = session.speaker;
    const orig = speaker.interrupt.bind(speaker);
    speaker.interrupt = () => {
      interrupted += 1;
      orig();
    };
    now += 1000;
    created!.emitMessage({ type: "input_audio_buffer.speech_started" });
    assert.ok(interrupted >= 1);
    assert.ok(created!.sent.some((l) => l.includes("response.cancel")));
    session.end();
    setLiveVoiceOccupied(false);
  });
});
