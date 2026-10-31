import { runLocalPlan } from "./local-tools.ts";
import type { Workspace } from "./types.ts";

export type Skill = {
  id: string;
  name: string;
  description: string;
  kind: "built-in" | "not-installed";
  needs: string;
  tool: "list_projects" | "list_chats" | "search_notes" | null;
};

export const SKILLS: Skill[] = [
  { id: "projects", name: "Project list", description: "Lists the projects saved on this device.", kind: "built-in", needs: "None. It reads this browser.", tool: "list_projects" },
  { id: "chats", name: "Chat list", description: "Lists the chats saved on this device.", kind: "built-in", needs: "None. It reads this browser.", tool: "list_chats" },
  { id: "notes", name: "Note search", description: "Searches notes saved on this device.", kind: "built-in", needs: "None. It reads this browser.", tool: "search_notes" },
  { id: "notion", name: "Notion", description: "Searches a Notion workspace.", kind: "not-installed", needs: "Set NOTION_TOKEN on the server and share the pages. This skill is not installed.", tool: null },
  { id: "browser", name: "Cloud browser", description: "Opens a page in a hosted browser.", kind: "not-installed", needs: "No cloud browser is configured. This skill is not installed.", tool: null },
  { id: "voice", name: "Voice", description: "Turns speech into text.", kind: "not-installed", needs: "No speech-to-text key is configured. Nothing is transcribed.", tool: null },
  { id: "gmail", name: "Gmail", description: "Reads a mailbox.", kind: "not-installed", needs: "Google OAuth is not configured. This skill is not installed.", tool: null },
];

export function searchSkills(query: string): Skill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SKILLS;
  return SKILLS.filter((skill) => `${skill.name} ${skill.description} ${skill.needs}`.toLowerCase().includes(needle));
}

export function runSkill(ws: Workspace, skill: Skill, enabled: boolean): { ok: boolean; text: string } {
  if (skill.kind !== "built-in" || !skill.tool) return { ok: false, text: skill.needs };
  if (!enabled) return { ok: false, text: `${skill.name} is turned off. Nothing was run.` };
  const result = runLocalPlan(ws, [{ id: skill.tool, tool: skill.tool }], { autonomy: "automatic", halted: ws.halted, tokens: {} });
  return { ok: result.ok, text: result.lines.join("\n") || "No result." };
}
