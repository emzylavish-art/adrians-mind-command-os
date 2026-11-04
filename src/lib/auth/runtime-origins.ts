/** Vercel supplies deployment and branch hostnames as server-side environment values.
 * Never derive this allowlist from request headers. */
export function vercelRuntimeHosts(env: { VERCEL_URL?: string; VERCEL_BRANCH_URL?: string }): string[] {
  const result = new Set<string>();
  for (const raw of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    if (!raw || raw !== raw.trim() || raw.length > 253 || /[^a-zA-Z0-9.-]/.test(raw)) continue;
    const host = raw.toLowerCase();
    const labels = host.split('.');
    if (labels.length < 2 || labels.some((x) => x.length === 0 || x.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x))) continue;
    if (!host.endsWith('.vercel.app')) continue;
    result.add(host);
  }
  return [...result];
}
