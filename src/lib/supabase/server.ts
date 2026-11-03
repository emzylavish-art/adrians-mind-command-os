/**
 * Server-only Supabase client bound to TanStack Start / h3 HTTP-only cookies.
 * Do not import from client components — pulls `@tanstack/react-start/server`.
 */
import { createServerClient } from "@supabase/ssr";
import {
  getCookies,
  setCookie,
} from "@tanstack/react-start/server";
import {
  isProductionRuntime,
  mergeCookieOptions,
} from "./cookies";
import { resolveSupabaseEnv, type SupabaseEnv } from "./env";

export function readSupabaseEnv(): SupabaseEnv | null {
  return resolveSupabaseEnv(
    process.env as Record<string, string | undefined>,
  );
}

export function createSupabaseServerClient() {
  const resolved = readSupabaseEnv();
  if (!resolved) {
    throw new Error("Supabase env is not configured");
  }

  const isProd = isProductionRuntime({
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
  });

  return createServerClient(resolved.url, resolved.anonKey, {
    cookies: {
      getAll() {
        const jar = getCookies();
        return Object.entries(jar).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          const merged = mergeCookieOptions(
            options as Record<string, unknown> | undefined,
            isProd,
          );
          setCookie(
            name,
            value,
            merged as Parameters<typeof setCookie>[2],
          );
        }
      },
    },
    auth: {
      flowType: "pkce",
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });
}
