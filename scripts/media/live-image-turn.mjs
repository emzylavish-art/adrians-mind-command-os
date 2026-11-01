#!/usr/bin/env node
/**
 * Live multimodal Direct-turn probe against xAI via app packaging helpers.
 * Loads XAI_API_KEY from env or /home/box/.secrets/xai_inference.env.
 * Never prints the key. Writes scripts/media/live-image-result.json
 *
 * xAI rejects images under 512 total pixels / under 8px edge.
 */
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const outPath = join(__dirname, "live-image-result.json");

function loadKey() {
  if (process.env.XAI_API_KEY?.trim()) return process.env.XAI_API_KEY.trim();
  const p = "/home/box/.secrets/xai_inference.env";
  if (!existsSync(p)) throw new Error("XAI_API_KEY missing and secrets file not found");
  for (const line of readFileSync(p, "utf8").split(/\n/)) {
    const m = line.trim().match(/^(?:export\s+)?XAI_API_KEY=(.*)$/);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) return v;
  }
  throw new Error("XAI_API_KEY not found in secrets file");
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Solid red PNG large enough for xAI vision (≥512 pixels). */
function redPngDataUrl(size = 32) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      row[1 + x * 3] = 220;
      row[2 + x * 3] = 20;
      row[3 + x * 3] = 20;
    }
    rows.push(row);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function main() {
  const key = loadKey();
  process.env.XAI_API_KEY = key;

  const packMod = await import(pathToFileURL(join(root, "src/lib/mind/media/pack.ts")).href);
  const relayMod = await import(pathToFileURL(join(root, "src/lib/mind/relay.ts")).href);
  const streamMod = await import(pathToFileURL(join(root, "src/lib/mind/stream.ts")).href);
  const tiersMod = await import(pathToFileURL(join(root, "src/lib/mind/model-tiers.ts")).href);

  const dataUrl = redPngDataUrl(32);
  const content = packMod.packageMultimodalContent(
    "What dominant color is this image? Reply with one word only: red, green, blue, or other.",
    [{ dataUrl, name: "red-32.png" }],
  );
  const tier = tiersMod.resolveModelTier("Fast", "color of image", process.env);
  const body = relayMod.buildRelayModelBody(tier.model, [{ role: "user", content }], {
    temperature: 0,
    max_tokens: 32,
  });
  body.stream = false;
  delete body.stream_options;

  const started = Date.now();
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const latencyMs = Date.now() - started;
  const parsed = streamMod.readModelPayload(raw);
  const report = {
    ok: res.ok && Boolean(parsed.text.trim()),
    status: res.status,
    model: tier.model,
    requestId: res.headers.get("x-request-id"),
    latencyMs,
    reply: parsed.text.trim().slice(0, 500),
    sawImageHint: /red/i.test(parsed.text),
    packaging: {
      parts: content.map((p) =>
        p.type === "text"
          ? { type: "text", text: p.text.slice(0, 80) }
          : { type: "image_url", urlPrefix: p.image_url.url.slice(0, 32) },
      ),
    },
    note: "Uses app media packaging + relay body builder (Direct path shape). Key not logged.",
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        model: report.model,
        reply: report.reply,
        sawImageHint: report.sawImageHint,
        latencyMs: report.latencyMs,
        status: report.status,
      },
      null,
      2,
    ),
  );
  if (!report.ok) {
    console.error(raw.slice(0, 400));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
