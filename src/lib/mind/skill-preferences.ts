import { SKILLS } from "./skills.ts";

export type SkillPreferences = { schema: 2; owner: string; revision: number; manual: Record<string, boolean>; automatic: Record<string, boolean> };
export type SkillPreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export function skillPreferenceKey(owner: string): string { return `amcos.skills.v2.${encodeURIComponent(owner)}`; }
export function defaultSkillPreferences(owner: string, failClosed = false): SkillPreferences {
  return { schema: 2, owner, revision: 0, manual: Object.fromEntries(SKILLS.map((skill) => [skill.id, !failClosed && skill.kind !== "not-installed"])), automatic: Object.fromEntries(SKILLS.map((skill) => [skill.id, !failClosed && skill.kind === "built-in"])) };
}
export function loadSkillPreferences(owner: string, storage: Pick<Storage, "getItem">): { preferences: SkillPreferences; error: string | null } {
  try {
    if (!owner) throw new Error("A signed-in owner is required.");
    const raw = storage.getItem(skillPreferenceKey(owner));
    if (raw === null) return { preferences: defaultSkillPreferences(owner), error: null };
    const value = JSON.parse(raw) as Partial<SkillPreferences>;
    if (value.schema !== 2 || value.owner !== owner || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new Error("Invalid skill preference identity or revision.");
    for (const mode of [value.manual, value.automatic]) {
      if (!mode || typeof mode !== "object" || Array.isArray(mode) || Object.values(mode).some((v) => typeof v !== "boolean")) throw new Error("Invalid skill preference values.");
    }
    // Unknown/new skills stay disabled until the owner reviews the updated catalog.
    return { preferences: { schema: 2, owner, revision: value.revision!, manual: Object.fromEntries(SKILLS.map((skill) => [skill.id, value.manual?.[skill.id] === true])), automatic: Object.fromEntries(SKILLS.map((skill) => [skill.id, value.automatic?.[skill.id] === true])) }, error: null };
  } catch { return { preferences: defaultSkillPreferences(owner, true), error: "Skill preferences could not be read. Automatic and manual skill selection are paused until you save reviewed preferences; tool permissions are unchanged." }; }
}
export function saveSkillPreferences(owner: string, preferences: SkillPreferences, storage: SkillPreferenceStorage): SkillPreferences {
  if (!owner || preferences.owner !== owner) throw new Error("Skill preferences belong to another account.");
  const current = loadSkillPreferences(owner, storage);
  if (!current.error && current.preferences.revision !== preferences.revision) throw new Error("Skill preferences changed in another tab. Reload them before saving.");
  const next: SkillPreferences = { ...preferences, schema: 2, owner, revision: preferences.revision + 1 };
  storage.setItem(skillPreferenceKey(owner), JSON.stringify(next));
  return next;
}
