import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock, sharedMotionClock } from "./motion-clock.ts";
import { sampleOrbitDrift } from "./orbit-drift.ts";
import {
  characterPhaseFromId,
  createCharacterMotionState,
  createCharacterSample,
  sampleCharacterIdle,
  stepCharacterMotion,
} from "./character-motion.ts";
import {
  createNodeOpenState,
  createSceneTransitionState,
  createSceneTransitionSample,
  beginSceneTransition,
  stepNodeOpen,
  stepSceneTransition,
} from "./transition-ease.ts";

describe("character-motion", () => {
  it("phase from id is stable and desyncs a crowd", () => {
    const a = characterPhaseFromId("bot:dashboard");
    assert.equal(characterPhaseFromId("bot:dashboard"), a);
    assert.ok(a >= 0 && a < Math.PI * 2);
    assert.notEqual(characterPhaseFromId("bot:painter"), a);
    assert.equal(characterPhaseFromId(""), characterPhaseFromId(null));
  });

  it("idle breathes/bobs; reduced-motion is static pose", () => {
    const clock = createMotionClock();
    const st = createCharacterMotionState();
    const out = createCharacterSample();
    stepCharacterMotion(st, out, "bot:a", 1.0, 1 / 60, false, { speed: 0, clock });
    const y0 = out.offsetY;
    stepCharacterMotion(st, out, "bot:a", 1.4, 1 / 60, false, { speed: 0, clock });
    assert.notEqual(out.offsetY, y0);
    assert.ok(out.scaleY !== 1 || Math.abs(out.offsetY) > 0);
    stepCharacterMotion(st, out, "bot:a", 2, 1 / 60, true, { speed: 0, clock });
    assert.equal(out.offsetY, 0);
    assert.equal(out.scaleY, 1);
    assert.equal(out.loco, 0);
  });

  it("walk cycle produces bounce/sway; start/stop blends loco", () => {
    const clock = createMotionClock();
    const st = createCharacterMotionState();
    const out = createCharacterSample();
    for (let i = 0; i < 90; i++) {
      stepCharacterMotion(st, out, "walker", 10 + i / 60, 1 / 60, false, { speed: 1, clock });
    }
    assert.ok(st.loco > 0.9, `loco ${st.loco}`);
    assert.ok(Math.abs(out.offsetX) > 0 || out.offsetY > 0);
    const locoHi = st.loco;
    for (let i = 0; i < 90; i++) {
      stepCharacterMotion(st, out, "walker", 20 + i / 60, 1 / 60, false, { speed: 0, clock });
    }
    assert.ok(st.loco < 0.1, `stopped loco ${st.loco} from ${locoHi}`);
  });

  it("look-at yaw eases toward target; reduced snaps", () => {
    const st = createCharacterMotionState();
    const out = createCharacterSample();
    const clock = createMotionClock();
    for (let i = 0; i < 60; i++) {
      stepCharacterMotion(st, out, "bot:x", i / 60, 1 / 60, false, { lookYaw: 1.2, clock });
    }
    assert.ok(Math.abs(st.lookYaw - 1.2) < 0.05, `yaw ${st.lookYaw}`);
    stepCharacterMotion(st, out, "bot:x", 2, 1 / 60, true, { lookYaw: -0.8, clock });
    assert.equal(out.yaw, -0.8);
  });

  it("NaN speed/dt/time stay finite; sampleCharacterIdle works", () => {
    const st = createCharacterMotionState();
    const out = createCharacterSample();
    stepCharacterMotion(st, out, "z", Number.NaN, Number.POSITIVE_INFINITY, false, {
      speed: Number.NaN,
      lookYaw: Number.POSITIVE_INFINITY,
      clock: createMotionClock(),
    });
    assert.ok(Number.isFinite(out.offsetY) && Number.isFinite(out.yaw) && Number.isFinite(out.loco));
    sampleCharacterIdle(out, "z", 1.5, false, { clock: createMotionClock() });
    assert.ok(Number.isFinite(out.offsetY));
  });
});

describe("hacker c7 — shared clock reset + out aliasing + batch transitions", () => {
  it("sharedMotionClock.reset is a no-op (no cross-mount teleport)", () => {
    sharedMotionClock.reset();
    let wall = 2000;
    const out = { x: 0, y: 0, z: 0 };
    const base = { x: 10, y: 0, z: 0 };
    for (let i = 0; i < 40; i++) {
      sharedMotionClock.map(wall);
      wall += 1 / 60;
      wall += 10; // resume gaps → motion time lags wall
      sharedMotionClock.map(wall);
    }
    sampleOrbitDrift(out, base, wall, 0.3, false);
    const before = { ...out };
    const timeBefore = sharedMotionClock.time;
    sharedMotionClock.reset(); // would have poisoned pre-c7
    assert.equal(sharedMotionClock.time, timeBefore);
    wall += 1 / 60;
    sampleOrbitDrift(out, base, wall, 0.3, false);
    const jump = Math.hypot(out.x - before.x, out.y - before.y, out.z - before.z);
    assert.ok(jump < 0.05, `teleport jump ${jump} after shared reset`);
  });

  it("private createMotionClock().reset still clears", () => {
    const k = createMotionClock();
    k.map(50);
    assert.ok(k.time > 0);
    k.reset();
    assert.equal(k.time, 0);
    assert.equal(k.anchorCount, 0);
  });

  it("stepNodeOpen/stepSceneTransition with out===state do not pollute state keys", () => {
    const st = createNodeOpenState(false);
    st.target = 1;
    const sample = stepNodeOpen(st, st as never, 0.2, false);
    assert.deepEqual(Object.keys(st).sort(), ["amount", "target"]);
    assert.ok(sample.scale >= 0.86);
    assert.ok(st.amount > 0);

    const tx = createSceneTransitionState();
    beginSceneTransition(tx, "universe", "city");
    const s2 = stepSceneTransition(tx, tx as never, 0.2, false);
    assert.ok(["fromId", "progress", "target", "toId"].every((k) => k in tx));
    assert.equal((tx as { scale?: number }).scale, undefined);
    assert.ok(s2.linear > 0);
    assert.equal(tx.fromId, "universe");
  });

  it("hundreds of simultaneous node opens stay allocation-stable and settle", () => {
    const N = 400;
    const states = Array.from({ length: N }, () => createNodeOpenState(false));
    const samples = Array.from({ length: N }, () => ({
      scale: 0.86,
      opacity: 0,
      offsetY: 0,
      amount: 0,
      done: false,
    }));
    for (const st of states) st.target = 1;
    for (let f = 0; f < 80; f++) {
      for (let i = 0; i < N; i++) stepNodeOpen(states[i]!, samples[i]!, 1 / 60, false);
    }
    for (let i = 0; i < N; i++) {
      assert.equal(states[i]!.amount, 1);
      assert.equal(samples[i]!.done, true);
    }
  });
});
