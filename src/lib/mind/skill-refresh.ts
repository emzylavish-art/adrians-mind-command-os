import { SKILLS, type Skill } from "./skills.ts";

export function refreshSkills(catalog: readonly Skill[] = SKILLS, now = Date.now()) {
  return {
    askedPermission: false as const,
    refreshedAt: new Date(now).toISOString(),
    count: catalog.length,
    names: catalog.map((skill) => skill.name),
  };
}
