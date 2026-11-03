/**
 * HTTP handlers for BuildSession: start / stream / steer / cancel / get.
 * Auth + ownership + validation + rate limits (after body validation, H14 pattern).
 */
import { requireUserId } from "../auth/verify.server";
import { getSql } from "../db";
import {
  BUILD_RATE_LIMIT_REPLY,
  BUILD_STEER_RATE_LIMIT_REPLY,
  BUILD_TERMINAL,
  publicSession,
  rejectInjectedModel,
  sanitizeBotId,
  sanitizeGoal,
  sanitizeSessionId,
  sanitizeSteer,
} from "./build-session.ts";
import { cancelBuildSession, runBuildSession, steerBuildSession } from "./build-session-exec.ts";
import {
  canStartAnother,
  loadSession,
  memoryGet,
  persistSession,
  startInMemory,
  subscribeSession,
} from "./build-session-store.ts";
import { AGENT_RATE_LIMIT_REPLY, consumeMindRateLimit, jsonRateLimited } from "./limits.ts";
import { parseModelTierField, readJsonObjectBody } from "./request-body.ts";
import { decideFetchSite } from "./request-guard.ts";
import { haltIsOn } from "./halt.server.ts";

const MAX_BODY = 100_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function siteBlocked(request: Request): boolean {
  return (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    }) === "block"
  );
}

async function authedUser(request: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  try {
    const userId = await requireUserId(bearer);
    return { ok: true, userId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return {
      ok: false,
      response: json(
        { ok: false, error: message === "Unauthorized" ? "Sign in is required." : message },
        message === "Unauthorized" ? 401 : 403,
      ),
    };
  }
}

export async function handleBuildSessionStart(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (siteBlocked(request)) return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;

  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const injected = rejectInjectedModel(read.body);
  if (!injected.ok) return json({ ok: false, error: injected.error }, 400);
  const goal = sanitizeGoal(read.body.goal);
  if (!goal.ok) return json({ ok: false, error: goal.error }, 400);
  const bot = sanitizeBotId(read.body.botId ?? read.body.agentId ?? "build-bot");
  if (!bot.ok) return json({ ok: false, error: bot.error }, 400);
  const tierField = parseModelTierField(read.body.modelTier ?? "Build");
  if (!tierField.ok) return json({ ok: false, error: tierField.error }, 400);
  void tierField;

  if (await haltIsOn(auth.userId)) {
    return json({ ok: false, error: "Emergency stop is on. No new action can run." });
  }

  const limited = consumeMindRateLimit("build-start", auth.userId, 6);
  if (!limited.ok) return jsonRateLimited(BUILD_RATE_LIMIT_REPLY, limited.retryAfterSec);

  if (!canStartAnother(auth.userId)) {
    return json({ ok: false, error: "Too many active build sessions. Cancel one first." }, 409);
  }

  const idem = (request.headers.get("idempotency-key") || "").trim().slice(0, 120);
  const { lookupIdempotency, rememberIdempotency } = await import("./build-session-store.ts");
  if (idem) {
    const existing = lookupIdempotency(auth.userId, idem);
    if (existing && existing.ownerId === auth.userId && !BUILD_TERMINAL.has(existing.status)) {
      return json({ ok: true, session: publicSession(existing), reused: true });
    }
  }

  const session = startInMemory({ ownerId: auth.userId, botId: bot.botId, goal: goal.goal });
  if (idem) rememberIdempotency(auth.userId, idem, session.id);

  try {
    const sql = await getSql();
    await persistSession(sql, session);
  } catch {
    /* pglite/pg may be warming; memory session still runs */
  }

  void runBuildSession(session.id, {}).catch(() => undefined);

  return json({ ok: true, session: publicSession(session) }, 201);
}

export async function handleBuildSessionGet(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const idField = sanitizeSessionId(url.searchParams.get("id") ?? url.pathname.split("/").pop());
  if (!idField.ok) return json({ ok: false, error: idField.error }, 400);

  let session = memoryGet(idField.id);
  if (!session || session.ownerId !== auth.userId) {
    try {
      const sql = await getSql();
      session = (await loadSession(sql, auth.userId, idField.id)) ?? undefined;
    } catch {
      session = undefined;
    }
  }
  if (!session || session.ownerId !== auth.userId) {
    return json({ ok: false, error: "That build session was not found." }, 404);
  }
  return json({ ok: true, session: publicSession(session) });
}

export async function handleBuildSessionSteer(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (siteBlocked(request)) return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;

  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const injected = rejectInjectedModel(read.body);
  if (!injected.ok) return json({ ok: false, error: injected.error }, 400);
  const idField = sanitizeSessionId(read.body.id ?? read.body.sessionId);
  if (!idField.ok) return json({ ok: false, error: idField.error }, 400);
  const steer = sanitizeSteer(read.body.text ?? read.body.message);
  if (!steer.ok) return json({ ok: false, error: steer.error }, 400);

  const limited = consumeMindRateLimit("build-steer", auth.userId, 20);
  if (!limited.ok) return jsonRateLimited(BUILD_STEER_RATE_LIMIT_REPLY, limited.retryAfterSec);

  let session = memoryGet(idField.id);
  if (!session || session.ownerId !== auth.userId) {
    try {
      const sql = await getSql();
      session = (await loadSession(sql, auth.userId, idField.id)) ?? undefined;
    } catch {
      session = undefined;
    }
  }
  if (!session || session.ownerId !== auth.userId) {
    return json({ ok: false, error: "That build session was not found." }, 404);
  }

  const result = steerBuildSession(idField.id, auth.userId, steer.text);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status ?? 409);
  try {
    const sql = await getSql();
    await persistSession(sql, result.session);
  } catch {
    /* ignore */
  }
  return json({ ok: true, session: publicSession(result.session) });
}

export async function handleBuildSessionCancel(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (siteBlocked(request)) return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;

  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const idField = sanitizeSessionId(read.body.id ?? read.body.sessionId);
  if (!idField.ok) return json({ ok: false, error: idField.error }, 400);

  let session = memoryGet(idField.id);
  if (!session || session.ownerId !== auth.userId) {
    try {
      const sql = await getSql();
      session = (await loadSession(sql, auth.userId, idField.id)) ?? undefined;
    } catch {
      session = undefined;
    }
  }
  if (!session || session.ownerId !== auth.userId) {
    return json({ ok: false, error: "That build session was not found." }, 404);
  }

  const limited = consumeMindRateLimit("build-cancel", auth.userId, 20);
  if (!limited.ok) return jsonRateLimited(AGENT_RATE_LIMIT_REPLY, limited.retryAfterSec);

  const result = cancelBuildSession(idField.id, auth.userId);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status ?? 409);
  try {
    const sql = await getSql();
    await persistSession(sql, result.session);
  } catch {
    /* ignore */
  }
  return json({ ok: true, session: publicSession(result.session) });
}

export async function handleBuildSessionStream(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const idField = sanitizeSessionId(url.searchParams.get("id"));
  if (!idField.ok) return json({ ok: false, error: idField.error }, 400);
  const afterSeq = Number(url.searchParams.get("afterSeq") ?? "-1");
  const resumeFrom = Number.isFinite(afterSeq) ? afterSeq : -1;

  let session = memoryGet(idField.id);
  if (!session || session.ownerId !== auth.userId) {
    try {
      const sql = await getSql();
      session = (await loadSession(sql, auth.userId, idField.id)) ?? undefined;
    } catch {
      session = undefined;
    }
  }
  if (!session || session.ownerId !== auth.userId) {
    return json({ ok: false, error: "That build session was not found." }, 404);
  }

  const encoder = new TextEncoder();
  let closed = false;
  let unsub: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        unsub?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const snap = memoryGet(idField.id) ?? session!;
      send("snapshot", { session: publicSession(snap) });
      for (const evt of snap.timeline) {
        if (evt.seq > resumeFrom) send("event", evt);
      }
      if (BUILD_TERMINAL.has(snap.status)) {
        send("done", { session: publicSession(snap) });
        finish();
        return;
      }

      unsub = subscribeSession(idField.id, (next, fromSeq) => {
        if (next.ownerId !== auth.userId) return;
        for (const evt of next.timeline) {
          if (evt.seq > fromSeq && evt.seq > resumeFrom) send("event", evt);
        }
        send("status", {
          status: next.status,
          elapsedMs: next.elapsedMs,
          lastSeq: next.lastSeq,
          resolved: next.resolved ?? null,
        });
        if (BUILD_TERMINAL.has(next.status)) {
          send("done", { session: publicSession(next) });
          finish();
        }
      });

      request.signal.addEventListener(
        "abort",
        () => {
          send("disconnected", { error: "Stream disconnected. Reconnect with afterSeq to resume." });
          finish();
        },
        { once: true },
      );
    },
    cancel() {
      closed = true;
      unsub?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
