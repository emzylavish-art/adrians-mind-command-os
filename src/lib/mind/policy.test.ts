import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalTokenFor, decide } from "./policy.ts";
import { guardMindEnv } from "./isolation.ts";
import { assembleTurn } from "./prompt.ts";

describe("policy", () => {
  it("denies everything while halted", () => {
    const result = decide({
      autonomy: "automatic",
      kind: "chat",
      halted: true,
      approvalToken: null,
      expectedToken: null,
    });
    assert.equal(result.decision, "deny");
  });

  it("asks before delete in both modes and rejects a mismatched token", () => {
    for (const autonomy of ["ask", "automatic"] as const) {
      const ask = decide({
        autonomy,
        kind: "delete",
        halted: false,
        approvalToken: null,
        expectedToken: approvalTokenFor("delete-chat:a"),
      });
      assert.equal(ask.decision, "ask_owner");
      const forged = decide({
        autonomy,
        kind: "delete",
        halted: false,
        approvalToken: approvalTokenFor("delete-chat:b"),
        expectedToken: approvalTokenFor("delete-chat:a"),
      });
      assert.equal(forged.decision, "ask_owner");
    }
    const ok = decide({
      autonomy: "automatic",
      kind: "delete",
      halted: false,
      approvalToken: approvalTokenFor("delete-chat:a"),
      expectedToken: approvalTokenFor("delete-chat:a"),
    });
    assert.equal(ok.decision, "allow");
  });

  it("allows chat in ask mode and waits on other ordinary steps", () => {
    assert.equal(
      decide({
        autonomy: "ask",
        kind: "chat",
        halted: false,
        approvalToken: null,
        expectedToken: null,
      }).decision,
      "allow",
    );
    assert.equal(
      decide({
        autonomy: "ask",
        kind: "search",
        halted: false,
        approvalToken: null,
        expectedToken: approvalTokenFor("search:1"),
      }).decision,
      "ask_owner",
    );
  });
});

describe("isolation", () => {
  it("refuses both forbidden projects and a mismatched ref", () => {
    assert.equal(guardMindEnv({ databaseUrl: "postgres://ybxowvzicirinpdcfyqe" }).ok, false);
    assert.equal(guardMindEnv({ mindUrl: "https://espmxiitzucooxblmnpr.supabase.co" }).ok, false);
    assert.equal(guardMindEnv({ mindRef: "ybxowvzicirinpdcfyqe" }).ok, false);
    assert.equal(
      guardMindEnv({ mindUrl: "https://example.supabase.co", mindRef: "newprojectref" }).ok,
      false,
    );
    assert.equal(guardMindEnv({}).ok, true);
  });
});

describe("assembleTurn", () => {
  it("refuses saved memory while memory is off and omits it from the prompt", () => {
    const refused = assembleTurn({
      memory: "off",
      history: [],
      text: "Hello",
      memoryContext: [{ id: "m1", text: "secret fact" }],
    });
    assert.equal(refused.ok, false);
    const clean = assembleTurn({ memory: "off", history: [], text: "Hello", memoryContext: [] });
    assert.equal(clean.ok, true);
    if (clean.ok) {
      assert.equal(clean.usedIds.length, 0);
      assert.equal(JSON.stringify(clean.messages).includes("secret fact"), false);
      assert.match(clean.messages[0].content, /Memory is OFF/);
    }
  });
});
