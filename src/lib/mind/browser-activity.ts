import { authorizeBrowserAction, browserAddress, browserPreferencesKey, parseBrowserPreferences } from "./browser-permissions.ts";

export type BrowserActivityRow = {
  id: string;
  kind: "website" | "screenshot";
  title: string;
  origin?: string;
  outcome: "returned" | "cancelled" | "saved";
  image?: string;
  at: number;
};

const MAX_SCREENSHOT_CHARS = 560_000;
const screenshotPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
export function safeBrowserScreenshot(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SCREENSHOT_CHARS && screenshotPattern.test(value);
}

export function activityOwnerPrefix(owner: string) {
  return "amcos.browser-activity.v1." + encodeURIComponent("[" + JSON.stringify(owner) + ",");
}

export function activityStorageKey(owner: string, scope: string) {
  return activityOwnerPrefix(owner) + encodeURIComponent(JSON.stringify(scope) + "]");
}

export function readBrowserActivity(raw: string | null): BrowserActivityRow[] {
  if (!raw) return [];
  const input: unknown = JSON.parse(raw);
  if (!Array.isArray(input)) throw new Error("Invalid browser activity");
  return input.slice(0, 12).flatMap((row): BrowserActivityRow[] => {
    if (!row || typeof row.id !== "string" || !/^[a-z0-9-]{1,100}$/i.test(row.id) ||
        typeof row.title !== "string" || typeof row.at !== "number" || !Number.isFinite(new Date(row.at).valueOf())) return [];
    if (row.kind === "website" && ["returned", "cancelled"].includes(row.outcome)) {
      const origin = typeof row.origin === "string" ? browserAddress(row.origin)?.origin : null;
      if (origin && origin === row.origin) return [{ id: row.id, kind: "website", title: origin, origin, outcome: row.outcome, at: row.at }];
    }
    if (row.kind === "screenshot" && row.outcome === "saved" && safeBrowserScreenshot(row.image)) {
      return [{ id: row.id, kind: "screenshot", title: row.title.slice(0, 150), outcome: "saved", image: row.image, at: row.at }];
    }
    return [];
  });
}

export function websiteOpening(storage: Pick<Storage, "getItem">, owner: string | null, address: string, confirm: boolean) {
  const url = browserAddress(address);
  if (!url || !url.hostname || url.href.length > 4096) return { error: "Enter a valid HTTP or HTTPS address." } as const;
  try {
    const permission = authorizeBrowserAction(parseBrowserPreferences(owner ? storage.getItem(browserPreferencesKey(owner)) : null), url, "open");
    if (!permission.allowed) return { error: permission.reason } as const;
    if (permission.needsConfirmation && !confirm) return { error: "Confirm this website address before opening it." } as const;
    return { url } as const;
  } catch { return { error: "Website permissions could not be verified." } as const; }
}
