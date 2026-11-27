/** USD amounts are integer microdollars (1 USD = 1,000,000); never floating-point billing claims. */
export type MonetaryDispatchContext = {
  operationId: string;
  provider: string;
  model: string;
  projectId?: string | null;
  taskId?: string | null;
  /** SHA-256 of immutable request arguments. Do not include credentials in exported evidence. */
  requestHash?: string;
  /** Required for verified free text pricing; image/audio/tools remain unpriced unless independently covered. */
  textOnly?: boolean;
};
export type MonetarySettlement = {
  outcome: "completed" | "not_sent" | "unknown";
  /** Only a parsed provider USD charge belongs here. Token counts or estimated prices are not actual dollars. */
  actualCostMicros?: number;
  currency?: "USD";
  providerRequestId?: string | null;
};
export type OwnerPriceCeiling = { provider: string; model: string; ceilingMicros: number; expiresAt: string; note: string; basis: "owner_estimate" };
export type FinancialPolicy = {
  enabled: boolean; currency: "USD"; revision: number;
  dailyLimitMicros: number; weeklyLimitMicros: number; monthlyLimitMicros: number; taskLimitMicros: number;
  approvalAboveMicros: number; freeOnly: boolean;
  providerMonthlyCaps: Record<string, number>; projectMonthlyCaps: Record<string, number>;
  ceilings: OwnerPriceCeiling[];
};
export const DEFAULT_FINANCIAL_POLICY: FinancialPolicy = { enabled: false, currency: "USD", revision: 0, dailyLimitMicros: 0, weeklyLimitMicros: 0, monthlyLimitMicros: 0, taskLimitMicros: 0, approvalAboveMicros: 0, freeOnly: false, providerMonthlyCaps: {}, projectMonthlyCaps: {}, ceilings: [] };
export type FinancialReservationResult = { ok: true; reservationId?: string } | { ok: false; error: string; status: number; approvalId?: string };
export type FinancialLedgerRow = { id: string; operationId: string; provider: string; model: string; projectId: string | null; taskId: string; reservedMicros: number; actualMicros: number | null; state: "reserved" | "unknown" | "settled" | "released"; costBasis: "owner_estimate" | "verified_free" | "provider_reported" | "owner_invoice"; providerRequestId: string | null; createdAt: string; updatedAt: string; invoiceRef: string | null };
export type FinancialApproval = { id: string; operationId: string; provider: string; model: string; projectId: string | null; taskId: string; ceilingMicros: number; state: "pending" | "approved" | "consumed" | "revoked"; expiresAt: string };
export type FinancialReconciliation = { id: string; reservationId: string; invoiceRef: string; actualMicros: number; previousMicros: number | null; createdAt: string };
export type FinancialSnapshot = { policy: FinancialPolicy; totals: { dayMicros: number; weekMicros: number; monthMicros: number; unknownCount: number }; ledger: FinancialLedgerRow[]; reconciliations: FinancialReconciliation[]; approvals: FinancialApproval[]; verifiedFreeModels: Array<{ provider: string; model: string; expiresAt: string }>; incompleteHistory: boolean };
export const validMoney = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
const label = (value: unknown, limit = 160): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= limit && !/\p{Cc}/u.test(value);
export function validateMonetaryContext(value: unknown): value is MonetaryDispatchContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as MonetaryDispatchContext;
  return label(input.operationId, 240) && label(input.provider) && label(input.model, 240) && (input.projectId == null || label(input.projectId)) && (input.taskId == null || label(input.taskId, 240)) && (input.requestHash === undefined || /^[a-f0-9]{64}$/.test(input.requestHash)) && (input.textOnly === undefined || typeof input.textOnly === "boolean");
}
export function parseFinancialPolicy(value: unknown): { ok: true; policy: Omit<FinancialPolicy, "revision">; expectedRevision: number } | { ok: false; error: string } {
  const fail = () => ({ ok: false as const, error: "Use nonnegative USD amounts, bounded provider/project scopes, valid expiring owner estimates and the current policy revision." });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as FinancialPolicy & { expectedRevision?: number };
  if (typeof v.enabled !== "boolean" || v.currency !== "USD" || typeof v.freeOnly !== "boolean" || !Number.isSafeInteger(v.expectedRevision) || (v.expectedRevision ?? -1) < 0 || ![v.dailyLimitMicros, v.weeklyLimitMicros, v.monthlyLimitMicros, v.taskLimitMicros, v.approvalAboveMicros].every(validMoney)) return fail();
  const caps = (input: unknown): input is Record<string, number> => !!input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length <= 100 && Object.entries(input).every(([key, amount]) => label(key) && validMoney(amount));
  if (!caps(v.providerMonthlyCaps) || !caps(v.projectMonthlyCaps) || !Array.isArray(v.ceilings) || v.ceilings.length > 100) return fail();
  const unique = new Set<string>();
  for (const price of v.ceilings) {
    if (!price || !label(price.provider) || !label(price.model, 240) || !validMoney(price.ceilingMicros) || price.basis !== "owner_estimate" || typeof price.expiresAt !== "string" || price.expiresAt.length > 80 || !Number.isFinite(Date.parse(price.expiresAt)) || typeof price.note !== "string" || price.note.length > 500 || unique.has(price.provider + "\0" + price.model)) return fail();
    unique.add(price.provider + "\0" + price.model);
  }
  return { ok: true, expectedRevision: v.expectedRevision!, policy: { enabled: v.enabled, currency: "USD", freeOnly: v.freeOnly, dailyLimitMicros: v.dailyLimitMicros, weeklyLimitMicros: v.weeklyLimitMicros, monthlyLimitMicros: v.monthlyLimitMicros, taskLimitMicros: v.taskLimitMicros, approvalAboveMicros: v.approvalAboveMicros, providerMonthlyCaps: { ...v.providerMonthlyCaps }, projectMonthlyCaps: { ...v.projectMonthlyCaps }, ceilings: v.ceilings.map(price => ({ provider: price.provider, model: price.model, ceilingMicros: price.ceilingMicros, expiresAt: price.expiresAt, note: price.note, basis: "owner_estimate" })) } };
}
export function financialPeriods(now: number) {
  const date = new Date(now); const day = date.toISOString().slice(0, 10); const week = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
  return { day, week, month: day.slice(0, 7) };
}
export function budgetCharge(row: Pick<FinancialLedgerRow, "state" | "reservedMicros" | "actualMicros">): number {
  return row.state === "released" ? 0 : row.actualMicros ?? row.reservedMicros;
}
export function dollarsToMicros(value: string): number | null { if (!/^\d{1,7}(?:\.\d{1,6})?$/.test(value.trim())) return null; const [whole, decimal = ""] = value.trim().split("."); const amount = Number(whole) * 1_000_000 + Number(decimal.padEnd(6, "0")); return validMoney(amount) ? amount : null; }
