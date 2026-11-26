import { decide, type Autonomy } from "./policy.ts";
import type { Workspace } from "./types.ts";

export const LOCAL_TOOLS = ["search_notes", "list_chats", "list_projects"] as const;
export type LocalTool = (typeof LOCAL_TOOLS)[number];

export type LocalStep = { id: string; tool: LocalTool; query?: string };

function one(ws: Workspace, step: LocalStep): { ok: true; output: string } | { ok: false; error: string } {
  if (step.tool === "list_projects") {
    const names = ws.projects.map((project) => project.name);
    return { ok: true, output: names.length ? names.join(", ") : "No projects." };
  }
  if (step.tool === "list_chats") {
    const titles = ws.chats.map((chat) => chat.title);
    return { ok: true, output: titles.length ? titles.join(", ") : "No chats." };
  }
  if (step.tool === "search_notes") {
    const query = (step.query ?? "").trim().toLowerCase();
    if (!query) return { ok: false, error: "Search needs a word." };
    const hits = ws.memories.filter((note) => !note.archived && note.text.toLowerCase().includes(query));
    return { ok: true, output: hits.length ? hits.map((note) => note.text).join("\n") : "No matching notes." };
  }
  return { ok: false, error: "That tool is not available." };
}

export function runLocalPlan(
  ws: Workspace,
  steps: LocalStep[],
  input: { autonomy: Autonomy; halted: boolean; tokens: Record<string, string | null> },
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  for (const step of steps) {
    if (ws.toolPermissions?.[step.tool] === false) {
      lines.push(`${step.tool}: this tool is turned off for the workspace. Nothing was read.`);
      return { ok: false, lines };
    }
    const decision = decide({
      autonomy: input.autonomy,
      kind: "lookup",
      halted: input.halted,
      approvalToken: input.tokens[step.id] ?? null,
      expectedToken: `approve:${step.id}`,
    });
    if (decision.decision !== "allow") {
      lines.push(`${step.tool}: ${decision.reason}`);
      return { ok: false, lines };
    }
    const result = one(ws, step);
    lines.push(result.ok ? `${step.tool}: ${result.output}` : `${step.tool}: ${result.error}`);
    if (!result.ok) return { ok: false, lines };
  }
  return { ok: true, lines };
}
