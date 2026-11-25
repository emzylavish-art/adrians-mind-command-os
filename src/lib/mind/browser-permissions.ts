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
