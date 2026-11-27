import { DEFAULT_SKILL_TOOLS, type SkillToolRegistry } from "./skill-tools.ts";
import type { Workspace } from "./types.ts";
import { ADRIAN_OS_BUILDER_OUTPUT } from "./adrian-os-skill.ts";

export type Skill = {
  id: string;
  name: string;
  description: string;
  kind: "built-in" | "installed" | "not-installed";
  category?: "tool" | "instruction" | "connector";
  needs: string;
  input: string;
  output: string;
  tool: string | null;
  version?: number;
  capabilities?: readonly string[];
  authorized?: boolean;
};

export const SKILLS: Skill[] = [
  { id: "projects", name: "Project list", description: "Lists the projects saved on this device.", kind: "built-in", category: "tool", needs: "None. It reads this browser.", input: "No extra input.", output: "Project names.", tool: "list_projects" },
  { id: "chats", name: "Chat list", description: "Lists the chats saved on this device.", kind: "built-in", category: "tool", needs: "None. It reads this browser.", input: "No extra input.", output: "Chat titles.", tool: "list_chats" },
  { id: "notes", name: "Note search", description: "Searches notes saved on this device.", kind: "built-in", category: "tool", needs: "None. It reads this browser.", input: "Words to find.", output: "Matching notes.", tool: "search_notes" },
  { id: "adrian-os-builder", name: "Adrian OS builder", description: "Continues Adrian OS on the local preview. The owner flow approves hosted file read, write, delete, and terminal. The Windows installer is a local download and is not deployed.", kind: "installed", category: "instruction", needs: "Installed instruction set. Build reports the revision loaded; loading alone does not verify that a procedure was followed.", input: "A product gap.", output: ADRIAN_OS_BUILDER_OUTPUT, tool: null },
  { id: "notion", name: "Notion", description: "Searches a Notion workspace.", kind: "not-installed", category: "connector", needs: "Connector availability is shown in Plugins. The standalone Notion procedure is not installed; a connection does not grant write approval.", input: "A page name.", output: "Pages from Notion.", tool: null },
  { id: "browser", name: "Cloud browser", description: "Opens a page in a hosted browser.", kind: "not-installed", category: "connector", needs: "Runtime availability is shown in Cloud Browser. The standalone browser procedure is not installed.", input: "A URL.", output: "A page title.", tool: null },
  { id: "voice", name: "Voice", description: "Turns speech into text.", kind: "not-installed", category: "connector", needs: "Speech input, answering model, and speech output readiness are shown in Speak and Settings. The standalone Voice procedure is not installed.", input: "Audio.", output: "A transcript.", tool: null },
  { id: "gmail", name: "Gmail", description: "Reads a mailbox.", kind: "not-installed", category: "connector", needs: "Google account and granted mailbox permissions are shown in Plugins. The standalone Gmail procedure is not installed.", input: "A mailbox.", output: "Messages.", tool: null },
];

export function searchSkills(query: string): Skill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SKILLS;
  return SKILLS.filter((skill) => `${skill.name} ${skill.description} ${skill.needs}`.toLowerCase().includes(needle));
}

export type SkillReceipt = { skillId: string; version: number; stage: "instruction_retrieved" | "tool_executed" | "blocked"; tool: string | null; verified: false };
export function runSkill(ws: Workspace, skill: Skill, enabled: boolean, query?: string, registry: SkillToolRegistry = DEFAULT_SKILL_TOOLS): { ok: boolean; text: string; receipt: SkillReceipt } {
  const receipt: SkillReceipt = { skillId: skill.id, version: skill.version || 1, stage: "blocked", tool: skill.tool, verified: false };
  if (!enabled) return { ok: false, text: `${skill.name} is turned off. Nothing was run.`, receipt };
  if (ws.halted) return { ok: false, text: "Emergency stop is on. No skill was applied or executed.", receipt };
  if (skill.kind === "installed" && !skill.tool) return { ok: true, text: `Instructions retrieved for ${skill.name} v${receipt.version}. No tool was executed and no implementation was verified.\n\n${skill.output}`, receipt: { ...receipt, stage: "instruction_retrieved" } };
  if (skill.kind === "not-installed" || !skill.tool) return { ok: false, text: skill.needs, receipt };
  const result = registry.run(skill.tool, { workspace: ws, permissions: new Set(["workspace:read"]) }, query);
  return { ...result, receipt: { ...receipt, stage: result.ok ? "tool_executed" : "blocked" } };
}

export function skillReadiness(skill: Skill, enabled: boolean, ws: Workspace, registry: SkillToolRegistry = DEFAULT_SKILL_TOOLS): { available: boolean; label: string; detail: string } {
  if (!enabled) return { available: false, label: "Disabled", detail: "This account disabled future use." };
  if (ws.halted) return { available: false, label: "Stopped", detail: "Emergency stop prevents application and execution." };
  if (!skill.tool) return skill.kind === "installed" ? { available: true, label: "Instructions available", detail: "Retrieval does not execute tools or verify a task." } : { available: false, label: "Adapter unavailable", detail: "Connection state alone does not install a skill adapter. Open the service's implemented workflow." };
  const state = registry.readiness(skill.tool, { workspace: ws, permissions: new Set(["workspace:read"]) });
  return state.ok ? { available: true, label: "Ready to read", detail: "Registered read permission is available for this workspace." } : { available: false, label: "Unavailable", detail: state.reason };
}

/** The ordinary-chat route uses the same switch and adapter as a named skill. */
export function runLocalSkill(ws: Workspace, tool: NonNullable<Skill["tool"]>, request: string, enabled: Record<string, boolean>) {
  const skill = SKILLS.find((item) => item.tool === tool)!;
  const query = tool === "search_notes" ? request.replace(/^\s*search\s+(?:my\s+)?notes\b\s*(?:(?:for|about)\s+)?[:-]?\s*/i, "").trim() : request;
  return runSkill(ws, skill, enabled[skill.id] !== false, query);
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
