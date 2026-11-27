import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activeConversationIds,
  isNuanceKey,
  mintNuanceSession,
  publicPersonaRefusal,
  publicNuanceError,
  redactSecrets,
  sessionRequest,
} from "./nuance-live.ts";
import { isSafeSecretsPath, readNuanceKey, readOwnerNuanceKey, saveNuanceKey, saveOwnerNuanceKey } from "./nuance-live.server.ts";
import type { Sql } from "../db.ts";

const FAKE_KEY = "nk_testkey012345678901234567890";

test("a key-shaped value is accepted and a session token is not", () => {
  assert.equal(isNuanceKey(FAKE_KEY), true);
  assert.equal(isNuanceKey("st_testkey012345678901234567890"), false);
  assert.equal(isNuanceKey("sk-live-secret"), false);
  assert.equal(isNuanceKey(""), false);
});

test("the session prompt names Sonia as an AI and does not carry a key", () => {
  const body = sessionRequest("owner-" + "a".repeat(32), false);
  assert.equal(body.personality.persona_id, "sonia");
  assert.match(body.personality.system_prompt, /not a human/);
  assert.equal(body.interface_setup.video.input.camera, false);
  assert.equal(JSON.stringify(body).includes("nk_"), false);
});

test("Sam and Mira can be selected and Emma cannot", () => {
  assert.equal(sessionRequest("owner-" + "a".repeat(32), false, "sam").personality.persona_id, "sam");
  assert.equal(sessionRequest("owner-" + "a".repeat(32), false, "mira").personality.persona_id, "mira");
  assert.match(publicPersonaRefusal("emma"), /reserved/);
  assert.equal(publicPersonaRefusal("emma").includes("nk_"), false);
});

test("an active conversation list keeps only ids", () => {
  const ids = activeConversationIds(JSON.stringify({
    items: [{ id: "51d8137c-3d4a-4d6c-a373-e47ac75ffb80", status: "connected" }, { id: "not-an-id" }],
  }));
  assert.deepEqual(ids, ["51d8137c-3d4a-4d6c-a373-e47ac75ffb80"]);
});

test("a reserved persona error does not keep the key", () => {
  const text = publicNuanceError(400, "reserved_persona nk_live0123456789012345678901");
  assert.match(text, /Emma is reserved/);
  assert.equal(text.includes("nk_"), false);
});

test("public errors never keep a key or token", () => {
  const text = publicNuanceError(401, `refused nk_live0123456789012345678901 and st_session0123456789`);
  assert.equal(text.includes("nk_"), false);
  assert.equal(text.includes("st_"), false);
  assert.match(redactSecrets("nk_live0123456789012345678901"), /\[key\]/);
});

test("mint returns a token and does not echo the key", async () => {
  const result = await mintNuanceSession({
    key: FAKE_KEY,
    endUserId: "owner-" + "b".repeat(32),
    camera: false,
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${FAKE_KEY}`);
      return new Response(JSON.stringify({ token: "st_session0123456789" }), { status: 201 });
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.token.startsWith("st_"), true);
});

test("a refused key becomes a public error", async () => {
  const result = await mintNuanceSession({
    key: FAKE_KEY,
    endUserId: "owner-" + "c".repeat(32),
    camera: false,
    fetchImpl: async () => new Response("bad nk_testkey012345678901234567890", { status: 401 }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.includes("nk_"), false);
    assert.match(result.error, /refused/);
  }
});

test("the key file stays outside the repo and round-trips", () => {
  assert.equal(isSafeSecretsPath("/tmp/adrian-visual-handoff/.env"), false);
  const dir = mkdtempSync(join(tmpdir(), "nuance-secret-"));
  const path = join(dir, ".secrets", "nuance_live.env");
  try {
    assert.equal(saveNuanceKey(FAKE_KEY, path).ok, true);
    assert.equal(readNuanceKey(path), FAKE_KEY);
    assert.equal(readFileSync(path, "utf8").includes("NUANCE_API_KEY="), true);
    assert.equal(saveNuanceKey("not-a-key", path).ok, false);
    assert.equal(readNuanceKey(path), FAKE_KEY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted Nuance keys are encrypted, owner-scoped, and confirmed after save", async () => {
  const rows = new Map<string, string>();
  const sql = (async () => []) as unknown as Sql;
  sql.query = async <T>(text: string, params: unknown[] = []) => {
    const owner = String(params[0] ?? "");
    if (/^select access_token_enc/i.test(text.trim())) {
      const encrypted = rows.get(owner);
      return (encrypted ? [{ access_token_enc: encrypted }] : []) as T[];
    }
    if (/^insert into mind_oauth_connections/i.test(text.trim())) {
      assert.equal(params[1], "nuance");
      rows.set(owner, String(params[2] ?? ""));
      return [] as T[];
    }
    throw new Error("unexpected query");
  };
  const deps = { sql, secret: "nuance-test-encryption-secret" };
  assert.deepEqual(await saveOwnerNuanceKey("owner-a", FAKE_KEY, deps), { ok: true });
  assert.notEqual(rows.get("owner-a"), FAKE_KEY);
  assert.equal(await readOwnerNuanceKey("owner-a", deps), FAKE_KEY);
  assert.equal(await readOwnerNuanceKey("owner-b", deps), null);
  assert.deepEqual(await saveOwnerNuanceKey("owner-b", "not-a-key", deps), {
    ok: false,
    error: "That is not a Nuance key. Nothing was saved.",
  });
  assert.equal(JSON.stringify([...rows.entries()]).includes(FAKE_KEY), false);
});
