import { requireUserId } from "../auth/verify.server";
import { guardMindEnv } from "./isolation";
import { allowMindRequest, checkTurnSize } from "./limits";
import { assembleTurn } from "./prompt";
import { assertLiveProvider } from "./providers";
import { relayModelStream } from "./relay";
import { decideFetchSite } from "./request-guard";
import { readModelPayload } from "./stream";

export const MIND_MODEL = "grok-4.5";
const MAX_BODY = 200_000;

type HistoryItem = { role: "user" | "assistant"; content: string };
type NoteItem = { id: string; text: string };

export type TurnBody = {
  text?: unknown;
  memory?: unknown;
  halted?: unknown;
  history?: unknown;
  memoryContext?: unknown;
  provider?: unknown;
};

function isHistory(item: unknown): item is HistoryItem {
  if (!item || typeof item !== "object") return false;
  const record = item as { role?: unknown; content?: unknown };
  return (record.role === "user" || record.role === "assistant") && typeof record.content === "string";
}

function isNote(item: unknown): item is NoteItem {
  if (!item || typeof item !== "object") return false;
  const record = item as { id?: unknown; text?: unknown };
  return typeof record.id === "string" && typeof record.text === "string";
}

function envCheck() {
  return guardMindEnv({
    databaseUrl: process.env.DATABASE_URL,
    mindUrl: process.env.MIND_SUPABASE_URL,
    mindRef: process.env.MIND_SUPABASE_PROJECT_REF,
  });
}

export async function prepareMindTurn(userId: string, data: TurnBody) {
  const { haltIsOn } = await import("./halt.server");
  if ((await haltIsOn(userId)) || data.halted === true) {
    return { ok: false as const, error: "Emergency stop is on. No new action can run." };
  }
  if (!allowMindRequest("chat", userId, 12)) {
    return { ok: false as const, error: "Too many messages. Wait a minute and try again." };
  }
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) return { ok: false as const, error: "Write a message first." };
  const history = Array.isArray(data.history) ? data.history.filter(isHistory).slice(-12) : [];
  const memoryContext = Array.isArray(data.memoryContext) ? data.memoryContext.filter(isNote).slice(0, 12) : [];
  const sized = checkTurnSize({ text, history, memoryContext });
  if (!sized.ok) return sized;
  const memory: "off" | "on" | null = data.memory === "on" ? "on" : data.memory === "off" ? "off" : null;
  if (!memory) return { ok: false as const, error: "Memory setting is invalid." };
  const routed = assertLiveProvider(data.provider);
  if (!routed.ok) return routed;
  const gate = envCheck();
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const assembled = assembleTurn({
    memory,
    history,
    text,
    memoryContext,
  });
  if (!assembled.ok) return { ok: false as const, error: assembled.error };
  return { ok: true as const, assembled, memory, model: routed.model };
}

function modelBody(model: string, messages: { role: string; content: string }[]) {
  return {
    model,
    messages,
    max_tokens: 500,
    temperature: 0.4,
    stream: true,
    stream_options: { include_usage: true },
  };
}

export async function completeModelReply(prepared: { assembled: { messages: { role: "system" | "user" | "assistant"; content: string }[]; usedIds: string[] }; memory: "off" | "on"; model: "grok-4.5" }) {
  if (prepared.model !== MIND_MODEL) return { ok: false as const, error: "That model is not available. Another provider is not substituted." };
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false as const, error: "Grok is not configured on the server." };
  let res: Response;
  try {
    res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(modelBody(prepared.model, prepared.assembled.messages)),
    });
  } catch {
    return { ok: false as const, error: "Grok did not answer in time. Nothing was saved as a success." };
  }
  if (!res.ok) return { ok: false as const, error: `Grok returned ${res.status}. Nothing was saved as a success.` };
  const parsed = readModelPayload(await res.text());
  if (!parsed.text) return { ok: false as const, error: "Grok returned an empty reply." };
  return {
    ok: true as const,
    text: parsed.text,
    model: prepared.model,
    requestId: res.headers.get("x-request-id"),
    usage: parsed.usage,
    memory: prepared.memory,
    usedIds: prepared.assembled.usedIds,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function readLimited(request: Request): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    received += step.value.byteLength;
    if (received > MAX_BODY) return { ok: false, error: "That request is too large." };
    chunks.push(step.value);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

export async function handleMindTurn(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (
    decideFetchSite({
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
      method: request.method,
    }) === "block"
  ) {
    return json({ ok: false, error: "Forbidden: cross-site request blocked" }, 403);
  }
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  let userId: string;
  try {
    userId = await requireUserId(bearer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
  const limited = await readLimited(request);
  if (!limited.ok) return json({ ok: false, error: limited.error }, 413);
  let body: TurnBody;
  try {
    body = JSON.parse(limited.text) as TurnBody;
  } catch {
    return json({ ok: false, error: "That request could not be read." }, 400);
  }
  const prepared = await prepareMindTurn(userId, body);
  if (!prepared.ok) return json(prepared);
  if (prepared.model !== MIND_MODEL) return json({ ok: false, error: "That model is not available. Another provider is not substituted." });
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return json({ ok: false, error: "Grok is not configured on the server." });
  return relayModelStream({
    apiKey,
    model: prepared.model,
    messages: prepared.assembled.messages,
    usedIds: prepared.assembled.usedIds,
    requestSignal: request.signal,
  });
}
