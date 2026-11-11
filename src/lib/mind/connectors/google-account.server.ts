/** Reads the Google account email. Never returns or logs a token. */

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export function emailFromGoogleUserinfo(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const email = (json as { email?: unknown }).email;
  return typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email) ? email : null;
}

export async function googleAccountEmail(accessToken: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const response = await fetchImpl("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) return null;
    return emailFromGoogleUserinfo(await response.json().catch(() => null));
  } catch {
    return null;
  }
}
