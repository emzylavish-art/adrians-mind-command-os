/**
 * Server-only pattern_outcomes insert via Supabase REST (service role).
 * Import only from API route handlers (or dynamic import inside them).
 */
import {
  resolveSupabaseServiceRole,
  type SupabaseServiceEnv,
} from "../supabase/env.ts";
import type { ValidatedOutcomeItem } from "./outcome-validate.ts";

export type InsertOutcomesResult =
  | {
      ok: true;
      inserted: number;
      droppedNoPattern: number;
      droppedUnknownPattern: number;
      acknowledged: string[];
    }
  | { ok: false; status: 503; error: string };

type FetchLike = typeof fetch;

function ackId(item: ValidatedOutcomeItem, index: number): string {
  return item.clientId ?? `${item.intentId}:${item.observedAt}:${index}`;
}

async function readExistingPatternIds(
  env: SupabaseServiceEnv,
  ids: string[],
  fetchImpl: FetchLike,
): Promise<{ ok: true; ids: Set<string> } | { ok: false; status: 503; error: string }> {
  if (ids.length === 0) return { ok: true, ids: new Set() };
  const unique = [...new Set(ids)];
  const filter = unique.map((id) => `"${id}"`).join(",");
  const url = `${env.url.replace(/\/$/, "")}/rest/v1/patterns?select=id&id=in.(${filter})`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        Accept: "application/json",
      },
    });
  } catch {
    return { ok: false, status: 503, error: "pattern store unreachable" };
  }
  if (res.status === 404 || res.status === 503) {
    return { ok: false, status: 503, error: "pattern store unavailable" };
  }
  if (!res.ok) {
    // Missing table often surfaces as 404 or PostgREST error JSON.
    const text = await res.text().catch(() => "");
    if (res.status === 400 && /does not exist|PGRST/i.test(text)) {
      return { ok: false, status: 503, error: "pattern store unavailable" };
    }
    if (res.status >= 500) {
      return { ok: false, status: 503, error: "pattern store unavailable" };
    }
    return { ok: false, status: 503, error: "pattern store unavailable" };
  }
  const rows = (await res.json().catch(() => null)) as { id?: string }[] | null;
  if (!Array.isArray(rows)) {
    return { ok: false, status: 503, error: "pattern store unavailable" };
  }
  return { ok: true, ids: new Set(rows.map((r) => String(r.id || "")).filter(Boolean)) };
}

export async function insertPatternOutcomes(
  items: ValidatedOutcomeItem[],
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: FetchLike;
  } = {},
): Promise<InsertOutcomesResult> {
  const envMap = options.env ?? (process.env as Record<string, string | undefined>);
  const resolved = resolveSupabaseServiceRole(envMap);
  if (!resolved) {
    return { ok: false, status: 503, error: "service role not configured" };
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const acknowledged: string[] = [];
  let droppedNoPattern = 0;
  const withPattern: { item: ValidatedOutcomeItem; index: number }[] = [];

  items.forEach((item, index) => {
    acknowledged.push(ackId(item, index));
    if (!item.patternId) {
      droppedNoPattern += 1;
      return;
    }
    withPattern.push({ item, index });
  });

  if (withPattern.length === 0) {
    return {
      ok: true,
      inserted: 0,
      droppedNoPattern,
      droppedUnknownPattern: 0,
      acknowledged,
    };
  }

  const existing = await readExistingPatternIds(
    resolved,
    withPattern.map((row) => row.item.patternId!),
    fetchImpl,
  );
  if (!existing.ok) return existing;

  const toInsert = withPattern.filter((row) => existing.ids.has(row.item.patternId!));
  const droppedUnknownPattern = withPattern.length - toInsert.length;

  if (toInsert.length === 0) {
    return {
      ok: true,
      inserted: 0,
      droppedNoPattern,
      droppedUnknownPattern,
      acknowledged,
    };
  }

  const payload = toInsert.map(({ item }) => ({
    pattern_id: item.patternId,
    hit: item.hit,
    observed_at: item.observedAt,
    note: item.note
      ? `intentId=${item.intentId}; ${item.note}`.slice(0, 500)
      : `intentId=${item.intentId}`,
  }));

  const url = `${resolved.url.replace(/\/$/, "")}/rest/v1/pattern_outcomes`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        apikey: resolved.serviceRoleKey,
        Authorization: `Bearer ${resolved.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, status: 503, error: "pattern_outcomes unreachable" };
  }

  if (res.status === 404 || res.status === 503 || res.status >= 500) {
    return { ok: false, status: 503, error: "pattern_outcomes unavailable" };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/does not exist|PGRST205|Could not find the table/i.test(text)) {
      return { ok: false, status: 503, error: "pattern_outcomes unavailable" };
    }
    // FK violation for unknown pattern — treat as drop, still ack (client shouldn't retry forever)
    if (res.status === 409 || res.status === 400) {
      return {
        ok: true,
        inserted: 0,
        droppedNoPattern,
        droppedUnknownPattern: droppedUnknownPattern + toInsert.length,
        acknowledged,
      };
    }
    return { ok: false, status: 503, error: "pattern_outcomes unavailable" };
  }

  return {
    ok: true,
    inserted: toInsert.length,
    droppedNoPattern,
    droppedUnknownPattern,
    acknowledged,
  };
}
