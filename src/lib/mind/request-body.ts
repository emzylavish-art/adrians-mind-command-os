/**
 * Shared JSON body guard for /api/mind/turn and /api/mind/agent.
 * Non-object JSON (null, arrays, primitives) must never reach property access.
 */

import { isModelTier, type ModelTier } from "./model-tiers.ts";

export const MIND_MAX_BODY_BYTES = 2_500_000;

/** Honest 400 copy for every body that is not a plain non-null, non-array object. */
export const MIND_BODY_UNREADABLE = "That request could not be read.";
export const MIND_BODY_TOO_LARGE = "That request is too large.";

export type ReadJsonObjectOk = { ok: true; body: Record<string, unknown> };
export type ReadJsonObjectErr = { ok: false; error: string; status: 400 | 413 };
export type ReadJsonObjectResult = ReadJsonObjectOk | ReadJsonObjectErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** True when any object key in the JSON tree is a prototype-pollution vector. */
export function hasForbiddenPollutionKey(value: unknown, depth = 0): boolean {
  if (depth > 64) return true; // fail closed on pathological depth
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenPollutionKey(item, depth + 1));
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenPollutionKey((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/** Parse a Request into a plain non-null, non-array JSON object with a byte cap. */
export async function readJsonObjectBody(
  request: Request,
  maxBytes: number = MIND_MAX_BODY_BYTES,
): Promise<ReadJsonObjectResult> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, error: MIND_BODY_TOO_LARGE, status: 413 };
    }
  }

  if (!request.body) {
    return { ok: false, error: MIND_BODY_UNREADABLE, status: 400 };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    received += step.value.byteLength;
    if (received > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      return { ok: false, error: MIND_BODY_TOO_LARGE, status: 413 };
    }
    chunks.push(step.value);
  }

  if (received === 0) {
    return { ok: false, error: MIND_BODY_UNREADABLE, status: 400 };
  }

  const buf = Buffer.concat(chunks);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { ok: false, error: MIND_BODY_UNREADABLE, status: 400 };
  }

  if (!text.trim()) {
    return { ok: false, error: MIND_BODY_UNREADABLE, status: 400 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: MIND_BODY_UNREADABLE, status: 400 };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: MIND_BODY_UNREADABLE, status: 400 };
  }

  // Reject — do not strip — any __proto__ / constructor / prototype key at any depth.
  if (hasForbiddenPollutionKey(parsed)) {
    return { ok: false, error: MIND_BODY_UNREADABLE, status: 400 };
  }

  // Fresh object copy (own enumerable string keys only).
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    body[key] = parsed[key];
  }
  return { ok: true, body };
}

export type ParseModelTierOk = { ok: true; tier: ModelTier };
export type ParseModelTierErr = { ok: false; error: string };
export type ParseModelTierResult = ParseModelTierOk | ParseModelTierErr;

/** Missing/null/empty → Auto. Anything else unknown fails loudly (no silent remap). */
export function parseModelTierField(value: unknown): ParseModelTierResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, tier: "Auto" };
  }
  if (typeof value !== "string" || !isModelTier(value)) {
    return { ok: false, error: "Unknown model tier. Choose Auto, Fast, Expert, Heavy, Build, or Orchestrator." };
  }
  return { ok: true, tier: value };
}
