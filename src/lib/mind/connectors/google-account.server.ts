/** Verified Google userinfo; no token or unverified JWT claims leave this module. */
export type GoogleIdentity = { email: string | null; subject: string | null };
type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export function emailFromGoogleUserinfo(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const email = (json as { email?: unknown }).email;
  return typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email) ? email : null;
}

export function identityFromGoogleUserinfo(json: unknown): GoogleIdentity {
  const raw = json && typeof json === "object" ? json as Record<string, unknown> : {};
  return {
    email: emailFromGoogleUserinfo(json),
    subject: typeof raw.sub === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(raw.sub) ? raw.sub : null,
  };
}

export async function googleAccountIdentity(accessToken: string, fetchImpl: FetchLike = fetch, timeoutMs = 5_000): Promise<GoogleIdentity | null> {
  if (!accessToken) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
  });
  const lookup = async () => {
    try {
      const response = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted) return null;
      const identity = identityFromGoogleUserinfo(await response.json().catch(() => null));
      return controller.signal.aborted || (!identity.email && !identity.subject) ? null : identity;
    } catch { return null; }
  };
  try { return await Promise.race([lookup(), deadline]); }
  finally { clearTimeout(timer); }
}

export async function googleAccountEmail(accessToken: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  return (await googleAccountIdentity(accessToken, fetchImpl))?.email ?? null;
}
