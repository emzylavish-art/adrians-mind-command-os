import assert from "node:assert/strict";
import { test } from "node:test";
import { accountPreferences } from "./account-preferences.ts";
import { createDraft, emptyLibrary, reviewDraft, reviseDraft, serializeLibrary, STORAGE_KEY } from "./skill-library.ts";
import { activateReviewedSkill, activeAccountSkills, collectAccountSkillApplications, SKILL_ACTIVATIONS_KEY, skillApplicationContext, validateSkillFixture } from "./skill-activation.ts";

test("activation requires exact reviewed bytes, a matching fixture, and explicit approval", () => {
  const draft = createDraft(emptyLibrary(), { title: "Accessibility", summary: "Accessible frontend review", body: "Check keyboard navigation." });
  assert.equal(validateSkillFixture(draft, "draft-1", "accessible UI").ok, false);
  const reviewed = reviewDraft(draft, "draft-1");
  const validation = validateSkillFixture(reviewed, "draft-1", "Review the accessible UI");
  assert.equal(validation.ok, true);
  assert.throws(() => activateReviewedSkill(reviewed, [], "draft-1", validation, "chat", false), /Explicit/);
  assert.throws(() => activateReviewedSkill(reviseDraft(reviewed, "draft-1", { title: "Changed", summary: "", body: "new" }), [], "draft-1", validation, "chat", true), /reviewed/);
});
test("account-owned approved version applies, revisions remain inactive, disable stops future use", () => {
  const values = new Map<string, string>();
  const browser = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const a = accountPreferences(browser, "a"), b = accountPreferences(browser, "b");
  const reviewed = reviewDraft(createDraft(emptyLibrary(), { title: "Accessibility", summary: "Accessible frontend review", body: "Check keyboard navigation." }), "draft-1");
  const activations = activateReviewedSkill(reviewed, [], "draft-1", validateSkillFixture(reviewed, "draft-1", "Review accessible UI"), "chat", true);
  a.setItem(STORAGE_KEY, serializeLibrary(reviseDraft(reviewed, "draft-1", { title: "Unapproved", summary: "", body: "new text" })));
  a.setItem(SKILL_ACTIVATIONS_KEY, JSON.stringify(activations));
  assert.equal(activeAccountSkills(a)[0].version, 2); assert.deepEqual(activeAccountSkills(b), []);
  const selected = collectAccountSkillApplications(a, "Review accessible UI");
  assert.equal(selected.applications.length, 1); assert.equal(selected.applications[0].body, "Check keyboard navigation.");
  const applied = skillApplicationContext(selected.applications);
  assert.equal(applied.receipts[0].stage, "instructions_applied"); assert.deepEqual(applied.receipts[0].toolsExecuted, []); assert.equal(applied.receipts[0].verified, false);
  a.setItem(SKILL_ACTIVATIONS_KEY, JSON.stringify(activations.map(item => ({ ...item, enabled: false }))));
  assert.deepEqual(collectAccountSkillApplications(a, "Review accessible UI").applications, []);
});
