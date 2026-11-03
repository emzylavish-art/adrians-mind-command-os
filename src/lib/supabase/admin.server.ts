/**
 * Server-only Supabase admin client (service role). Never import from client.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseServiceRole } from "./env";

export function createSupabaseAdminClient(): SupabaseClient {
  const resolved = resolveSupabaseServiceRole(
    process.env as Record<string, string | undefined>,
  );
  if (!resolved) {
    throw new Error("Supabase service role is not configured");
  }
  return createClient(resolved.url, resolved.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
