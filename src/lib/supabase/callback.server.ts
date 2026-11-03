/**
 * OAuth PKCE callback — exchange code server-side, set HttpOnly cookies, redirect.
 */
import { safeRedirectPath } from "./safe-redirect";
import { oauthCallbackRedirect } from "./oauth-callback-response";

export { oauthCallbackRedirect } from "./oauth-callback-response";

export async function handleAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeRedirectPath(url.searchParams.get("next"));
  const errDescription =
    url.searchParams.get("error_description") ||
    url.searchParams.get("error") ||
    "";

  const loginError = (message: string) => {
    const target = new URL("/login", url.origin);
    target.searchParams.set("next", next);
    target.searchParams.set("error", message.slice(0, 240));
    return oauthCallbackRedirect(target.toString());
  };

  try {
    if (errDescription) {
      return loginError(errDescription);
    }

    const { readSupabaseEnv, createSupabaseServerClient } = await import(
      "./server"
    );
    if (!readSupabaseEnv()) {
      return loginError("Sign-in isn't configured yet.");
    }
    if (!code) {
      return loginError("Missing authorization code.");
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return loginError(error.message || "Could not complete sign-in.");
    }

    return oauthCallbackRedirect(new URL(next, url.origin).toString());
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim()
        ? err.message
        : "Could not complete sign-in.";
    return loginError(message);
  }
}
