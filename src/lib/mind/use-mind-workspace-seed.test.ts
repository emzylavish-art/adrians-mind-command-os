import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickInitialWorkspace } from "./sync.ts";
import { emptyWorkspace } from "./workspace.ts";
import type { Workspace } from "./types.ts";

function withChat(title: string): Workspace {
  const ws = emptyWorkspace();
  return {
    ...ws,
    chats: [
      {
        id: "c1",
        projectId: null,
        title,
        memory: "off",
        autonomy: "ask",
        temporary: false,
        messages: [{ id: "m1", role: "user", content: "hi", at: new Date().toISOString() }],
        retrievalLog: [],
      },
    ],
  };
}

describe("pickInitialWorkspace", () => {
  it("keeps local when local has content", () => {
    const local = withChat("local");
    const server = withChat("server");
    assert.equal(pickInitialWorkspace(local, server).chats[0]?.title, "local");
  });

  it("uses server when local empty and server has content", () => {
    const local = emptyWorkspace();
    const server = withChat("cloud");
    assert.equal(pickInitialWorkspace(local, server).chats[0]?.title, "cloud");
  });

  it("falls back to local empty when server null", () => {
    const local = emptyWorkspace();
    assert.equal(pickInitialWorkspace(local, null).chats.length, 0);
  });
});
