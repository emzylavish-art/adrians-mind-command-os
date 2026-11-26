import { SessionIdentityConflictError, type SessionCandidate } from "./session-user.ts";

export type SessionIdentity = SessionCandidate & { sessionSource?: "supabase" | "better-auth" | "both" };

/** Read-only canonical identity used by both UI and account-sensitive endpoints. */
export async function handleSessionIdentity(
  request: Request,
  resolve: (bearer?: string) => Promise<SessionIdentity | null>,
): Promise<Response> {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (request.method !== "GET") return new Response(JSON.stringify({ status: "unavailable", error: "Method not allowed." }), { status: 405, headers });
  try {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const user = await resolve(bearer);
    return new Response(JSON.stringify({ status: user ? "authenticated" : "signed-out", user }), { headers });
  } catch (error) {
    const conflict = error instanceof SessionIdentityConflictError;
    return new Response(JSON.stringify({
      status: conflict ? "conflict" : "unavailable", user: null,
      error: conflict ? error.message : "Account verification is unavailable. Try again before sending or saving account data.",
    }), { status: conflict ? 409 : 503, headers });
  }
}
