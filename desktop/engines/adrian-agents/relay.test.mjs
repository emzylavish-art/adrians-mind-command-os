import assert from "node:assert/strict";
import test from "node:test";
import { humanNotice, pcBeat, readRelayEnv } from "./relay.mjs";

test("a missing Supabase key stops the PC", async () => {
  const result = await pcBeat(async () => { throw new Error("must not call"); }, {}, 1000, 1000, "ok");
  assert.equal(result.stopped, true);
  assert.match(result.refused, /not configured/);
  assert.equal(readRelayEnv({}).refused.includes("Supabase"), true);
});

test("a configured relay renews the lease and Telegram stays a human notice", async () => {
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret", ADRIAN_TELEGRAM_USER_ID: "9" };
  let stored = null;
  const fetchImpl = async (url, options = {}) => {
    if (!options.method) return { ok: true, json: async () => stored ? [stored] : [] };
    stored = JSON.parse(options.body);
    return { ok: true, json: async () => stored };
  };
  const beat = await pcBeat(fetchImpl, env, 5000, 5000, "ok");
  assert.equal(beat.stopped, false);
  assert.equal(stored.owner, "pc");
  assert.equal(humanNotice(env, "8", "PC down").refused, "That Telegram user is not on the allowlist.");
  assert.equal(humanNotice(env, "9", "PC down").deviceToDevice, false);
});
