export type ProviderDependency = { kind: "chat" | "agent" | "run" | "schedule"; id: string; label: string };

/** Inspect references, without rewriting destinations or changing existing approval authority. */
export function providerDependencies(providerId: string, snapshot: unknown): ProviderDependency[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const ws = snapshot as Record<string, unknown>;
  const rows = (name: string): Record<string, unknown>[] => Array.isArray(ws[name]) ? (ws[name] as unknown[]).filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))) : [];
  const matches = (value: unknown) => typeof value === "string" && value.startsWith(`custom:${providerId}:`);
  const agents = rows("agents").filter(row => matches(row.chatProvider));
  const agentIds = new Set(agents.map(row => row.id));
  const selected: { kind: ProviderDependency["kind"]; row: Record<string, unknown> }[] = [
    ...rows("chats").filter(row => matches(row.botProvider)).map(row => ({ kind: "chat" as const, row })),
    ...agents.map(row => ({ kind: "agent" as const, row })),
    ...rows("runs").filter(row => !["completed", "failed", "canceled"].includes(String(row.state)) && (agentIds.has(row.agentId) || matches((row.configuration as Record<string, unknown> | undefined)?.chatProvider))).map(row => ({ kind: "run" as const, row })),
    ...rows("schedules").filter(row => agentIds.has(row.agentId)).map(row => ({ kind: "schedule" as const, row })),
  ];
  return selected.filter(({ row }) => typeof row.id === "string").map(({ kind, row }) => ({ kind, id: String(row.id), label: String(row.name || row.title || row.goal || row.id).slice(0, 160) }));
}
