import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KIMI_CAPABILITIES, assertNoFalseAvailability, capabilitySummary } from "./capabilities.ts";
import { listProjects, providerKeyLeaks, saveProject, saveProvider, setBuildDirectory } from "./build-store.ts";

test("capability inventory never advertises unverified features as available", () => {
  assertNoFalseAvailability();
  const summary = capabilitySummary();
  assert.equal(summary.fully_integrated + summary.limited + summary.not_supported + summary.planned, KIMI_CAPABILITIES.length);
  assert.equal(KIMI_CAPABILITIES.find((item) => item.id === "subagents")?.status, "not_supported");
  assert.equal(KIMI_CAPABILITIES.find((item) => item.id === "voice_audio")?.status, "not_supported");
});

test("projects stay owner scoped and provider responses do not leak keys", () => {
  setBuildDirectory(mkdtempSync(join(tmpdir(), "mind-build-")));
  process.env.CONNECTOR_TOKEN_SECRET = "test-secret-value-32";
  const project = saveProject({ ownerId: "owner-a", label: "App", cwd: "C:\\Work\\App", instructions: "Use TypeScript." });
  saveProject({ ownerId: "owner-b", label: "Other", cwd: "C:\\Other" });
  assert.deepEqual(listProjects("owner-a").map((item) => item.id), [project.id]);
  const provider = saveProvider({ ownerId: "owner-a", model: "kimi-k2", apiKey: "sk-test" });
  assert.equal(provider.hasKey, true);
  assert.equal(provider.runtimeUse, "not_injected");
  assert.equal(providerKeyLeaks(provider), false);
});
