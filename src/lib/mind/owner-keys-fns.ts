import { createServerFn } from "@tanstack/react-start";
import { isolationMiddleware } from "@/lib/auth/middleware";

export const listOwnerKeySlotsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listOwnerKeySlots } = await import("./owner-keys.server");
  return { slots: listOwnerKeySlots() };
});

export const copyOwnerKeyFn = createServerFn({ method: "POST" })
  .middleware([isolationMiddleware])
  .validator((input: { id?: string }) => ({
    id: typeof input?.id === "string" ? input.id : "",
  }))
  .handler(async ({ data }) => {
    const { copyOwnerKey } = await import("./owner-keys.server");
    const result = await copyOwnerKey(data.id);
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, value: result.value };
  });
