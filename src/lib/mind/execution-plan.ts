/** Shared envelope for independent answers and synthesis; selection is not a grant. */
export type ModelExecutionPlan = {
  revision: 1;
  kind: "independent" | "synthesis";
  participants: { id: string; role: "answer" | "helper"; dependsOn: string[] }[];
  maxProviderCalls: number;
  maxConcurrency: number;
  costAuthority: "owner-resource-policy";
};
export function modelExecutionPlan(kind: ModelExecutionPlan["kind"], answerIds: string[], helperIds: string[] = [], maxConcurrency = 2): ModelExecutionPlan {
  const ids = [...answerIds, ...helperIds];
  if (!answerIds.length || ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length || ids.length > 9) throw new Error("Invalid execution participants.");
  if (kind === "independent" && helperIds.length) throw new Error("Independent answers must not silently synthesize helpers.");
  return { revision: 1, kind, participants: [...helperIds.map((id) => ({ id, role: "helper" as const, dependsOn: [] })), ...answerIds.map((id) => ({ id, role: "answer" as const, dependsOn: kind === "synthesis" ? [...helperIds] : [] }))], maxProviderCalls: ids.length, maxConcurrency: Math.max(1, Math.min(3, Math.floor(maxConcurrency))), costAuthority: "owner-resource-policy" };
}


export function readModelExecutionPlan(value: unknown): ModelExecutionPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<ModelExecutionPlan>;
  if (row.revision !== 1 || (row.kind !== "independent" && row.kind !== "synthesis") || row.costAuthority !== "owner-resource-policy" || !Array.isArray(row.participants) || row.participants.length > 9 || !Number.isInteger(row.maxConcurrency) || row.maxConcurrency! < 1 || row.maxConcurrency! > 3) return null;
  if (row.participants.some((item) => !item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 600 || !["answer", "helper"].includes(item.role) || !Array.isArray(item.dependsOn) || item.dependsOn.some((id) => typeof id !== "string"))) return null;
  try {
    const canonical = modelExecutionPlan(row.kind, row.participants.filter((item) => item.role === "answer").map((item) => item.id), row.participants.filter((item) => item.role === "helper").map((item) => item.id), row.maxConcurrency);
    if (row.maxProviderCalls !== canonical.maxProviderCalls || row.participants.some((item) => JSON.stringify(item.dependsOn) !== JSON.stringify(canonical.participants.find((part) => part.id === item.id)?.dependsOn))) return null;
    return canonical;
  } catch { return null; }
}
