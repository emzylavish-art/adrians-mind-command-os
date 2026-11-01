const optedIn = process.env.MIND_LIVE_GROK === "1";
if (!optedIn) {
  console.error("Live Grok check skipped. Set MIND_LIVE_GROK=1 to send one grok-4.5 request.");
  process.exit(2);
}

import { readFileSync, existsSync } from "node:fs";

function loadInferenceKey() {
  const path = process.env.XAI_INFERENCE_ENV_FILE || "/home/box/.secrets/xai_inference.env";
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\n/)) {
      const m = line.trim().match(/^(?:export\s+)?XAI_API_KEY=(.*)$/);
      if (!m) continue;
      let value = m[1].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (value) return value;
    }
  }
  return process.env.XAI_API_KEY?.trim() || "";
}

const key = loadInferenceKey();
const mgmt = process.env.XAI_MANAGEMENT_KEY?.trim() || "";
if (!key) {
  console.error("XAI_API_KEY is not set. Nothing was sent.");
  process.exit(1);
}
if (mgmt && key === mgmt) {
  console.error("XAI_API_KEY matches XAI_MANAGEMENT_KEY. Nothing was sent.");
  process.exit(1);
}

const response = await fetch("https://api.x.ai/v1/chat/completions", {
  method: "POST",
  signal: AbortSignal.timeout(25_000),
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: "grok-4.5",
    messages: [{ role: "user", content: "Reply with the single word pong." }],
    max_tokens: 16,
    temperature: 0,
    stream: false,
  }),
});

if (!response.ok) {
  console.error(`Grok returned ${response.status}. Nothing was marked verified.`);
  process.exit(1);
}
const payload = await response.json();
const text = payload?.choices?.[0]?.message?.content;
if (typeof text !== "string" || !text.trim()) {
  console.error("Grok returned an empty reply. Nothing was marked verified.");
  process.exit(1);
}
console.log("Live Grok check returned text. Model grok-4.5.");
