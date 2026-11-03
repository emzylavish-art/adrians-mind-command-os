import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { guardMindEnv } from "./isolation";
import { allowMindRequest } from "./limits";
import { describePersistence } from "./persistence";
import { modelTierCatalog } from "./model-tiers";
import { configuredProviders } from "./provider-call";
import { performSearch } from "./research";
import { interpretWorkerHealth } from "./worker-health";
import { resolveXaiInferenceApiKey } from "./xai-adapter";
import { resolveDatabaseUrl } from "../env.server.ts";

const MODEL = "grok-4.5";

function envCheck() {
  return guardMindEnv({
    databaseUrl: resolveDatabaseUrl(process.env),
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
  const described = describePersistence(resolveDatabaseUrl(process.env));
  const persistence = described.note;
  const databaseBackend = described.backend;
  if (!gate.ok) {
    return {
      ok: false as const,
      grok: "down" as const,
      model: MODEL,
      modelTiers: modelTierCatalog(process.env),
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
    grok: resolveXaiInferenceApiKey(process.env).ok ? ("configured" as const) : ("unconfigured" as const),
    model: MODEL,
    modelTiers: modelTierCatalog(process.env),
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
    // Only a server-issued id is honored. tool/ok/detail from the client are ignored.
    id: typeof input.id === "string" ? input.id.slice(0, 80) : "",
    tool: typeof input.tool === "string" ? input.tool.slice(0, 80) : "",
    action: input.action === "voice" ? "voice" : "chat",
    ok: input.ok === true,
    detail: typeof input.detail === "string" ? input.detail.slice(0, 500) : "",
  }))
  .handler(async ({ data, context }) => {
    const { recordIssuedExecution } = await import("./execution-ledger");
    const { writeToolRun } = await import("./notion-record");
    const { getSql } = await import("../db");
    const sql = await getSql();
    const result = await recordIssuedExecution({
      userId: context.userId,
      id: data.id,
      clientOk: data.ok,
      clientDetail: data.detail,
      write: async (run) => {
        await writeToolRun(sql, context.userId, run);
      },
    });
    return result;
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
    modelTier?: string;
    images?: { dataUrl: string; name?: string }[];
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
  .validator((input: { text: string; voiceId?: string }) => input)
  .handler(async ({ data, context }) => {
    const { validateSpeakTextInput } = await import("./voice/voice-input");
    const parsed = validateSpeakTextInput((data as { text?: unknown } | null)?.text);
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) return { ok: false as const, error: "Emergency stop is on. Nothing was read aloud." };
    if (!allowMindRequest("speak", context.userId, 8)) return { ok: false as const, error: "Too many voice requests. Wait a minute." };
    const text = parsed.text;
    const { resolveVoiceApiKey } = await import("./voice/keys");
    const { resolveXaiVoiceId } = await import("./voice/voices");
    const apiKey = resolveVoiceApiKey(process.env);
    if (!apiKey) return { ok: false as const, error: "The chat key is not used for speech. No speech key is configured. Nothing was played." };
    const voice_id = resolveXaiVoiceId(data.voiceId);
    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/tts", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ text, voice_id, language: "en", output_format: { codec: "mp3" } }),
      });
    } catch {
      return { ok: false as const, error: "Voice did not answer in time. Nothing was played." };
    }
    if (!res.ok) return { ok: false as const, error: `Voice returned ${res.status}. Nothing was played.` };
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > 2_000_000) return { ok: false as const, error: "Voice returned audio that could not be played." };
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
    // Dev-only e2e flag: force honest "provider not configured" without touching real keys.
    if (process.env.VOICE_E2E_FORCE_UNCONFIGURED === "1" && process.env.NODE_ENV !== "production") {
      const { providerUnconfiguredMessage } = await import("./voice/provider-unconfigured");
      return { ok: false as const, error: providerUnconfiguredMessage() };
    }
    const { mintRealtimeClientSecret } = await import("./voice/client-secret");
    return mintRealtimeClientSecret({});
  });

/** Whisper Flow STT: proxy recorded audio to xAI /v1/stt (or OpenAI Whisper when configured). Keys stay server-side. */
export const transcribeDictation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { audioBase64: string; mime?: string; filename?: string }) => input)
  .handler(async ({ data, context }) => {
    const { validateTranscribeAudioInput, decodeAudioBase64 } = await import("./voice/voice-input");
    const parsed = validateTranscribeAudioInput(data);
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    const decoded = decodeAudioBase64(parsed.audioBase64);
    if (!decoded.ok) return { ok: false as const, error: decoded.error };
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, error: "Emergency stop is on. Nothing was transcribed." };
    }
    if (!allowMindRequest("stt", context.userId, 20)) {
      return { ok: false as const, error: "Too many speech-to-text requests. Wait a minute." };
    }
    // Dev-only e2e: force honest unconfigured / failure without calling providers.
    if (process.env.VOICE_E2E_FORCE_UNCONFIGURED === "1" && process.env.NODE_ENV !== "production") {
      return {
        ok: false as const,
        error:
          "No speech-to-text key is configured on the server. Whisper Flow cannot transcribe. Nothing was invented.",
      };
    }
    if (process.env.WHISPER_FLOW_E2E_FORCE_FAIL === "1" && process.env.NODE_ENV !== "production") {
      return {
        ok: false as const,
        error: "Speech-to-text did not answer in time. Nothing was transcribed.",
      };
    }
    const { transcribeWhisperFlowAudio } = await import("./whisper-flow/provider");
    const result = await transcribeWhisperFlowAudio({
      bytes: new Uint8Array(decoded.bytes),
      mime: parsed.mime,
      filename: parsed.filename,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, text: result.text, provider: result.provider ?? "xai" };
  });

/** Optional non-blocking LLM polish for Whisper Flow. Client must insert local refine first; this never blocks. */
export const refineDictationOptional = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { text: string; enabled?: boolean }) => input)
  .handler(async ({ data, context }) => {
    if (data.enabled === false) {
      return { ok: false as const, skipped: true as const, error: "Optional LLM refinement is turned off." };
    }
    const text = typeof data.text === "string" ? data.text.trim().slice(0, 2000) : "";
    if (!text) return { ok: false as const, skipped: true as const, error: "Nothing to refine." };
    if (!allowMindRequest("stt_refine", context.userId, 10)) {
      return { ok: false as const, skipped: true as const, error: "Too many refine requests. Local text was kept." };
    }
    const key = resolveXaiInferenceApiKey(process.env);
    if (!key.ok) {
      return {
        ok: false as const,
        skipped: true as const,
        error: "No chat model key is configured for optional refinement. Local refinement was kept.",
      };
    }
    // Honest stub: we do not call the model from this lane unless a dedicated polish path is required.
    // Returning skipped keeps insertion non-blocking and avoids inventing polished text.
    return {
      ok: false as const,
      skipped: true as const,
      error: "Optional LLM refinement is not wired to a polish call yet. Local refinement was kept. Nothing was invented.",
    };
  });


/**
 * MCP server list for Tools. Soft-auth: always calls getSessionUser (Supabase
 * HttpOnly cookies first, then Better Auth) via resolveMcpListUserId — same
 * session helper as authMiddleware/requireUserId — but returns typed
 * `unauthenticated` instead of throwing so Tools stays quiet when signed out.
 */
export const mcpRegistryList = createServerFn({ method: "GET" })
  .middleware([
    createMiddleware({ type: "function" })
      .client(async ({ next }) => {
        const { getBearerToken } = await import("../auth/client");
        return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
      })
      .server(async ({ next, context }) => {
        const { getRequest } = await import("@tanstack/react-start/server");
        const { CrossSiteRequestError } = await import("../auth/isolation.server");
        const { softAuthMcpListDecision } = await import("./mcp-list-auth");
        const request = getRequest();
        let forceUnauthenticated = false;
        if (request) {
          const h = request.headers;
          const decision = softAuthMcpListDecision({
            site: h.get("sec-fetch-site"),
            mode: h.get("sec-fetch-mode"),
            dest: h.get("sec-fetch-dest"),
            method: request.method,
            origin: h.get("origin"),
            host: h.get("host"),
            forwardedHost: h.get("x-forwarded-host"),
          });
          if (decision === "block") throw new CrossSiteRequestError();
          if (decision === "soft_unauth") forceUnauthenticated = true;
        }
        return next({
          context: {
            bearerToken: forceUnauthenticated ? undefined : (context.bearerToken as string | undefined),
            forceUnauthenticated,
          },
        });
      }),
  ])
  .handler(async ({ context }) => {
    const { buildMcpRegistryListPayload } = await import("./mcp-list-auth");
    if ((context as { forceUnauthenticated?: boolean }).forceUnauthenticated) {
      // Same-site / missing Origin: quiet 200 unauthenticated (do not ride cookies).
      return buildMcpRegistryListPayload(null, []);
    }
    const { DEV_USER_ID, authConfigured, getSessionUser } = await import("../auth/verify.server");
    const { gateIdentityEnabled } = await import("../auth/gate-identity.server");
    const { resolveMcpListUserId } = await import("./mcp-list-auth");
    // Always reuse getSessionUser (Supabase cookies first, then Better Auth) so a
    // signed-in Supabase user is never short-circuited when Better Auth is off.
    const sessionUser = await getSessionUser(context.bearerToken);
    const userId = resolveMcpListUserId({
      sessionUser,
      authConfigured,
      gateIdentityEnabled: gateIdentityEnabled(),
      databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
      devUserId: DEV_USER_ID,
    });
    if (!userId) {
      return buildMcpRegistryListPayload(null, []);
    }
    const { listRegistryServers } = await import("./mcp/registry");
    return buildMcpRegistryListPayload(userId, listRegistryServers(userId));
  });

export const mcpRegistryToggle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; enabled?: boolean }) => ({
    id: typeof input.id === "string" ? input.id.slice(0, 80) : "",
    enabled: input.enabled === true,
  }))
  .handler(async ({ data, context }) => {
    const { setServerEnabled } = await import("./mcp/registry");
    return { servers: setServerEnabled(context.userId, data.id, data.enabled) };
  });

export const mcpRegistryTools = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listRegistryTools } = await import("./mcp/registry");
    return { tools: await listRegistryTools(context.userId) };
  });

export const mcpRegistryCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { serverId?: string; tool?: string; args?: Record<string, unknown> }) => ({
    serverId: typeof input.serverId === "string" ? input.serverId.slice(0, 80) : "",
    tool: typeof input.tool === "string" ? input.tool.slice(0, 80) : "",
    args: input.args && typeof input.args === "object" ? input.args : {},
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false, status: "error" as const, serverId: data.serverId, tool: data.tool, text: "Emergency stop is on. No MCP tool was called." };
    }
    const { callRegistryTool } = await import("./mcp/registry");
    const { getSql } = await import("../db");
    const result = await callRegistryTool({
      userId: context.userId,
      serverId: data.serverId,
      tool: data.tool,
      args: data.args,
      getSql,
    });
    return {
      ok: result.ok,
      status: result.status,
      serverId: result.serverId,
      tool: result.tool,
      text: result.text,
    };
  });


/**
 * Real per-connector verification for Tools.
 * Soft-auth like mcpRegistryList: getSessionUser + same-site origin check.
 * Signed-out → typed unauthenticated (no probes, no red banner).
 * Never trusts a stored status badge.
 */
export const mcpConnectorVerify = createServerFn({ method: "POST" })
  .middleware([
    createMiddleware({ type: "function" })
      .client(async ({ next }) => {
        const { getBearerToken } = await import("../auth/client");
        return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
      })
      .server(async ({ next, context }) => {
        const { assertSameSiteRequest } = await import("../auth/isolation.server");
        assertSameSiteRequest();
        return next({ context: { bearerToken: context.bearerToken as string | undefined } });
      }),
  ])
  .validator((input: { target?: "all" | "mcp" | "oauth"; id?: string } = {}) => {
    const target = input?.target === "mcp" || input?.target === "oauth" || input?.target === "all" ? input.target : "all";
    const id = typeof input?.id === "string" ? input.id.trim().slice(0, 80) : "";
    return { target, id };
  })
  .handler(async ({ data, context }) => {
    const { DEV_USER_ID, authConfigured, getSessionUser } = await import("../auth/verify.server");
    const { gateIdentityEnabled } = await import("../auth/gate-identity.server");
    const { resolveMcpListUserId } = await import("./mcp-list-auth");
    const sessionUser = await getSessionUser(context.bearerToken);
    const userId = resolveMcpListUserId({
      sessionUser,
      authConfigured,
      gateIdentityEnabled: gateIdentityEnabled(),
      databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
      devUserId: DEV_USER_ID,
    });
    const {
      buildConnectorVerifyPayload,
      verifyConnectors,
      VERIFY_TIMEOUT_MS,
      VERIFY_MAX_BYTES,
    } = await import("./mcp/connector-verify");
    if (!userId) {
      return buildConnectorVerifyPayload(null, []);
    }
    const { getSql } = await import("../db");
    let verifyTarget: { type: "all" } | { type: "mcp"; id: string } | { type: "oauth"; id: import("./connectors/store").ConnectorId };
    if (data.target === "all" || !data.id) {
      verifyTarget = { type: "all" };
    } else if (data.target === "oauth") {
      const { isConnectorId } = await import("./connectors/store");
      if (!isConnectorId(data.id)) {
        return buildConnectorVerifyPayload(userId, [{
          id: data.id,
          kind: "oauth",
          label: data.id,
          state: "error",
          detail: "Unknown OAuth connector.",
        }]);
      }
      verifyTarget = { type: "oauth", id: data.id };
    } else {
      verifyTarget = { type: "mcp", id: data.id };
    }
    const results = await verifyConnectors(userId, verifyTarget, {
      getSql,
      timeoutMs: VERIFY_TIMEOUT_MS,
      maxBytes: VERIFY_MAX_BYTES,
    });
    return buildConnectorVerifyPayload(userId, results);
  });

export const listMindMemories = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, error: "Emergency stop is on. Memories were not listed.", memories: [] as const };
    }
    const { getSql } = await import("../db");
    const { listOwnerMemories } = await import("./memory/owner-ops");
    const listed = await listOwnerMemories(await getSql(), context.userId, { includeArchived: false });
    return { ok: true as const, memories: listed.memories };
  });

export const createMindMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { scope?: string; text?: string; projectId?: string | null; chatId?: string | null; source?: string }) => {
    const scope = input.scope === "project" || input.scope === "chat" ? input.scope : ("global" as const);
    return {
      scope: scope as "global" | "project" | "chat",
      text: typeof input.text === "string" ? input.text : "",
      projectId: typeof input.projectId === "string" ? input.projectId : null,
      chatId: typeof input.chatId === "string" ? input.chatId : null,
      source: typeof input.source === "string" ? input.source.slice(0, 160) : "owner",
    };
  })
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, error: "Emergency stop is on. Nothing was saved.", memorySaved: false as const, savedMemoryId: null };
    }
    if (!allowMindRequest("memory_write", context.userId, 30)) {
      return { ok: false as const, error: "Too many memory writes. Wait a minute.", memorySaved: false as const, savedMemoryId: null };
    }
    const { getSql } = await import("../db");
    const { createOwnerMemory } = await import("./memory/owner-ops");
    const { memorySignalFromSave } = await import("./memory/signal");
    const saved = await createOwnerMemory(await getSql(), context.userId, data);
    if (!saved.ok) return { ok: false as const, error: saved.error, ...memorySignalFromSave(saved) };
    return { ok: true as const, item: saved.item, ...memorySignalFromSave({ ok: true, id: saved.item.id }) };
  });

export const editMindMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; text?: string }) => ({
    id: typeof input.id === "string" ? input.id.slice(0, 120) : "",
    text: typeof input.text === "string" ? input.text : "",
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, error: "Emergency stop is on. Nothing was edited." };
    }
    if (!allowMindRequest("memory_write", context.userId, 30)) {
      return { ok: false as const, error: "Too many memory writes. Wait a minute." };
    }
    const { getSql } = await import("../db");
    const { editOwnerMemory } = await import("./memory/owner-ops");
    return editOwnerMemory(await getSql(), context.userId, data.id, data.text);
  });

export const deleteMindMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({
    id: typeof input.id === "string" ? input.id.slice(0, 120) : "",
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, error: "Emergency stop is on. Nothing was deleted." };
    }
    if (!allowMindRequest("memory_write", context.userId, 30)) {
      return { ok: false as const, error: "Too many memory writes. Wait a minute." };
    }
    const { getSql } = await import("../db");
    const { deleteOwnerMemory } = await import("./memory/owner-ops");
    return deleteOwnerMemory(await getSql(), context.userId, data.id);
  });
