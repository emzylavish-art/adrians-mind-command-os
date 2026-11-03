import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { createLocalHttpVoiceProvider } from "./local-provider.ts";
import { resolveVoiceCloneLocalUrl } from "./local-url.ts";

describe("local voice-clone URL attacker pass", () => {
  it("rejects non-localhost by default", () => {
    const bad = resolveVoiceCloneLocalUrl("http://evil.example:7860");
    assert.equal(bad.ok, false);
  });

  it("allows loopback", () => {
    const ok = resolveVoiceCloneLocalUrl("http://127.0.0.1:7860");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.base, "http://127.0.0.1:7860");
  });

  it("allows remote only when opted in", () => {
    const stillBad = resolveVoiceCloneLocalUrl("http://10.0.0.2:7860", { allowRemote: false });
    assert.equal(stillBad.ok, false);
    const ok = resolveVoiceCloneLocalUrl("http://10.0.0.2:7860", { allowRemote: true });
    assert.equal(ok.ok, true);
  });
});

describe("local provider health / attacker responses", () => {
  it("reports not running when endpoint is down", async () => {
    const provider = createLocalHttpVoiceProvider({
      baseUrl: "http://127.0.0.1:59999",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const st = await provider.status();
    assert.equal(st.canClone, false);
    assert.match(st.banner, /Local voice engine not running/);
  });

  it("rejects wrong content-type on /health", async () => {
    const provider = createLocalHttpVoiceProvider({
      baseUrl: "http://127.0.0.1:7860",
      fetchImpl: async () =>
        new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    });
    const st = await provider.status();
    assert.equal(st.canClone, false);
    assert.match(st.reason, /not JSON|content type/i);
  });

  it("surfaces PerTh watermark from health even when weights not loaded", async () => {
    const provider = createLocalHttpVoiceProvider({
      baseUrl: "http://127.0.0.1:7860",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            status: "weights_not_loaded",
            backend: "chatterbox",
            watermark: { enabled: true, name: "PerTh", note: "PerTh on" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const st = await provider.status();
    assert.equal(st.canClone, false);
    assert.equal(st.backend, "chatterbox");
    assert.equal(st.watermark?.enabled, true);
    assert.equal(st.watermark?.name, "PerTh");
  });

  it("rejects huge TTS bodies", async () => {
    const provider = createLocalHttpVoiceProvider({
      baseUrl: "http://127.0.0.1:7860",
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true, status: "ok", backend: "mock-tone", watermark: { enabled: false, name: null, note: "mock" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.endsWith("/tts")) {
          return new Response(new Uint8Array(64), {
            status: 200,
            headers: { "content-type": "audio/wav", "content-length": String(5_000_000) },
          });
        }
        return new Response("no", { status: 404 });
      },
    });
    const tts = await provider.synthesize({ text: "hi", voiceId: "loc_x", format: "wav" });
    assert.equal(tts.ok, false);
    if (!tts.ok) assert.equal(tts.code, "too_large");
  });

  it("rejects non-audio TTS content type", async () => {
    const provider = createLocalHttpVoiceProvider({
      baseUrl: "http://127.0.0.1:7860",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true, status: "ok", watermark: { enabled: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const tts = await provider.synthesize({ text: "hi", voiceId: "loc_x" });
    assert.equal(tts.ok, false);
    if (!tts.ok) assert.equal(tts.code, "bad_content_type");
  });

  it("slow health is treated as not running", async () => {
    const provider = createLocalHttpVoiceProvider({
      baseUrl: "http://127.0.0.1:7860",
      fetchImpl: async (_url, init) => {
        await new Promise((_, reject) => {
          const err = new Error("aborted");
          if (init?.signal) {
            init.signal.addEventListener("abort", () => reject(err));
          }
        });
        return new Response("{}");
      },
    });
    const st = await provider.status();
    assert.equal(st.canClone, false);
  });
});

describe("local mock HTTP server (mock-verified flow helpers)", () => {
  it("serves health JSON from a tiny loopback server", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, status: "ok", backend: "mock-tone", watermark: { enabled: false, name: null, note: "mock" } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}`;
    const provider = createLocalHttpVoiceProvider({ baseUrl: base });
    const st = await provider.status();
    assert.equal(st.canClone, true);
    assert.equal(st.backend, "mock-tone");
    await new Promise<void>((r) => server.close(() => r()));
  });
});
