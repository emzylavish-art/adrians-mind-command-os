import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveVoiceSession } from "./live-session.ts";
import { LIVE_SCREEN_FRAME_PROMPT } from "./session-context.ts";
import { setLiveVoiceOccupied } from "./occupancy.ts";
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
  }
  openNow() {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) listener(new Event("open"));
  }
}

describe("sendSessionContext vs Ask Anything", () => {
  it("does not emit onUserTranscript for internal frame prompts", async () => {
    setLiveVoiceOccupied(false);
    const transcripts: string[] = [];
    let created: FakeSocket | undefined;
    const session = new LiveVoiceSession(
      { onUserTranscript: (t) => transcripts.push(t) },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        probeMic: async () => ({ ok: true as const }),
        skipMic: true,
        getMode: () => "direct",
        getVoiceId: () => "eve",
        socketFactory: (url) => {
          assert.equal(url, REALTIME_ENDPOINT);
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created;
        },
      },
    );
    await session.start();
    assert.ok(created);
    const before = created!.sent.length;
    assert.equal(session.sendSessionContext(LIVE_SCREEN_FRAME_PROMPT), true);
    assert.deepEqual(transcripts, []);
    // sendText with internal prompt also stays out of transcript callback
    assert.equal(session.sendText(LIVE_SCREEN_FRAME_PROMPT), true);
    assert.deepEqual(transcripts, []);
    const after = created!.sent.slice(before).map((l) => JSON.parse(l) as { type?: string });
    assert.ok(after.some((m) => m.type === "conversation.item.create"));
    assert.ok(after.some((m) => m.type === "response.create"));
    // Real user text still notifies
    assert.equal(session.sendText("hello from user"), true);
    assert.deepEqual(transcripts, ["hello from user"]);
    session.end();
    setLiveVoiceOccupied(false);
  });
});
