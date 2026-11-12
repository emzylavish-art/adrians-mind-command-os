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
  assert.equal(summary.fully_integrated, 0);
  const byId = Object.fromEntries(KIMI_CAPABILITIES.map((item) => [item.id, item]));
  assert.equal(byId.task_submit?.status, "limited");
  assert.match(byId.task_submit?.evidence || "", /node_modules\/@moonshot-ai\/kimi-code/);
  assert.match(byId.task_submit?.evidence || "", /saved Grok key/);
  assert.equal(byId.agent_output?.status, "limited");
  assert.match(byId.agent_output?.evidence || "", /https:\/\/datatracker\.ietf\.org\/doc\/html\/rfc2616/);
  assert.equal(byId.web_research?.status, "limited");
  assert.match(byId.web_research?.evidence || "", /WebSearch and FetchURL/);
  assert.equal(byId.hooks?.status, "limited");
  assert.match(byId.hooks?.evidence || "", /SessionStart, UserPromptSubmit, SubagentStart, and PostToolUse/);
  assert.match(byId.subagents?.evidence || "", /research-web/);
  assert.equal(KIMI_CAPABILITIES.find((item) => item.id === "subagents")?.status, "limited");
  assert.match(byId.plugins_skills?.evidence || "", /adrian-coding/);
  assert.match(byId.plugins_skills?.evidence || "", /research-web/);
  assert.equal(byId.planning_modes?.status, "limited");
  assert.equal(byId.session_resume_fork?.status, "limited");
  assert.equal(byId.git_write?.status, "limited");
  assert.equal(KIMI_CAPABILITIES.find((item) => item.id === "voice_audio")?.status, "not_supported");
  assert.equal(byId.provider_select?.status, "limited");
  assert.equal(byId.provider_key?.status, "limited");
  const stale = KIMI_CAPABILITIES.filter((item) => /CLI login|Kimi Code access|coding prompt was rejected|account rejected/i.test(item.evidence));
  assert.deepEqual(stale.map((item) => item.id), []);
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
