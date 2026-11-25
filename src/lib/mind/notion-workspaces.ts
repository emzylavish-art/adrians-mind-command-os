import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const listNotionWorkspaces = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
  const { savedNotionWorkspaces } = await import("./connectors/notion-oauth");
  return savedNotionWorkspaces(context.userId);
});

export const selectNotionWorkspace = createServerFn({ method: "POST" }).middleware([authMiddleware])
  .validator((value: { id: string }) => {
    if (!value || typeof value.id !== "string" || !value.id || value.id.length > 200) throw new Error("Invalid workspace.");
    return { id: value.id };
  }).handler(async ({ context, data }) => {
    const { hasDurableOAuthStore, selectDurableNotionWorkspace } = await import("./connectors/durable-oauth.server");
    if (hasDurableOAuthStore()) await selectDurableNotionWorkspace(context.userId, data.id);
    else (await import("./connectors/store")).selectLocalNotionWorkspace(context.userId, data.id);
    return { ok: true };
  });
