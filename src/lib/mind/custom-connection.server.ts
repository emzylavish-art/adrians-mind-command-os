import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const listCustomConnectionsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { listCustomConnections } = await import("./custom-connection");
    return { ok: true as const, connections: await listCustomConnections(await getSql(), context.userId) };
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
    const { getSql } = await import("@/lib/db");
    const { saveCustomConnection } = await import("./custom-connection");
    return saveCustomConnection(await getSql(), context.userId, data);
  });

export const callCustomConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string; operation?: string; args?: Record<string, unknown>; confirmed?: boolean }) => ({
    id: typeof input.id === "string" ? input.id.slice(0, 80) : "",
    operation: typeof input.operation === "string" ? input.operation.slice(0, 80) : "",
    args: input.args && typeof input.args === "object" && !Array.isArray(input.args) ? input.args : {},
    confirmed: input.confirmed === true,
  }))
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const { callCustomConnection } = await import("./custom-connection");
    return callCustomConnection({ db: await getSql(), userId: context.userId, ...data });
  });
