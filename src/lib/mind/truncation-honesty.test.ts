/**
 * H14 attacker probes: a provider stream that closes cleanly at a frame boundary
 * WITHOUT [DONE] or a finish_reason is a cut-off reply. It must not become a done
 * event (the chip would advertise a model whose answer never finished).
 * Also pins honest HTTP status for Grok-path turn failures (no 200 on failure).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { relayModelStream } from "./relay.ts";
import { readModelPayload } from "./stream.ts";
import { httpStatusForTurnFailure } from "./provider-call.ts";
import { readFileSync } from "node:fs";

const SECRET = "xai-TRUNCSECRET-0123456789abcdef";

function sse(...frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

async function run(body: () => ReadableStream<Uint8Array>): Promise<string> {
  const res = relayModelStream({
    apiKey: SECRET,
    model: "grok-4.7",
    messages: [{ role: "user", content: "hi" }],
    usedIds: [],
    requestSignal: new AbortController().signal,
    timeoutMs: 5_000,
    fetchImpl: (async () => new Response(body(), { status: 200 })) as typeof fetch,
    meta: { modelTier: "Orchestrator", resolvedTier: "Orchestrator" },
  });
  return await res.text();
}

const chunk = (content: string, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;

describe("truncated provider stream (clean close, no terminator)", () => {
  it("no [DONE] and no finish_reason → error, no done, no model advertised", async () => {
    const raw = await run(() => sse(chunk("Half an ans")));
    assert.equal(raw.includes("event: done"), false);
    assert.match(raw, /event: error/);
    assert.match(raw, /cut off/i);
    assert.equal(raw.includes(SECRET), false);
  });

  it("[DONE] terminator → done", async () => {
    const raw = await run(() => sse(chunk("Full answer."), "data: [DONE]\n\n"));
    assert.match(raw, /event: done/);
    assert.match(raw, /"model":"grok-4\.7"/);
  });

  it("finish_reason stop without [DONE] → done", async () => {
    const raw = await run(() => sse(chunk("Full answer.", "stop")));
    assert.match(raw, /event: done/);
  });

  it("finish_reason length (max_tokens hit) still completes honestly", async () => {
    const raw = await run(() => sse(chunk("Long", "length"), "data: [DONE]\n\n"));
    assert.match(raw, /event: done/);
  });

  it("readModelPayload (server-fn path) treats an unterminated SSE body as empty", () => {
    const parsed = readModelPayload(chunk("Half"));
    assert.equal(parsed.text, "");
    const ok = readModelPayload(chunk("Whole") + "data: [DONE]\n\n");
    assert.equal(ok.text, "Whole");
  });
});

describe("Grok-path turn failures carry an honest HTTP status (never 200)", () => {
  for (const [error, status] of [
    ["Emergency stop is on. No new action can run.", 409],
    ["Write a message first.", 400],
    ["Memory setting is invalid.", 400],
    ["That model is not available. Another provider is not substituted.", 503],
    ["Grok is not configured on the server.", 503],
    ["Refused forbidden project abc. Use the Mind project only.", 503],
    ["Mind project URL and project ref do not match.", 503],
    ["Some unexpected validation message", 400],
  ] as const) {
    it(`${error} → ${status}`, () => {
      assert.equal(httpStatusForTurnFailure(error), status);
    });
  }
});

describe("handleMindTurn wiring (static; handler imports auth so is not unit-run here)", () => {
  const src = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  const handler = src.slice(src.indexOf("export async function handleMindTurn"));
  it("prepared failures use httpStatusForTurnFailure, not a bare json(prepared)", () => {
    assert.match(handler, /json\(prepared, httpStatusForTurnFailure\(prepared\.error\)\)/);
    assert.equal(/json\(prepared\)\s*;/.test(handler), false);
  });
  it("non-Grok provider failure is not returned as 200", () => {
    // Success is an SSE reply naming the provider; failure is JSON with a non-200 status.
    assert.match(handler, /error: primaryError, provider: selected\.id \}, failStatus\)/);
    assert.match(handler, /return sseReply\(\{ text: answer, model: selected\.model, provider: selected\.id/);
    assert.match(handler, /json\(selected, httpStatusForProviderSelection\(selected\.error\)\)/);
  });
  it("model-not-allowed and halt carry explicit non-200 status", () => {
    assert.match(handler, /not substituted\." \}, 503\)/);
    assert.match(handler, /No new action can run\." \}, 409\)/);
  });
});
