export type UsageReservationStatus = "reserved" | "needs_reconciliation" | "settled" | "released";

export type UsageReservation = {
  idempotencyKey: string;
  ownerId: string;
  taskId: string;
  providerId: string;
  model: string;
  reservedTokens: number;
  status: UsageReservationStatus;
  reservedAt: number;
  usedTokens?: number;
  closedAt?: number;
};

export type UsageBudgetState = { reservations: Record<string, UsageReservation> };
export type UsageBudgetSummary = {
  ownerId: string;
  utcDay: string;
  capTokens: number;
  usedTokens: number;
  heldTokens: number;
  availableTokens: number;
};

export type ReserveUsageInput = {
  ownerId: string;
  taskId: string;
  providerId: string;
  model: string;
  idempotencyKey: string;
  reserveTokens: number;
  dailyTokenCap: number;
  now?: number;
};

export type FinalizeUsageInput = {
  ownerId: string;
  idempotencyKey: string;
  dispatched: boolean;
  actualTokens?: number;
  now?: number;
};

export type UsageMutationResult =
  | { ok: true; state: UsageBudgetState; reservation: UsageReservation; duplicate?: true }
  | { ok: false; state: UsageBudgetState; error: string };

const MAX_RESERVATION_TOKENS = 10_000_000;
const MAX_DAILY_TOKENS = 1_000_000_000;
const ACTIVE_STATUSES = new Set<UsageReservationStatus>(["reserved", "needs_reconciliation"]);

function nonEmpty(value: string, max = 160): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function validWholeNumber(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validTimestamp(value: number): boolean {
  return Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value) && value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

function dayKey(timestamp: number): string {
  return validTimestamp(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "invalid-date";
}

function sameReservation(a: UsageReservation, input: ReserveUsageInput): boolean {
  return a.ownerId === input.ownerId && a.taskId === input.taskId && a.providerId === input.providerId &&
    a.model === input.model && a.reservedTokens === input.reserveTokens;
}

function budgetUsage(state: UsageBudgetState, ownerId: string, now: number): { usedTokens: number; heldTokens: number } {
  const day = dayKey(now);
  let usedTokens = 0;
  let heldTokens = 0;
  for (const reservation of Object.values(state.reservations)) {
    if (reservation.ownerId !== ownerId || dayKey(reservation.reservedAt) !== day) continue;
    if (ACTIVE_STATUSES.has(reservation.status)) heldTokens += reservation.reservedTokens;
    else if (reservation.status === "settled") usedTokens += reservation.usedTokens ?? 0;
  }
  return { usedTokens, heldTokens };
}

/** Calculate confirmed use and still-held reservations for one owner and UTC day. */
export function summarizeUsageBudget(
  state: UsageBudgetState,
  ownerId: string,
  dailyTokenCap: number,
  now = Date.now(),
): UsageBudgetSummary {
  const { usedTokens, heldTokens } = budgetUsage(state, ownerId, now);
  return {
    ownerId,
    utcDay: dayKey(now),
    capTokens: dailyTokenCap,
    usedTokens,
    heldTokens,
    availableTokens: Math.max(0, dailyTokenCap - usedTokens - heldTokens),
  };
}

/**
 * Reserve a bounded token estimate before dispatch. An idempotent repeat returns
 * the original reservation; a reused key with a different request is refused.
 * Persist the returned state transactionally in the real task store before use.
 */
export function reserveUsage(
  state: UsageBudgetState,
  input: ReserveUsageInput,
): UsageMutationResult {
  const now = input.now ?? Date.now();
  if (!nonEmpty(input.ownerId) || !nonEmpty(input.taskId) || !nonEmpty(input.providerId) ||
      !nonEmpty(input.model) || !validIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, state, error: "Usage reservation identifiers are invalid." };
  }
  if (!validWholeNumber(input.reserveTokens, 1, MAX_RESERVATION_TOKENS) ||
      !validWholeNumber(input.dailyTokenCap, 1, MAX_DAILY_TOKENS) || !validTimestamp(now)) {
    return { ok: false, state, error: "Usage reservation limits are invalid." };
  }
  const existing = Object.hasOwn(state.reservations, input.idempotencyKey)
    ? state.reservations[input.idempotencyKey]
    : undefined;
  if (existing) {
    if (!sameReservation(existing, input)) return { ok: false, state, error: "Idempotency key was already used for a different request." };
    return { ok: true, state, reservation: existing, duplicate: true };
  }
  const current = budgetUsage(state, input.ownerId, now);
  if (current.usedTokens + current.heldTokens + input.reserveTokens > input.dailyTokenCap) {
    return { ok: false, state, error: "The daily token budget would be exceeded. Nothing was dispatched." };
  }
  const reservation: UsageReservation = {
    idempotencyKey: input.idempotencyKey,
    ownerId: input.ownerId,
    taskId: input.taskId,
    providerId: input.providerId,
    model: input.model,
    reservedTokens: input.reserveTokens,
    status: "reserved",
    reservedAt: now,
  };
  return {
    ok: true,
    state: { reservations: { ...state.reservations, [input.idempotencyKey]: reservation } },
    reservation,
  };
}

/**
 * Settle actual provider usage. If a dispatched request has no authoritative
 * usage report (common after cancellation/network loss), keep its budget held in
 * `needs_reconciliation`; do not free it optimistically or charge an estimate as fact.
 */
export function finalizeUsage(
  state: UsageBudgetState,
  input: FinalizeUsageInput,
): UsageMutationResult {
  const now = input.now ?? Date.now();
  if (!validIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, state, error: "Usage reservation was not found for this owner." };
  }
  const current = Object.hasOwn(state.reservations, input.idempotencyKey)
    ? state.reservations[input.idempotencyKey]
    : undefined;
  if (!current || current.ownerId !== input.ownerId) {
    return { ok: false, state, error: "Usage reservation was not found for this owner." };
  }
  if (!validTimestamp(now)) return { ok: false, state, error: "Usage finalization time is invalid." };
  if (input.actualTokens !== undefined && !validWholeNumber(input.actualTokens, 0, MAX_RESERVATION_TOKENS)) {
    return { ok: false, state, error: "Reported token usage is invalid." };
  }
  if (input.actualTokens !== undefined && !input.dispatched) {
    return { ok: false, state, error: "Usage cannot be reported for a request that was not dispatched." };
  }

  if (current.status === "settled") {
    if (input.actualTokens === current.usedTokens) return { ok: true, state, reservation: current, duplicate: true };
    return { ok: false, state, error: "Usage reservation is already settled with different usage." };
  }
  if (current.status === "released") {
    if (input.actualTokens === undefined && !input.dispatched) return { ok: true, state, reservation: current, duplicate: true };
    return { ok: false, state, error: "A released usage reservation cannot be charged later." };
  }

  let reservation: UsageReservation;
  if (input.actualTokens !== undefined) {
    reservation = { ...current, status: "settled", usedTokens: input.actualTokens, closedAt: now };
  } else if (input.dispatched) {
    reservation = { ...current, status: "needs_reconciliation" };
  } else if (current.status === "needs_reconciliation") {
    return { ok: false, state, error: "A dispatched request cannot be released without authoritative reconciliation." };
  } else {
    reservation = { ...current, status: "released", usedTokens: 0, closedAt: now };
  }

  return {
    ok: true,
    state: { reservations: { ...state.reservations, [input.idempotencyKey]: reservation } },
    reservation,
  };
}
