/**
 * Minimal live xAI chat per concrete model tier via the app's resolveModelTier mapping.
 * Loads /home/box/.secrets/xai_inference.env into process.env only. Never prints the key.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const secretsPath = "/home/box/.secrets/xai_inference.env";
const outPath = join(root, "docs/live-tier-check.md");
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const TIERS = ["Fast", "Expert", "Heavy", "Build"];

function loadSecrets(path = secretsPath) {
  if (!existsSync(path)) return false;
  const body = readFileSync(path, "utf8");
  for (const line of body.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?XAI_API_KEY=(.*)$/);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) {
      process.env.XAI_API_KEY = value;
      return true;
    }
  }
  return Boolean(process.env.XAI_API_KEY?.trim());
}

async function callOnce({ model, temperature, max_tokens, reasoning_effort }) {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return { ok: false, error: "missing_key", status: null, returnedModel: null, text: "" };
  const body = {
    model,
    messages: [{ role: "user", content: "Reply with OK" }],
    temperature: temperature ?? 0,
    max_tokens: Math.min(max_tokens ?? 16, 16),
    stream: false,
  };
  if (reasoning_effort) body.reasoning_effort = reasoning_effort;
  let res;
  try {
    res = await fetch(XAI_CHAT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unreachable", status: null, returnedModel: null, text: "" };
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  const text = payload?.choices?.[0]?.message?.content ?? "";
  const returnedModel = typeof payload?.model === "string" ? payload.model : null;
  if (!res.ok) {
    const msg = typeof payload?.error === "string" ? payload.error : payload?.error?.message || `http_${res.status}`;
    return { ok: false, error: String(msg), status: res.status, returnedModel, text: "" };
  }
  if (!String(text).trim()) {
    return { ok: false, error: "empty_reply", status: res.status, returnedModel, text: "" };
  }
  return { ok: true, error: null, status: res.status, returnedModel, text: String(text).slice(0, 80) };
}

async function main() {
  const loaded = loadSecrets();
  const { resolveModelTier } = await import(pathToFileURL(join(root, "src/lib/mind/model-tiers.ts")).href);
  const rows = [];
  let allOk = true;
  for (const tier of TIERS) {
    const resolved = resolveModelTier(tier, "Reply with OK", process.env);
    let result = await callOnce({
      model: resolved.model,
      temperature: 0,
      max_tokens: 16,
      reasoning_effort: resolved.params.reasoning_effort,
    });
    if (!result.ok) {
      // one retry only
      result = await callOnce({
        model: resolved.model,
        temperature: 0,
        max_tokens: 16,
        reasoning_effort: resolved.params.reasoning_effort,
      });
    }
    if (!result.ok) allOk = false;
    rows.push({
      tier,
      requestedModel: resolved.model,
      returnedModel: result.returnedModel,
      ok: result.ok,
      status: result.status,
      error: result.error,
      textPreview: result.ok ? result.text.replace(/\s+/g, " ").trim() : "",
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ tier, requestedModel: resolved.model, ok: result.ok, returnedModel: result.returnedModel, status: result.status, error: result.error }));
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const zone = "Africa/Lagos (UTC+1)";
  const at = new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos" });
  const md = [
    `# Live model-tier check`,
    ``,
    `- At: ${at} (${zone})`,
    `- Secrets loaded: ${loaded ? "yes (path only; value not logged)" : "no"}`,
    `- Secrets path: \`/home/box/.secrets/xai_inference.env\``,
    `- Prompt: \`Reply with OK\` · max_tokens: 16`,
    `- Mapping: \`resolveModelTier\` from \`src/lib/mind/model-tiers.ts\``,
    ``,
    `| Tier | Requested model | Returned model | OK | Status | Error / preview |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...rows.map((r) =>
      `| ${r.tier} | \`${r.requestedModel}\` | ${r.returnedModel ? `\`${r.returnedModel}\`` : "—"} | ${r.ok ? "yes" : "no"} | ${r.status ?? "—"} | ${r.ok ? r.textPreview : r.error} |`,
    ),
    ``,
    `All four tiers OK: **${allOk ? "yes" : "no"}**`,
    ``,
  ].join("\n");
  writeFileSync(outPath, md);
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
