import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSupabaseEnv, isSupabaseConfigured } from "./env.ts";

describe("resolveSupabaseEnv", () => {
  it("returns null when both url and key are missing", () => {
    assert.equal(resolveSupabaseEnv({}), null);
    assert.equal(resolveSupabaseEnv({ SUPABASE_URL: "https://x.supabase.co" }), null);
    assert.equal(resolveSupabaseEnv({ SUPABASE_ANON_KEY: "anon" }), null);
  });

  it("reads canonical SUPABASE_URL + SUPABASE_ANON_KEY", () => {
    assert.deepEqual(
      resolveSupabaseEnv({
        SUPABASE_URL: " https://example.supabase.co ",
        SUPABASE_ANON_KEY: " anon-key ",
      }),
      { url: "https://example.supabase.co", anonKey: "anon-key" },
    );
  });

  it("accepts Vercel–Supabase integration names", () => {
    assert.deepEqual(
      resolveSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://int.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "pub-anon",
      }),
      { url: "https://int.supabase.co", anonKey: "pub-anon" },
    );
    assert.deepEqual(
      resolveSupabaseEnv({
        SUPABASE_URL: "https://a.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
      }),
      { url: "https://a.supabase.co", anonKey: "publishable" },
    );
    assert.deepEqual(
      resolveSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://pub.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "npk",
      }),
      { url: "https://pub.supabase.co", anonKey: "npk" },
    );
  });

  it("ignores empty / whitespace values", () => {
    assert.equal(
      resolveSupabaseEnv({
        SUPABASE_URL: "   ",
        SUPABASE_ANON_KEY: "key",
      }),
      null,
    );
  });

  it("does not treat VITE_ variables as configured", () => {
    assert.equal(
      resolveSupabaseEnv({
        VITE_SUPABASE_URL: "https://vite.supabase.co",
        VITE_SUPABASE_ANON_KEY: "vite-key",
      } as Record<string, string | undefined>),
      null,
    );
  });

  it("isSupabaseConfigured mirrors resolve", () => {
    assert.equal(isSupabaseConfigured({}), false);
    assert.equal(
      isSupabaseConfigured({
        SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_ANON_KEY: "k",
      }),
      true,
    );
  });
});
