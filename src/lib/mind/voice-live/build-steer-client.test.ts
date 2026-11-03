import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILD_STEER_LABEL,
  formatBuildSteerHttpError,
  postBuildSteer,
  sanitizeSteerText,
  steerActiveBuildOrFallback,
} from "./build-steer-client.ts";
import { createDebouncedSteer } from "./build-steer-debounce.ts";
import {
  getActiveBuildSessionId,
  setActiveBuildSessionId,
} from "./active-build-session.ts";

describe("build steer client", () => {
  it("sanitizes steer text and labels steering", () => {
    assert.equal(sanitizeSteerText("  hello  ").ok, true);
    assert.equal(sanitizeSteerText("").ok, false);
    assert.equal(BUILD_STEER_LABEL, "Steering build");
  });

  it("formats 4xx/5xx clearly", () => {
    assert.match(formatBuildSteerHttpError(401), /Sign in/i);
    assert.match(formatBuildSteerHttpError(404), /not found/i);
    assert.match(formatBuildSteerHttpError(409, "This build is already finished. Steer was not applied."), /finished/i);
    assert.match(formatBuildSteerHttpError(500), /server 500/i);
    assert.match(formatBuildSteerHttpError(429), /Too many steer/i);
  });

  it("POSTs final transcript to /api/mind/build-session/steer", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const result = await postBuildSteer(
      { id: "bs_1", text: "use dark mode" },
      {
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), body: String(init?.body || "") });
          return new Response(
            JSON.stringify({
              ok: true,
              session: { id: "bs_1", status: "running", pendingSteerCount: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/api\/mind\/build-session\/steer$/);
    assert.match(calls[0]!.body, /use dark mode/);
  });

  it("surfaces 5xx with clearActive false so caller keeps session pointer", async () => {
    const result = await postBuildSteer(
      { id: "bs_1", text: "retry" },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 503 }),
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.httpStatus, 503);
      assert.equal(result.clearActive, false);
      assert.match(result.error, /503|boom/i);
    }
  });

  it("steerActiveBuildOrFallback clears on terminal GET", async () => {
    let n = 0;
    const result = await steerActiveBuildOrFallback(
      { id: "bs_done", text: "too late" },
      {
        fetchImpl: async (url) => {
          n += 1;
          if (String(url).includes("/get")) {
            return new Response(
              JSON.stringify({ ok: true, session: { id: "bs_done", status: "done" } }),
              { status: 200 },
            );
          }
          throw new Error("should not POST steer");
        },
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.clearActive, true);
      assert.equal("fallback" in result && result.fallback, true);
    }
    assert.equal(n, 1);
  });
});

describe("build steer debounce + active id", () => {
  it("debounces rapid finals to the latest text", async () => {
    const d = createDebouncedSteer(40);
    const p1 = d.push("one");
    const p2 = d.push("two");
    const [a, b] = await Promise.all([p1, p2]);
    // First waiter gets superseded null or both get latest depending on timing —
    // our impl resolves all waiters with the same flushed value.
    assert.equal(a, "two");
    assert.equal(b, "two");
  });

  it("stores and clears active build session id", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    } as unknown as Storage;
    // Use module memory API
    setActiveBuildSessionId("bs_mem", "running");
    assert.equal(getActiveBuildSessionId(), "bs_mem");
    setActiveBuildSessionId(null);
    assert.equal(getActiveBuildSessionId(storage), null);
    void storage;
  });
});
