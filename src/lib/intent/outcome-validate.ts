/**
 * Pure validation for intent outcome batches (client + server safe).
 * No server imports.
 */

export const MAX_OUTCOME_BATCH = 50;
export const MAX_NOTE_CHARS = 500;
export const MAX_INTENT_ID_CHARS = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OutcomeBatchItemInput = {
  intentId?: unknown;
  patternId?: unknown;
  hit?: unknown;
  observedAt?: unknown;
  note?: unknown;
  /** Client queue fingerprint for ack/clear. */
  clientId?: unknown;
};

export type ValidatedOutcomeItem = {
  intentId: string;
  /** Present only when a well-formed uuid was supplied. */
  patternId: string | null;
  hit: boolean;
  observedAt: string;
  note: string | null;
  clientId: string | null;
};

export type ValidateBatchResult =
  | { ok: true; items: ValidatedOutcomeItem[]; droppedInvalid: number }
  | { ok: false; error: string };

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function asTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function parseObservedAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value.trim());
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
  }
  return null;
}

export function validateOutcomeItem(
  raw: OutcomeBatchItemInput,
): ValidatedOutcomeItem | null {
  const intentId = asTrimmedString(raw.intentId, MAX_INTENT_ID_CHARS);
  if (!intentId) return null;
  if (typeof raw.hit !== "boolean") return null;
  const observedAt = parseObservedAt(raw.observedAt);
  if (!observedAt) return null;

  let patternId: string | null = null;
  if (raw.patternId !== undefined && raw.patternId !== null && raw.patternId !== "") {
    if (typeof raw.patternId !== "string" || !isUuid(raw.patternId.trim())) {
      // Malformed patternId → drop the row (do not insert).
      return null;
    }
    patternId = raw.patternId.trim();
  }

  const note =
    raw.note === undefined || raw.note === null
      ? null
      : asTrimmedString(raw.note, MAX_NOTE_CHARS);

  const clientId =
    raw.clientId === undefined || raw.clientId === null
      ? null
      : asTrimmedString(raw.clientId, 80);

  return {
    intentId,
    patternId,
    hit: raw.hit,
    observedAt,
    note,
    clientId,
  };
}

export function validateOutcomeBatch(body: unknown): ValidateBatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be an object with an items array." };
  }
  const itemsRaw = (body as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) {
    return { ok: false, error: "items must be an array." };
  }
  if (itemsRaw.length === 0) {
    return { ok: false, error: "items must not be empty." };
  }
  if (itemsRaw.length > MAX_OUTCOME_BATCH) {
    return { ok: false, error: `items max is ${MAX_OUTCOME_BATCH}.` };
  }

  const items: ValidatedOutcomeItem[] = [];
  let droppedInvalid = 0;
  for (const row of itemsRaw) {
    if (!row || typeof row !== "object") {
      droppedInvalid += 1;
      continue;
    }
    const validated = validateOutcomeItem(row as OutcomeBatchItemInput);
    if (!validated) {
      droppedInvalid += 1;
      continue;
    }
    items.push(validated);
  }
  return { ok: true, items, droppedInvalid };
}
