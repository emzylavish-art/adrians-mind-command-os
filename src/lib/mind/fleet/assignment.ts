/**
 * Parallel assignment projects one task onto named bots.
 * Eve and every bot share one workspace memory.
 * This is not a second brain, a secret store, or a halt control.
 * Bots cannot halt or approve. The owner owns both.
 */

export const WORKSPACE_MEMORY_ID = "workspace";

export type ParallelAssignment = {
  task: string;
  botId: string;
  memoryId: typeof WORKSPACE_MEMORY_ID;
  canHalt: false;
  canApprove: false;
};

export function assignParallel(task: string, botIds: readonly string[]): ParallelAssignment[] {
  const sharedTask = typeof task === "string" ? task : "";
  const assignments: ParallelAssignment[] = [];
  for (const botId of botIds) {
    const id = typeof botId === "string" ? botId.trim() : "";
    if (!id) continue;
    assignments.push({
      task: sharedTask,
      botId: id,
      memoryId: WORKSPACE_MEMORY_ID,
      canHalt: false,
      canApprove: false,
    });
  }
  return assignments;
}
