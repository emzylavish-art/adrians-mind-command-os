import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbSource } from "../../db.ts";
import { decryptSecret } from "./crypto.ts";
import { clearConnection, getRefreshToken, localNotionWorkspaces, newOAuthState, readConnection, selectLocalNotionWorkspace, setConnectorDirectory, storeAccessToken } from "./store.ts";
import { clearDurableConnection, listDurableNotionWorkspaces, readDurableConnection, saveDurableConnection, saveDurablePendingOAuth, selectDurableNotionWorkspace, takeDurablePendingOAuth } from "./durable-oauth.server.ts";

const grant = (workspaceId: string, refreshToken?: string) => ({
  ownerId: "owner", connector: "notion" as const, workspaceId, workspaceName: workspaceId,
  accessToken: "access-" + workspaceId, refreshToken,
});

test("a second workspace is saved separately; selecting it never inherits another workspace's refresh token", () => {
  process.env.CONNECTOR_TOKEN_SECRET = "synthetic-grant-test-secret";
  setConnectorDirectory(mkdtempSync(join(tmpdir(), "workspace-grants-")));
  storeAccessToken(grant("A", "refresh-A"));
  storeAccessToken(grant("A"));
  assert.equal(getRefreshToken("owner", "notion"), "refresh-A");
  storeAccessToken(grant("B"));
  assert.equal(readConnection("owner", "notion")?.workspaceId, "A");
  assert.equal(localNotionWorkspaces("owner").length, 2);
  assert.equal(localNotionWorkspaces("other").length, 0);
  selectLocalNotionWorkspace("owner", "B");
  assert.equal(getRefreshToken("owner", "notion"), null);
  clearConnection("owner", "notion");
  assert.deepEqual(localNotionWorkspaces("owner").map((row) => row.workspaceId), ["A"]);
  selectLocalNotionWorkspace("owner", "A");
  assert.equal(getRefreshToken("owner", "notion"), "refresh-A");
});

test("transactional SQL keeps grants distinct and cancels a claimed callback on disconnect", async () => {
  assert.equal(dbSource, "pglite");
  process.env.CONNECTOR_TOKEN_SECRET = "synthetic-grant-test-secret";
  async function claim() {
    const { state, codeVerifier } = newOAuthState();
    const key = newOAuthState().state;
    await saveDurablePendingOAuth({ state, codeVerifier, redirectUri: "https://fixture.invalid", connector: "notion", ownerId: "owner", createdAt: new Date().toISOString() });
    assert.ok(await takeDurablePendingOAuth(state, key));
    assert.equal(await takeDurablePendingOAuth(state, newOAuthState().state), null);
    return key;
  }
  await saveDurableConnection(grant("A", "refresh-A"), await claim());
  await saveDurableConnection(grant("B"), await claim());
  assert.equal((await readDurableConnection("owner", "notion"))?.workspaceId, "A");
  assert.deepEqual((await listDurableNotionWorkspaces("owner")).map((r) => r.workspaceId).sort(), ["A", "B"]);
  assert.deepEqual(await listDurableNotionWorkspaces("other"), []);
  await selectDurableNotionWorkspace("owner", "B");
  const b = await readDurableConnection("owner", "notion");
  assert.equal(b?.refreshTokenEnc, undefined);
  const stale = await claim();
  await clearDurableConnection("owner", "notion", b?.connectedAt);
  await assert.rejects(saveDurableConnection(grant("B"), stale), /expired|disconnected/);
  await selectDurableNotionWorkspace("owner", "A");
  const a = await readDurableConnection("owner", "notion");
  assert.equal(decryptSecret(a?.refreshTokenEnc || ""), "refresh-A");
});
