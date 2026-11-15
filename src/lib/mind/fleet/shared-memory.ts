/**
 * Eve and every bot read one workspace memory.
 * This is a projection of that list, not a second store, brain, or halt control.
 */

export type WorkspaceNote = {
  title: string;
  body: string;
};

const BLOCKED = /secret|api key|token|password/i;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isShareable(note: WorkspaceNote): boolean {
  return !BLOCKED.test(textOf(note.title)) && !BLOCKED.test(textOf(note.body));
}

export function sharedMemory(notes: readonly WorkspaceNote[], botIds: readonly string[]): Record<string, WorkspaceNote[]> {
  const shared = notes.filter(isShareable);
  const view: Record<string, WorkspaceNote[]> = {};
  for (const botId of botIds) {
    view[botId] = shared;
  }
  return view;
}
