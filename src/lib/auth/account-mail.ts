export function accountMailConfiguration(env: NodeJS.ProcessEnv) {
  const { ADRIAN_ACCOUNT_EMAIL_KEY: key, ADRIAN_ACCOUNT_EMAIL_FROM: from, BETTER_AUTH_URL: base } = env;
  if (env.VITE_AUTH_ENABLED === "false" || !key?.trim() || !from || /[\r\n]/.test(from)
    || !/@[^\s@]+\.[^\s@>]+>?$/.test(from) || !base) return null;
  try {
    const url = new URL(base);
    const development = url.protocol === "http:" && url.hostname === "localhost" && env.NODE_ENV !== "production" && !env.VERCEL;
    if ((!development && url.protocol !== "https:") || url.pathname !== "/" || url.username || url.password || url.search || url.hash) return null;
    return { origin: url.origin, from, key: key.trim() };
  } catch {
    return null;
  }
}
