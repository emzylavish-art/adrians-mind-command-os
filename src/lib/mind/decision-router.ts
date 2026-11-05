export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: string;
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

/**
 * Canonical builtin IDs or display names: projects, chats, notes.
 * Descriptions never influence routing. No input text is returned or retained.
 */
export function decide(
  text: string,
  skills: readonly Skill[],
  enabled: EnabledSkills,
): Decision {
  if (text.length > 2000) return { type: "abstain", reason: "oversized" };
  if (!text.trim()) return { type: "abstain", reason: "empty" };

  const matches = new Set<string>();
  for (const skill of skills) {
    if (
      skill.kind !== "built-in" ||
      enabled[skill.id] === false
    ) continue;

    const identities = [
      skill.id.trim().toLowerCase(),
      skill.name.trim().toLowerCase(),
    ];
    if (identities.some(key => isRoute(key) && rules[key].test(text))) {
      matches.add(skill.id);
    }
  }

  if (matches.size === 1) {
    return { type: "suggestion", skillId: [...matches][0]! };
  }
  return {
    type: "abstain",
    reason: matches.size ? "ambiguous" : "no_match",
  };
}
