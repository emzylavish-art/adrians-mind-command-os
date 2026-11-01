import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hmacHex, safeEqualHex } from "./crypto.ts";
import { readManagementKey } from "./management-key.ts";

export type AgentManifest = {
  files: Record<string, string>; // relative path -> sha256 hex
  version: string;
  /** HMAC-SHA256 over canonical file list, keyed by management key (or derived). */
  signature?: string;
  signedAt?: string;
};

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Canonical bytes signed: version + sorted "path:hash" lines. */
export function canonicalManifestPayload(manifest: Pick<AgentManifest, "version" | "files">): string {
  const lines = Object.keys(manifest.files)
    .sort()
    .map((k) => `${k}:${manifest.files[k]!.toLowerCase()}`);
  return `mind-agent-manifest|v=${manifest.version}|${lines.join("|")}`;
}

export function signAgentManifest(
  files: Record<string, string>,
  version = "1",
  now = Date.now(),
): { ok: true; manifest: AgentManifest } | { ok: false; error: string } {
  const key = readManagementKey();
  if (!key.ok) return key;
  const base: AgentManifest = { version, files: { ...files } };
  const payload = canonicalManifestPayload(base);
  const signature = hmacHex(key.key, payload);
  return {
    ok: true,
    manifest: {
      ...base,
      signature,
      signedAt: new Date(now).toISOString(),
    },
  };
}

export function verifyAgentManifestSignature(
  manifest: AgentManifest,
): { ok: true } | { ok: false; error: string } {
  const key = readManagementKey();
  if (!key.ok) return key;
  if (!manifest.signature) return { ok: false, error: "Manifest signature missing." };
  const expected = hmacHex(key.key, canonicalManifestPayload(manifest));
  if (!safeEqualHex(expected, manifest.signature)) {
    return { ok: false, error: "Manifest signature invalid (tampered or wrong key)." };
  }
  return { ok: true };
}

export function verifyAgentFiles(
  rootFiles: Record<string, string>,
  manifest: AgentManifest,
  opts?: { requireSignature?: boolean },
): { ok: true } | { ok: false; error: string; mismatched: string[] } {
  if (opts?.requireSignature !== false) {
    const sig = verifyAgentManifestSignature(manifest);
    if (!sig.ok) return { ok: false, error: sig.error, mismatched: [] };
  }
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
