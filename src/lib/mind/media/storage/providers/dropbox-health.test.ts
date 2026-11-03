import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDropboxProvider } from "./dropbox.ts";

describe("dropbox health uses files.list_folder (files.* scopes)", () => {
  it("connects when list_folder succeeds even if account APIs would need account_info.read", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/files/list_folder")) {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ entries: [], cursor: "c", has_more: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ error_summary: "missing_scope/" }), { status: 401 });
    };
    const provider = createDropboxProvider(fetchImpl as unknown as typeof fetch);
    const health = await provider.health("token");
    assert.equal(health.connected, true);
    assert.ok(calls.some((c) => c.includes("/files/list_folder")));
    assert.equal(calls.some((c) => c.includes("/users/get_current_account")), false);
  });

  it("surfaces missing_scope honestly when list_folder is refused", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          error_summary: "missing_scope/",
          error: { ".tag": "missing_scope", required_scope: "files.content.read" },
        }),
        { status: 401 },
      );
    const provider = createDropboxProvider(fetchImpl as unknown as typeof fetch);
    const health = await provider.health("token");
    assert.equal(health.connected, false);
    assert.match(health.detail || "", /missing required scope/i);
  });
});
