/**
 * One orchestrator, adrian-core, routes each task to one department.
 * Eve and every bot share one workspace memory.
 * This is not a second brain, a secret store, or a halt control.
 * Paired actions run only after the owner approves that exact action.
 * Halt blocks all four. Pointer control and the Windows desktop stay blocked.
 */

export const ORCHESTRATOR = "adrian-core" as const;

export const DEPARTMENTS = [
  "Engineering",
  "Design",
  "Media",
  "Research",
  "Knowledge",
  "Security",
  "Operations",
  "Marketing",
  "Personal assistant",
] as const;

export type DepartmentName = (typeof DEPARTMENTS)[number];

export const FACE_FILE = "public/brand/eve-idle.jpg";

export const PAIRED_ACTIONS = ["file_read", "file_write", "file_delete", "terminal"] as const;

export const BLOCKED_CONTROLS = ["mouse", "keyboard", "browser pointer", "windows desktop"] as const;

export type FleetRules = {
  orchestrator: typeof ORCHESTRATOR;
  memoryId: "workspace";
  separateBrain: false;
  secrets: false;
  canHalt: false;
  canApprove: false;
  face: typeof FACE_FILE;
  actions: typeof PAIRED_ACTIONS;
  haltBlocks: typeof PAIRED_ACTIONS;
  blocked: typeof BLOCKED_CONTROLS;
};

const RULES: FleetRules = {
  orchestrator: ORCHESTRATOR,
  memoryId: "workspace",
  separateBrain: false,
  secrets: false,
  canHalt: false,
  canApprove: false,
  face: FACE_FILE,
  actions: PAIRED_ACTIONS,
  haltBlocks: PAIRED_ACTIONS,
  blocked: BLOCKED_CONTROLS,
};

/** Same rules for Eve and every bot. Not a per-bot brain. */
export function fleetRules(): FleetRules {
  return RULES;
}

const KEYWORDS: readonly { name: DepartmentName; pattern: RegExp }[] = [
  { name: "Engineering", pattern: /\b(engineer(?:ing)?|code|typescript|bug|refactor|compile|implement)\b/i },
  { name: "Design", pattern: /\b(design|mockup|layout|typography|\bux\b|\bui\b)\b/i },
  { name: "Media", pattern: /\b(media|video|audio|music|image|film|podcast)\b/i },
  { name: "Research", pattern: /\b(research|investigate|citation|sources?|study)\b/i },
  { name: "Knowledge", pattern: /\b(knowledge|wiki|notes?|documents?)\b/i },
  { name: "Security", pattern: /\b(security|vulnerabilit(?:y|ies)|permission|threat|halt|mouse|keyboard|browser pointer|windows desktop)\b/i },
  { name: "Operations", pattern: /\b(operations|incident|uptime|monitor|schedule)\b/i },
  { name: "Marketing", pattern: /\b(marketing|campaign|audience|brand)\b/i },
  { name: "Personal assistant", pattern: /\b(personal assistant|assistant|reminder|inbox|calendar)\b/i },
];

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function namedDepartment(text: string): DepartmentName | null {
  const lower = text.toLowerCase();
  let best: { name: DepartmentName; index: number } | null = null;
  for (const name of DEPARTMENTS) {
    const index = lower.indexOf(name.toLowerCase());
    if (index < 0) continue;
    if (!best || index < best.index) best = { name, index };
  }
  return best?.name ?? null;
}

function keywordDepartment(text: string): DepartmentName | null {
  let best: { name: DepartmentName; index: number } | null = null;
  for (const rule of KEYWORDS) {
    const match = rule.pattern.exec(text);
    if (!match || match.index === undefined) continue;
    if (!best || match.index < best.index) best = { name: rule.name, index: match.index };
  }
  return best?.name ?? null;
}

function isDepartment(value: string): value is DepartmentName {
  return (DEPARTMENTS as readonly string[]).includes(value);
}

/** One department name. Never the orchestrator, and never a second one. */
export function routeTask(text: unknown): DepartmentName {
  const input = textOf(text);
  const named = namedDepartment(input);
  const picked = named ?? keywordDepartment(input) ?? "Personal assistant";
  if (!isDepartment(picked)) return "Personal assistant";
  return picked;
}
