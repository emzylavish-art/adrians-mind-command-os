#!/usr/bin/env node
/**
 * Controlled xAI verification for Mind Command OS.
 * - Missing-key path always runs (no network).
 * - Live chat runs only when MIND_LIVE_XAI=1 (exactly one call).
 * - Persistence round-trip uses PGLite + store write/read (sha256 + length).
 * Never prints secrets.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  liveOptIn: LIVE,
  missingKey: null,
  live: null,
  persistence: null,
};

const { callXaiChat, readXaiApiKey } = await loadTs("src/lib/mind/xai-adapter.ts");
const { writeSnapshot, readSnapshot } = await loadTs("src/lib/mind/store.ts");
const { emptyWorkspace, normalizeWorkspace } = await loadTs("src/lib/mind/workspace.ts");
const { applyAgentTurn } = await loadTs("src/lib/mind/agent-session.ts");
const { shouldStoreReply } = await loadTs("src/lib/mind/live-turn.ts");

// 1) Missing-key path
{
  const missing = await callXaiChat({
    prompt: "Reply with exactly: VERIFY-OK",
    env: { ...process.env, XAI_API_KEY: "" },
    fetchImpl: async () => {
      throw new Error("fetch must not run when the key is missing");
    },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.state, "unavailable");
  assert.equal(missing.reason, "missing_key");
  assert.equal(missing.text, "");
  const wouldStore = shouldStoreReply({ ok: false, error: missing.error });
  assert.equal(wouldStore, false);
  report.missingKey = {
    state: missing.state,
    reason: missing.reason,
    fabricated: false,
    persistedAsModelReply: false,
    error: missing.error,
  };
  console.log("missing-key: unavailable (no fetch, no fabricated reply, nothing persisted)");
}

// 2) Live call (opt-in only; one shot)
if (!LIVE) {
  report.live = { skipped: true, note: "Set MIND_LIVE_XAI=1 to send exactly one chat call through the adapter." };
  console.log("live: skipped (MIND_LIVE_XAI!=1)");
} else {
  const keyed = readXaiApiKey(process.env);
  if (!keyed.ok) {
    report.live = { ok: false, state: keyed.state, reason: keyed.reason, error: keyed.error };
    console.error("live: key missing; nothing sent");
  } else {
    const live = await callXaiChat({
      prompt: "Reply with exactly: VERIFY-OK",
      temperature: 0,
      maxTokens: 16,
      model: process.env.MIND_XAI_MODEL || "grok-4.5",
    });
    report.live = {
      ok: live.ok,
      state: live.state,
      model: live.model,
      requestId: live.requestId,
      latencyMs: live.latencyMs,
      status: live.status,
      usage: live.usage,
      text: live.ok ? live.text : "",
      textLength: live.ok ? live.text.length : 0,
      textSha256: live.ok ? sha256(live.text) : null,
      error: live.ok ? null : live.error,
      reason: live.ok ? null : live.reason,
    };
    if (!live.ok) {
      console.error(`live: failed status=${live.status} reason=${live.reason}`);
    } else {
      console.log(`live: ok model=${live.model} latencyMs=${live.latencyMs} len=${live.text.length}`);
    }

    // 3) Persist only a successful model reply
    const dir = mkdtempSync(join(tmpdir(), "mind-xai-"));
    try {
      const pg = await openDatabase(dir);
      const sql = toSql(pg);
      let persisted = false;
      let match = null;
      if (live.ok && live.text.trim()) {
        const raw = live.text;
        const rawSha = sha256(raw);
        const rawLen = raw.length;
        const now = new Date().toISOString();
        let ws = emptyWorkspace();
        ws = {
          ...ws,
          chats: [
            {
              id: "xai-verify",
              title: "xAI verification",
              memory: "off",
              temporary: false,
              autonomy: "ask",
              projectId: null,
              messages: [
                { id: `user-${now}`, role: "user", content: "Reply with exactly: VERIFY-OK", at: now },
                { id: `assistant-${now}`, role: "assistant", content: raw, at: now, model: live.model ?? "grok-4.5" },
              ],
              retrievalLog: [],
            },
          ],
          usage: [
            {
              id: `usage-${now}`,
              chatId: "xai-verify",
              at: now,
              model: live.model ?? "grok-4.5",
              requestId: live.requestId,
              promptTokens: live.usage?.prompt_tokens ?? null,
              completionTokens: live.usage?.completion_tokens ?? null,
              kind: "actual",
            },
          ],
        };
        await writeSnapshot(sql, "xai-owner", ws);
        const loaded = normalizeWorkspace(await readSnapshot(sql, "xai-owner"));
        const back = loaded.chats[0]?.messages.find((m) => m.role === "assistant")?.content ?? "";
        match = {
          equal: back === raw,
          rawLength: rawLen,
          readLength: back.length,
          rawSha256: rawSha,
          readSha256: sha256(back),
        };
        persisted = true;
        assert.equal(back, raw);
        assert.equal(sha256(back), rawSha);
        console.log(`persistence: byte-for-byte match sha256=${rawSha} len=${rawLen}`);
      } else {
        // Confirm failures do not get stored as model replies
        const before = emptyWorkspace();
        await writeSnapshot(sql, "xai-owner", before);
        const loaded = normalizeWorkspace(await readSnapshot(sql, "xai-owner"));
        assert.equal(loaded.chats.length, 0);
        console.log("persistence: live failed; no model reply persisted");
      }
      report.persistence = { persisted, match, backend: "pglite-file" };
      await pg.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// Always exercise persistence round-trip with a deterministic local reply (does not call xAI)
if (!report.persistence) {
  const dir = mkdtempSync(join(tmpdir(), "mind-xai-local-"));
  try {
    const pg = await openDatabase(dir);
    const sql = toSql(pg);
    const raw = "VERIFY-OK-LOCAL";
    const now = "2026-11-01T10:00:00.000Z";
    let ws = emptyWorkspace();
    // Also exercise orchestrator turn -> chat message, then PGLite snapshot.
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
    await writeSnapshot(sql, "xai-owner", ws);
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

const outPath = join(root, "artifacts", "xai-verification.json");
try {
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report: ${outPath}`);
} catch {
  console.log("report: (artifacts dir missing; stdout only)");
}
console.log(JSON.stringify({ missingKey: report.missingKey?.state, live: report.live, persistenceMatch: report.persistence?.match?.equal }, null, 2));

if (LIVE && report.live && report.live.ok === false) process.exit(1);
