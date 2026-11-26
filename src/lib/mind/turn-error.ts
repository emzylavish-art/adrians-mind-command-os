/** Stable transport/application outcomes. Human wording never selects recovery behavior. */
export const TURN_ERROR_CODES = [
  "auth_required", "forbidden_cross_site", "rate_limited", "service_unavailable", "provider_unavailable",
  "provider_credentials_rejected", "billing_required", "model_unavailable", "request_invalid", "invalid_response",
  "stream_incomplete", "delivery_unconfirmed", "database_write_failed", "emergency_stop_active", "memory_policy_changed",
  "chat_timeout", "network_failure", "user_stopped", "unknown",
] as const;
export type TurnErrorCode = (typeof TURN_ERROR_CODES)[number];

export function turnErrorCode(value: unknown, httpStatus?: number): TurnErrorCode {
  if (typeof value === "string" && (TURN_ERROR_CODES as readonly string[]).includes(value)) return value as TurnErrorCode;
  if (httpStatus === 401) return "auth_required";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 408 || httpStatus === 504) return "chat_timeout";
  if (httpStatus === 400 || httpStatus === 413 || httpStatus === 422) return "request_invalid";
  if (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599) return "service_unavailable";
  return "unknown";
}

/** Upstream authentication is distinct from the owner's application sign-in. */
export function providerErrorCode(httpStatus?: number, explicit?: unknown): TurnErrorCode {
  if (explicit !== undefined && turnErrorCode(explicit) !== "unknown") return turnErrorCode(explicit);
  if (httpStatus === 401 || httpStatus === 403) return "provider_credentials_rejected";
  if (httpStatus === 402) return "billing_required";
  return turnErrorCode(undefined, httpStatus);
}
