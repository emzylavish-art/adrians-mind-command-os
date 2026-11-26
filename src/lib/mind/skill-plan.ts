import { SKILLS, type Skill } from "./skills.ts";

export type SkillPlanStep = { skillId: string; title: string; reason: string; requires: string[]; status: "ready-for-review" | "blocked"; blockedBy: string[] };
export type SkillPlan = { version: 1; objective: string; steps: SkillPlanStep[]; conflicts: string[]; omitted: string[]; grantsPermissions: false; executesTools: false };
const objectives: Record<string, RegExp> = {
  projects: /\b(projects?|workstreams?|initiatives?)\b/i,
  chats: /\b(chats?|conversations?|discussions?)\b/i,
  notes: /\b(notes?|knowledge|remember|saved facts?)\b/i,
  "adrian-os-builder": /\b(build|code|coding|debug|implement|website|application)\b/i,
  notion: /\bnotion\b/i, gmail: /\b(gmail|email|mailbox)\b/i,
  voice: /\b(voice|speech|transcribe|dictat\w*)\b/i, browser: /\b(browser|browse|website)\b/i,
};
/** Bounded transparent selection proposes compatible procedures; it never grants or executes a capability. */
export function planSkillUse(objective: string, input: { manual?: Record<string, boolean>; automatic?: Record<string, boolean>; toolPermissions?: Record<string, boolean>; capabilities?: Record<string, boolean>; catalog?: Skill[]; maxSteps?: number } = {}): SkillPlan {
  const text = objective.trim().slice(0, 2000);
  const result: SkillPlan = { version: 1, objective: text, steps: [], conflicts: [], omitted: [], grantsPermissions: false, executesTools: false };
  if (!text) return result;
  const maximum = Math.max(1, Math.min(4, input.maxSteps ?? 3));
  for (const skill of input.catalog ?? SKILLS) {
    const exact = text.toLowerCase().includes(skill.name.toLowerCase());
    if (!exact && !objectives[skill.id]?.test(text)) continue;
    if (input.manual?.[skill.id] === false || input.automatic?.[skill.id] === false) { result.omitted.push(`${skill.name}: selection is disabled.`); continue; }
    const requires = skill.tool ? [`tool:${skill.tool}`] : skill.id === "adrian-os-builder" ? ["runtime:build"] : [`connector:${skill.id}`, `procedure:${skill.id}`];
    const blockedBy = requires.filter((dependency) => dependency.startsWith("tool:") ? input.toolPermissions?.[dependency.slice(5)] === false : input.capabilities?.[dependency] !== true);
    if (skill.kind === "not-installed") blockedBy.push("No standalone reviewed procedure is installed.");
    const step: SkillPlanStep = { skillId: skill.id, title: skill.name, reason: exact ? "The objective names this procedure." : "The objective matches this registered task category.", requires, status: blockedBy.length ? "blocked" : "ready-for-review", blockedBy: [...new Set(blockedBy)] };
    if (result.steps.length < maximum) result.steps.push(step); else result.omitted.push(`${skill.name}: the ${maximum}-step plan limit was reached.`);
  }
  if (result.steps.some((step) => step.skillId === "adrian-os-builder") && result.steps.some((step) => step.skillId === "browser")) result.conflicts.push("Build and browser work require different runtimes. Review their order and destinations before starting either action.");
  if (!result.steps.length) result.omitted.push("No enabled registered procedure matched. No action was selected.");
  return result;
}
