import { createHash } from "node:crypto";
import type { RegistryRecord } from "./registry-store.ts";

/** Object key order never changes the meaning of a reviewed tool or argument. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function toolDefinitionFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
/** Opaque revision binds actual endpoint/credential values, not randomly rewrapped ciphertext. */
export function connectionRevision(row: RegistryRecord): string {
  return toolDefinitionFingerprint({ id: row.id, label: row.label, kind: row.kind, protocol: row.protocol,
    url: row.url, method: row.httpMethod, token: row.token ?? null, secretUnreadable: Boolean(row.secretUnreadable),
    enabled: row.enabled, operations: row.operations ?? [] });
}
export function approvalRequestFingerprint(revision: string, operation: string, args: Record<string, unknown>): string {
  return toolDefinitionFingerprint({ revision, operation, args });
}
