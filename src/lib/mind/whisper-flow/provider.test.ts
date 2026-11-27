import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";
import { parseWhisperFlowRoute, selectSttProvider, transcribeWhisperFlowAudio } from "./provider.ts";
import { dispatchTranscription } from "../voice/transcription-dispatch.server.ts";
import * as voiceInput from "../voice/voice-input.ts";

const bytes = new Uint8Array(64).fill(7);
const env = { XAI_VOICE_API_KEY: "fixture-xai", OPENAI_API_KEY: "fixture-openai" };
const selected = { bytes, env, secretsPath: "/dev/null" };

describe("C5 explicit legacy Whisper Flow destinations", () => {
  it("does not infer any route from key presence, auto, invalid or omitted selection", async () => {
    for (const prefer of [undefined, "auto", "invented"] as const) {
      const result = await transcribeWhisperFlowAudio({ ...selected, prefer: prefer as "auto", fetchImpl: async () => assert.fail("selection must precede transport") });
      assert.equal(result.ok, false);
      assert.equal(selectSttProvider(env, prefer as "auto", "/dev/null").provider, null);
    }
    assert.equal(parseWhisperFlowRoute({ provider: "handy", fallbackProvider: "invented" }).ok, false);
  });
  for (const provider of ["xai", "openai"] as const) {
    it(`missing selected ${provider} key errors without choosing a configured alternate`, async () => {
      const available = provider === "xai" ? { OPENAI_API_KEY: "fixture" } : { XAI_VOICE_API_KEY: "fixture" };
      const result = await transcribeWhisperFlowAudio({ ...selected, env: available, prefer: provider, fallbackProvider: provider === "xai" ? "openai" : "xai", fetchImpl: async () => assert.fail("missing selected key must not substitute") });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /not configured/);
    });
  }
  it("selected Handy success stays local even with all cloud keys", async () => {
    let local = 0;
    const result = await transcribeWhisperFlowAudio({ ...selected, prefer: "handy", handyFetchImpl: async () => { local++; return Response.json({ ok: true, text: "local words" }); }, cloudFetchImpl: async () => assert.fail("local path cannot upload") });
    assert.equal(result.ok && result.provider, "handy"); assert.equal(local, 1);
  });
  it("Handy failure cannot upload to cloud without explicit fallback", async () => {
    let local = 0;
    const result = await transcribeWhisperFlowAudio({ ...selected, prefer: "handy", handyFetchImpl: async () => { local++; throw new Error("offline fixture"); }, cloudFetchImpl: async () => assert.fail("keys are not consent") });
    assert.equal(result.ok, false); assert.equal(local, 1);
  });
  it("explicit local-to-OpenAI fallback calls only reviewed alternate and attributes it", async () => {
    const calls: string[] = [];
    const result = await transcribeWhisperFlowAudio({ ...selected, prefer: "handy", fallbackProvider: "openai", handyFetchImpl: async () => { calls.push("handy"); throw new Error("offline fixture"); }, cloudFetchImpl: async url => { calls.push(String(url)); return Response.json({ text: "cloud words" }); } });
    assert.equal(result.ok && result.provider, "openai"); assert.equal(calls.length, 2); assert.equal(calls[0], "handy"); assert.match(calls[1], /api\.openai\.com/);
  });
  for (const failure of [401, 429, "timeout", "empty"] as const) {
    it(`selected xAI ${failure} does not upload elsewhere by default`, async () => {
      const calls: string[] = [];
      const result = await transcribeWhisperFlowAudio({ ...selected, prefer: "xai", cloudFetchImpl: async url => {
        calls.push(String(url)); if (failure === "timeout") throw new Error("fixture timeout");
        return Response.json({ text: "" }, { status: typeof failure === "number" ? failure : 200 });
      } });
      assert.equal(result.ok, false); assert.equal(calls.length, 1); assert.match(calls[0], /api\.x\.ai/);
    });
  }
  it("explicit cloud fallback is bounded to one alternate attempt", async () => {
    const calls: string[] = [];
    const result = await transcribeWhisperFlowAudio({ ...selected, prefer: "xai", fallbackProvider: "openai", cloudFetchImpl: async url => { calls.push(String(url)); return new Response("unavailable", { status: 503 }); } });
    assert.equal(result.ok, false); assert.equal(calls.length, 2); assert.match(calls[0], /api\.x\.ai/); assert.match(calls[1], /api\.openai\.com/);
  });
  it("free-only allows explicit Handy but forbids cloud selection or fallback", async () => {
    const cloud = async () => assert.fail("free-only cannot upload");
    assert.equal((await transcribeWhisperFlowAudio({ ...selected, prefer: "openai", freeOnly: true, cloudFetchImpl: cloud })).ok, false);
    assert.equal((await transcribeWhisperFlowAudio({ ...selected, prefer: "handy", fallbackProvider: "xai", freeOnly: true, handyFetchImpl: async () => new Response("offline", { status: 503 }), cloudFetchImpl: cloud })).ok, false);
    const local = await transcribeWhisperFlowAudio({ ...selected, prefer: "handy", freeOnly: true, handyFetchImpl: async () => Response.json({ ok: true, text: "local only" }), cloudFetchImpl: cloud });
    assert.equal(local.ok && local.provider, "handy");
  });
  it("actual legacy serverFn forwards selected route, rejects missing choice and preserves provider", async () => {
    const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const fragment = source.slice(source.indexOf("export const transcribeDictation ="), source.indexOf("/**\n * MCP server list"));
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async url => { calls.push(String(url)); return Response.json({ text: "fixture words" }); };
    const modules: Record<string, unknown> = {
      "./voice/voice-input": voiceInput,
      "./voice/transcription-dispatch.server": { dispatchTranscription: (...args: Parameters<typeof dispatchTranscription>) => dispatchTranscription(args[0], args[1], args[2], {
        ...args[3], deps: { env, fetchImpl, halted: async () => false, reserve: async () => ({ ok: true }), recordUsage: async () => {}, authorize: async () => async () => {} },
      }) },
      "./halt.server": { haltIsOn: async () => false },
      "./voice/usage.server": { createVoiceUsageTracker: () => ({ fetch: () => fetchImpl, error: null }) },
      "./whisper-flow/provider": { parseWhisperFlowRoute, transcribeWhisperFlowAudio: (input: Parameters<typeof transcribeWhisperFlowAudio>[0]) => transcribeWhisperFlowAudio({ ...input, env, secretsPath: "/dev/null", handyFetchImpl: async () => assert.fail("selected cloud cannot try local") }) },
    };
    const exports: { transcribeDictation?: (data: unknown) => Promise<{ ok: boolean; provider?: string }>; refineDictationOptional?: (data: unknown) => Promise<{ ok: boolean }> } = {};
    type Chain = { middleware: () => Chain; validator: () => Chain; handler: (fn: (input: unknown) => unknown) => (data: unknown) => unknown };
    const chain: Chain = { middleware: () => chain, validator: () => chain, handler: (fn) => (data) => fn({ data, context: { userId: "fixture-owner" } }) };
    runInNewContext(ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, createServerFn: () => chain, authMiddleware: {}, allowMindRequest: () => true, Uint8Array, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
    const input = { audioBase64: Buffer.from(bytes).toString("base64"), mime: "audio/webm" };
    assert.equal((await exports.transcribeDictation!(input)).ok, false); assert.equal(calls.length, 0);
    assert.equal((await exports.transcribeDictation!({ ...input, provider: "openai", freeOnly: true })).ok, false); assert.equal(calls.length, 0);
    assert.equal((await exports.refineDictationOptional!({ text: "fixture", enabled: true, freeOnly: true })).ok, false); assert.equal(calls.length, 0);
    assert.equal((await exports.transcribeDictation!({ ...input, provider: "openai" })).provider, "openai"); assert.equal(calls.length, 1); assert.match(calls[0], /api\.openai\.com/);
  });
});
