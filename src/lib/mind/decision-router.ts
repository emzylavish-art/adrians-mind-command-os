export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: string;
  readonly authorized?: boolean;
  readonly capabilities?: readonly string[];
}

export type EnabledSkills = Readonly<Partial<Record<string, boolean>>>;

export type Decision =
  | { type: "suggestion"; skillId: string }
  | {
      type: "abstain";
      reason: "empty" | "oversized" | "no_match" | "ambiguous";
    };

const rules = {
  projects: /\bprojects?\b/i,
  chats: /\b(chats?|conversations?)\b/i,
  notes: /\bnotes?\b/i,
} as const;

type Route = keyof typeof rules;

function isRoute(value: string): value is Route {
  return Object.hasOwn(rules, value);
}

const vocabulary = [
  ["frontend", "react", "interface", "website", "ui"],
  ["accessibility", "accessible", "keyboard", "wcag", "screenreader"],
  ["test", "tests", "testing", "regression", "verify", "validation"],
  ["development", "develop", "build", "coding", "implementation"],
];
function terms(value: string): Set<string> {
  const out = new Set(value.toLowerCase().match(/[a-z0-9]+/g) || []);
  for (const group of vocabulary) if (group.some(term => out.has(term))) group.forEach(term => out.add(term));
  return out;
}

/** Suggestions never grant permissions or execute. Only shipped or activated instructions qualify. */
export function suggestSkills(text: string, skills: readonly Skill[], enabled: EnabledSkills): { skillId: string; score: number; reason: string }[] {
  if (!text.trim() || text.length > 2000) return [];
  const task = terms(text);
  const matches: { skillId: string; score: number; reason: string }[] = [];
  for (const skill of skills) {
    if (enabled[skill.id] === false || skill.authorized === false) continue;
    const identities = [skill.id.trim().toLowerCase(), skill.name.trim().toLowerCase()];
    if (skill.kind === "built-in" && identities.some(key => isRoute(key) && rules[key].test(text))) {
      matches.push({ skillId: skill.id, score: 10, reason: "Matches a registered workspace lookup." }); continue;
    }
    if (!(skill.kind === "installed" || skill.authorized === true)) continue;
    const names = terms(skill.name), capabilities = terms((skill.capabilities || []).join(" ")), description = terms(skill.description);
    let score = 0;
    for (const term of task) { if (names.has(term)) score += 4; else if (capabilities.has(term)) score += 3; else if (description.has(term)) score += 1; }
    if (score >= 2) matches.push({ skillId: skill.id, score, reason: "Matches the authorized instruction's name, capabilities or description; application does not execute tools." });
  }
  return matches.sort((a, b) => b.score - a.score || a.skillId.localeCompare(b.skillId));
}

/**
 * Canonical builtin IDs or display names: projects, chats, notes.
 * Authorized instruction descriptions can contribute suggestions. No input text is returned or retained.
 */
export function decide(
  text: string,
  skills: readonly Skill[],
  enabled: EnabledSkills,
): Decision {
  if (text.length > 2000) return { type: "abstain", reason: "oversized" };
  if (!text.trim()) return { type: "abstain", reason: "empty" };

  const matches = new Set(suggestSkills(text, skills, enabled).map(item => item.skillId));

  if (matches.size === 1) {
    return { type: "suggestion", skillId: [...matches][0]! };
  }
  return {
    type: "abstain",
    reason: matches.size ? "ambiguous" : "no_match",
  };
}
