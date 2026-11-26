export function parseHaltControlRequest(value: unknown): { on: boolean; ownerId?: string; expectedRevision?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { on?: unknown }).on !== "boolean") throw new Error("An explicit stop or release boolean is required. Existing state was preserved.");
  const input = value as { on: boolean; ownerId?: unknown; expectedRevision?: unknown };
  if (input.ownerId !== undefined && (typeof input.ownerId !== "string" || !input.ownerId.trim())) throw new Error("An explicit stop or release requires the intended owner.");
  if (!input.on && (typeof input.expectedRevision !== "string" || !input.expectedRevision || input.expectedRevision.length > 80)) throw new Error("Read the current emergency stop state before explicitly resuming.");
  return { on: input.on, ...(typeof input.ownerId === "string" ? { ownerId: input.ownerId } : {}), ...(typeof input.expectedRevision === "string" ? { expectedRevision: input.expectedRevision } : {}) };
}
