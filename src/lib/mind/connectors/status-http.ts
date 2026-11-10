/** Safe API response for errors while reading OAuth connection status.
 * Never echo upstream exception text, database URLs, tokens, or credentials.
 */
export function oauthStatusFailure(error: unknown): {
  status: 401 | 503;
  body: { ok: false; state: "unavailable"; detail: string; error: string };
} {
  const unauthorized = error instanceof Error &&
    (error.message === "Unauthorized" || error.name === "UnauthorizedError");
  if (unauthorized) {
    return {
      status: 401,
      body: {
        ok: false, state: "unavailable",
        detail: "Connection status could not be read (sign in required).",
        error: "Sign in is required.",
      },
    };
  }
  return {
    status: 503,
    body: {
      ok: false, state: "unavailable",
      detail: "Connection status could not be read (server unavailable).",
      error: "The connection status service is unavailable.",
    },
  };
}
