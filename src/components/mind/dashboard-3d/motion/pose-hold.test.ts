import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  createFocusEaseState,
  stepFocusEase,
  FOCUS_PULSE_SCALE,
} from "./focus-ease.ts";
import {
  createCharacterMotionState,
  createCharacterSample,
  stepCharacterMotion,
} from "./character-motion.ts";
import {
  clearBreadcrumbFocus,
  createBreadcrumbEaseState,
  setBreadcrumbFocus,
  stepBreadcrumbEase,
} from "./breadcrumb-ease.ts";
import {
  createNodeOpenState,
  setNodeOpen,
  stepNodeOpen,
  createNodeOpenSample,
  createSceneTransitionState,
  createSceneTransitionSample,
  beginSceneTransition,
  stepSceneTransition,
} from "./transition-ease.ts";
import { createMotionClock } from "./motion-clock.ts";
import { sanitizeDt } from "./sanitize.ts";
import { sampleStarPulse } from "./star-pulse.ts";
import { sampleOrbitDrift } from "./orbit-drift.ts";
import { createDustField } from "../particles/dust-field.ts";
import {
  createCommitComets,
  cometHeadSpriteRefs,
  flushCometHeadSprite,
} from "../particles/commit-comets.ts";
import {
  captureBreadcrumbPose,
  captureCharacterPose,
  captureFocusPose,
  captureNodeOpenPose,
  captureSceneTransitionPose,
  createBreadcrumbPoseHold,
  createCharacterPoseHold,
  createFocusPoseHold,
  createMotionPoseBag,
  createNodeOpenPoseHold,
  createSceneTransitionPoseHold,
  restoreBreadcrumbPose,
  restoreCharacterPose,
  restoreFocusPose,
  restoreNodeOpenPose,
  restoreSceneTransitionPose,
  sanitizeMotionPoseBag,
  restoreFocusPosesForKnownIds,
  restoreCharacterPosesForKnownIds,
  parseMotionPoseBag,
} from "./pose-hold.ts";

describe("hacker c9 — remount snap without pose hold + sprite refs + stress", () => {
  it("remounting focus/character mid-ease snaps without restore (the break)", () => {
    const focus = createFocusEaseState();
    const character = createCharacterMotionState();
    const clock = createMotionClock();
    const cout = createCharacterSample();
    for (let i = 0; i < 20; i++) {
      stepFocusEase(focus, "bot:a", "bot:a", 1 / 60, false);
      stepCharacterMotion(character, cout, "bot:a", i / 60, 1 / 60, false, { speed: 1, clock });
    }
    assert.ok(focus.pulseMul > 1.05 && focus.pulseMul < FOCUS_PULSE_SCALE);
    assert.ok(character.loco > 0.2);
    // Simulate remount: brand-new state (old bug — no pose hold)
    const focus2 = createFocusEaseState();
    const character2 = createCharacterMotionState();
    assert.equal(focus2.pulseMul, 1);
    assert.equal(character2.loco, 0);
    assert.ok(Math.abs(focus2.pulseMul - focus.pulseMul) > 0.05, "expected remount snap");
    assert.ok(Math.abs(character2.loco - character.loco) > 0.1, "expected loco snap");
  });

  it("pose hold restore removes the remount snap", () => {
    const focus = createFocusEaseState();
    const character = createCharacterMotionState();
    const clock = createMotionClock();
    const cout = createCharacterSample();
    for (let i = 0; i < 25; i++) {
      stepFocusEase(focus, "bot:a", "bot:a", 1 / 60, false);
      stepCharacterMotion(character, cout, "bot:a", i / 60, 1 / 60, false, { speed: 1, clock });
    }
    const fh = createFocusPoseHold();
    const ch = createCharacterPoseHold();
    captureFocusPose(fh, focus);
    captureCharacterPose(ch, character);
    const focus2 = createFocusEaseState();
    const character2 = createCharacterMotionState();
    restoreFocusPose(focus2, fh);
    restoreCharacterPose(character2, ch);
    assert.ok(Math.abs(focus2.pulseMul - focus.pulseMul) < 1e-12);
    assert.ok(Math.abs(character2.loco - character.loco) < 1e-12);
  });

  it("shared comet head sprite refs never go negative under double dispose + remount", () => {
    const scene = new THREE.Scene();
    for (let i = 0; i < 20; i++) {
      const c = createCommitComets(scene, [{ sha: `s${i}` }], { max: 1 });
      c.dispose();
      c.dispose();
      assert.ok(cometHeadSpriteRefs() >= 0, `refs ${cometHeadSpriteRefs()} after ${i}`);
    }
    const a = createCommitComets(scene, [{ sha: "live" }], { max: 1 });
    const b = createCommitComets(scene, [{ sha: "live2" }], { max: 1 });
    a.dispose();
    a.dispose();
    flushCometHeadSprite(); // mid-lifetime flush must not free while refs>0
    assert.equal(cometHeadSpriteRefs(), 1);
    b.dispose();
    b.dispose();
    flushCometHeadSprite();
    assert.equal(cometHeadSpriteRefs(), 0);
  });

  it("100k-frame integration stress: dust+comets+focus+transition+character stay finite", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    let dust = createDustField(scene, { count: 48, seed: 2, clock });
    let comets = createCommitComets(scene, [{ sha: "x" }, { sha: "y" }], { max: 2, clock });
    const focuses = Array.from({ length: 6 }, () => createFocusEaseState());
    const chars = Array.from({ length: 6 }, () => createCharacterMotionState());
    const cout = createCharacterSample();
    const pulse = { scale: 1, glow: 2, emissive: 0.7 };
    const drift = { x: 0, y: 0, z: 0 };
    const base = { x: 4, y: 0, z: 1 };
    const node = createNodeOpenState(false);
    const nout = createNodeOpenSample();
    const stx = createSceneTransitionState();
    beginSceneTransition(stx, "universe", "city");
    const sout = createSceneTransitionSample();
    const bc = createBreadcrumbEaseState();
    let t = 500;
    for (let i = 0; i < 100_000; i++) {
      const dt = [0, 1 / 60, 0.04, Number.NaN, -0.5, Number.POSITIVE_INFINITY][i % 6]!;
      const reduced = i % 19 === 0;
      const focusId = i % 13 === 0 ? null : `bot:${i % 6}`;
      t += 1 / 60;
      sampleStarPulse(pulse, t, 0.1, "blocked", reduced, clock);
      sampleOrbitDrift(drift, base, t, 0.1, reduced, { clock });
      for (let j = 0; j < 6; j++) {
        stepFocusEase(focuses[j]!, `bot:${j}`, focusId, dt, reduced);
        stepCharacterMotion(chars[j]!, cout, `bot:${j}`, t, dt, reduced, {
          speed: (i % 4) / 3,
          clock,
        });
      }
      setNodeOpen(node, i % 29 !== 0);
      stepNodeOpen(node, nout, dt, reduced);
      stepSceneTransition(stx, sout, dt, reduced);
      if (focusId) setBreadcrumbFocus(bc, focusId);
      else clearBreadcrumbFocus(bc);
      // breadcrumb sample not needed for finiteness of state
      if (i % 8000 === 7999) {
        dust.dispose();
        dust.dispose();
        comets.dispose();
        comets.dispose();
        assert.ok(cometHeadSpriteRefs() >= 0);
        dust = createDustField(scene, { count: 48, seed: 2, clock: createMotionClock() });
        comets = createCommitComets(scene, [{ sha: "x" }, { sha: "y" }], {
          max: 2,
          clock: createMotionClock(),
        });
      }
      assert.ok(Number.isFinite(pulse.scale) && pulse.scale > 0 && pulse.scale < 3);
      assert.ok(Number.isFinite(drift.x) && Number.isFinite(cout.loco));
      assert.ok(cout.loco >= -1e-6 && cout.loco <= 1 + 1e-6);
      assert.ok(Number.isFinite(nout.scale) && Number.isFinite(sout.dolly));
      for (const f of focuses) {
        assert.ok(Number.isFinite(f.pulseMul) && f.pulseMul >= 0.5 && f.pulseMul <= FOCUS_PULSE_SCALE + 0.1);
      }
    }
    dust.dispose();
    comets.dispose();
    flushCometHeadSprite();
    assert.equal(cometHeadSpriteRefs(), 0);
  });
});

describe("pose-hold — capture/restore + sanitize", () => {
  it("round-trips node/scene/breadcrumb and sanitizes NaN bag", () => {
    const node = createNodeOpenState(false);
    setNodeOpen(node, true);
    stepNodeOpen(node, createNodeOpenSample(), 0.2, false);
    const nh = createNodeOpenPoseHold();
    captureNodeOpenPose(nh, node);
    const node2 = createNodeOpenState(false);
    restoreNodeOpenPose(node2, nh);
    assert.equal(node2.amount, node.amount);

    const stx = createSceneTransitionState();
    beginSceneTransition(stx, "universe", "city");
    stepSceneTransition(stx, createSceneTransitionSample(), 0.2, false);
    const sh = createSceneTransitionPoseHold();
    captureSceneTransitionPose(sh, stx);
    const stx2 = createSceneTransitionState();
    restoreSceneTransitionPose(stx2, sh);
    assert.equal(stx2.progress, stx.progress);
    assert.equal(stx2.fromId, "universe");

    const bc = createBreadcrumbEaseState();
    setBreadcrumbFocus(bc, "bot:z");
    stepBreadcrumbEase(bc, { opacity: 0, offsetX: 0, amount: 0, done: false, focusId: null }, 0.2, false);
    const bh = createBreadcrumbPoseHold();
    captureBreadcrumbPose(bh, bc);
    const bc2 = createBreadcrumbEaseState();
    restoreBreadcrumbPose(bc2, bh);
    assert.equal(bc2.focusId, "bot:z");

    const dirty = createMotionPoseBag();
    dirty.focusById.a = { pulseMul: Number.NaN, driftMul: 2 };
    dirty.characterById.a = { loco: 99, lookYaw: Number.POSITIVE_INFINITY };
    dirty.breadcrumb.amount = Number.NaN;
    const bag = sanitizeMotionPoseBag(dirty);
    assert.equal(bag.focusById.a!.pulseMul, 1);
    assert.equal(bag.focusById.a!.driftMul, 1);
    assert.equal(bag.characterById.a!.loco, 1);
    assert.equal(bag.characterById.a!.lookYaw, 0);
    assert.equal(bag.breadcrumb.amount, 0);
  });
});

describe("hacker c10 — corrupted / stale / polluted pose-hold JSON", () => {
  it("foreign version + missing fields + wrong types must not throw or poison state", () => {
    const raw = {
      version: 99,
      focusById: null,
      characterById: "not-an-object",
      breadcrumb: { amount: "hot", target: {}, focusId: 42 },
      nodeOpen: undefined,
      sceneTx: { progress: NaN, target: Infinity, fromId: { x: 1 }, toId: "" },
      extraHuge: new Array(10_000).fill(0),
    };
    const bag = sanitizeMotionPoseBag(raw as never);
    assert.equal(bag.version, 1);
    assert.equal(typeof bag.focusById, "object");
    assert.equal(typeof bag.characterById, "object");
    assert.ok(Number.isFinite(bag.breadcrumb.amount));
    assert.ok(bag.breadcrumb.amount >= 0 && bag.breadcrumb.amount <= 1);
    assert.equal(bag.breadcrumb.focusId, null);
    assert.ok(Number.isFinite(bag.nodeOpen.amount));
    assert.ok(Number.isFinite(bag.sceneTx.progress));
    assert.equal(bag.sceneTx.fromId, null);
    assert.equal(bag.sceneTx.toId, null);
  });

  it("parseMotionPoseBag recovers from sessionStorage tampering string", () => {
    const bad = '{"version":"nope","focusById":[],"characterById":null,"breadcrumb":null}';
    const bag = parseMotionPoseBag(bad);
    assert.equal(bag.version, 1);
    assert.ok(bag.focusById);
    assert.ok(Number.isFinite(bag.breadcrumb.amount));
    const worse = parseMotionPoseBag("{not json");
    assert.equal(worse.version, 1);
    const nullish = parseMotionPoseBag(null);
    assert.equal(nullish.version, 1);
  });

  it("__proto__ / constructor keys in focusById must not pollute Object.prototype", () => {
    const polluted = JSON.parse(
      '{"version":1,"focusById":{"__proto__":{"pulseMul":9,"driftMul":9},"constructor":{"pulseMul":9,"driftMul":9},"bot:a":{"pulseMul":1.2,"driftMul":0.5}},"characterById":{"__proto__":{"loco":1,"lookYaw":99}},"breadcrumb":{"amount":0,"target":0,"focusId":null},"nodeOpen":{"amount":0,"target":0},"sceneTx":{"progress":0,"target":0,"fromId":null,"toId":null}}',
    );
    const before = ({} as Record<string, unknown>).pulseMul;
    const bag = sanitizeMotionPoseBag(polluted);
    const after = ({} as Record<string, unknown>).pulseMul;
    assert.equal(after, before, "Object.prototype must stay clean");
    assert.equal(Object.prototype.hasOwnProperty.call(bag.focusById, "__proto__"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(bag.focusById, "constructor"), false);
    assert.ok(bag.focusById["bot:a"]);
    assert.ok(Number.isFinite(bag.focusById["bot:a"]!.pulseMul));
  });

  it("restoreFocusPosesForKnownIds skips ids no longer in the live set", () => {
    const bag = createMotionPoseBag();
    bag.focusById["gone"] = { pulseMul: 1.2, driftMul: 0.1 };
    bag.focusById["alive"] = { pulseMul: 1.15, driftMul: 0.2 };
    const live = new Map<string, ReturnType<typeof createFocusEaseState>>();
    live.set("alive", createFocusEaseState());
    restoreFocusPosesForKnownIds(live, bag.focusById);
    assert.equal(live.has("gone"), false);
    assert.ok(Math.abs(live.get("alive")!.pulseMul - 1.15) < 1e-9);
    // character twin
    bag.characterById["ghost"] = { loco: 0.9, lookYaw: 1 };
    bag.characterById["alive"] = { loco: 0.4, lookYaw: 0.2 };
    const chars = new Map<string, ReturnType<typeof createCharacterMotionState>>();
    chars.set("alive", createCharacterMotionState());
    restoreCharacterPosesForKnownIds(chars, bag.characterById);
    assert.equal(chars.has("ghost"), false);
    assert.ok(Math.abs(chars.get("alive")!.loco - 0.4) < 1e-9);
  });

  it("hours-hidden then visibilitychange: sanitizeDt + restore stay finite (no spike)", () => {
    const hours = 3 * 3600;
    const dt = sanitizeDt(hours);
    assert.ok(dt <= 0.05 && dt >= 0);
    const focus = createFocusEaseState();
    const hold = createFocusPoseHold();
    hold.pulseMul = 1.2;
    hold.driftMul = 0.3;
    restoreFocusPose(focus, hold);
    stepFocusEase(focus, "bot:a", "bot:a", dt, false);
    assert.ok(Number.isFinite(focus.pulseMul));
    assert.ok(focus.pulseMul <= FOCUS_PULSE_SCALE + 0.01);
    assert.ok(focus.driftMul >= 0 && focus.driftMul <= 1);
  });
});
