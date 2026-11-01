import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveVoiceInstructionsForMode, shouldSpeakOrchestratorResult } from "./mode-routing.ts";
import { getVoiceMode, setVoiceModeStore } from "../voice/mode-store.ts";
import { toggleVoiceMode } from "../voice/mode.ts";
import { LiveVoiceSession } from "./live-session.ts";
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
    for (const listener of this.listeners.get("close") ?? []) listener(new Event("close"));
  }
  openNow() {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) listener(new Event("open"));
  }
}

const okProbe = async () => ({ ok: true as const });

describe("voice mode badge / routing attacker pass", () => {
  it("rapid toggle ends on the mode the store reports", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    let mode = setVoiceModeStore("direct", storage);
    for (let i = 0; i < 21; i++) mode = setVoiceModeStore(toggleVoiceMode(mode), storage);
    assert.equal(mode, "orchestrator");
    assert.equal(getVoiceMode(), "orchestrator");
    mode = setVoiceModeStore(toggleVoiceMode(mode), storage);
    assert.equal(mode, "direct");
    assert.equal(getVoiceMode(), "direct");
  });

  it("instructions and late-result gate match the active mode", () => {
    assert.match(liveVoiceInstructionsForMode("orchestrator"), /silent|transcribe/i);
    assert.match(liveVoiceInstructionsForMode("direct"), /helpful|concise/i);
    assert.equal(shouldSpeakOrchestratorResult("orchestrator", true), true);
    assert.equal(shouldSpeakOrchestratorResult("direct", true), false);
    assert.equal(shouldSpeakOrchestratorResult("orchestrator", false), false);
  });

  it("notifyModeChange while live cuts audio path (cancel) and matches next routing mode", async () => {
    setLiveVoiceOccupied(false);
    let mode: "direct" | "orchestrator" = "direct";
    let created: FakeSocket | undefined;
    const session = new LiveVoiceSession(
      {},
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => mode,
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        socketFactory: (url, protocols) => {
          assert.equal(url, REALTIME_ENDPOINT);
          assert.deepEqual(protocols, ["xai-client-secret.ephemeral"]);
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created;
        },
      },
    );
    await session.start();
    assert.ok(created);
    assert.equal(session.state.modeBadge, "Direct");

    const before = created!.sent.length;
    mode = "orchestrator";
    session.notifyModeChange();
    const after = created!.sent.slice(before).map((line) => JSON.parse(line) as {
      type?: string;
      session?: { instructions?: string };
    });
    assert.ok(after.some((m) => m.type === "response.cancel"), "must cancel playing response");
    const update = after.find((m) => m.type === "session.update");
    assert.ok(update, "must refresh session instructions");
    assert.match(update!.session?.instructions || "", /silent|transcribe/i);
    assert.equal(session.state.modeBadge, "Orchestrator");

    mode = "direct";
    session.notifyModeChange();
    assert.equal(session.state.modeBadge, "Direct");
    session.end();
    setLiveVoiceOccupied(false);
  });

  it("toggle while connecting updates badge without throwing", () => {
    setLiveVoiceOccupied(false);
    let mode: "direct" | "orchestrator" = "direct";
    const session = new LiveVoiceSession(
      {},
      {
        mintSecret: async () => {
          await new Promise(() => {});
          return { ok: true, value: "x", expiresAt: 0 };
        },
        getMode: () => mode,
        probeMic: async () => {
          await new Promise(() => {});
          return { ok: true as const };
        },
        skipMic: true,
      },
    );
    void session.start();
    mode = "orchestrator";
    assert.doesNotThrow(() => session.notifyModeChange());
    assert.equal(session.state.modeBadge, "Orchestrator");
    session.end();
    setLiveVoiceOccupied(false);
  });
});
