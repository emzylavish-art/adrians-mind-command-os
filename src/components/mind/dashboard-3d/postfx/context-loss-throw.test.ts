import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContextLossRecovery, type PostfxBundle } from "./context-loss.ts";

/**
 * Light hacker pass (cycle: #60). universe-scene pauses the render loop while
 * `recovery.lost` is true. Before the fix, one throwing dispose() (or a
 * throwing rebuild factory) aborted disposeBundle mid-way: the remaining GPU
 * handles leaked and `lost` stayed true forever → dashboard frozen on the
 * last-frame snapshot with the error only in the console.
 */
function counting() {
  const h = { n: 0, dispose() { h.n += 1; } };
  return h;
}
function throwing() {
  const h = { n: 0, dispose() { h.n += 1; throw new Error("dispose boom"); } };
  return h;
}

describe("context-loss: throwing dispose / factory never freezes postfx", () => {
  it("one throwing dispose still frees every other handle and restore rebuilds", () => {
    const guard = throwing();
    const bloom = counting();
    const grade = counting();
    const rays = counting();
    const exposure = counting();
    const focusDepth = counting();
    const errors: string[] = [];
    let builds = 0;
    const r = createContextLossRecovery({
      initial: { focusBloomGuard: guard, bloom, grade, godRays: rays, exposure, focusDepth } as unknown as PostfxBundle,
      factory: () => {
        builds += 1;
        return { bloom: counting() } as unknown as PostfxBundle;
      },
      onError: (stage, err) => errors.push(`${stage}:${(err as Error).message}`),
    });
    assert.doesNotThrow(() => r.notifyLost());
    assert.equal(r.lost, true);
    for (const h of [bloom, grade, rays, exposure, focusDepth]) assert.equal(h.n, 1, "every handle disposed");
    assert.equal(r.bundle.focusBloomGuard, null, "stale refs cleared");
    assert.doesNotThrow(() => r.notifyRestored());
    assert.equal(guard.n, 1, "throwing handle not re-disposed on restore");
    assert.equal(builds, 1, "factory ran");
    assert.equal(r.lost, false, "render loop resumes");
    assert.ok(r.bundle.bloom);
    assert.deepEqual(errors, ["dispose:dispose boom"]);
    assert.equal(r.lastError?.stage, "dispose");
    r.dispose();
  });

  it("throwing factory: lost clears (plain render resumes), empty bundle, error surfaced not swallowed", () => {
    const errors: string[] = [];
    const r = createContextLossRecovery({
      initial: { bloom: counting() } as unknown as PostfxBundle,
      factory: () => {
        throw new Error("rebuild boom");
      },
      onError: (stage, err) => errors.push(`${stage}:${(err as Error).message}`),
    });
    r.notifyLost();
    assert.doesNotThrow(() => r.notifyRestored());
    assert.equal(r.lost, false);
    assert.equal(r.bundle.bloom, null);
    // Dashboard scene-side retry: factory is attempted twice before empty bundle.
    assert.deepEqual(errors, ["rebuild:rebuild boom", "rebuild:rebuild boom"]);
    assert.equal(r.lastError?.stage, "rebuild");
    r.dispose();
  });

  it("without onError, errors still surface via console.error (never silent)", () => {
    const orig = console.error;
    const seen: unknown[] = [];
    console.error = (...a: unknown[]) => void seen.push(a);
    try {
      const r = createContextLossRecovery({ initial: { grade: throwing() } as unknown as PostfxBundle });
      r.notifyLost();
      assert.equal(seen.length, 1);
      r.dispose();
    } finally {
      console.error = orig;
    }
  });
});
