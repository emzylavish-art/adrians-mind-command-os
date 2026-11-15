import assert from "node:assert/strict";
import test from "node:test";
import { accountWorkspaceKey, emptyWorkspace, isPrimaryOwner, loadWorkspaceForAccount, WORKSPACE_KEY } from "./workspace.ts";

test("a second account does not see the owner workspace", () => {
  const owner = {
    ...emptyWorkspace(),
    chats: [{ id: "owner-chat", title: "Private", memory: "off" as const, temporary: false, autonomy: "ask" as const, personalityId: "direct", customPersonality: "", projectId: null, messages: [], retrievalLog: [] }],
  };
  const values = new Map<string, string>([
    [accountWorkspaceKey("owner-1"), JSON.stringify(owner)],
    [WORKSPACE_KEY, JSON.stringify(owner)],
  ]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  const second = loadWorkspaceForAccount(storage, "signup-2", "new@example.com");
  assert.equal(second.chats.length, 0);
  assert.equal(accountWorkspaceKey("owner-1") === accountWorkspaceKey("signup-2"), false);
  assert.equal(isPrimaryOwner("emzylavish@gmail.com"), true);
  assert.equal(isPrimaryOwner("new@example.com"), false);
});
