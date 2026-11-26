import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_EXECUTION_LEDGER_ENTRIES,
  consumeServerExecution,
  executionLedgerSizeForTests,
  issueServerExecution,
  recordIssuedExecution,
  resetExecutionLedgerForTests,
} from "./execution-ledger.ts";
import {
  MAX_RATE_LIMIT_KEYS,
  consumeMindRateLimit,
  pruneMindRateLimitsForTests,
  rateLimitMapSizeForTests,
  resetMindRateLimitsForTests,
  jsonRateLimited,
} from "./limits.ts";

describe("execution ledger (forged tool runs)", () => {
  it("retries recording after storage failure without consuming or executing the action again", async () => {
    resetExecutionLedgerForTests(); resetMindRateLimitsForTests();
    const id = issueServerExecution("recovery-owner", { tool: "notion", action: "chat", ok: true, detail: "accepted" });
    const failed = await recordIssuedExecution({ userId: "recovery-owner", id, write: async () => { throw new Error("fixture storage failure"); } });
    assert.equal(failed.ok, false);
    let records = 0;
    const recovered = await recordIssuedExecution({ userId: "recovery-owner", id, write: async () => { records++; } });
    assert.equal(recovered.ok, true);
    assert.equal(records, 1);
  });

  it("claims an in-flight receipt so two recording requests cannot insert it twice", async () => {
    resetExecutionLedgerForTests(); resetMindRateLimitsForTests();
    const id = issueServerExecution("race-owner", { tool: "notion", action: "chat", ok: true, detail: "accepted" });
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let records = 0;
    const first = recordIssuedExecution({ userId: "race-owner", id, write: async () => { records++; await wait; } });
    const other = await recordIssuedExecution({ userId: "race-owner", id, write: async () => { records++; } });
    assert.equal(other.ok, false);
    release();
    assert.equal((await first).ok, true);
    assert.equal(records, 1);
  });
  it("rejects a forged / unknown id", async () => {
    resetExecutionLedgerForTests();
    resetMindRateLimitsForTests();
    const writes: unknown[] = [];
    const result = await recordIssuedExecution({
      userId: "u1",
      id: "client-forged-uuid",
      clientOk: true,
      write: async (run) => {
        writes.push(run);
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not recorded|unknown|not recognized/i);
    assert.equal(writes.length, 0);
  });

  it("rejects a replayed id (record once)", async () => {
    resetExecutionLedgerForTests();
    resetMindRateLimitsForTests();
    const id = issueServerExecution("u1", { tool: "list_projects", action: "chat", ok: true, detail: "3 projects" });
    const writes: unknown[] = [];
    const first = await recordIssuedExecution({
      userId: "u1",
      id,
      clientOk: false,
      write: async (run) => {
        writes.push(run);
      },
    });
    assert.equal(first.ok, true);
    assert.equal(writes.length, 1);
    const replay = await recordIssuedExecution({
      userId: "u1",
      id,
      clientOk: true,
      write: async (run) => {
        writes.push(run);
      },
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.match(replay.error, /already recorded|already used|not recorded/i);
    assert.equal(writes.length, 1);
  });

  it("ignores client-claimed ok:true and writes the server outcome", async () => {
    resetExecutionLedgerForTests();
    resetMindRateLimitsForTests();
    const id = issueServerExecution("u1", { tool: "search_notes", action: "chat", ok: false, detail: "no matches" });
    const writes: Array<{ ok: boolean; tool: string; detail: string }> = [];
    const result = await recordIssuedExecution({
      userId: "u1",
      id,
      clientOk: true,
      clientDetail: "FORGED SUCCESS",
      write: async (run) => {
        writes.push(run);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.ok, false);
    assert.equal(writes[0]!.detail, "no matches");
    assert.equal(writes[0]!.detail.includes("FORGED"), false);
  });

  it("a flood of record attempts gets rate limited (429 + Retry-After)", async () => {
    resetExecutionLedgerForTests();
    resetMindRateLimitsForTests();
    const limit = 5;
    let last: Awaited<ReturnType<typeof recordIssuedExecution>> | null = null;
    for (let i = 0; i < limit + 3; i += 1) {
      last = await recordIssuedExecution({
        userId: "flood-user",
        id: `forged-${i}`,
        clientOk: true,
        rateLimit: limit,
        write: async () => undefined,
      });
    }
    assert.ok(last);
    assert.equal(last!.ok, false);
    if (!last!.ok) {
      assert.equal(last!.rateLimited, true);
      assert.ok((last!.retryAfterSec ?? 0) >= 1);
      const res = jsonRateLimited(last!.error, last!.retryAfterSec ?? 1);
      assert.equal(res.status, 429);
      assert.ok(res.headers.get("retry-after"));
    }
  });

  it("consumeServerExecution is single-use and user-scoped", () => {
    resetExecutionLedgerForTests();
    const id = issueServerExecution("owner-a", { tool: "t", action: "chat", ok: true, detail: "x" });
    assert.equal(consumeServerExecution("owner-b", id).ok, false);
    assert.equal(consumeServerExecution("owner-a", id).ok, true);
    assert.equal(consumeServerExecution("owner-a", id).ok, false);
  });
});

describe("rate-limit map stays bounded", () => {
  it("prunes stale keys and caps map size", () => {
    resetMindRateLimitsForTests();
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 50; i += 1) {
      consumeMindRateLimit("chat", `user-${i}`, 12, 1_000, 0);
    }
    pruneMindRateLimitsForTests(2_000, 1_000);
    assert.ok(rateLimitMapSizeForTests() <= MAX_RATE_LIMIT_KEYS);
    assert.equal(rateLimitMapSizeForTests(), 0);

    for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 80; i += 1) {
      consumeMindRateLimit("chat", `hot-${i}`, 12, 60_000, 10_000 + i);
    }
    assert.ok(rateLimitMapSizeForTests() <= MAX_RATE_LIMIT_KEYS);
  });

  it("execution ledger size stays bounded under issue flood", () => {
    resetExecutionLedgerForTests();
    for (let i = 0; i < MAX_EXECUTION_LEDGER_ENTRIES + 40; i += 1) {
      issueServerExecution(`u${i % 3}`, { tool: "t", action: "chat", ok: true, detail: "d" }, 1_000 + i);
    }
    assert.ok(executionLedgerSizeForTests() <= MAX_EXECUTION_LEDGER_ENTRIES);
  });
});


describe("execution receipt context", () => {
  it("preserves server correlation metadata while dropping unsupported fields", async () => {
    resetExecutionLedgerForTests(); resetMindRateLimitsForTests();
    const metadata = { provider: "notion", operationId: "operation-1", workspaceId: "workspace-a", durationMs: 12.7, accessToken: "must-not-persist" };
    const id = issueServerExecution("metadata-owner", { tool: "notion", action: "chat", ok: false, detail: "verification pending", metadata });
    let stored: unknown;
    assert.equal((await recordIssuedExecution({ userId: "metadata-owner", id, write: async (run) => { stored = run.metadata; } })).ok, true);
    assert.deepEqual(stored, { operationId: "operation-1", workspaceId: "workspace-a", provider: "notion", durationMs: 13 });
    assert.equal(JSON.stringify(stored).includes("must-not-persist"), false);
  });
});
