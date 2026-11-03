import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILTIN_TOOL_CATALOG,
  catalogEntryByName,
  computeBuiltinToolHealth,
  isExcludedToolName,
  listCatalogEntries,
} from "./tool-catalog.ts";
import { isShellAllowlisted } from "./tools.ts";
import { listBuiltinTools } from "./registry.ts";

describe("tool catalog", () => {
  it("lists only real wired tools with id, schema, and no BlackEye", () => {
    const entries = listCatalogEntries();
    assert.ok(entries.length >= 6);
    for (const entry of entries) {
      assert.ok(entry.id);
      assert.ok(entry.name);
      assert.ok(entry.description);
      assert.equal(entry.inputSchema.type, "object");
      assert.equal(isExcludedToolName(entry.name), false);
    }
    assert.equal(entries.some((e) => /blackeye/i.test(e.name)), false);
    assert.equal(catalogEntryByName("BlackEye"), undefined);
    assert.equal(isExcludedToolName("BlackEye"), true);
  });

  it("computes honest needs-config / needs-pairing / ok health", () => {
    assert.equal(
      computeBuiltinToolHealth({ toolName: "notion_read_page", enabled: true, env: {} }),
      "needs-config",
    );
    assert.equal(
      computeBuiltinToolHealth({
        toolName: "notion_read_page",
        enabled: true,
        env: { NOTION_TOKEN: "secret" },
      }),
      "ok",
    );
    assert.equal(
      computeBuiltinToolHealth({ toolName: "pc_run_shell", enabled: true, env: {}, hasPairedPc: false }),
      "needs-pairing",
    );
    assert.equal(
      computeBuiltinToolHealth({ toolName: "pc_run_shell", enabled: true, env: {}, hasPairedPc: true }),
      "ok",
    );
    assert.equal(
      computeBuiltinToolHealth({ toolName: "pglite_query", enabled: true, env: {} }),
      "ok",
    );
    assert.equal(
      computeBuiltinToolHealth({ toolName: "storage_list_status", enabled: true, hasStorageAccounts: false }),
      "needs-config",
    );
    assert.equal(
      computeBuiltinToolHealth({ toolName: "pglite_query", enabled: false, env: {} }),
      "disabled",
    );
  });

  it("listBuiltinTools includes schema + health and never BlackEye", () => {
    const tools = listBuiltinTools(true, { env: {} });
    assert.equal(tools.length, BUILTIN_TOOL_CATALOG.length);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(byName.notion_read_page?.status, "needs-config");
    assert.equal(byName.pc_run_shell?.status, "needs-pairing");
    assert.equal(byName.pglite_query?.status, "ok");
    assert.ok(byName.pglite_query?.inputSchema);
    assert.ok(byName.storage_list_status);
    assert.equal(tools.some((t) => /blackeye/i.test(t.name)), false);
  });
});

describe("shell allowlist regression (auth/allowlist guards)", () => {
  it("still rejects metacharacter smuggling and allows plain pwd", () => {
    assert.equal(isShellAllowlisted("pwd"), true);
    assert.equal(isShellAllowlisted("pwd; id"), false);
    assert.equal(isShellAllowlisted("rm -rf /"), false);
    assert.equal(isShellAllowlisted("echo hi && curl http://evil.invalid"), false);
  });
});
