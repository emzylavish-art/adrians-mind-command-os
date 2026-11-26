import { runLocalPlan, LOCAL_TOOLS } from "./local-tools.ts";
import type { Workspace } from "./types.ts";

export type SkillToolContext = { workspace: Workspace; permissions: ReadonlySet<string> };
export type SkillTool = {
  id: string; description: string; permissions: readonly string[];
  available: (context: SkillToolContext) => { ok: true } | { ok: false; reason: string };
  execute: (context: SkillToolContext, input?: string) => { ok: boolean; text: string };
};
export type SkillToolRegistry = ReturnType<typeof createSkillToolRegistry>;

/** Registration is application code, never imported draft text or serialized commands. */
export function createSkillToolRegistry(entries: readonly SkillTool[]) {
  const tools = new Map<string, SkillTool>();
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(entry.id) || tools.has(entry.id) || !entry.permissions.length) throw new Error("Invalid or duplicate tool registration.");
    tools.set(entry.id, Object.freeze({ ...entry, permissions: Object.freeze([...entry.permissions]) }));
  }
  return Object.freeze({
    list: () => [...tools.values()].map(({ id, description, permissions }) => ({ id, description, permissions })),
    readiness(id: string, context: SkillToolContext): { ok: true } | { ok: false; reason: string } {
      const tool = tools.get(id);
      if (!tool) return { ok: false, reason: "No registered adapter is bound to this skill." };
      if (context.workspace.halted) return { ok: false, reason: "Emergency stop is on. Nothing was executed." };
      if (!tool.permissions.every(permission => context.permissions.has(permission))) return { ok: false, reason: "The current execution has not authorized this tool's permissions." };
      return tool.available(context);
    },
    run(id: string, context: SkillToolContext, input?: string): { ok: boolean; text: string } {
      const readiness = this.readiness(id, context);
      if (!readiness.ok) return { ok: false, text: readiness.reason };
      try { return tools.get(id)!.execute(context, input); }
      catch { return { ok: false, text: "The registered tool did not complete. Nothing was reported as verified." }; }
    },
  });
}

export const DEFAULT_SKILL_TOOLS = createSkillToolRegistry(LOCAL_TOOLS.map(id => ({
  id, description: `Read local workspace using ${id}`, permissions: ["workspace:read"],
  available: () => ({ ok: true as const }),
  execute: ({ workspace }: SkillToolContext, query?: string) => {
    const result = runLocalPlan(workspace, [{ id, tool: id, query }], { autonomy: "automatic", halted: workspace.halted, tokens: {} });
    return { ok: result.ok, text: result.lines.join("\n") || "No result." };
  },
})));
