export const managedBrowserWidth = 1120;
export const managedBrowserHeight = 720;
export const managedBrowserLifetimeMs = 15 * 60_000;
export const managedBrowserId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type BrowserPhase = "starting" | "managed" | "manual" | "closed" | "uncertain";
export type ManagedBrowserAction = "start" | "recover" | "takeover" | "handback" | "follow" | "scroll" | "stop" | "frame";
export type BrowserInput = { action: ManagedBrowserAction; x?: number; y?: number; delta?: number };
export type ManagedLink = { x: number; y: number; label: string };
export type ManagedFrame = { image: string; path: string; links?: ManagedLink[] };
export type BrowserReceipt = { action: string; phase: BrowserPhase; at: string; outcome?: "attempted" | "confirmed" | "rejected" | "unconfirmed" };
export type ManagedBrowserSession = {
  id: string; origin: string; phase: BrowserPhase; revision: number; pending: string | null;
  expires: string; receipts: BrowserReceipt[];
};

export function managedBrowserUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 800 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

export function managedBrowserOrigins(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").flatMap(value => {
    const url = managedBrowserUrl(value.trim());
    return url?.pathname === "/" ? [url.origin] : [];
  }));
}

export function browserInput(value: Record<string, unknown>): BrowserInput | null {
  switch (value.action) {
    case "start": case "recover": case "takeover": case "handback": case "stop": case "frame":
      return { action: value.action };
    case "follow": {
      const { x, y } = value;
      return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) &&
        x >= 0 && x < managedBrowserWidth && y >= 0 && y < managedBrowserHeight ? { action: "follow", x, y } : null;
    }
    case "scroll": {
      const { delta } = value;
      return typeof delta === "number" && Number.isInteger(delta) && Math.abs(delta) > 0 && Math.abs(delta) <= 800
        ? { action: "scroll", delta } : null;
    }
    default: return null;
  }
}
