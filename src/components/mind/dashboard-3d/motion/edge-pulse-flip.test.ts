/**
 * Hacker c20 — edge highlight pops on focus/hover orientation flip.
 *
 * universe-scene drives the ink-edge `uPulse` uniform from
 * stepEdgePulseSync(..., focusId = rig.subjectId ?? hoverId). The pulse phase was
 * taken from the *destination* endpoint, so when focus moved from one endpoint to
 * the other (or to null / an unrelated star) the phase jumped and `highlight`
 * popped by up to ±2·EDGE_PULSE_AMP·strength in a single frame (~0.2 of uPulse).
 * Invariant: at a fixed instant, orientation must not change pulse/highlight.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";
import { createEdgePulseSample, createEdgePulseState, stepEdgePulseSync } from "./edge-pulse-sync.ts";

function at(t: number, focus: string | null, from = "bot:alpha", to = "bot:omega") {
  const clock = createMotionClock();
  const out = createEdgePulseSample();
  stepEdgePulseSync(createEdgePulseState(), out, 0.9, from, to, focus, t, false, { clock });
  return out;
}

describe("hacker c20 — edge pulse orientation flip continuity", () => {
  it("focus from→to→null→unrelated leaves pulse/highlight unchanged at the same instant", () => {
    for (const t of [0.3, 1.7, 5.2, 12.9, 77.4]) {
      const ref = at(t, "bot:omega");
      for (const f of ["bot:alpha", null, "bot:zzz", ""]) {
        const o = at(t, f);
        assert.ok(Math.abs(o.pulse - ref.pulse) < 1e-9, `t=${t} focus=${f}: pulse ${ref.pulse}→${o.pulse}`);
        assert.ok(Math.abs(o.highlight - ref.highlight) < 1e-9, `t=${t} focus=${f}: highlight pop`);
      }
    }
  });

  it("swapping edge endpoint order (from/to) does not change the pulse", () => {
    for (const t of [0.5, 3.3, 9.1]) {
      const a = at(t, null, "bot:alpha", "bot:omega");
      const b = at(t, null, "bot:omega", "bot:alpha");
      assert.ok(Math.abs(a.pulse - b.pulse) < 1e-9, `t=${t} ${a.pulse} vs ${b.pulse}`);
    }
  });

  it("different edges still get different phases (not globally synced)", () => {
    const a = at(2.0, null, "bot:a", "bot:b");
    const b = at(2.0, null, "bot:c", "bot:d");
    assert.notEqual(a.pulse, b.pulse);
  });

  it("focus churn every frame keeps per-frame highlight change small", () => {
    const clock = createMotionClock();
    const st = createEdgePulseState();
    const out = createEdgePulseSample();
    const foci = ["bot:alpha", "bot:omega", null, "bot:x"];
    let prev: number | null = null;
    let maxStep = 0;
    for (let i = 0; i < 600; i++) {
      stepEdgePulseSync(st, out, 0.9, "bot:alpha", "bot:omega", foci[i % 4], i / 60, false, { clock });
      if (prev != null) maxStep = Math.max(maxStep, Math.abs(out.highlight - prev));
      prev = out.highlight;
      assert.ok(Number.isFinite(out.highlight) && Number.isFinite(out.travel));
    }
    // Smooth sin at 2.2 rad/s, amp 0.18 → ≤ ~0.006/frame; allow margin.
    assert.ok(maxStep < 0.02, `max per-frame highlight step ${maxStep}`);
  });
});
