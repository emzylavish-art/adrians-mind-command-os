import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";

const SOURCE = "https://github.com/morluto/rea";

function runRea(args: string[], timeout = 90000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      "npx",
      ["-y", "rea-agents@latest", ...args],
      { timeout, maxBuffer: 4_000_000 },
      (error, stdout, stderr) => {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr).slice(0, 1500) });
      },
    );
  });
}

export const reaDoctor = createServerFn({ method: "POST" }).handler(async () => {
  const result = await runRea(["doctor", "--format", "json"]);
  try {
    const body = JSON.parse(result.stdout) as {
      healthy?: boolean;
      identity?: { cli_package_version?: string };
      checks?: { name?: string; ok?: boolean; detail?: string; remediation?: string }[];
    };
    const checks = Array.isArray(body.checks) ? body.checks : [];
    return {
      ok: true as const,
      source: SOURCE,
      version: body.identity?.cli_package_version ?? "unknown",
      healthy: body.healthy === true,
      gaps: checks
        .filter((check) => check.ok === false)
        .slice(0, 8)
        .map((check) => ({
          name: check.name ?? "check",
          detail: [check.detail, check.remediation].filter(Boolean).join(" — ") || "Not ready",
        })),
    };
  } catch {
    return {
      ok: false as const,
      source: SOURCE,
      error: result.stderr || "REA doctor did not return a readable report.",
    };
  }
});

export const reaInspect = createServerFn({ method: "POST" })
  .validator((input: { name: string; text: string }) => input)
  .handler(async ({ data }) => {
    const text = data.text.trim().slice(0, 40000);
    if (!text) return { ok: false as const, error: "There is no file text to inspect." };
    const dir = await mkdtemp(join(tmpdir(), "mind-rea-"));
    const safe = data.name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 48) || "note.txt";
    const path = join(dir, safe);
    try {
      await writeFile(path, text);
      const result = await runRea(["inspect-artifact", path, "--format", "json"]);
      if (!result.stdout.trim()) {
        return { ok: false as const, error: result.stderr || "REA returned an empty report." };
      }
      const body = JSON.parse(result.stdout) as {
        evidence_id?: string;
        operation?: string;
        subject?: { format?: string; digest?: { sha256?: string } };
        provider?: { name?: string };
      };
      return {
        ok: true as const,
        source: SOURCE,
        evidenceId: body.evidence_id ?? null,
        operation: body.operation ?? "inspect_artifact",
        format: body.subject?.format ?? "unknown",
        sha256: body.subject?.digest?.sha256 ?? null,
        provider: body.provider?.name ?? "REA",
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 400) : "REA inspect failed." };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
