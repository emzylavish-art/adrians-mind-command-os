/** Only existing app navigation IDs, never arbitrary redirects or copied approvals. */
export function safeOAuthReturnPath(value: string): string {
  try {
    const url = new URL(value, "https://mind.invalid");
    if (url.origin !== "https://mind.invalid" || url.pathname !== "/") return "/";
    const out = new URLSearchParams();
    for (const key of ["section", "chat", "project", "file", "bot"]) {
      const item = url.searchParams.get(key);
      if (item && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(item)) out.set(key, item);
    }
    return out.size ? `/?${out}` : "/";
  } catch { return "/"; }
}
export function rememberOAuthReturn(storage: Pick<Storage, "setItem">, connector: string, redirectUrl: string, path: string) {
  try {
    const state = new URL(redirectUrl).searchParams.get("state");
    if (state && /^[A-Za-z0-9_-]{32,128}$/.test(state)) storage.setItem(`mind.oauth.return.${connector}`, JSON.stringify({ state, path: safeOAuthReturnPath(path) }));
  } catch { /* Storage denied: callback retains its safe home link. */ }
}
