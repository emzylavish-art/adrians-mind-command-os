import { requireUserId } from "../auth/verify.server";
import { buildAgentModelBody, readAgentMessage, runBoundedAgent, type AgentModel } from "./agent";
import { resolveModelTier } from "./model-tiers";
import { guardMindEnv } from "./isolation";
import { allowMindRequest } from "./limits";
import { decideFetchSite } from "./request-guard";
import { emptyWorkspace } from "./workspace";

const MAX_BODY = 200_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function names(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 200)).filter(Boolean).slice(0, limit);
}

function grokModel(
  apiKey: string,
  parent: AbortSignal,
  options: {
    model: string;
    temperature: number;
    max_tokens: number;
    reasoning_effort?: "low" | "medium" | "high" | "xhigh";
  },
): AgentModel {
  return async ({ messages, signal }) => {
    const linked = typeof AbortSignal.any === "function" ? AbortSignal.any([parent, signal]) : parent;
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: linked,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(
        buildAgentModelBody(messages, {
          model: options.model,
          temperature: options.temperature,
          max_tokens: options.max_tokens,
          reasoning_effort: options.reasoning_effort,
        }),
      ),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return readAgentMessage(await response.json());
  };
}

export async function handleAgentRun(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed.", log: [] }, 405);
  if (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
    }) === "block"
  ) {
    return json({ ok: false, error: "Forbidden: cross-site request blocked", log: [] }, 403);
  }
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  let userId: string;
  try {
    userId = await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message, log: [] }, message === "Unauthorized" ? 401 : 403);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "That request is too large.", log: [] }, 413);
  let body: { goal?: unknown; projects?: unknown; chats?: unknown; notes?: unknown; modelTier?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ ok: false, error: "That request could not be read.", log: [] }, 400);
  }
  const { haltIsOn } = await import("./halt.server");
  if (await haltIsOn(userId)) return json({ ok: false, error: "Emergency stop is on. No new action can run.", log: [] });
  if (!allowMindRequest("agent", userId, 6)) return json({ ok: false, error: "Too many agent runs. Wait a minute and try again.", log: [] });
  const gate = guardMindEnv({
    databaseUrl: process.env.DATABASE_URL,
    mindUrl: process.env.MIND_SUPABASE_URL,
    mindRef: process.env.MIND_SUPABASE_PROJECT_REF,
  });
  if (!gate.ok) return json({ ok: false, error: gate.error, log: [] });
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return json({ ok: false, error: "Grok is not configured on the server.", log: [] });
  const ws = emptyWorkspace();
  const stamp = "2026-01-01T00:00:00.000Z";
  ws.projects = names(body.projects, 20).map((name, index) => ({ id: `p${index}`, name, description: "", createdAt: stamp }));
  ws.chats = names(body.chats, 20).map((title, index) => ({
    id: `c${index}`,
    title,
    memory: "off" as const,
    temporary: false,
    autonomy: "ask" as const,
    projectId: null,
    retrievalLog: [],
    messages: [],
  }));
  ws.memories = names(body.notes, 12).map((text, index) => ({
    id: `n${index}`,
    scope: "global" as const,
    projectId: null,
    chatId: null,
    text,
    source: "owner",
    createdAt: stamp,
    updatedAt: stamp,
    archived: false,
    versions: [],
  }));
  const goal = typeof body.goal === "string" ? body.goal : "";
  const tier = resolveModelTier(body.modelTier, goal, process.env);
  const result = await runBoundedAgent({
    ws,
    goal,
    model: grokModel(apiKey, request.signal, {
      model: tier.model,
      temperature: tier.params.temperature,
      max_tokens: tier.params.max_tokens,
      reasoning_effort: tier.params.reasoning_effort,
    }),
    signal: request.signal,
    autonomy: "ask",
    halted: false,
    approved: true,
  });
  return json({
    ok: result.ok,
    text: result.text,
    log: result.log,
    error: result.error ?? "",
    model: tier.model,
    modelTier: tier.selected,
    resolvedTier: tier.resolved,
    tierReason: tier.reason,
  });
}
