import { createServerFn } from "@tanstack/react-start";
import { serverHalted, setServerHalt } from "./execution-gate";
import { guardMindEnv } from "./isolation";
import { assembleTurn } from "./prompt";

const MODEL = "grok-4.5";

function envCheck() {
  return guardMindEnv({
    databaseUrl: process.env.DATABASE_URL,
    mindUrl: process.env.MIND_SUPABASE_URL,
    mindRef: process.env.MIND_SUPABASE_PROJECT_REF,
  });
}

export const mindStatus = createServerFn({ method: "GET" }).handler(async () => {
  const gate = envCheck();
  const checkedAt = new Date().toISOString();
  if (!gate.ok) {
    return {
      ok: false as const,
      grok: "down" as const,
      model: MODEL,
      database: gate.error,
      isolation: "failed" as const,
      executionHalted: serverHalted(),
      checkedAt,
    };
  }
  const mindUrl = process.env.MIND_SUPABASE_URL;
  return {
    ok: true as const,
    grok: process.env.XAI_API_KEY ? ("configured" as const) : ("unconfigured" as const),
    model: MODEL,
    database: mindUrl
      ? "A Mind project URL is set and is not a forbidden project."
      : "No dedicated project yet. The free organization already holds two active projects.",
    isolation: "clear" as const,
    executionHalted: serverHalted(),
    checkedAt,
  };
});

export const sendTurn = createServerFn({ method: "POST" })
  .validator((input: {
    text: string;
    memory: "off" | "on";
    halted: boolean;
    history: { role: "user" | "assistant"; content: string }[];
    memoryContext: { id: string; text: string }[];
  }) => input)
  .handler(async ({ data }) => {
    if (serverHalted() || data.halted) return { ok: false as const, error: "Emergency stop is on. No new action can run." };
    const text = data.text.trim();
    if (!text) return { ok: false as const, error: "Write a message first." };
    if (text.length > 8000) return { ok: false as const, error: "That message is too long." };
    if (data.memory !== "off" && data.memory !== "on") {
      return { ok: false as const, error: "Memory setting is invalid." };
    }
    const gate = envCheck();
    if (!gate.ok) return { ok: false as const, error: gate.error };

    const assembled = assembleTurn({
      memory: data.memory,
      history: Array.isArray(data.history) ? data.history : [],
      text,
      memoryContext: Array.isArray(data.memoryContext) ? data.memoryContext : [],
    });
    if (!assembled.ok) return { ok: false as const, error: assembled.error };

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Grok is not configured on the server." };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: assembled.messages,
        max_tokens: 500,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      return { ok: false as const, error: `Grok returned ${res.status}. Nothing was saved as a success.` };
    }
    const body = (await res.json()) as {
      id?: string;
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const reply = body.choices?.[0]?.message?.content?.trim();
    if (!reply) return { ok: false as const, error: "Grok returned an empty reply." };
    return {
      ok: true as const,
      text: reply,
      model: body.model ?? MODEL,
      requestId: body.id ?? null,
      usage: body.usage ?? null,
      memory: data.memory,
      usedIds: assembled.usedIds,
    };
  });

export const setExecutionHalt = createServerFn({ method: "POST" })
  .validator((input: { on: boolean }) => ({ on: input.on === true }))
  .handler(async ({ data }) => ({ halted: setServerHalt(data.on) }));

export const speakText = createServerFn({ method: "POST" })
  .validator((input: { text: string }) => input)
  .handler(async ({ data }) => {
    if (serverHalted()) return { ok: false as const, error: "Emergency stop is on. Nothing was read aloud." };
    const text = data.text.trim().slice(0, 500);
    if (!text) return { ok: false as const, error: "Nothing to read." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Voice is not configured on the server." };
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ text, voice_id: "eve" }),
    });
    if (!res.ok) return { ok: false as const, error: `Voice returned ${res.status}. Nothing was played.` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 32) return { ok: false as const, error: "Voice returned empty audio." };
    return { ok: true as const, audio: bytes.toString("base64"), mime: "audio/mpeg" };
  });
