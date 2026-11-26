/**
 * Astra/Sol/Luna readiness comes from the worker's publicStatus (provider.status).
 * The send calls team/provider_router.py with model.generate fields.
 * Neither adapter module is modified.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProviderReceipt, type ProviderReceipt } from "./provider-receipt.ts";
import { reportedModel } from "./stream.ts";
import {
  adapterCliArgs,
  LOGIC_ROUTE_ENV,
  LOGIC_ROUTE_LABEL,
  logicRoutesUnavailable,
  modelGenerateArgs,
  readinessFromProviderStatus,
  type AdapterMessage,
  type LogicRouteId,
  type LogicRouteInspection,
  type ModelGenerateArgs,
  type ProviderStatusSnapshot,
} from "./logic-routes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ADAPTER = join(ROOT, "team", "provider_router.py");
const WORKER = join(ROOT, "workers", "adrians-mind-mcp-tools", "src", "index.js");

const SECRET_ENV = ["ASTRA_API_KEY", "SOL_API_KEY", "LUNA_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY"] as const;

type SpawnFn = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    if (signal?.aborted) { resolve({ code: null, stdout: "", stderr: "Canceled before dispatch.", timedOut: false }); return; }
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    const abort = () => { child.kill("SIGTERM"); };
    signal?.addEventListener("abort", abort, { once: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 200_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 20_000) stderr += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code: null, stdout, stderr, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function childEnv(base: NodeJS.ProcessEnv, route: LogicRouteId, endpoint: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") env[key] = value;
  }
  if (!env.PATH && process.env.PATH) env.PATH = process.env.PATH;
  const baseEnv = LOGIC_ROUTE_ENV[route].base;
  // The worker publishes the endpoint it would call. The Python CLI only reads env.
  if (endpoint && !env[baseEnv] && !env.OPENAI_API_BASE_URL) env[baseEnv] = endpoint;
  return env;
}

function leakedSecret(text: string, env: NodeJS.ProcessEnv): boolean {
  for (const name of SECRET_ENV) {
    const value = env[name];
    if (typeof value === "string" && value.length >= 8 && text.includes(value)) return true;
  }
  return false;
}

const STATUS_LOADER = `
import { pathToFileURL } from "node:url";
const worker = await import(pathToFileURL(process.env.LOGIC_ROUTE_WORKER).href);
const status = worker.publicStatus(process.env);
const providers = Array.isArray(status.providers) ? status.providers.map((row) => ({
  id: row.id,
  configured: Boolean(row.configured),
  model: typeof row.model === "string" ? row.model : null,
  endpoint: typeof row.endpoint === "string" ? row.endpoint : null,
  credential: typeof row.credential === "string" ? row.credential : "unset",
})) : [];
process.stdout.write(JSON.stringify({
  live_verified: status.live_verified === true,
  app_budget: status.app_budget && typeof status.app_budget === "object"
    ? { paused: status.app_budget.paused === true, accounting: typeof status.app_budget.accounting === "string" ? status.app_budget.accounting : "" }
    : { paused: false, accounting: "" },
  providers,
}));
`;

export async function loadProviderStatus(
  env: NodeJS.ProcessEnv = process.env,
  spawnImpl: SpawnFn = spawnProcess,
): Promise<ProviderStatusSnapshot> {
  const safeEnv = childEnv(env, "astra", null);
  safeEnv.LOGIC_ROUTE_WORKER = WORKER;
  const result = await spawnImpl("node", ["--input-type=module", "-e", STATUS_LOADER], safeEnv, 8_000);
  if (result.timedOut || result.code !== 0 || leakedSecret(result.stdout, safeEnv)) {
    throw new Error("provider.status could not be read");
  }
  return JSON.parse(result.stdout) as ProviderStatusSnapshot;
}

export async function inspectLogicRoutes(env: NodeJS.ProcessEnv = process.env): Promise<LogicRouteInspection[]> {
  try {
    return readinessFromProviderStatus(await loadProviderStatus(env));
  } catch {
    return logicRoutesUnavailable("Route readiness could not be read from provider.status. Nothing was sent.");
  }
}

export type AdapterInvokeResult =
  | ({ ok: true; provider: LogicRouteId; model: string; content: string; dispatched?: boolean } & Partial<ProviderReceipt>)
  | ({ ok: false; error: string; dispatched?: boolean; provider?: string; model?: string; requestedModel?: string } & Partial<ProviderReceipt>);

function adapterReceipt(spec: ModelGenerateArgs, stdout: string, stderr = "") {
  for (const raw of [stdout, stderr]) {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      return { ...normalizeProviderReceipt(spec.provider, data), dispatched: data.dispatched !== false,
        provider: typeof data.provider === "string" ? data.provider.slice(0, 150) : spec.provider,
        model: reportedModel(data.model), requestedModel: typeof data.requested_model === "string" ? data.requested_model.slice(0, 200) : spec.model };
    } catch { /* The adapter's safe receipt may be on stderr for a failed call. */ }
  }
  return { ...normalizeProviderReceipt(spec.provider, null), dispatched: true, provider: spec.provider, model: "model unknown", requestedModel: spec.model };
}

function adapterError(stdout: string, stderr: string): string {
  for (const raw of [stderr.trim(), stdout.trim()]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim() && !parsed.error.includes("\n")) {
        return parsed.error.trim().slice(0, 400);
      }
    } catch {
      /* not the adapter's JSON error */
    }
  }
  return "The model route returned an unreadable reply. Nothing was saved as a success.";
}

export async function invokeProviderRouter(input: {
  spec: ModelGenerateArgs;
  endpoint?: string | null;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnFn;
  signal?: AbortSignal;
}): Promise<AdapterInvokeResult> {
  const safeEnv = childEnv(input.env ?? process.env, input.spec.provider, input.endpoint ?? null);
  const args = [ADAPTER, ...adapterCliArgs(input.spec)];
  let result: { code: number | null; stdout: string; stderr: string; timedOut: boolean };
  try {
    result = await (input.spawnImpl ?? spawnProcess)("python3", args, safeEnv, (input.spec.timeout_seconds + 5) * 1000, input.signal);
  } catch {
    return { ok: false, error: "The model route could not be started. Nothing was sent." };
  }
  if (leakedSecret(result.stdout, safeEnv) || leakedSecret(result.stderr, safeEnv)) {
    return { ok: false, error: "The model route returned an unsafe response. Nothing was saved as a success." };
  }
  if (input.signal?.aborted) return { ok: false, error: "The model route was canceled. Provider outcome may be unknown." };
  if (result.timedOut) return { ok: false, error: "The model route timed out. Nothing was saved as a success." };
  if (result.code !== 0) return { ok: false, error: adapterError(result.stdout, result.stderr) };
  try {
    const parsed = JSON.parse(result.stdout) as { provider?: unknown; model?: unknown; content?: unknown; route?: { selected?: unknown } };
    if (parsed.provider !== input.spec.provider) {
      const ran = typeof parsed.provider === "string" ? parsed.provider : "a different route";
      return {
        ok: false,
        error: `Requested ${LOGIC_ROUTE_LABEL[input.spec.provider]} but the adapter ran ${ran}. Nothing was saved as a success.`,
      };
    }
    if (typeof parsed.model !== "string" || !parsed.model.trim() || typeof parsed.content !== "string" || !parsed.content.trim()) {
      return { ok: false, error: "The model route returned an empty or unnamed reply. Nothing was saved as a success." };
    }
    return { ok: true, provider: input.spec.provider, model: parsed.model.trim(), content: parsed.content.trim() };
  } catch {
    return { ok: false, error: "The model route returned an unreadable reply. Nothing was saved as a success." };
  }
}

export async function runLogicRoute(input: {
  route: LogicRouteId;
  messages: AdapterMessage[];
  env?: NodeJS.ProcessEnv;
  invoke?: typeof invokeProviderRouter;
  signal?: AbortSignal;
  inspect?: typeof inspectLogicRoutes;
}): Promise<
  | {
      ok: true;
      provider: LogicRouteId;
      model: string;
      requestedModel: string | null;
      endpoint: string;
      content: string;
      called: true;
      credentialFallback: "OPENAI_API_KEY" | null;
    }
  | { ok: false; error: string; called: boolean; missing: string[] }
> {
  const env = input.env ?? process.env;
  const inspected = await (input.inspect ?? inspectLogicRoutes)(env);
  const view = inspected.find((item) => item.id === input.route);
  if (!view || !view.ready || !view.model || !view.endpoint) {
    return {
      ok: false,
      called: false,
      missing: view?.missing ?? [],
      error: view?.reason ?? `${LOGIC_ROUTE_LABEL[input.route]} is not ready. Nothing was sent.`,
    };
  }
  const spec = modelGenerateArgs(input.route, input.messages, view.model);
  const invoked = await (input.invoke ?? invokeProviderRouter)({ spec, endpoint: view.endpoint, env, signal: input.signal });
  if (!invoked.ok) return { ok: false, called: true, missing: [], error: invoked.error };
  return {
    ok: true,
    called: true,
    provider: invoked.provider,
    model: invoked.model,
    requestedModel: view.model,
    endpoint: view.endpoint,
    content: invoked.content,
    credentialFallback: view.credentialFallback,
  };
}
