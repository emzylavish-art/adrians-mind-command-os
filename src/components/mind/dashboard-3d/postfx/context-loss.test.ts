import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { createContextLossRecovery, type ContextLossCanvas, type PostfxBundle } from "./context-loss.ts";

type FakeHandle = { disposed: number; dispose: () => void };

function fakeHandle(): FakeHandle {
  const h: FakeHandle = {
    disposed: 0,
    dispose() {
      h.disposed += 1;
    },
  };
  return h;
}

function bundleOf(n = 1): { bundle: PostfxBundle; handles: FakeHandle[] } {
  const handles = Array.from({ length: n * 4 }, () => fakeHandle());
  // One set of 4; if n>1 we only need the first set for initial
  const [b, g, r, e] = handles;
  return {
    handles,
    bundle: {
      bloom: b as never,
      grade: g as never,
      godRays: r as never,
      exposure: e as never,
    },
  };
}

describe("context-loss recovery (queue #13)", () => {
  it("notifyLost disposes handles and sets lost; restore rebuilds via factory", () => {
    const first = bundleOf();
    let builds = 0;
    const secondHandles: FakeHandle[] = [];
    const recovery = createContextLossRecovery({
      initial: first.bundle,
      factory: () => {
        builds += 1;
        const h = [fakeHandle(), fakeHandle(), fakeHandle(), fakeHandle()];
        secondHandles.push(...h);
        return {
          bloom: h[0] as never,
          grade: h[1] as never,
          godRays: h[2] as never,
          exposure: h[3] as never,
        };
      },
    });
    assert.equal(recovery.lost, false);
    recovery.notifyLost();
    assert.equal(recovery.lost, true);
    for (const h of first.handles.slice(0, 4)) assert.equal(h.disposed, 1);
    assert.equal(recovery.bundle.bloom, null);
    recovery.notifyRestored();
    assert.equal(recovery.lost, false);
    assert.equal(builds, 1);
    assert.ok(recovery.bundle.bloom);
    recovery.dispose();
    for (const h of secondHandles) assert.equal(h.disposed, 1);
  });

  it("canvas listeners fire lost/restored and are removed on dispose (no leak)", () => {
    const ee = new EventEmitter();
    const canvas: ContextLossCanvas & { listenerCount: (t: string) => number; emit: (t: string, ...a: unknown[]) => boolean } = {
      addEventListener: (t, fn) => {
        ee.on(t, fn as (...a: unknown[]) => void);
      },
      removeEventListener: (t, fn) => {
        ee.off(t, fn as (...a: unknown[]) => void);
      },
      listenerCount: (t) => ee.listenerCount(t),
      emit: (t, ...a) => ee.emit(t, ...a),
    };

    const first = bundleOf();
    let builds = 0;
    const recovery = createContextLossRecovery({
      canvas,
      initial: first.bundle,
      factory: () => {
        builds += 1;
        const h = fakeHandle();
        return { bloom: h as never, grade: null, godRays: null, exposure: null };
      },
    });
    assert.equal(canvas.listenerCount("webglcontextlost"), 1);
    assert.equal(canvas.listenerCount("webglcontextrestored"), 1);

    const lostEv = { preventDefault() {} };
    canvas.emit("webglcontextlost", lostEv);
    assert.equal(recovery.lost, true);
    for (const h of first.handles.slice(0, 4)) assert.equal(h.disposed, 1);

    canvas.emit("webglcontextrestored");
    assert.equal(recovery.lost, false);
    assert.equal(builds, 1);

    recovery.dispose();
    assert.equal(canvas.listenerCount("webglcontextlost"), 0, "listeners removed");
    assert.equal(canvas.listenerCount("webglcontextrestored"), 0);
    // Late events after dispose must not rebuild / throw.
    canvas.emit("webglcontextlost", lostEv);
    canvas.emit("webglcontextrestored");
    assert.equal(builds, 1, "no rebuild after dispose");
  });

  it("double notifyLost is idempotent; missing factory still clears lost on restore", () => {
    const first = bundleOf();
    const recovery = createContextLossRecovery({ initial: first.bundle });
    recovery.notifyLost();
    recovery.notifyLost();
    for (const h of first.handles.slice(0, 4)) assert.equal(h.disposed, 1);
    recovery.notifyRestored();
    assert.equal(recovery.lost, false);
    assert.equal(recovery.bundle.bloom, null);
    recovery.dispose();
    assert.doesNotThrow(() => recovery.dispose());
  });

  it("retries once when factory throws on restore; clears lost so the scene can tick", () => {
    const first = bundleOf();
    let builds = 0;
    const recovery = createContextLossRecovery({
      initial: first.bundle,
      factory: () => {
        builds += 1;
        if (builds === 1) throw new Error("gl half-restored");
        const h = fakeHandle();
        return { bloom: h as never, grade: null, godRays: null, exposure: null };
      },
    });
    recovery.notifyLost();
    assert.equal(recovery.lost, true);
    recovery.notifyRestored();
    assert.equal(recovery.lost, false, "lost cleared even across the throw");
    assert.equal(builds, 2, "one retry after the first throw");
    assert.ok(recovery.bundle.bloom);
    recovery.dispose();
  });

  it("after two factory throws leaves lost false and a null bundle (no hang)", () => {
    const first = bundleOf();
    let builds = 0;
    const recovery = createContextLossRecovery({
      initial: first.bundle,
      factory: () => {
        builds += 1;
        throw new Error("still dead");
      },
    });
    recovery.notifyLost();
    recovery.notifyRestored();
    assert.equal(recovery.lost, false);
    assert.equal(builds, 2);
    assert.equal(recovery.bundle.bloom, null);
    recovery.dispose();
  });
});
