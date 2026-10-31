import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { guardMindEnv } from "./isolation";
import { allowMindRequest } from "./limits";
import { describePersistence } from "./persistence";
import { performSearch } from "./research";

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
  let signedIn = false;
  let executionHalted = false;
  try {
    const { requireUserId } = await import("../auth/verify.server");
    const userId = await requireUserId();
    signedIn = true;
    const { haltIsOn } = await import("./halt.server");
    executionHalted = await haltIsOn(userId);
  } catch {
    signedIn = false;
  }
  const described = describePersistence(process.env.DATABASE_URL);
  const persistence = described.note;
  const databaseBackend = described.backend;
  if (!gate.ok) {
    return {
      ok: false as const,
      grok: "down" as const,
      model: MODEL,
      database: gate.error,
      isolation: "failed" as const,
      executionHalted,
      signedIn,
      persistence,
      databaseBackend,
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
    executionHalted,
    signedIn,
    persistence,
    databaseBackend,
    checkedAt,
  };
});

export const searchWeb = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { query: string }) => ({ query: typeof input.query === "string" ? input.query.slice(0, 300) : "" }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, configured: false, citations: [] as { title: string; url: string }[], error: "Emergency stop is on. No new action can run." };
    }
    if (!allowMindRequest("search", context.userId, 6)) {
      return { ok: false as const, configured: false, citations: [] as { title: string; url: string }[], error: "Too many searches. Wait a minute and try again." };
    }
    return performSearch({
      query: data.query,
      endpoint: process.env.MIND_SEARCH_ENDPOINT,
      key: process.env.MIND_SEARCH_KEY,
    });
  });

export const sendTurn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    text: string;
    memory: "off" | "on";
    halted: boolean;
    history: { role: "user" | "assistant"; content: string }[];
    memoryContext: { id: string; text: string }[];
  }) => input)
  .handler(async ({ data, context }) => {
    const { completeModelReply, prepareMindTurn } = await import("./turn.server");
    const prepared = await prepareMindTurn(context.userId, data);
    if (!prepared.ok) return prepared;
    return completeModelReply(prepared);
  });

export const setExecutionHalt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { on: boolean }) => ({ on: input.on === true }))
  .handler(async ({ data, context }) => {
    const { setDurableHalt } = await import("./halt.server");
    return setDurableHalt(context.userId, data.on);
  });

export const saveMindCopy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { workspace: unknown }) => input)
  .handler(async ({ data, context }) => {
    if (!allowMindRequest("save", context.userId, 20)) return { ok: false as const, error: "Too many saves. The browser copy was kept." };
    const { normalizeWorkspace } = await import("./workspace");
    const { snapshotTooLarge, writeSnapshot } = await import("./store");
    const { getSql } = await import("../db");
    const workspace = normalizeWorkspace(data.workspace);
    if (snapshotTooLarge(workspace)) return { ok: false as const, error: "This workspace is too large to copy to the server. The browser copy was kept." };
    try {
      await writeSnapshot(await getSql(), context.userId, workspace);
    } catch {
      return { ok: false as const, error: "The server copy could not be saved. The browser copy was kept." };
    }
    return { ok: true as const, storage: "local-server" as const };
  });

export const loadMindCopy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { readSnapshot } = await import("./store");
    const { getSql } = await import("../db");
    try {
      const payload = await readSnapshot(await getSql(), context.userId);
      const { normalizeWorkspace } = await import("./workspace");
      return { ok: true as const, workspace: payload ? normalizeWorkspace(payload) : null };
    } catch {
      return { ok: false as const, error: "The server copy could not be read. The browser copy was kept." };
    }
  });

export const speakText = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { text: string }) => input)
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) return { ok: false as const, error: "Emergency stop is on. Nothing was read aloud." };
    if (!allowMindRequest("speak", context.userId, 8)) return { ok: false as const, error: "Too many voice requests. Wait a minute." };
    const text = data.text.trim().slice(0, 500);
    if (!text) return { ok: false as const, error: "Nothing to read." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Voice is not configured on the server." };
    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/tts", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ text, voice_id: "eve" }),
      });
    } catch {
      return { ok: false as const, error: "Voice did not answer in time. Nothing was played." };
    }
    if (!res.ok) return { ok: false as const, error: `Voice returned ${res.status}. Nothing was played.` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 32 || bytes.length > 2_000_000) return { ok: false as const, error: "Voice returned audio that could not be played." };
    return { ok: true as const, audio: bytes.toString("base64"), mime: "audio/mpeg" };
  });
