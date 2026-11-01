import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { guardMindEnv } from "./isolation";
import { allowMindRequest } from "./limits";
import { describePersistence } from "./persistence";
import { configuredProviders } from "./provider-call";
import { performSearch } from "./research";
import { interpretWorkerHealth } from "./worker-health";

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
      providers: configuredProviders(process.env),
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
    providers: configuredProviders(process.env),
    checkedAt,
  };
});

export const workerHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { readFileSync } = await import("node:fs");
  let file = null;
  try {
    file = JSON.parse(readFileSync(".data/worker-status.json", "utf8")) as { running?: boolean; heartbeatAt?: string };
  } catch {
    file = null;
  }
  return interpretWorkerHealth(file, Date.now(), 90_000);
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

export const recordAgentExecution = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; tool?: string; action?: string; ok?: boolean; detail?: string }) => ({
    id: typeof input.id === "string" ? input.id.slice(0, 80) : "",
    tool: typeof input.tool === "string" ? input.tool.slice(0, 80) : "",
    action: input.action === "voice" ? "voice" : "chat",
    ok: input.ok === true,
    detail: typeof input.detail === "string" ? input.detail.slice(0, 500) : "",
  }))
  .handler(async ({ data, context }) => {
    if (!data.id || !data.tool) return { ok: false as const, error: "The execution was not recorded." };
    const { writeToolRun } = await import("./notion-record");
    const { getSql } = await import("../db");
    await writeToolRun(await getSql(), context.userId, data);
    return { ok: true as const };
  });

export const notionStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { notionConnection, readNotionPref } = await import("./notion");
    const pref = readNotionPref(context.userId);
    return notionConnection(process.env.NOTION_TOKEN, pref.disabled);
  });

export const notionDisconnect = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { notionConnection, writeNotionPref } = await import("./notion");
    writeNotionPref(context.userId, true);
    return notionConnection(process.env.NOTION_TOKEN, true);
  });

export const notionCommand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { text?: string; confirmed?: boolean; pageId?: string | null }) => ({
    text: typeof input.text === "string" ? input.text.slice(0, 2000) : "",
    confirmed: input.confirmed === true,
    pageId: typeof input.pageId === "string" ? input.pageId.slice(0, 80) : null,
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return {
        ok: false as const,
        state: "connected" as const,
        action: "none",
        needsConfirmation: false,
        ambiguous: false,
        pages: [] as { id: string; title: string; url: string; kind: "page" | "database" }[],
        content: "",
        error: "Emergency stop is on. Notion was not called.",
        wrote: false,
        verified: false,
      };
    }
    if (!allowMindRequest("notion", context.userId, 8)) {
      return {
        ok: false as const,
        state: "connected" as const,
        action: "none",
        needsConfirmation: false,
        ambiguous: false,
        pages: [] as { id: string; title: string; url: string; kind: "page" | "database" }[],
        content: "",
        error: "Too many Notion requests. Wait a minute. Nothing was changed.",
        wrote: false,
        verified: false,
      };
    }
    const { readNotionPref, runNotionTurn } = await import("./notion");
    const pref = readNotionPref(context.userId);
    const result = await runNotionTurn({
      token: process.env.NOTION_TOKEN,
      disabled: pref.disabled,
      text: data.text,
      confirmed: data.confirmed,
      pageId: data.pageId,
      fetch: globalThis.fetch,
    });
    try {
      const { randomUUID } = await import("node:crypto");
      const { writeToolRun } = await import("./notion-record");
      const { getSql } = await import("../db");
      await writeToolRun(await getSql(), context.userId, {
        id: randomUUID(),
        tool: "notion",
        action: result.action,
        ok: result.ok,
        detail: result.error || result.pages.map((page) => page.title).join(", ") || result.content.slice(0, 180) || "no result",
      });
    } catch {
      /* the reply still reports the API result when the record cannot be saved */
    }
    return result;
  });

export const mcpList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listMcp } = await import("./mcp");
    return { servers: listMcp(context.userId) };
  });

export const mcpSave = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { label?: string; url?: string; token?: string }) => ({
    label: typeof input.label === "string" ? input.label.slice(0, 80) : "",
    url: typeof input.url === "string" ? input.url.slice(0, 300) : "",
    token: typeof input.token === "string" ? input.token.slice(0, 500) : "",
  }))
  .handler(async ({ data, context }) => {
    const { saveMcp } = await import("./mcp");
    const saved = saveMcp(context.userId, data);
    if (!saved.ok) return saved;
    const { probeMcp, listMcp } = await import("./mcp");
    await probeMcp(context.userId, saved.server.id, globalThis.fetch);
    return { ok: true as const, servers: listMcp(context.userId) };
  });

export const mcpRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: typeof input.id === "string" ? input.id.slice(0, 80) : "" }))
  .handler(async ({ data, context }) => {
    const { removeMcp } = await import("./mcp");
    return { servers: removeMcp(context.userId, data.id) };
  });

export const mcpCommand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { text?: string; confirmed?: boolean }) => ({
    text: typeof input.text === "string" ? input.text.slice(0, 2000) : "",
    confirmed: input.confirmed === true,
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false, needsConfirmation: false, servers: [], text: "", error: "Emergency stop is on. No MCP server was called." };
    }
    const { runMcpTurn } = await import("./mcp");
    return runMcpTurn({ userId: context.userId, text: data.text, confirmed: data.confirmed, fetch: globalThis.fetch });
  });

export const inspectWebPage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { url: string }) => ({ url: typeof input.url === "string" ? input.url.slice(0, 300) : "" }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, title: "", excerpt: "", error: "Emergency stop is on. No page was opened." };
    }
    if (!allowMindRequest("browser", context.userId, 6)) {
      return { ok: false as const, title: "", excerpt: "", error: "Too many page opens. Wait a minute." };
    }
    if (!/^https?:\/\/\S+$/i.test(data.url) || data.url.includes("@")) {
      return { ok: false as const, title: "", excerpt: "", error: "Only an http(s) page without credentials can be opened. No page was opened." };
    }
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["scripts/mind-browser.mjs", data.url], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20_000,
    });
    try {
      const payload = JSON.parse(result.stdout || "") as { ok?: boolean; title?: string; excerpt?: string; error?: string };
      if (!payload.ok) return { ok: false as const, title: "", excerpt: "", error: payload.error || "The page did not open." };
      return { ok: true as const, title: payload.title ?? "", excerpt: (payload.excerpt ?? "").slice(0, 500), error: "" };
    } catch {
      return { ok: false as const, title: "", excerpt: "", error: "The browser driver did not return a page. No screenshot was invented." };
    }
  });

export const analyzeImageFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name?: string; bytes?: number; imageBase64?: string }) => ({
    name: typeof input.name === "string" ? input.name.slice(0, 120) : "",
    bytes: typeof input.bytes === "number" ? input.bytes : 0,
    imageBase64: typeof input.imageBase64 === "string" ? input.imageBase64.slice(0, 200_000) : "",
  }))
  .handler(async ({ data }) => {
    const { analyzeImage } = await import("./image-analyze");
    return analyzeImage({
      name: data.name,
      bytes: data.bytes,
      imageBase64: data.imageBase64,
      visionKey: process.env.VISION_API_KEY,
      fetch: globalThis.fetch,
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
    const { resolveVoiceApiKey } = await import("./voice/keys");
    const apiKey = resolveVoiceApiKey(process.env);
    if (!apiKey) return { ok: false as const, error: "The chat key is not used for speech. No speech key is configured. Nothing was played." };
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

export const createVoiceClientSecret = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) return { ok: false as const, error: "Emergency stop is on. Voice was not started." };
    if (!allowMindRequest("voice_secret", context.userId, 20)) {
      return { ok: false as const, error: "Too many voice requests. Wait a minute." };
    }
    const { mintRealtimeClientSecret } = await import("./voice/client-secret");
    return mintRealtimeClientSecret({});
  });

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { audioBase64: string; mime?: string; filename?: string }) => input)
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) return { ok: false as const, error: "Emergency stop is on. Nothing was transcribed." };
    if (!allowMindRequest("stt", context.userId, 12)) return { ok: false as const, error: "Too many voice requests. Wait a minute." };
    const { resolveVoiceApiKey } = await import("./voice/keys");
    const apiKey = resolveVoiceApiKey(process.env);
    if (!apiKey) return { ok: false as const, error: "The chat key is not used for speech. No speech key is configured. Nothing was transcribed." };
    const raw = (data.audioBase64 || "").trim();
    if (!raw) return { ok: false as const, error: "No audio was recorded. Nothing was transcribed." };
    let bytes: Buffer;
    try {
      bytes = Buffer.from(raw, "base64");
    } catch {
      return { ok: false as const, error: "Recorded audio could not be read." };
    }
    if (bytes.length < 32 || bytes.length > 4_000_000) {
      return { ok: false as const, error: "Recorded audio was empty or too large. Nothing was transcribed." };
    }
    const { transcribeWavBytes } = await import("./voice/stt");
    return transcribeWavBytes({
      bytes,
      apiKey,
      mime: data.mime || "audio/webm",
      filename: data.filename,
    });
  });
