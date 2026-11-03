import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertRegistryLoadInvariants,
  builtinCatalogAsRegistryEntries,
  isGithubSourcedRegistryTool,
  isGodEyeName,
  isHardExcludedRegistryName,
  loadFilteredToolRegistry,
  loadRegistryJsonFile,
  loadToolsPagePayload,
  loadVerificationRecords,
} from "./load-registry.ts";
import { BUILTIN_TOOL_CATALOG } from "../mcp/tool-catalog.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const registryPath = join(repoRoot, "tools", "registry.json");
const verificationsDir = join(repoRoot, "tools", "verifications");

describe("governance #73 tool registry load (real tools/registry.json)", () => {
  it("loads the committed registry.json from disk (no mock fixtures)", () => {
    assert.equal(existsSync(registryPath), true, `expected ${registryPath}`);
    const raw = loadRegistryJsonFile(registryPath);
    assert.ok(raw.tools.length >= 10, "registry must contain real catalog entries");
    const names = raw.tools.map((t) => t.name);
    assert.ok(names.includes("BlackEye"), "BlackEye must exist on disk so exclusion is tested for real");
    assert.ok(names.includes("L1B3RT4S"), "L1B3RT4S must exist on disk so exclusion is tested for real");
    assert.ok(
      names.some((n) => isGodEyeName(n)) || names.includes("God's Eyes"),
      "GodEye / God's Eyes must be present in the real registry",
    );
  });

  it("hard-excludes BlackEye and L1B3RT4S at load", () => {
    assert.equal(isHardExcludedRegistryName("BlackEye"), true);
    assert.equal(isHardExcludedRegistryName("L1B3RT4S"), true);
    const loaded = loadFilteredToolRegistry({ registryPath, verificationsDir });
    const names = loaded.map((t) => t.name.toLowerCase());
    assert.equal(names.includes("blackeye"), false);
    assert.equal(names.includes("l1b3rt4s"), false);
    assertRegistryLoadInvariants({ registryPath, verificationsDir });
  });

  it("marks every GitHub-sourced tool including GodEye unverified and not callable without a verification record", () => {
    const loaded = loadFilteredToolRegistry({ registryPath, verificationsDir });
    const githubish = loaded.filter((t) => t.githubSourced);
    assert.ok(githubish.length > 0, "expected GitHub-sourced rows in real registry");
    for (const t of githubish) {
      assert.equal(t.callable, false, `${t.name} must not be callable without verification`);
      assert.equal(t.verification, null);
      assert.equal(t.reasonNotCallable, "unverified-github-source");
    }
    const godeye = loaded.find((t) => isGodEyeName(t.name));
    assert.ok(godeye, "GodEye must survive load (not hard-excluded)");
    assert.equal(godeye!.callable, false);
    assert.equal(isGithubSourcedRegistryTool(godeye!), true);
  });

  it("tool-catalog.ts remains the SSOT for callable MCP builtins on /tools", () => {
    const payload = loadToolsPagePayload({ registryPath, verificationsDir });
    assert.equal(payload.sourceOfTruth, "src/lib/mind/mcp/tool-catalog.ts");
    assert.equal(payload.builtins.length, BUILTIN_TOOL_CATALOG.length);
    for (const b of payload.builtins) {
      assert.equal(b.callable, true);
      assert.equal(b.githubSourced, false);
      assert.equal(b.category, "mcp-builtin");
    }
    const fromHelper = builtinCatalogAsRegistryEntries();
    assert.equal(fromHelper.length, payload.builtins.length);
    // Empty verifications dir → no verification records
    assert.equal(loadVerificationRecords(verificationsDir).size, 0);
  });
});
