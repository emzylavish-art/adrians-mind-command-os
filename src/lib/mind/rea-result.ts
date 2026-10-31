const SOURCE = "https://github.com/morluto/rea";
export const REA_PACKAGE = "rea-agents@6.8.0";

export type ReaRun = { code: number; stdout: string; stderr: string };

export function readReaJson(stdout: string): unknown | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function interpretDoctor(result: ReaRun) {
  const body = readReaJson(result.stdout);
  if (!body || typeof body !== "object") {
    return {
      ok: false as const,
      source: SOURCE,
      package: REA_PACKAGE,
      exitCode: result.code,
      error: result.stderr || "REA doctor did not return a readable report.",
    };
  }
  const record = body as {
    error?: string;
    message?: string;
    healthy?: boolean;
    identity?: { cli_package_version?: string };
    checks?: { name?: string; ok?: boolean; detail?: string; remediation?: string }[];
  };
  if (typeof record.error === "string") {
    return {
      ok: false as const,
      source: SOURCE,
      package: REA_PACKAGE,
      exitCode: result.code,
      error: record.message || record.error,
    };
  }
  const checks = Array.isArray(record.checks) ? record.checks : [];
  return {
    ok: true as const,
    source: SOURCE,
    package: REA_PACKAGE,
    exitCode: result.code,
    version: record.identity?.cli_package_version ?? "unknown",
    healthy: record.healthy === true,
    gaps: checks
      .filter((check) => check.ok === false)
      .slice(0, 8)
      .map((check) => ({
        name: check.name ?? "check",
        detail: [check.detail, check.remediation].filter(Boolean).join(" — ") || "Not ready",
      })),
  };
}

export function interpretInspect(result: ReaRun) {
  const body = readReaJson(result.stdout);
  if (!body || typeof body !== "object") {
    return {
      ok: false as const,
      source: SOURCE,
      package: REA_PACKAGE,
      exitCode: result.code,
      error: result.stderr || "REA inspect did not return a readable report.",
    };
  }
  const record = body as {
    error?: string;
    message?: string;
    evidence_id?: string;
    operation?: string;
    subject?: { format?: string; digest?: { sha256?: string } };
    provider?: { name?: string };
  };
  if (result.code !== 0 || typeof record.error === "string" || !record.evidence_id) {
    return {
      ok: false as const,
      source: SOURCE,
      package: REA_PACKAGE,
      exitCode: result.code,
      error: record.message || record.error || "REA did not return evidence for this file. Source files are not artifact targets.",
    };
  }
  return {
    ok: true as const,
    source: SOURCE,
    package: REA_PACKAGE,
    exitCode: result.code,
    evidenceId: record.evidence_id,
    operation: record.operation ?? "inspect_artifact",
    format: record.subject?.format ?? "unknown",
    sha256: record.subject?.digest?.sha256 ?? null,
    provider: record.provider?.name ?? "REA",
  };
}
