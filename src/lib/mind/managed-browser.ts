export const MANAGED_VIEWPORT = { width: 1024, height: 640 };
export type BrowserMode = "managed" | "takeover" | "stopped";
export type ManagedAction =
  | { kind: "start"; origin: string }
  | { kind: "status" | "capture" | "takeover" | "handback" | "stop" }
  | { kind: "click"; x: number; y: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: "Enter" | "Tab" | "Backspace" | "Escape" };
export type BrowserReply = { mode: BrowserMode; frame?: string };
export type ManagedBrowserSession = { id: string; origin: string; mode: BrowserMode | "unconfirmed"; operation: string; updatedAt: string };
export type ManagedBrowserReceipt = { id: string; action: string; outcome: string; at: string };

export function managedBrowserOrigin(value: unknown) {
  if (typeof value !== "string" || value.length > 250) return null;
  try {
    const url = new URL(value);
    const name = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
      || !name.includes(".") || /^(?:[0-9.]+|localhost)$/i.test(name) || name.endsWith(".localhost") || name.endsWith(".local")) return null;
    return url.origin;
  } catch { return null; }
}

export function approvedBrowserOrigins(value: string | undefined) {
  return [...new Set((value ?? "").split(",").flatMap(entry => {
    const origin = managedBrowserOrigin(entry.trim());
    return origin ? [origin] : [];
  }))].slice(0, 20);
}

export function managedBrowserId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function managedBrowserAction(value: unknown): ManagedAction | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  switch (data.kind) {
    case "start": {
      const origin = managedBrowserOrigin(data.origin);
      return origin ? { kind: "start", origin } : null;
    }
    case "status": case "capture": case "takeover": case "handback": case "stop":
      return { kind: data.kind };
    case "click": {
      const { x, y } = data;
      return typeof x === "number" && Number.isInteger(x) && x >= 0 && x < MANAGED_VIEWPORT.width
        && typeof y === "number" && Number.isInteger(y) && y >= 0 && y < MANAGED_VIEWPORT.height ? { kind: "click", x, y } : null;
    }
    case "text":
      return typeof data.text === "string" && data.text.length > 0 && data.text.length <= 300 && !/[\u0000-\u001f]/.test(data.text) ? { kind: "text", text: data.text } : null;
    case "key":
      return data.key === "Enter" || data.key === "Tab" || data.key === "Backspace" || data.key === "Escape" ? { kind: "key", key: data.key } : null;
    default: return null;
  }
}
