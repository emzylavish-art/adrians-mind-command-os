#!/usr/bin/env node
/**
 * Live Grok Imagine smoke test. Loads key from /home/box/.secrets/xai_inference.env
 * (never prints it). Saves one image under /workspace/audit/media-integration/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SECRETS = "/home/box/.secrets/xai_inference.env";
const MODEL = "grok-imagine-image";
const OUT_DIR = "/workspace/audit/media-integration";

function loadKey() {
  if (existsSync(SECRETS)) {
    for (const line of readFileSync(SECRETS, "utf8").split("\n")) {
      const m = line.trim().match(/^(?:export\s+)?XAI_API_KEY=(.*)$/);
      if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v) return v;
    }
  }
  return process.env.XAI_API_KEY?.trim() || "";
}

const key = loadKey();
if (!key) {
  console.error(JSON.stringify({ ok: false, error: "missing_key" }));
  process.exit(1);
}

const response = await fetch("https://api.x.ai/v1/images/generations", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    prompt: "a small solid red circle centered on a plain white background, flat simple icon, no text",
    n: 1,
    response_format: "b64_json",
  }),
});

const body = await response.json();
if (!response.ok) {
  console.error(JSON.stringify({ ok: false, status: response.status, error: body?.error ?? body }));
  process.exit(1);
}

const row = body?.data?.[0];
const b64 = row?.b64_json;
if (!b64) {
  console.error(JSON.stringify({ ok: false, error: "no_b64", keys: Object.keys(body || {}) }));
  process.exit(1);
}

const buf = Buffer.from(b64, "base64");
const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
const outPath = join(OUT_DIR, isJpg ? "imagine-live.jpg" : "imagine-live.png");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(outPath, buf);

const resultPath = join(dirname(fileURLToPath(import.meta.url)), "live-imagine-result.json");
const summary = {
  ok: true,
  model: MODEL,
  endpoint: "POST https://api.x.ai/v1/images/generations",
  mime: row.mime_type || (isJpg ? "image/jpeg" : "image/png"),
  bytes: buf.length,
  saved: outPath,
  at: new Date().toISOString(),
};
writeFileSync(resultPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
