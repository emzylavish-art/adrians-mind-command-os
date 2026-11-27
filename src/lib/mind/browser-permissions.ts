export const browserPermissions = ["ask", "allow", "block"] as const;
export type BrowserPermission = typeof browserPermissions[number];

export interface BrowserPreferences {
  defaultPermission: BrowserPermission;
  sites: Record<string, BrowserPermission>;
}

export const defaultBrowserPreferences: BrowserPreferences = { defaultPermission: "ask", sites: {} };

export function browserAddress(value: string): URL | null {
  const text = value.trim();
  if (!text || /[\s\\]/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isPermission(value: unknown): value is BrowserPermission {
  return browserPermissions.some((permission) => permission === value);
}

export function parseBrowserPreferences(raw: string | null): BrowserPreferences {
  if (!raw) return defaultBrowserPreferences;
  const data = JSON.parse(raw);
  if (!data || !isPermission(data.defaultPermission) || !data.sites || typeof data.sites !== "object" || Array.isArray(data.sites)) {
    throw new Error("Invalid browser preferences");
  }
  const sites: Record<string, BrowserPermission> = {};
  for (const [origin, permission] of Object.entries(data.sites)) {
    if (browserAddress(origin)?.origin !== origin || !isPermission(permission)) throw new Error("Invalid website permission");
    sites[origin] = permission;
  }
  return { defaultPermission: data.defaultPermission, sites };
}

export function websitePermission(settings: BrowserPreferences, url: URL): BrowserPermission {
  return settings.sites[url.origin] ?? settings.defaultPermission;
}

export function browserPreferencesKey(owner: string): string {
  return `amcos.browser-permissions.v1.${encodeURIComponent(owner)}`;
}

export type BrowserAction = "open" | "inspect" | "download" | "submit";
export type BrowserAuthorization = { allowed: boolean; needsConfirmation: boolean; reason: string };

/** An opening preference never grants an agent permission to inspect or change a signed-in site. */
export function authorizeBrowserAction(settings: BrowserPreferences, target: URL, action: BrowserAction): BrowserAuthorization {
  const permission = websitePermission(settings, target);
  if (permission === "block") return { allowed: false, needsConfirmation: false, reason: `Website access is blocked for ${target.origin}.` };
  if (action !== "open") return { allowed: false, needsConfirmation: false, reason: "This website preference authorizes a personal-browser handoff only. Agent inspection, downloads and submissions require a separately configured runtime and action approval." };
  return { allowed: true, needsConfirmation: permission === "ask", reason: "You control the opened tab; no agent action was authorized." };
}

export const browserEnvironments = [
  { id: "personal", label: "Personal browser", availability: "Manual handoff", location: "Your browser", scope: "Open a website under your control. Website-opening rules apply; no agent session or account permission is shared." },
  { id: "coding", label: "Coding browser", availability: "Runtime dependent", location: "Local coding runtime", scope: "Manage development work in Build. It is a coding interface, not an autonomous website session; its local session is isolated." },
  { id: "cloud", label: "Autonomous browser", availability: "Not configured", location: "No execution runtime", scope: "Website inspection, takeover, downloads and account actions are unavailable until a supported isolated runtime is configured." },
] as const;
