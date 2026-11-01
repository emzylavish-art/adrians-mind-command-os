/**
 * Server-side Supabase env resolution.
 * Accepts canonical names and Vercel–Supabase integration aliases.
 * Never reads VITE_* (those would leak into the client bundle).
 */

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

const URL_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_URL",
] as const;

const ANON_KEYS = [
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

function firstDefined(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Resolve URL + anon/publishable key from a process-like env map. */
export function resolveSupabaseEnv(
  env: Record<string, string | undefined>,
): SupabaseEnv | null {
  const url = firstDefined(env, URL_KEYS);
  const anonKey = firstDefined(env, ANON_KEYS);
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return resolveSupabaseEnv(env) !== null;
}
