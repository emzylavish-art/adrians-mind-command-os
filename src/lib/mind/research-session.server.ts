/**
 * HTTP handlers for ResearchSession: plan / start / stream / cancel.
 * Auth + ownership + validation + rate limits (after body validation).
 */
import { requireUserId } from "../auth/verify.server";
import { AGENT_RATE_LIMIT_REPLY, consumeMindRateLimit, jsonRateLimited } from "./limits.ts";
import { readJsonObjectBody } from "./request-body.ts";
import { decideFetchSite } from "./request-guard.ts";
import { haltIsOn } from "./halt.server.ts";
import { planDeepQueries } from "./research.ts";
import {
  publicResearchSession,
  RESEARCH_TERMINAL,
  sanitizeResearchId,
  sanitizeResearchPlan,
  sanitizeResearchQuery,
  sanitizeResearchUploads,
} from "./research-session.ts";
import { runResearchSession } from "./research-session-exec.ts";
import {
  activeResearchCount,
  cancelResearchInMemory,
  memoryGetResearch,
  startResearchInMemory,
  subscribeResearch,
} from "./research-session-store.ts";

const MAX_BODY = 200_000;

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

/** Preview editable deep plan — no provider spend. */
export async function handleResearchPlan(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (siteBlocked(request)) return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;
  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const q = sanitizeResearchQuery(read.body.query);
  if (!q.ok) return json({ ok: false, error: q.error }, 400);
  const plan = planDeepQueries(q.query);
  return json({ ok: true, query: q.query, plan, mode: "deep" as const });
}

export async function handleResearchStart(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (siteBlocked(request)) return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;

  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const q = sanitizeResearchQuery(read.body.query);
  if (!q.ok) return json({ ok: false, error: q.error }, 400);
  const deep = read.body.deep === true || read.body.mode === "deep";
  const plan = sanitizeResearchPlan(read.body.plan);
  const uploads = sanitizeResearchUploads(read.body.researchUploads ?? read.body.uploads);

  if (await haltIsOn(auth.userId)) {
    return json({ ok: false, error: "Emergency stop is on. No new action can run." });
  }

  const limited = consumeMindRateLimit("research-start", auth.userId, 6);
  if (!limited.ok) return jsonRateLimited(AGENT_RATE_LIMIT_REPLY, limited.retryAfterSec);

  if (activeResearchCount(auth.userId) >= 2) {
    return json({ ok: false, error: "Too many active research sessions. Cancel one first." }, 409);
  }

  const session = startResearchInMemory({
    ownerId: auth.userId,
    query: q.query,
    mode: deep ? "deep" : "search",
    plan,
  });

  void runResearchSession(session.id, { uploads }).catch(() => undefined);

  return json({ ok: true, session: publicResearchSession(memoryGetResearch(session.id) ?? session) }, 201);
}

export async function handleResearchCancel(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (siteBlocked(request)) return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;
  const read = await readJsonObjectBody(request, MAX_BODY);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const idField = sanitizeResearchId(read.body.id ?? read.body.sessionId);
  if (!idField.ok) return json({ ok: false, error: idField.error }, 400);

  const limited = consumeMindRateLimit("research-cancel", auth.userId, 20);
  if (!limited.ok) return jsonRateLimited(AGENT_RATE_LIMIT_REPLY, limited.retryAfterSec);

  const result = cancelResearchInMemory(idField.id, auth.userId);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status ?? 409);
  return json({ ok: true, session: publicResearchSession(result.session) });
}

export async function handleResearchStream(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
  const auth = await authedUser(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const idField = sanitizeResearchId(url.searchParams.get("id"));
  if (!idField.ok) return json({ ok: false, error: idField.error }, 400);
  const afterSeq = Number(url.searchParams.get("afterSeq") ?? "-1");
  const resumeFrom = Number.isFinite(afterSeq) ? afterSeq : -1;

  const session = memoryGetResearch(idField.id);
  if (!session || session.ownerId !== auth.userId) {
    return json({ ok: false, error: "That research session was not found." }, 404);
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

      const snap = memoryGetResearch(idField.id) ?? session;
      send("snapshot", { session: publicResearchSession(snap) });
      for (const evt of snap.timeline) {
        if (evt.seq > resumeFrom) send("event", evt);
      }
      if (RESEARCH_TERMINAL.has(snap.status)) {
        send("done", { session: publicResearchSession(snap) });
        finish();
        return;
      }

      unsub = subscribeResearch(idField.id, (next, fromSeq) => {
        if (next.ownerId !== auth.userId) return;
        for (const evt of next.timeline) {
          if (evt.seq > fromSeq && evt.seq > resumeFrom) send("event", evt);
        }
        send("status", {
          status: next.status,
          lastSeq: next.lastSeq,
          steps: next.steps,
          partial: next.partial ?? false,
          cancelled: next.cancelled ?? false,
        });
        if (RESEARCH_TERMINAL.has(next.status)) {
          send("done", { session: publicResearchSession(next) });
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
