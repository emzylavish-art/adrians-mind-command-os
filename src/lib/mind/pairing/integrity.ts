import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type AgentManifest = {
  files: Record<string, string>; // relative path -> sha256 hex
  version: string;
};

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function verifyAgentFiles(
  rootFiles: Record<string, string>,
  manifest: AgentManifest,
): { ok: true } | { ok: false; error: string; mismatched: string[] } {
  const mismatched: string[] = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const actual = rootFiles[rel];
    if (!actual || actual.toLowerCase() !== expected.toLowerCase()) mismatched.push(rel);
  }
  if (mismatched.length) {
    return { ok: false, error: "Agent file hash mismatch — refuse to run (tamper/hijack).", mismatched };
  }
  return { ok: true };
}

export function loadManifestFromJson(raw: string): AgentManifest {
  const parsed = JSON.parse(raw) as AgentManifest;
  if (!parsed || typeof parsed.version !== "string" || typeof parsed.files !== "object") {
    throw new Error("Invalid agent manifest.");
  }
  return parsed;
}

/** Local control plane: must bind 127.0.0.1 and require a shared auth token. */
export function localControlAuth(input: {
  bindHost: string;
  providedToken: string | null;
  expectedToken: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.bindHost !== "127.0.0.1" && input.bindHost !== "localhost" && input.bindHost !== "::1") {
    return { ok: false, error: "Local control port must bind to localhost only." };
  }
  if (!input.expectedToken || input.providedToken !== input.expectedToken) {
    return { ok: false, error: "Local control auth failed." };
  }
  return { ok: true };
}

export function readFileHashSync(path: string): string {
  return hashContent(readFileSync(path));
}
