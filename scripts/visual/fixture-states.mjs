/** Synthetic browser states. All API/RPC traffic is fulfilled or refused; no live writes/provider calls. */
const at = "2026-01-01T00:00:00.000Z";
const blank = () => ({ version: 1, halted: false, chats: [], memories: [], projects: [], files: [], usage: [], audit: [], agents: [], deployments: [], runs: [], runEvents: [], connections: [], mailboxes: [], schedules: [], pins: [], browserSessions: [] });
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "X-Mind-Workspace": "hosted", "cache-control": "no-store" } });
const accountRuntime = { id: "hosted", label: "Account files", kind: "account", files: true, coding: false, shell: false, git: false, checkpoints: false, debugger: false, detail: "Fixture runtime unavailable. Account file editing remains available." };
const buildFiles = {
  "fixture.ts": 'import { dependency } from "./dependency";\nexport function fixture() { return dependency; }\n',
  "dependency.ts": "export const dependency = 1;\n",
};
export const VISUAL_FIXTURES = {
  "plugins-connected": { path: "/?section=connected", destination: "Plugins", expectedText: "Fixture workspace connected; operations remain unverified.", notion: { state: "connected", workspaceName: "Synthetic workspace", detail: "Fixture workspace connected; operations remain unverified." } },
  "plugins-permission-denied": { path: "/?section=connected", destination: "Plugins", expectedText: "Fixture: Insert content permission denied. Reads remain available.", notion: { state: "connected", workspaceName: "Synthetic workspace", detail: "Fixture: Insert content permission denied. Reads remain available." } },
  "build-runtime-unavailable": { path: "/?section=build", destination: "Build", expectedText: accountRuntime.detail, action: async (page) => {
    await page.getByRole("navigation", { name: "Build sections" }).getByRole("button", { name: "Task", exact: true }).click();
  } },
  "build-revision-conflict": { path: "/?section=build", destination: "Build", expectedText: "Fixture revision conflict: the newer account copy was preserved.", action: async (page) => {
    const sections = page.getByRole("navigation", { name: "Build sections" });
    await sections.getByRole("button", { name: "Task", exact: true }).click();
    await page.getByText("Workspace and advanced controls", { exact: true }).click();
    await page.getByRole("button", { name: "Browse", exact: true }).click();
    await sections.getByRole("button", { name: "Editor", exact: true }).click();
    await page.getByRole("complementary", { name: "File tree", exact: true }).getByRole("button", { name: "fixture.ts", exact: true }).click();
    await page.locator('.cm-content[contenteditable="true"]').fill("reviewed fixture edit");
    await page.getByRole("button", { name: "Save reviewed file", exact: true }).click();
  } },
  "settings-save-failed": { path: "/?section=settings&pane=data", destination: "Settings", expectedText: "Fixture persistence failure: previous account policy preserved.", action: async (page) => {
    await page.getByRole("button", { name: "Save account limits", exact: true }).click();
  } },
  "chat-interrupted": { path: "/?section=chat&chat=fixture-chat", destination: "Chat fixture", expectedText: "Synthetic interrupted reply; completion is unverified.", workspace: () => ({ ...blank(), chats: [{ id: "fixture-chat", title: "Synthetic interrupted conversation", memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [], messages: [{ id: "fixture-message", role: "assistant", content: "Synthetic interrupted reply; completion is unverified.", at, delivery: "stopped", provider: "fixture", model: "not-a-live-model" }] }] }) },
  "agent-blocked": { path: "/?section=runs", destination: "Runs", expectedText: "Synthetic blocked task", workspace: () => {
    const agent = { id: "fixture-agent", name: "Synthetic agent", description: "Fixture only", role: "fixture", instructions: "Never invoke services", version: 1, tools: [], projectId: null, memory: "off", maxSteps: 1, approval: "ask", archived: false, createdAt: at, updatedAt: at };
    return { ...blank(), agents: [agent], runs: [{ id: "fixture-run", agentId: agent.id, parentId: null, depth: 0, goal: "Synthetic blocked task", state: "waiting_approval", step: 0, maxSteps: 1, workerId: null, leaseUntil: null, approvedActions: [], plan: [], result: "", error: "Fixture approval required", createdAt: at, updatedAt: at }] };
  } },
};
export function fixtureResponse(name, method, pathname, body = {}) {
  const fixture = VISUAL_FIXTURES[name];
  if (!fixture) throw new Error("Unknown visual fixture.");
  if (method === "GET" && pathname === "/api/auth/get-session") return json({ user: { id: "fixture-owner", name: "Synthetic fixture owner", email: "fixture@example.invalid", emailVerified: false }, session: { id: "fixture-session", userId: "fixture-owner", expiresAt: "2099-01-01T00:00:00.000Z" } });
  if (method === "GET" && pathname.startsWith("/_serverFn/")) {
    let exported = "";
    try { exported = JSON.parse(Buffer.from(pathname.split("/").at(-1), "base64url").toString("utf8")).export || ""; } catch { /* Unknown RPC stays refused. */ }
    const rpc = (result) => json({ result, context: {} });
    if (/^listNotionWorkspaces(?:_|$)/.test(exported)) return rpc(fixture.notion ? [{ id: "fixture-workspace", name: "Synthetic workspace", active: true, issues: [] }] : []);
    if (/^(?:mcpList|mcpRegistryList)(?:_|$)/.test(exported)) return rpc({ servers: [] });
    if (/^mindStatus(?:_|$)/.test(exported)) return rpc({ ok: true, grok: "configured", model: "synthetic-fixture-model", modelTiers: [], database: "Synthetic local fixture", isolation: "clear", executionHalted: false, executionHaltState: "off", signedIn: true, persistence: "Synthetic browser state only", databaseBackend: "pglite", providerModels: {}, searchProvider: "Unavailable", providers: { grok: true }, logicRoutes: [], checkedAt: at });
    if (/^notionStatus(?:_|$)/.test(exported)) return rpc(fixture.notion || { state: "disconnected", detail: "Synthetic unconnected fixture." });
    if (/^readExecutionControl(?:_|$)/.test(exported)) return rpc({ halted: false, state: "off" });
  }
  if (method === "GET" && pathname === "/api/mind/mcp/servers") return json({ servers: [] });
  if (method === "GET" && /\/api\/mind\/oauth\/[^/]+\/status$/.test(pathname)) return json(pathname.includes("/notion/") && fixture.notion ? fixture.notion : { state: "disconnected", detail: "Synthetic unconnected fixture." });
  if (method === "GET" && pathname === "/api/mind/build/capabilities") return json({ ok: true, capabilities: [], runtimes: [accountRuntime] });
  if (method === "GET" && pathname === "/api/mind/pc/status") return json({ ok: true, agents: [], onlineAgentIds: [], detail: "Synthetic offline devices." });
  if (method === "GET" && pathname === "/api/mind/providers") return json({ ok: true, providers: [] });
  if (pathname === "/api/mind/resources") {
    if (method === "GET") return json({ ok: true, revision: 1, policy: { freeOnly: true, maxCallsPerDay: 10, maxConcurrent: 1, maxTokensPerDay: 10000, maxDailyUsdMicros: 0, maxCallUsdMicros: 0, allowUnknownCost: false, prices: {} }, operations: [] });
    return json({ ok: false, error: "Fixture persistence failure: previous account policy preserved." }, 503);
  }
  if (method === "POST" && pathname === "/api/mind/build/files") {
    if (body.operation === "list") return json({ ok: true, files: Object.entries(buildFiles).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content) })), total: Object.keys(buildFiles).length });
    if (body.operation === "read" && Object.hasOwn(buildFiles, body.path)) return json({ ok: true, path: body.path, content: buildFiles[body.path], revision: "a".repeat(64) });
    if (body.operation === "write") return json({ ok: false, code: "revision_conflict", error: "Fixture revision conflict: the newer account copy was preserved." }, 409);
  }
  return json({ ok: false, error: "This service is unavailable in the deterministic fixture. No live call was made." }, 503);
}
export function fixtureRequestDecision(baseUrl, requestedUrl, method) {
  const origin = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) throw new Error("Fixture states require an isolated local preview.");
  const url = new URL(requestedUrl);
  if (url.origin !== origin.origin) return "block";
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn/")) return "fixture";
  if (!["GET", "HEAD"].includes(method)) return "block";
  return "asset-or-document";
}
export async function installVisualFixture(context, baseUrl, name, options = {}) {
  const fixture = VISUAL_FIXTURES[name];
  if (!fixture) throw new Error("Unknown visual fixture.");
  fixtureRequestDecision(baseUrl, baseUrl, "GET");
  if (typeof context.routeWebSocket !== "function") throw new Error("This Playwright version cannot isolate WebSockets; fixture navigation was not started.");
  const counts = { fulfilled: 0, blocked: 0, liveApiRequests: 0 };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const choice = fixtureRequestDecision(baseUrl, request.url(), request.method());
    if (choice === "block") { counts.blocked++; return route.abort("blockedbyclient"); }
    if (choice === "fixture") {
      counts.fulfilled++;
      let body = {}; try { body = request.postDataJSON() || {}; } catch { /* Unknown RPC format stays refused. */ }
      return route.fulfill(fixtureResponse(name, request.method(), new URL(request.url()).pathname, body));
    }
    return route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => { counts.blocked++; socket.close(); });
  await context.addInitScript(({ workspace, fixtureId }) => {
    window.localStorage.clear(); window.sessionStorage.clear();
    window.localStorage.setItem("amcos.workspace.v1", JSON.stringify(workspace));
    window.localStorage.setItem("amcos.workspace.v1.u.fixture-owner", JSON.stringify(workspace));
    const markFixture = () => { if (document.documentElement) document.documentElement.dataset.visualFixture = fixtureId; };
    markFixture(); document.addEventListener("DOMContentLoaded", markFixture, { once: true });
  }, { workspace: options.workspace || (fixture.workspace ? fixture.workspace() : blank()), fixtureId: name });
  return { summary: () => ({ ...counts, mode: "intercepted synthetic responses", physicalDevice: false }) };
}
