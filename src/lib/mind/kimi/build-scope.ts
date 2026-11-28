/** Work recovery is isolated from Chat, Projects and Library files. */
export function workProjectStoragePrefix(owner: string) {
  return `amcos.work-project.v1.[${JSON.stringify(owner)},`;
}

export function workStorageKey(owner: string, projectId: string | null, field: string, legacyKey: string) {
  return projectId ? `${workProjectStoragePrefix(owner)}${JSON.stringify(projectId)}].${field}` : legacyKey;
}

export function buildRunId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

export function workRunStoragePrefix(owner: string) {
  return `amcos.work-run.v1.[${JSON.stringify(owner)},`;
}

export function workRunStorageKey(owner: string, projectId: string | null, runId: string) {
  return `${workRunStoragePrefix(owner)}${JSON.stringify(projectId)},${JSON.stringify(runId)}]`;
}

export function buildBranchName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && value !== "HEAD" && !value.includes("..") &&
    value.split("/").every(part => part && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock"));
}
