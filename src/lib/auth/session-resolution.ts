import type { SessionCandidate, SessionIdentity } from "./session-user.ts";
export type SessionRead = { state: "verified"; user: SessionCandidate } | { state: "absent" | "rejected" | "unavailable" };
export class SessionResolutionError extends Error {
  readonly code: "session_unavailable" | "identity_conflict" | "session_rejected";
  constructor(code: "session_unavailable" | "identity_conflict" | "session_rejected") {
    super(code === "session_unavailable" ? "Session verification is temporarily unavailable. Your saved work is kept; retry verification before sending again." : code === "identity_conflict" ? "The sign-in providers identify different accounts. Sign out of the conflicting session and sign in to the intended account; no workspace was selected." : "Your session expired or was rejected. Sign in again, then recover the original operation before starting another send.");
    this.name = "SessionResolutionError";
    this.code = code;
  }
  get status() { return this.code === "session_unavailable" ? 503 : this.code === "identity_conflict" ? 409 : 401; }
}
/** An unavailable or rejected authority never becomes permission to try another identity. */
export function reconcileSessionReads(primary: SessionRead, secondary: SessionRead): SessionIdentity | null {
  if (primary.state === "unavailable" || secondary.state === "unavailable") throw new SessionResolutionError("session_unavailable");
  if (primary.state === "rejected" || secondary.state === "rejected") throw new SessionResolutionError("session_rejected");
  if (primary.state === "verified" && secondary.state === "verified" && primary.user.id !== secondary.user.id) throw new SessionResolutionError("identity_conflict");
  if (primary.state === "verified") {
    return { ...primary.user, sessionSource: secondary.state === "verified" ? "both" : "supabase" };
  }
  return secondary.state === "verified" ? { ...secondary.user, sessionSource: "better-auth" } : null;
}
export function classifySessionError(error: unknown, credentialPresent: boolean): SessionRead {
  const row = error && typeof error === "object" ? error as { name?: string; status?: number; code?: string } : {};
  if (row.name === "AuthSessionMissingError" || row.code === "session_not_found") return { state: credentialPresent ? "rejected" : "absent" };
  if (row.status === 401 || row.status === 403 || row.code === "refresh_token_not_found") return { state: "rejected" };
  return { state: "unavailable" };
}
export function sessionErrorStatus(error: unknown): number {
  if (error instanceof SessionResolutionError) return error.status;
  return error && typeof error === "object" && "status" in error && error.status === 401 ? 401 : 503;
}
