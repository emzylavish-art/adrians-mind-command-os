export function parseHaltControlRequest(value: unknown): { on: boolean; expectedRevision?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { on?: unknown }).on !== "boolean") throw new Error("Emergency stop requires an explicit boolean. Existing state was preserved.");
  const input = value as { on: boolean; expectedRevision?: unknown };
  if (!input.on && (typeof input.expectedRevision !== "string" || !input.expectedRevision || input.expectedRevision.length > 80)) throw new Error("Read the current emergency stop state before explicitly resuming.");
  return { on: input.on, ...(typeof input.expectedRevision === "string" ? { expectedRevision: input.expectedRevision } : {}) };
}
