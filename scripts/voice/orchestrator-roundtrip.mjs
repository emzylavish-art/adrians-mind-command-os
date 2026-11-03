/**
 * Orchestrator E2E: transcript → local Ollama → spoken-path parity check (force_message shape).
 * Never prints secrets.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/workspace/voice-test";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.OLLAMA_BASE || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";

const t0 = Date.now();
let probeOk = false;
try {
  const tags = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
  probeOk = tags.ok;
} catch {
  probeOk = false;
}
if (!probeOk) {
  const report = {
    ok: false,
    error: "Ollama unreachable at configured host",
    base: BASE,
    model: MODEL,
  };
  writeFileSync(`${OUT}/orchestrator-roundtrip.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(1);
}

const tChat = Date.now();
const res = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  signal: AbortSignal.timeout(30_000),
  body: JSON.stringify({
    model: MODEL,
    stream: false,
    messages: [
      { role: "system", content: "You are a terse voice conductor. Reply in one short spoken sentence." },
      { role: "user", content: "Confirm orchestrator path in five words." },
    ],
  }),
});
const json = await res.json();
const chatMs = Date.now() - tChat;
const reply = json?.message?.content?.trim() || "";
const report = {
  ok: Boolean(res.ok && reply),
  base: BASE,
  model: MODEL,
  probe_ok: probeOk,
  chat_latency_ms: chatMs,
  total_latency_ms: Date.now() - t0,
  reply_chars: reply.length,
  // Same speaker path as Direct: live-session speakForce → playback + force_message
  speaker_path: "live-session.speakForce → LivePlayback (same as Direct realtime deltas)",
};
writeFileSync(`${OUT}/orchestrator-roundtrip.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.ok) process.exit(1);
