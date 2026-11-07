/**
 * Optional failure seam. Other owners register a handler; command-app keeps
 * its current banner when nobody is registered. This file does not import an
 * MCP error envelope.
 */

export const FAILURE_SURFACES = ["mcp", "notion", "research", "serviceBoard", "supabase", "persona", "modelRoute"] as const;
export type FailureSurface = (typeof FAILURE_SURFACES)[number];

/** Outcome stays the caller's object. localCorrelationId is a local UUID, not a server id. */
export type MountedFailure<T> = {
  outcome: T;
  retry: () => void;
  localCorrelationId: string;
};

type FailureHandler = (payload: MountedFailure<unknown>) => void;

const handlers = new Map<FailureSurface, FailureHandler>();

export function isFailureSurface(value: string): value is FailureSurface {
  return (FAILURE_SURFACES as readonly string[]).includes(value);
}

export function localCorrelationId(): string {
  return crypto.randomUUID();
}

export function mountFailure<T>(outcome: T, retry: () => void, id = localCorrelationId()): MountedFailure<T> {
  return { outcome, retry, localCorrelationId: id };
}

/** Returns an unregister function. A later register on the same surface replaces the previous handler. */
export function registerFailureHandler(surface: FailureSurface, handler: FailureHandler): () => void {
  handlers.set(surface, handler);
  return () => {
    if (handlers.get(surface) === handler) handlers.delete(surface);
  };
}

/** True when a handler ran. False leaves the caller on its existing UI. */
export function emitFailure<T>(surface: FailureSurface, payload: MountedFailure<T>): boolean {
  const handler = handlers.get(surface);
  if (!handler) return false;
  handler(payload as MountedFailure<unknown>);
  return true;
}

export function surfaceForReport(action: string, target: string): FailureSurface | null {
  const blob = `${action} ${target}`.toLowerCase();
  if (blob.includes("mcp")) return "mcp";
  if (blob.includes("notion")) return "notion";
  if (blob.includes("research") || target === "search") return "research";
  if (blob.includes("supabase") || blob.includes("database") || target === "server-copy") return "supabase";
  if (blob.includes("persona")) return "persona";
  if (blob.includes("service")) return "serviceBoard";
  if (
    blob.includes("model") ||
    blob.includes("provider") ||
    blob.includes("chat_failed") ||
    target === "provider" ||
    action === "chat_failed"
  ) {
    return "modelRoute";
  }
  return null;
}
