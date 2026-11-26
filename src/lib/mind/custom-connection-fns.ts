import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

const STOPPED = "Emergency stop is on. Nothing was called.";

export const listCustomConnectionsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { databaseConfigured } = await import("./mcp/registry-store");
    const { getSql } = await import("@/lib/db");
    const db = databaseConfigured() ? await getSql() : null;
    const { listCustomConnections } = await import("./custom-connection");
    return { ok: true as const, connections: await listCustomConnections(db, context.userId) };
  });

export const saveCustomConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { label?: string; kind?: string; url?: string; method?: string; auth?: string; token?: string; fields?: string[] }) => ({
    label: typeof input.label === "string" ? input.label.slice(0, 80) : "",
    kind: input.kind === "http" ? "http" as const : "mcp" as const,
    url: typeof input.url === "string" ? input.url.slice(0, 300) : "",
    method: input.method === "POST" ? "POST" as const : "GET" as const,
    auth: input.auth === "bearer" ? "bearer" as const : "none" as const,
    token: typeof input.token === "string" ? input.token.slice(0, 500) : "",
    fields: Array.isArray(input.fields) ? input.fields.filter((field) => typeof field === "string").slice(0, 12) : [],
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) return { ok: false as const, error: "Emergency stop is on. Nothing was saved." };
    const { databaseConfigured } = await import("./mcp/registry-store");
    const { getSql } = await import("@/lib/db");
    const db = databaseConfigured() ? await getSql() : null;
    const { saveCustomConnection } = await import("./custom-connection");
    return saveCustomConnection(db, context.userId, data);
  });

export const callCustomConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; operation?: string; args?: Record<string, unknown>; confirmed?: boolean; expectedRevision?: string }) => ({
    id: typeof input.id === "string" ? input.id.slice(0, 80) : "",
    operation: typeof input.operation === "string" ? input.operation.slice(0, 80) : "",
    args: input.args && typeof input.args === "object" && !Array.isArray(input.args) ? input.args : {},
    confirmed: input.confirmed === true,
    expectedRevision: typeof input.expectedRevision === "string" ? input.expectedRevision.slice(0, 80) : undefined,
  }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) {
      return { ok: false as const, status: "error" as const, text: STOPPED, connection: null, transport: null, rpc: null };
    }
    const { databaseConfigured } = await import("./mcp/registry-store");
    const { getSql } = await import("@/lib/db");
    const db = databaseConfigured() ? await getSql() : null;
    const { callCustomConnection } = await import("./custom-connection");
    return callCustomConnection({ db, userId: context.userId, ...data });
  });

/** Refresh discovery without executing a tool. Existing approvals are invalidated by revision. */
export const refreshCustomConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: typeof input.id === "string" ? input.id.slice(0, 80) : "" }))
  .handler(async ({ data, context }) => {
    const { haltIsOn } = await import("./halt.server");
    if (await haltIsOn(context.userId)) return { ok: false as const, error: STOPPED };
    const { databaseConfigured } = await import("./mcp/registry-store");
    const { getSql } = await import("@/lib/db");
    const db = databaseConfigured() ? await getSql() : null;
    const { refreshMcp } = await import("./custom-connection");
    return { ok: true as const, connection: await refreshMcp(db, context.userId, data.id, {}) };
  });
