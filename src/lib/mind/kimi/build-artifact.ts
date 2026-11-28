export const BUILD_ARTIFACT_LIMIT = 1024 * 1024;

export type BuildArtifactStatus =
  | { name: string; status: "saved"; bytes: number; sha256: string }
  | { name: string; status: "unavailable" };
export type StoredBuildArtifact = BuildArtifactStatus & { base64?: string };

export function buildArtifactName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 &&
    /^[a-z0-9][a-z0-9_-]*\.(?:bin|pdf|zip|png|jpe?g|webp|gif|wasm)$/i.test(value) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value);
}

export function readBuildArtifactStatus(value: unknown): BuildArtifactStatus | undefined {
  const row = value as Partial<StoredBuildArtifact> | null;
  if (!buildArtifactName(row?.name)) return;
  if (row.status === "unavailable") return { name: row.name, status: row.status };
  if (row.status === "saved" && typeof row.bytes === "number" && Number.isInteger(row.bytes) &&
    row.bytes > 0 && row.bytes <= BUILD_ARTIFACT_LIMIT && typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256)) {
    return { name: row.name, status: row.status, bytes: row.bytes, sha256: row.sha256 };
  }
}

export function buildArtifactHref(runId: string, projectId: string | null) {
  return "/api/mind/build/session?" + new URLSearchParams({ jobId: runId, reviewProject: projectId ?? "", artifact: "1" });
}
