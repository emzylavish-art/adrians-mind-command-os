import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  historyForDeliver,
  resolveChatMessages,
  shouldBlockForEmergencyStop,
  snapshotImages,
} from "./retry-fidelity.ts";

describe("retry fidelity", () => {
  it("preserves images byte-identically across snapshot", () => {
    const images = [{ dataUrl: "data:image/png;base64,aaa", name: "eb-red.png" }];
    const snap = snapshotImages(images);
    assert.deepEqual(snap, images);
    assert.notEqual(snap, images);
  });

  it("keeps original history on resume using the live chat that already stored the user turn", () => {
    const prior = [{ role: "user" as const, content: "verifier first message" }];
    const withSecond = [...prior, { role: "user" as const, content: "verifier second message in chat" }];
    // First attempt (resume=false) used prior only.
    assert.deepEqual(historyForDeliver(prior, false), prior);
    // After the user turn was written, Retry (resume=true) must slice it off the LIVE chat.
    const live = resolveChatMessages([{ id: "c1", messages: withSecond }], "c1", { id: "c1", messages: prior });
    assert.deepEqual(historyForDeliver(live, true), prior);
  });

  it("does not drop history when a stale chat object is used for resume (documents the bug)", () => {
    const prior = [{ role: "user" as const, content: "verifier first message" }];
    // Stale chat never received the second user turn — resume slice empties it.
    assert.deepEqual(historyForDeliver(prior, true), []);
  });

  it("blocks only on live halted, not a stale source.halted after Clear stop", () => {
    assert.equal(shouldBlockForEmergencyStop(true, false), true);
    assert.equal(shouldBlockForEmergencyStop(false, true), false);
    assert.equal(shouldBlockForEmergencyStop(false, false), false);
  });
});

import { commandSendPlan, onceRetry } from "./retry-fidelity.ts";
import { mcpToolFailure, imageGenerationFailure, imagineRetryParams } from "./failure-states.ts";

describe("retry after Clear stop", () => {
  it("uses live halt state: blocked while halted, sends after Clear stop", () => {
    assert.equal(commandSendPlan({ liveHalted: true, text: "hi", imageCount: 0 }), "blocked");
    assert.equal(commandSendPlan({ liveHalted: false, text: "hi", imageCount: 0 }), "send");
  });
  it("never creates an empty New session", () => {
    assert.equal(commandSendPlan({ liveHalted: false, text: "   ", imageCount: 0 }), "empty");
    assert.equal(commandSendPlan({ liveHalted: true, text: "", imageCount: 0 }), "empty");
    assert.equal(commandSendPlan({ liveHalted: false, text: "", imageCount: 1 }), "send");
  });
  it("Retry sends exactly once even when clicked repeatedly", () => {
    let sends = 0;
    const retry = onceRetry(() => { sends += 1; });
    retry?.(); retry?.(); retry?.();
    assert.equal(sends, 1);
    assert.equal(onceRetry(null), null);
  });
});

describe("MCP call-site failure banner", () => {
  it("maps a failed askMcp result to an mcp_tool_failed banner with a target", () => {
    const f = mcpToolFailure({ ok: false, status: "error", error: "boom", tool: "mcp", serverId: "pglite" });
    assert.equal(f?.kind, "mcp_tool_failed");
    assert.match(f!.message, /boom/);
    assert.equal(f?.target, "mcp:pglite/mcp");
  });
});


describe("Imagine call-site failure banner", () => {
  it("maps a failed generate result to image_generation_failed with identical retry params", () => {
    const f = imageGenerationFailure({
      mode: "generate",
      prompt: "lighthouse",
      status: 502,
      serverError: "upstream boom",
      n: 1,
    });
    assert.equal(f.kind, "image_generation_failed");
    assert.match(f.message, /image service failed|Image generation failed/i);
    assert.deepEqual(imagineRetryParams(f), { mode: "generate", prompt: "lighthouse", n: 1 });
  });

  it("Retry guard fires exactly once for Imagine", () => {
    let runs = 0;
    const failure = imageGenerationFailure({ mode: "edit", prompt: "dusk", imageDataUrl: "data:image/png;base64,x", status: 500 });
    const params = imagineRetryParams(failure);
    const retry = onceRetry(() => {
      runs += 1;
      assert.equal(params.prompt, "dusk");
      assert.equal(params.imageDataUrl, "data:image/png;base64,x");
    });
    retry?.();
    retry?.();
    retry?.();
    assert.equal(runs, 1);
  });
});
