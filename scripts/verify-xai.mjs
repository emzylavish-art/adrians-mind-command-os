#!/usr/bin/env node
/**
 * Controlled xAI verification for Mind Command OS.
 * - Missing-key path always runs (no secrets file, no network).
 * - Live chat runs when MIND_LIVE_XAI=1 (exactly one call after optional models list).
 * - Loads inference key from /home/box/.secrets/xai_inference.env via applyXaiInferenceSecrets.
 * - Persistence round-trip uses orchestrator + PGLite snapshot (sha256 + length).
 * Never prints secrets.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const LIVE = process.env.MIND_LIVE_XAI === "1";
const root = process.cwd();

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function toSql(pg) {
  const sql = async (strings, ...values) => {
    let text = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1] ?? ""}`;
    const result = await pg.query(text, values);
    return result.rows;
  };
  sql.query = async (text, params = []) => (await pg.query(text, params)).rows;
  if (typeof pg.transaction === "function") {
    sql.transaction = (callback) => pg.transaction((tx) => callback(toSql(tx)));
  }
  return sql;
}

async function openDatabase(dataDir) {
  const pg = new PGlite({ dataDir });
  await pg.waitReady;
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const names = readdirSync(join(root, "migrations"));
  const files = {};
  for (const name of names) {
    if (name.endsWith(".sql")) files[name] = readFileSync(join(root, "migrations", name), "utf8");
  }
  const done = (await pg.query("select name from _migrations")).rows.map((row) => row.name);
  for (const { name, path } of pendingMigrations(Object.keys(files), done)) {
    await pg.exec("begin");
    await pg.exec(files[path] ?? files[name] ?? "");
    await pg.query("insert into _migrations (name) values ($1)", [name]);
    await pg.exec("commit");
  }
  return pg;
}

async function loadTs(rel) {
  return import(pathToFileURL(join(root, rel)).href);
}

const report = {
  at: new Date().toISOString(),
  zone: "Africa/Lagos (UTC+1)",
  adapter: "src/lib/mind/xai-adapter.ts",
  secretsPath: "/home/box/.secrets/xai_inference.env",
  liveOptIn: LIVE,
  missingKey: null,
  modelsList: null,
  live: null,
  persistence: null,
  stopPoint: null,
};

const {
  applyXaiInferenceSecrets,
  callXaiChat,
  listXaiModels,
  resolveXaiInferenceApiKey,
  XAI_INFERENCE_SECRETS_PATH,
} = await loadTs("src/lib/mind/xai-adapter.ts");
const { relayModelStream } = await loadTs("src/lib/mind/relay.ts");
const { pullMindEvents } = await loadTs("src/lib/mind/stream.ts");
const { writeSnapshot, readSnapshot, snapshotRevision } = await loadTs("src/lib/mind/store.ts");
const { emptyWorkspace, normalizeWorkspace } = await loadTs("src/lib/mind/workspace.ts");
const { applyAgentTurn } = await loadTs("src/lib/mind/agent-session.ts");
const { shouldStoreReply } = await loadTs("src/lib/mind/live-turn.ts");

// 1) Missing-key path — isolated env, no secrets file
{
  const missingPath = join(tmpdir(), `xai-missing-${Date.now()}.env`);
  const env = { ...process.env, XAI_API_KEY: "" };
  delete env.XAI_API_KEY;
  assert.equal(applyXaiInferenceSecrets(env, missingPath), false);
  const missing = await callXaiChat({
    prompt: "Reply with exactly: VERIFY-OK",
    env,
    secretsPath: missingPath,
    skipSecretsFile: true,
    fetchImpl: async () => {
      throw new Error("fetch must not run when the key is missing");
    },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.state, "unavailable");
  assert.equal(missing.reason, "missing_key");
  assert.equal(missing.text, "");
  assert.equal(shouldStoreReply({ ok: false, error: missing.error }), false);
  report.missingKey = {
    state: missing.state,
    reason: missing.reason,
    fabricated: false,
    persistedAsModelReply: false,
    error: missing.error,
  };
  console.log("missing-key: unavailable (no fetch, no fabricated reply, nothing persisted)");
}

if (!LIVE) {
  report.live = { skipped: true, note: "Set MIND_LIVE_XAI=1 to send exactly one chat call through the adapter." };
  report.stopPoint = "live_skipped";
  console.log("live: skipped (MIND_LIVE_XAI!=1)");
} else {
  // Credential probe (models list only — not the chat call)
  const processEnvKeyLen = (process.env.XAI_API_KEY || "").length;
  const mgmtLen = (process.env.XAI_MANAGEMENT_KEY || "").length;
  const equalsMgmtBefore = Boolean(process.env.XAI_API_KEY) && process.env.XAI_API_KEY === process.env.XAI_MANAGEMENT_KEY;
  report.credentialProbe = {
    processApiKeyLen: processEnvKeyLen,
    managementKeyLen: mgmtLen,
    equalsManagementKeyBeforeResolve: equalsMgmtBefore,
  };
  console.log(`probe: process_api_len=${processEnvKeyLen} equals_mgmt_before=${equalsMgmtBefore}`);

  const keyed = resolveXaiInferenceApiKey(process.env, XAI_INFERENCE_SECRETS_PATH);
  if (!keyed.ok) {
    report.live = { ok: false, error: keyed.error, reason: keyed.reason };
    report.stopPoint = keyed.reason === "misconfigured_management_key" ? "management_key_refused" : "secrets_missing";
    console.error(`live: resolve failed reason=${keyed.reason}`);
    process.exit(1);
  }
  const equalsMgmtAfter = process.env.XAI_API_KEY === process.env.XAI_MANAGEMENT_KEY;
  report.credentialProbe.equalsManagementKeyAfterResolve = equalsMgmtAfter;
  report.credentialProbe.resolvedKeyLen = keyed.key.length;
  console.log(`secrets: resolved via adapter from ${XAI_INFERENCE_SECRETS_PATH} (value not printed); equals_mgmt_after=${equalsMgmtAfter}`);

  // Optional models list with resolved key (does not count as the model chat call)
  const models = await listXaiModels({});
  if (!models.ok) {
    report.modelsList = { ok: false, status: models.status, error: models.error };
    report.live = { ok: false, error: models.error, reason: models.reason, status: models.status };
    report.stopPoint = "models_list_failed";
    console.error(`models: failed status=${models.status}`);
    process.exit(1);
  }
  const preferred = process.env.MIND_XAI_MODEL || "grok-4.5";
  const model = models.ids.includes(preferred) ? preferred : models.ids.find((id) => id.startsWith("grok-4")) || models.ids[0];
  report.modelsList = { ok: true, count: models.ids.length, chosen: model, sample: models.ids.slice(0, 12), httpOk: true };
  console.log(`models: ${models.ids.length} listed; chosen=${model}`);

  // Exactly one chat call through the typed-chat server path: relayModelStream (same as handleMindTurn)
  const started = Date.now();
  const response = relayModelStream({
    apiKey: keyed.key,
    model,
    messages: [{ role: "user", content: "Reply with exactly: VERIFY-OK" }],
    usedIds: [],
    requestSignal: AbortSignal.timeout(25_000),
    timeoutMs: 25_000,
  });
  // Override max tokens/temperature by using adapter non-stream if relay hardcodes 500/0.4 —
  // typed-chat production path uses relay; keep that for fidelity.
  if (!response.ok || !response.body) {
    report.live = { ok: false, error: `typed-chat relay returned ${response.status}`, status: response.status };
    report.stopPoint = "live_api_error";
    console.error(`live: relay http ${response.status}`);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    let finished = null;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      carry += decoder.decode(step.value, { stream: true });
      const pulled = pullMindEvents(carry);
      carry = pulled.rest;
      for (const event of pulled.events) {
        if (event.event === "error" || event.event === "canceled") {
          finished = { ok: false, error: event.error, status: null, reason: "api_error" };
        }
        if (event.event === "done") {
          finished = {
            ok: true,
            text: event.text,
            model: event.model,
            usage: event.usage,
            requestId: event.requestId,
            status: 200,
          };
        }
      }
    }
    const latencyMs = Date.now() - started;
    if (!finished || !finished.ok) {
      report.live = {
        ok: false,
        path: "relayModelStream(handleMindTurn)",
        error: finished?.error || "empty stream",
        reason: finished?.reason || "empty_reply",
        latencyMs,
      };
      report.stopPoint = "live_api_error";
      console.error(`live: typed-chat path failed: ${report.live.error}`);
    } else {
      const live = finished;
      report.live = {
        ok: true,
        path: "relayModelStream(handleMindTurn)",
        state: "ok",
        model: live.model,
        requestId: live.requestId,
        latencyMs,
        status: 200,
        usage: live.usage,
        text: live.text,
        textLength: live.text.length,
        textSha256: sha256(live.text),
        error: null,
        reason: null,
      };
      console.log(`live: ok path=typed-chat/relay model=${live.model} latencyMs=${latencyMs} len=${live.text.length}`);
    }
  }
  const live = report.live;

  const dir = mkdtempSync(join(tmpdir(), "mind-xai-"));
  try {
    const pg = await openDatabase(dir);
    const sql = toSql(pg);
    if (live && live.ok && live.text && live.text.trim()) {
      const raw = live.text;
      const rawSha = sha256(raw);
      const now = new Date().toISOString();
      let ws = emptyWorkspace();
      const tools = [
        {
          id: "list_projects",
          confirm: false,
          available: true,
          unavailableReason: "",
          run: () => ({ ok: true, text: "local-tool-ok" }),
        },
      ];
      ws = applyAgentTurn(ws, {
        chatId: "xai-verify",
        text: "Reply with exactly: VERIFY-OK",
        modality: "chat",
        tools,
        toolId: "list_projects",
        now,
        complete: () => ({ ok: true, text: raw }),
      }).ws;
      // Ensure assistant content is exactly the raw model text
      const chat = ws.chats.find((c) => c.id === "xai-verify");
      if (chat) {
        const assistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
        if (assistant) assistant.content = raw;
      }
      ws = {
        ...ws,
        usage: [
          {
            id: `usage-${now}`,
            chatId: "xai-verify",
            at: now,
            model: live.model ?? model,
            requestId: live.requestId,
            promptTokens: live.usage?.prompt_tokens ?? null,
            completionTokens: live.usage?.completion_tokens ?? null,
            kind: "actual",
          },
          ...ws.usage,
        ],
      };
      await writeSnapshot(sql, "xai-owner", ws, snapshotRevision(await readSnapshot(sql, "xai-owner")));
      const loadedWs = normalizeWorkspace(await readSnapshot(sql, "xai-owner"));
      const back = loadedWs.chats[0]?.messages.find((m) => m.role === "assistant")?.content ?? "";
      const match = {
        equal: back === raw,
        rawLength: raw.length,
        readLength: back.length,
        rawSha256: rawSha,
        readSha256: sha256(back),
      };
      assert.equal(back, raw);
      assert.equal(sha256(back), rawSha);
      report.persistence = { persisted: true, match, backend: "pglite-file", liveReply: true };
      report.stopPoint = "complete";
      console.log(`persistence: byte-for-byte match sha256=${rawSha} len=${raw.length}`);
    } else {
      await writeSnapshot(sql, "xai-owner", emptyWorkspace(), snapshotRevision(await readSnapshot(sql, "xai-owner")));
      const loadedWs = normalizeWorkspace(await readSnapshot(sql, "xai-owner"));
      assert.equal(loadedWs.chats.length, 0);
      report.persistence = { persisted: false, match: null, backend: "pglite-file", liveReply: false };
      console.log("persistence: live failed; no model reply persisted");
    }
    await pg.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!report.persistence) {
  const dir = mkdtempSync(join(tmpdir(), "mind-xai-local-"));
  try {
    const pg = await openDatabase(dir);
    const sql = toSql(pg);
    const raw = "VERIFY-OK-LOCAL";
    const now = "2026-11-01T10:00:00.000Z";
    let ws = emptyWorkspace();
    const tools = [
      {
        id: "list_projects",
        confirm: false,
        available: true,
        unavailableReason: "",
        run: () => ({ ok: true, text: "local-tool-ok" }),
      },
    ];
    ws = applyAgentTurn(ws, {
      chatId: "xai-local",
      text: "local persistence probe",
      modality: "chat",
      tools,
      toolId: "list_projects",
      now,
      complete: () => ({ ok: true, text: raw }),
    }).ws;
    await writeSnapshot(sql, "xai-owner", ws, snapshotRevision(await readSnapshot(sql, "xai-owner")));
    const loaded = normalizeWorkspace(await readSnapshot(sql, "xai-owner"));
    const back = loaded.chats[0]?.messages.find((m) => m.role === "assistant")?.content ?? "";
    const match = {
      equal: back === raw,
      rawLength: raw.length,
      readLength: back.length,
      rawSha256: sha256(raw),
      readSha256: sha256(back),
      note: "local fixture (live reply unavailable or skipped)",
    };
    assert.equal(back, raw);
    report.persistence = { persisted: true, match, backend: "pglite-file", liveReply: false };
    console.log(`persistence(local): match sha256=${match.rawSha256} len=${match.rawLength}`);
    await pg.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

mkdirSync(join(root, "artifacts"), { recursive: true });
const outPath = join(root, "artifacts", "xai-verification.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report: ${outPath}`);
console.log(
  JSON.stringify(
    {
      missingKey: report.missingKey?.state,
      live: report.live && {
        ok: report.live.ok,
        skipped: report.live.skipped || false,
        model: report.live.model,
        text: report.live.text,
        latencyMs: report.live.latencyMs,
        usage: report.live.usage,
        requestId: report.live.requestId,
        error: report.live.error,
      },
      persistenceMatch: report.persistence?.match?.equal,
      stopPoint: report.stopPoint,
    },
    null,
    2,
  ),
);

if (LIVE && report.live && report.live.ok === false) process.exit(1);
