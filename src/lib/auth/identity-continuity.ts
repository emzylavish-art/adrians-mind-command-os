/** A presented credential must never turn into a different login after verification fails. */
export function hasSupabaseCredential(cookie: string | null): boolean {
  return /(?:^|;\s*)sb-[^=;]*auth-token(?:\.\d+)?=/i.test(cookie ?? "");
}
export function sessionFallbackAllowed(input: { supabasePresented: boolean; supabaseVerified: boolean }): boolean {
  return !input.supabasePresented && !input.supabaseVerified;
}
export function identitiesAgree(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b;
}
