import { runLocalPlan } from "./local-tools.ts";
import type { Workspace } from "./types.ts";
import { ADRIAN_OS_BUILDER_OUTPUT } from "./adrian-os-skill.ts";

export type Skill = {
  id: string;
  name: string;
  description: string;
  kind: "built-in" | "installed" | "not-installed";
  needs: string;
  input: string;
  output: string;
  tool: "list_projects" | "list_chats" | "search_notes" | null;
};

export const SKILLS: Skill[] = [
  { id: "projects", name: "Project list", description: "Lists the projects saved on this device.", kind: "built-in", needs: "None. It reads this browser.", input: "No extra input.", output: "Project names.", tool: "list_projects" },
  { id: "chats", name: "Chat list", description: "Lists the chats saved on this device.", kind: "built-in", needs: "None. It reads this browser.", input: "No extra input.", output: "Chat titles.", tool: "list_chats" },
  { id: "notes", name: "Note search", description: "Searches notes saved on this device.", kind: "built-in", needs: "None. It reads this browser.", input: "Words to find.", output: "Matching notes.", tool: "search_notes" },
  { id: "adrian-os-builder", name: "Adrian OS builder", description: "Continues Adrian OS on the local preview. The owner flow approves hosted file read, write, delete, and terminal. The Windows installer is a local download and is not deployed.", kind: "installed", needs: "Installed. Build follows this skill on every coding turn.", input: "A product gap.", output: ADRIAN_OS_BUILDER_OUTPUT, tool: null },
  { id: "notion", name: "Notion", description: "Searches a Notion workspace.", kind: "not-installed", needs: "Set NOTION_TOKEN on the server and share the pages. This skill is not installed.", input: "A page name.", output: "Pages from Notion.", tool: null },
  { id: "browser", name: "Cloud browser", description: "Opens a page in a hosted browser.", kind: "not-installed", needs: "No cloud browser is configured. This skill is not installed.", input: "A URL.", output: "A page title.", tool: null },
  { id: "voice", name: "Voice", description: "Turns speech into text.", kind: "not-installed", needs: "No speech-to-text key is configured. Nothing is transcribed.", input: "Audio.", output: "A transcript.", tool: null },
  { id: "gmail", name: "Gmail", description: "Reads a mailbox.", kind: "not-installed", needs: "Google OAuth is not configured. This skill is not installed.", input: "A mailbox.", output: "Messages.", tool: null },
];

export function searchSkills(query: string): Skill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SKILLS;
  return SKILLS.filter((skill) => `${skill.name} ${skill.description} ${skill.needs}`.toLowerCase().includes(needle));
}

export function runSkill(ws: Workspace, skill: Skill, enabled: boolean, query?: string): { ok: boolean; text: string } {
  if (skill.kind === "installed") {
    if (!enabled) return { ok: false, text: `${skill.name} is turned off. Nothing was run.` };
    return { ok: true, text: skill.output };
  }
  if (skill.kind !== "built-in" || !skill.tool) return { ok: false, text: skill.needs };
  if (!enabled) return { ok: false, text: `${skill.name} is turned off. Nothing was run.` };
  const result = runLocalPlan(ws, [{ id: skill.tool, tool: skill.tool, query }], { autonomy: "automatic", halted: ws.halted, tokens: {} });
  return { ok: result.ok, text: result.lines.join("\n") || "No result." };
}

/** Only a named runnable skill can execute. Pass the remainder of the request as its input. */
export function runRequestedSkill(ws: Workspace, request: string, enabled: Record<string, boolean>): { ok: boolean; text: string } {
  const lower = request.toLowerCase();
  const words = " " + lower.replace(/[^a-z0-9]+/g, " ") + " ";
  const named = SKILLS.filter((skill) => words.includes(" " + skill.name.toLowerCase() + " "));
  if (named.length === 1) {
    const skill = named[0]!;
    const query = request.slice(lower.indexOf(skill.name.toLowerCase()) + skill.name.length)
      .replace(/^\s*(?:skill\b)?\s*(?:to\s+)?(?:find|search(?:\s+for)?)?\s*/i, "").trim();
    if (skill.id === "adrian-os-builder") return { ok: false, text: "Builder instructions apply to hosted Build. Open Build to run a coding task." };
    return runSkill(ws, skill, enabled[skill.id] !== false, query);
  }
  const matches = searchSkills(request.replace(/\bskills?\b/gi, " "));
  return { ok: matches.length > 0, text: matches.map((skill) => skill.name + " — " + skill.needs).join("\n") || "No matching skill." };
}
