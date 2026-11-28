export function passkeyConfiguration(env: NodeJS.ProcessEnv) {
  if (env.VITE_AUTH_ENABLED === "false" || !env.ADRIAN_PASSKEY_ORIGIN || !env.BETTER_AUTH_URL) return null;
  try {
    const auth = new URL(env.BETTER_AUTH_URL);
    const url = new URL(env.ADRIAN_PASSKEY_ORIGIN);
    const isLocal = url.protocol === "http:" && url.hostname === "localhost" && env.NODE_ENV !== "production" && !env.VERCEL;
    if ((!isLocal && url.protocol !== "https:") || auth.origin !== url.origin
      || [auth, url].some(value => value.username || value.password || value.pathname !== "/" || value.search || value.hash)) return null;
    return { origin: url.origin, rpID: url.hostname };
  } catch { return null; }
}

export function passkeyAccess(pathname: string) {
  const route = /^\/api\/auth\/passkey(?:\/(.*))?$/i.exec(decodeURIComponent(pathname));
  if (!route) return null;
  switch (route[1]) {
    case "generate-authenticate-options":
    case "verify-authentication":
      return "sign-in";
    case "list-user-passkeys":
      return "read";
    case "generate-register-options":
    case "verify-registration":
    case "delete-passkey":
    case "update-passkey":
      return "change";
    default:
      return "unknown";
  }
}

export function freshPasskeySession(createdAt: Date | string, now = Date.now()) {
  const age = now - new Date(createdAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < 5 * 60_000;
}
