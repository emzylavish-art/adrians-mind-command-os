import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_VOICES,
  prioritizeVoices,
  readStoredMute,
  writeStoredMute,
  createHealthSound,
  SOUND_STORAGE_KEY,
} from "./health-sound.ts";

describe("health-sound (hacker + queue #4)", () => {
  it("prioritizeVoices caps, dedupes, drops idle, prefers blocked", () => {
    const many: Array<{ id: string; health: "healthy" | "stalled" | "blocked" | "idle" }> = Array.from({ length: 30 }, (_, i) => ({
      id: `b${i}`,
      health: i % 3 === 0 ? "healthy" : i % 3 === 1 ? "stalled" : "blocked",
    }));
    many.push({ id: "b1", health: "healthy" }); // dup
    many.push({ id: "idle1", health: "idle" });
    const picked = prioritizeVoices(many, MAX_VOICES);
    assert.ok(picked.length <= MAX_VOICES);
    assert.equal(new Set(picked.map((p) => p.id)).size, picked.length);
    assert.ok(picked.every((p) => p.health !== "idle"));
    assert.equal(picked[0]!.health, "blocked");
  });

  it("mute defaults true and persists via storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
    };
    assert.equal(readStoredMute(storage), true);
    writeStoredMute(storage, false);
    assert.equal(mem.get(SOUND_STORAGE_KEY), "0");
    assert.equal(readStoredMute(storage), false);
  });

  it("stays silent until unlock; dispose is idempotent; sync with garbage is safe", () => {
    const sound = createHealthSound({
      storage: null,
      muted: true,
      contextFactory: () => {
        throw new Error("AudioContext must not construct while muted/locked in this test");
      },
    });
    sound.sync([
      { id: "a", health: "healthy" },
      { id: "", health: "blocked" } as never,
      { id: "b", health: "purple" as never },
    ]);
    assert.equal(sound.unlocked, false);
    // muted+locked: unlock would create context — use a fake instead
    const fakeNodes: Array<{ stop: () => void; connect: () => void; disconnect: () => void; start: () => void; frequency: { value: number }; type: string }> = [];
    const fakeCtx = {
      currentTime: 0,
      state: "running",
      destination: {},
      createGain() {
        const g = { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() { return g; }, disconnect() {} };
        return g;
      },
      createOscillator() {
        const o = { type: "sine", frequency: { value: 0 }, connect() { return o; }, start() {}, stop() {}, disconnect() {} };
        fakeNodes.push(o as never);
        return o;
      },
      createStereoPanner() {
        const p = { pan: { value: 0 }, connect() { return p; }, disconnect() {} };
        return p;
      },
      resume: async () => {},
      suspend: async () => {},
      close: async () => {},
    };
    const s2 = createHealthSound({
      storage: null,
      muted: false,
      contextFactory: () => fakeCtx as unknown as AudioContext,
    });
    s2.unlock();
    assert.equal(s2.unlocked, true);
    s2.sync(Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, health: "healthy" as const })));
    s2.setHidden(true);
    s2.setHidden(false);
    s2.setReducedMotion(true);
    s2.setMuted(true);
    s2.dispose();
    s2.dispose();
    assert.ok(true);
  });
});
