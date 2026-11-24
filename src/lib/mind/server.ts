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
  const { inspectLogicRoutes } = await import("./logic-route-adapter.server.ts");
  const { toPublicLogicRoute } = await import("./logic-routes.ts");
  const logicRoutes = (await inspectLogicRoutes(process.env)).map(toPublicLogicRoute);
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
      logicRoutes,
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
    logicRoutes,
    checkedAt,
  };
});

/** Authenticated read-only bridge to a real Paperclip instance.
 * An explicitly configured owner ID is required before any fleet data is
 * retrieved; installing Paperclip CLI alone never activates this endpoint.
 */
export const paperclipStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getPaperclipSnapshot, paperclipOwnerAllowed } = await import("./paperclip-bridge.server");
    const empty = (state: "not_configured" | "unavailable", message: string) => ({
      state, message, agents: [], runs: [], checkedAt: new Date().toISOString(),
    });
    if (!paperclipOwnerAllowed(context.userId, process.env)) {
      return empty("not_configured", "No Paperclip instance is authorised for this account.");
    }
    if (!allowMindRequest("paperclip_read", context.userId, 8)) {
      return empty("unavailable", "Too many Paperclip status checks. Wait one minute.");
    }
    return getPaperclipSnapshot();
  });

/** One authenticated pass over the owner's saved server workspace. Does not replace the browser copy. */
export const runDurableCorePass = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!allowMindRequest("core_pass", context.userId, 6)) {
      return { ok: false as const, error: "Too many runtime steps. Wait a minute. Nothing ran." };
    }
    const { runDurableCorePassForUser } = await import("./core-runtime.server");
    return runDurableCorePassForUser(context.userId);
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
    const endpoint = process.env.MIND_SEARCH_ENDPOINT?.trim();
    const key = process.env.MIND_SEARCH_KEY?.trim();
    if (endpoint && key) {
      return performSearch({
        query: data.query,
        endpoint,
        key,
      });
    }
    const { searchWithGrok } = await import("./xai-search");
    return searchWithGrok(data.query);
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
    try {
      const { listConnectedMcp } = await import("./connected-mcp.server");
      const { databaseConfigured } = await import("./mcp/registry-store");
      const db = databaseConfigured() ? await (await import("../db")).getSql() : null;
      return { servers: await listConnectedMcp(db, context.userId) };
    } catch {
      return { servers: [] };
    }
  });

export const mcpSave = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { label?: string; url?: string; token?: string }) => ({
    label: typeof input.label === "string" ? input.label.slice(0, 80) : "",
    url: typeof input.url === "string" ? input.url.slice(0, 300) : "",
    token: typeof input.token === "string" ? input.token.slice(0, 500) : "",
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) return { ok: false as const, error: "Emergency stop is on. Nothing was saved." };
    const { saveConnectedMcp } = await import("./connected-mcp.server");
    const { databaseConfigured } = await import("./mcp/registry-store");
    const db = databaseConfigured() ? await (await import("../db")).getSql() : null;
    return saveConnectedMcp(db, context.userId, data, { isHalted: haltIsOn });
  });

export const mcpRemove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: typeof input.id === "string" ? input.id.slice(0, 80) : "" }))
  .handler(async ({ data, context }) => {
    const { removeConnectedMcp } = await import("./connected-mcp.server");
    const { databaseConfigured } = await import("./mcp/registry-store");
    const db = databaseConfigured() ? await (await import("../db")).getSql() : null;
    return { ok: true as const, servers: await removeConnectedMcp(db, context.userId, data.id) };
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
    const { runConnectedMcpTurn } = await import("./connected-mcp.server");
    const { databaseConfigured } = await import("./mcp/registry-store");
    const db = databaseConfigured() ? await (await import("../db")).getSql() : null;
    return runConnectedMcpTurn({ db, userId: context.userId, text: data.text, confirmed: data.confirmed, isHalted: haltIsOn });
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
  .validator((input: { workspace: unknown; ownerId?: string }) => input)
  .handler(async ({ data, context }) => {
    if (data.ownerId !== undefined && data.ownerId !== context.userId) return { ok: false as const, error: "The signed-in account changed. The workspace was not saved." };
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
  .validator((input?: { ownerId?: string }) => input)
  .handler(async ({ data, context }) => {
    if (data?.ownerId !== undefined && data.ownerId !== context.userId) return { ok: false as const, error: "The signed-in account changed. The workspace was not loaded." };
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
    const { speakWithFallback } = await import("./voice/provider-fallback");
    const spoken = await speakWithFallback({
      text,
      voiceId: data.voiceId,
      xaiKey: resolveVoiceApiKey(process.env),
      // Speak honours the chosen xAI voice (Eve by default). A different
      // provider/voice is never substituted without explicit consent.
      openaiKey: undefined,
    });
    if (!spoken.ok) return { ok: false as const, error: spoken.error, provider: null };
    return { ok: true as const, audio: spoken.audio, mime: spoken.mime, provider: spoken.provider };
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

/** Whisper Flow STT. The key stays on the server. Browser speech is not this path. */
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
    const { transcribeWhisperFlowAudio } = await import("./whisper-flow/provider");
    const result = await transcribeWhisperFlowAudio({
      bytes: new Uint8Array(decoded.bytes),
      mime: parsed.mime,
      filename: parsed.filename,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, text: result.text, provider: result.provider ?? "xai" };
  });

/** Optional polish after the local text is already inserted. It does not replace that text by itself. */
export const refineDictationOptional = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { text: string; enabled?: boolean }) => input)
  .handler(async ({ data, context }) => {
    if (data.enabled === false) {
      return { ok: false as const, skipped: true as const, error: "Optional LLM refinement is turned off. Local refinement was kept." };
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
    const { polishDictationWithXai } = await import("./whisper-flow/llm-refine");
    const polished = await polishDictationWithXai({ text, apiKey: key.key });
    if (!polished.ok) {
      return { ok: false as const, skipped: true as const, error: polished.error };
    }
    return { ok: true as const, text: polished.text, skipped: false as const };
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
        const { assertSameSiteRequest } = await import("../auth/isolation.server");
        assertSameSiteRequest();
        return next({ context: { bearerToken: context.bearerToken as string | undefined } });
      }),
  ])
  .handler(async ({ context }) => {
    const { DEV_USER_ID, authConfigured, getSessionUser, isLoopbackPreview } = await import("../auth/verify.server");
    const { gateIdentityEnabled } = await import("../auth/gate-identity.server");
    const { resolveMcpListUserId, buildMcpRegistryListPayload } = await import("./mcp-list-auth");
    // Always reuse getSessionUser (Supabase cookies first, then Better Auth) so a
    // signed-in Supabase user is never short-circuited when Better Auth is off.
    const sessionUser = await getSessionUser(context.bearerToken);
    const userId = resolveMcpListUserId({
      sessionUser,
      authConfigured,
      gateIdentityEnabled: gateIdentityEnabled(),
      databaseConfigured: Boolean(resolveDatabaseUrl(process.env)),
      devUserId: DEV_USER_ID,
      loopbackPreview: !context.bearerToken && isLoopbackPreview(),
    });
    if (!userId) {
      return buildMcpRegistryListPayload(null, []);
    }
    try {
      const { listRegistryServers, databaseConfigured } = await import("./mcp/registry");
      const db = databaseConfigured() ? await (await import("../db")).getSql() : null;
      const servers = await listRegistryServers(userId, db);
      const payload = buildMcpRegistryListPayload(userId, servers);
      if (payload.status === "ok" && !db) return { ...payload, persistence: "missing_config" as const };
      return payload;
    } catch {
      return buildMcpRegistryListPayload(userId, []);
    }
  });

export const mcpRegistryToggle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; enabled?: boolean }) => ({
    id: typeof input.id === "string" ? input.id.slice(0, 80) : "",
    enabled: input.enabled === true,
  }))
  .handler(async ({ data, context }) => {
    const { setServerEnabled, databaseConfigured } = await import("./mcp/registry");
    const db = databaseConfigured() ? await (await import("../db")).getSql() : null;
    return { servers: await setServerEnabled(context.userId, data.id, data.enabled, db) };
  });

export const mcpRegistryTools = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listRegistryTools, databaseConfigured } = await import("./mcp/registry");
    const db = databaseConfigured() ? await (await import("../db")).getSql() : null;
    return { tools: await listRegistryTools(context.userId, undefined, { registryDb: db }) };
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
    const { callRegistryTool, databaseConfigured } = await import("./mcp/registry");
    const { getSql } = await import("../db");
    const registryDb = databaseConfigured() ? await getSql() : null;
    const result = await callRegistryTool({
      userId: context.userId,
      serverId: data.serverId,
      tool: data.tool,
      args: data.args,
      getSql,
      registryDb,
    });
    return {
      ok: result.ok,
      status: result.status,
      serverId: result.serverId,
      tool: result.tool,
      text: result.text,
      ...(result.code ? { code: result.code } : {}),
      ...(result.transport !== undefined ? { transport: result.transport } : {}),
      ...(result.rpc !== undefined ? { rpc: result.rpc } : {}),
    };
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
