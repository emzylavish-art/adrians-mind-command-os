import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

test("C2 AA110/111: additive migration and atomic model receipts preserve independent models and owner isolation", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("create table mind_ai_providers(user_id text not null, id text not null, base_url text, default_model text, models jsonb, status text, last_error text, updated_at timestamptz, primary key(user_id,id)); insert into mind_ai_providers(user_id,id) values('owner-a','provider'),('owner-b','provider');");
    await db.exec(readFileSync(new URL("../../../migrations/0019_c2_model_profiles.sql", import.meta.url), "utf8"));
    const source = readFileSync(new URL("./ai-provider-config.server.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function recordModelExecution");
    const end = source.indexOf("\nconst OFFICIAL_API_BASES", start);
    const context: any = { profileRecord: (profiles: Array<{ id: string }>) => Object.fromEntries(profiles.map((profile) => [profile.id, profile])) };
    runInNewContext(stripTypeScriptTypes(source.slice(start, end).replaceAll("export ", "")), context);
    const sql = { query: async (query: string, values: unknown[]) => (await db.query(query, values)).rows };
    await Promise.all(["model-a", "model-b"].map((model) => context.recordModelExecution(sql, "owner-a", "provider", model, { outcome: "succeeded", at: "2026-11-25T00:00:00Z", requestedModel: model, reportedModel: `${model}-reported` })));
    const rows = await db.query<{ user_id: string; model_profiles: Record<string, any> }>("select user_id,model_profiles from mind_ai_providers order by user_id");
    assert.deepEqual(Object.keys(rows.rows[0].model_profiles).sort(), ["model-a", "model-b"]);
    assert.equal(rows.rows[0].model_profiles["model-a"].lastExecution.reportedModel, "model-a-reported");
    assert.deepEqual(rows.rows[1].model_profiles, {});
    // A catalog request started before those calls must preserve their newer receipts.
    await context.recordModelCatalogue(sql, "owner-a", "provider", { baseUrl: "https://api.fixture.invalid", defaultModel: "model-a", models: ["model-a", "model-b"], status: "catalogued", lastError: "", profiles: [{ id: "model-a", contextTokens: 8192 }, { id: "model-b", contextTokens: 16384 }] });
    const refreshed = await db.query<{ model_profiles: Record<string, any> }>("select model_profiles from mind_ai_providers where user_id='owner-a'");
    assert.equal(refreshed.rows[0].model_profiles["model-a"].contextTokens, 8192);
    assert.equal(refreshed.rows[0].model_profiles["model-a"].lastExecution.reportedModel, "model-a-reported");
    assert.equal(refreshed.rows[0].model_profiles["model-b"].lastExecution.reportedModel, "model-b-reported");
  } finally { await db.close(); }
});
