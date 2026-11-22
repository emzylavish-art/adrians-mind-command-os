import { createServer } from "node:http";
import { env, pipeline, Tensor } from "@huggingface/transformers";

const cacheDir = process.env.ADRIAN_OPUS_CACHE;
if (!cacheDir) throw new Error("Opus-MT weights are not packed with this application.");
env.cacheDir = cacheDir;
env.allowLocalModels = true;
env.allowRemoteModels = false;

const port = 4197;
const pairs = {
  es: { id: "Xenova/opus-mt-en-es", dedicated: true, prefix: "" },
  fr: { id: "Xenova/opus-mt-en-fr", dedicated: true, prefix: "" },
  de: { id: "Xenova/opus-mt-en-de", dedicated: true, prefix: "" },
  zh: { id: "Xenova/opus-mt-en-zh", dedicated: true, prefix: "" },
  pt: { id: "Xenova/opus-mt-en-ROMANCE", dedicated: false, prefix: ">>pt<< " },
};

const loaded = new Map();
const failed = new Map();

function allowedOrigin(origin) {
  if (!origin) return "http://127.0.0.1:41731";
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return origin;
  } catch {
    return "";
  }
  return "";
}

function send(response, status, body) {
  const origin = allowedOrigin(response.originHeader);
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin || "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  });
  response.end(JSON.stringify(body));
}

async function loadAll() {
  for (const [target, pair] of Object.entries(pairs)) {
    try {
      loaded.set(target, await pipeline("translation", pair.id, { dtype: "q8" }));
      console.log(`loaded ${target}`);
    } catch (error) {
      failed.set(target, error instanceof Error ? error.message : String(error));
      console.error(`failed ${target}`, failed.get(target));
    }
  }
}

async function translatePair(model, text, pair) {
  if (!pair.prefix) {
    const output = await model(text);
    const translated = Array.isArray(output) ? output[0]?.translation_text : output?.translation_text;
    return typeof translated === "string" ? translated.trim() : "";
  }
  const tokenizer = model.tokenizer;
  const pieces = tokenizer._encode_text(`${pair.prefix.trim()} ${text}`);
  const vocab = tokenizer.get_vocab();
  const ids = pieces.map((piece) => {
    const id = vocab.get(piece);
    if (id === undefined) throw new Error(`Opus-MT is missing the token ${piece}.`);
    return id;
  });
  const inputIds = new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const attentionMask = new Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]);
  const output = await model.model.generate({ input_ids: inputIds, attention_mask: attentionMask, max_new_tokens: 128 });
  const decoded = tokenizer.batch_decode(output, { skip_special_tokens: true });
  const value = Array.isArray(decoded) ? decoded[0] : decoded;
  return typeof value === "string" ? value.trim() : "";
}

const ready = loadAll();
const server = createServer(async (request, response) => {
  response.originHeader = request.headers.origin || "";
  if (request.method === "OPTIONS") {
    send(response, 204, {});
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    await ready;
    send(response, 200, {
      ok: loaded.size > 0,
      weightsLoaded: loaded.size === Object.keys(pairs).length,
      loaded: [...loaded.keys()],
      failed: Object.fromEntries(failed),
      pairs,
      google: false,
    });
    return;
  }
  if (request.method !== "POST" || request.url !== "/opus-mt") {
    send(response, 404, { ok: false, weightsLoaded: false, error: "Not the Opus-MT route." });
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    send(response, 400, { ok: false, weightsLoaded: false, error: "The translator could not read that request." });
    return;
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const target = typeof input.target === "string" ? input.target : "es";
  const pair = pairs[target];
  await ready;
  if (!text || !pair) {
    send(response, 422, { ok: false, weightsLoaded: loaded.size > 0, error: "Nothing to translate." });
    return;
  }
  const model = loaded.get(target);
  if (!model) {
    send(response, 503, { ok: false, weightsLoaded: false, pair: pair.id, error: failed.get(target) || "Opus-MT weights are not loaded." });
    return;
  }
  try {
    const value = await translatePair(model, text, pair);
    if (!value || value.includes(">>")) {
      send(response, 422, { ok: false, weightsLoaded: true, pair: pair.id, error: "Opus-MT returned no words." });
      return;
    }
    send(response, 200, {
      ok: true,
      weightsLoaded: true,
      text: value,
      pair: pair.id,
      dedicated: pair.dedicated,
      target,
      google: false,
      note: pair.dedicated
        ? `Translated by ${pair.id}. Nothing was sent to Google.`
        : `Portuguese uses ${pair.id} with a >>pt<< token. Nothing was sent to Google.`,
    });
  } catch (error) {
    send(response, 422, { ok: false, weightsLoaded: true, pair: pair.id, error: error instanceof Error ? error.message : "Opus-MT did not translate." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`opus-mt listening on ${port}`);
});
