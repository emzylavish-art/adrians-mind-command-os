import type { ModelTier } from "../model-tiers";

export type BuildFileTarget = { workspace: string; cwd?: string };
export type BuildEditorSelection = { anchor: number; head: number };
export type BuildEditorBuffer = BuildFileTarget & { path: string; saved: string; draft: string; selection?: BuildEditorSelection };
export type BuildDraft = { version: 1; owner: string; buffers: Record<string, BuildEditorBuffer>; tabs: string[]; selectedFile: string; prompt: string; cwd?: string; planningTier?: ModelTier };

export function buildBufferKey(target: BuildFileTarget, path: string): string {
  return JSON.stringify([target.workspace, target.cwd || "", path]);
}

export function buildDraftKey(owner: string): string {
  return `amcos.build-editor.v1.${encodeURIComponent(owner)}`;
}

/** Recovery never writes a file: the original saved baseline remains the compare-and-save guard. */
export function parseBuildDraft(raw: string | null, owner: string): BuildDraft | null {
  if (!raw) return null;
  if (raw.length > 4_000_000) throw new Error("The saved editor draft exceeds the recovery limit.");
  const data = JSON.parse(raw);
  if (data?.version !== 1 || data.owner !== owner || !data.buffers || typeof data.buffers !== "object" || !Array.isArray(data.tabs)) return null;
  const buffers: Record<string, BuildEditorBuffer> = {};
  for (const [key, value] of Object.entries(data.buffers)) {
    const item = value as BuildEditorBuffer;
    if (!item || typeof item.workspace !== "string" || typeof item.path !== "string" || typeof item.saved !== "string" || typeof item.draft !== "string" || (item.cwd !== undefined && typeof item.cwd !== "string")) continue;
    if (buildBufferKey(item, item.path) !== key) continue;
    const selection = normalizeBuildSelection(item.selection, item.draft.length);
    buffers[key] = { workspace: item.workspace, ...(item.cwd === undefined ? {} : { cwd: item.cwd }), path: item.path, saved: item.saved, draft: item.draft, ...(selection ? { selection } : {}) };
  }
  const tabs = data.tabs.filter((key: unknown): key is string => typeof key === "string" && Object.hasOwn(buffers, key));
  return { version: 1, owner, buffers, ...(["Auto", "Fast", "Expert", "Heavy", "Build"].includes(data.planningTier) ? { planningTier: data.planningTier } : {}), ...(typeof data.cwd === "string" ? { cwd: data.cwd } : {}), tabs: [...new Set<string>(tabs)], selectedFile: Object.hasOwn(buffers, data.selectedFile) ? data.selectedFile : tabs[0] || "", prompt: typeof data.prompt === "string" ? data.prompt : "" };
}

export function normalizeBuildSelection(value: unknown, length: number): BuildEditorSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.anchor) || !Number.isSafeInteger(row.head)) return undefined;
  return { anchor: Math.min(length, Math.max(0, row.anchor as number)), head: Math.min(length, Math.max(0, row.head as number)) };
}

export function serializeBuildDraft(input: Omit<BuildDraft, "version">): string {
  const raw = JSON.stringify({ version: 1, ...input });
  if (raw.length > 4_000_000) throw new Error("Draft recovery storage is full. Download or save your changes before leaving Build.");
  return raw;
}

/** A contiguous replacement diff preserves deletions, duplicates and ordering without quadratic work. */
export function buildDiff(path: string, before: string, after: string, previousPath?: string, existence: { beforeExists?: boolean; afterExists?: boolean } = {}): string {
  const rename = previousPath && previousPath !== path ? [`rename from ${previousPath}`, `rename to ${path}`] : [];
  const creation = existence.beforeExists === false ? [`new file ${path}`] : [];
  const deletion = existence.afterExists === false ? [`deleted file ${previousPath || path}`] : [];
  if (before === after) return [...rename, ...creation, ...deletion, `${path}: no text change.`].join("\n");
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
  let end = 0;
  while (end < oldLines.length - start && end < newLines.length - start && oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]) end += 1;
  const removed = oldLines.slice(start, oldLines.length - end);
  const added = newLines.slice(start, newLines.length - end);
  return [...rename, ...creation, ...deletion, `--- ${existence.beforeExists === false ? "/dev/null" : previousPath || path}`, `+++ ${existence.afterExists === false ? "/dev/null" : path}`, `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`, ...removed.map(line => `- ${line}`), ...added.map(line => `+ ${line}`)].join("\n");
}

export function buildResultHandoff(changes: { path: string; before: string; after: string; previousPath?: string; beforeExists?: boolean; afterExists?: boolean }[], output: string, operationId?: string, outcome: { completed?: boolean; error?: string; outputComplete?: boolean } = {}): string {
  return [outcome.completed === false ? "Build request did not complete; recorded changes require review and implementation verification remains pending." : "Build request completed; implementation verification remains pending.", outcome.error ? `Execution error: ${outcome.error}` : "", operationId ? `Operation: ${operationId}` : "", ...changes.map(change => buildDiff(change.path, change.before, change.after, change.previousPath, change)), changes.length ? "" : "No file change was verified by this receipt.", outcome.outputComplete === false ? "Execution output is incomplete; the supported retention limit was exceeded. Download the retained receipt before starting another task." : "Full supported execution output:", output || "No textual output was returned."].filter(Boolean).join("\n\n");
}
