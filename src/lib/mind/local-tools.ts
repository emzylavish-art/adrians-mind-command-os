import { decide, type Autonomy } from "./policy.ts";
import type { Workspace } from "./types.ts";

export const LOCAL_TOOLS = ["search_notes", "list_chats", "list_projects"] as const;
export type LocalTool = (typeof LOCAL_TOOLS)[number];

export type LocalStep = { id: string; tool: LocalTool; query?: string };
export type LocalRecord = { kind: "memory" | "project" | "chat"; id: string; title?: string; text?: string; projectId: string | null; source?: string; updatedAt?: string; scope?: string };
export type LocalResult = { stepId: string; tool: LocalTool; ok: boolean; output: string; error?: string; records: LocalRecord[] };

function one(ws: Workspace, step: LocalStep): { ok: true; output: string; records: LocalRecord[] } | { ok: false; error: string } {
  if (step.tool === "list_projects") {
    const records: LocalRecord[] = ws.projects.map((project) => ({ kind: "project", id: project.id, title: project.name, text: project.description, projectId: project.id }));
    return { ok: true, output: records.length ? records.map((row) => `${row.title} [${row.id}]`).join(", ") : "No projects.", records };
  }
  if (step.tool === "list_chats") {
    const records: LocalRecord[] = ws.chats.filter((chat) => !chat.archived && !chat.temporary).map((chat) => ({ kind: "chat", id: chat.id, title: chat.title, projectId: chat.projectId, updatedAt: chat.updatedAt }));
    return { ok: true, output: records.length ? records.map((row) => `${row.title} [${row.id}]`).join(", ") : "No chats.", records };
  }
  if (step.tool === "search_notes") {
    const query = (step.query ?? "").trim().toLowerCase();
    if (!query) return { ok: false, error: "Search needs a word." };
    const hits = ws.memories.filter((note) => !note.archived && note.text.toLowerCase().includes(query));
    const records: LocalRecord[] = hits.map((note) => ({ kind: "memory", id: note.id, text: note.text, projectId: note.projectId, source: note.source, updatedAt: note.updatedAt, scope: note.scope }));
    return { ok: true, output: records.length ? records.map((note) => `[${note.id} · ${note.scope} · ${note.source || "source unknown"} · ${note.updatedAt || "date unknown"}] ${note.text}`).join("\n") + (records.length > 1 ? "\nThese are separate saved records; disagreement has not been resolved." : "") : "No matching notes.", records };
  }
  return { ok: false, error: "That tool is not available." };
}

export function runLocalPlan(
  ws: Workspace,
  steps: LocalStep[],
  input: { autonomy: Autonomy; halted: boolean; tokens: Record<string, string | null> },
): { ok: boolean; lines: string[]; results: LocalResult[] } {
  const lines: string[] = [];
  const results: LocalResult[] = [];
  for (const step of steps) {
    const decision = decide({
      autonomy: input.autonomy,
      kind: "lookup",
      halted: input.halted,
      approvalToken: input.tokens[step.id] ?? null,
      expectedToken: `approve:${step.id}`,
    });
    if (decision.decision !== "allow") {
      lines.push(`${step.tool}: ${decision.reason}`);
      results.push({ stepId: step.id, tool: step.tool, ok: false, output: "", error: decision.reason, records: [] });
      return { ok: false, lines, results };
    }
    const result = one(ws, step);
    lines.push(result.ok ? `${step.tool}: ${result.output}` : `${step.tool}: ${result.error}`);
    results.push(result.ok ? { stepId: step.id, tool: step.tool, ok: true, output: result.output, records: result.records } : { stepId: step.id, tool: step.tool, ok: false, output: "", error: result.error, records: [] });
    if (!result.ok) return { ok: false, lines, results };
  }
  return { ok: true, lines, results };
}
