export const CLOUD_ORIGIN = "https://adrians-mind.vercel.app";
export const UPDATE_PATH = "/api/mind/desktop-update";
export const INSTALLER_PATH = "/downloads/AdriansMind-Setup.exe";
export const PUBLIC_FEED = "https://raw.githubusercontent.com/emzylavish-art/adrians-mind-live/main/desktop-update.json";
export const PUBLIC_INSTALLER = "https://github.com/emzylavish-art/adrians-mind-live/releases/download/desktop-installer/AdriansMind-Setup.exe";
export const LOCAL_BUILD = 1;
export const LOCAL_VERSION = "0.9.0";

const GITHUB_ASSETS = new Set([
  "/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup.exe",
  "/emzylavish-art/adrians-mind-live/releases/download/desktop-installer/AdriansMind-Setup.exe",
]);
const ASSET_HOSTS = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

export type UpdateAction = "stay" | "switch" | "install";

export type UpdateDecision = {
  action: UpdateAction;
  reason: string;
  url?: string;
  switchUrl?: string;
};

export const publishedManifest = {
  product: "adrians-mind",
  version: LOCAL_VERSION,
  build: LOCAL_BUILD,
  download: INSTALLER_PATH,
  sha256: "7399cbd35c3fe8491a9b29f2881f2df7bcfa2c386b2629277060e5660dacbd92",
  size: 110204024,
};

export function isAllowedDownloadUrl(value: string, hop = 0): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  if (host === "adrians-mind.vercel.app") return url.pathname === INSTALLER_PATH;
  if (host === "github.com") return GITHUB_ASSETS.has(url.pathname);
  return hop > 0 && ASSET_HOSTS.has(host);
}

export function resolveDownloadUrl(download: string): string | null {
  if (typeof download !== "string" || download.length === 0 || download.length > 300) return null;
  if (download.startsWith("/")) {
    if (download !== INSTALLER_PATH) return null;
    return `${CLOUD_ORIGIN}${INSTALLER_PATH}`;
  }
  if (!isAllowedDownloadUrl(download, 0)) return null;
  return download;
}

export function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function validSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) < 500_000_000;
}

export function hashesMatch(expected: string, actual: string): boolean {
  if (!validHash(expected) || !validHash(actual) || expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

export function decideUpdate(localBuild: number, remote: unknown): UpdateDecision {
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
    return { action: "stay", reason: "cloud-missing" };
  }
  const body = remote as Record<string, unknown>;
  if (body.product !== "adrians-mind" || !Number.isInteger(body.build) || !Number.isInteger(localBuild)) {
    return { action: "stay", reason: "cloud-missing" };
  }
  const remoteBuild = body.build as number;
  if (remoteBuild < localBuild) return { action: "stay", reason: "cloud-older" };
  if (remoteBuild === localBuild) return { action: "stay", reason: "cloud-current" };
  const url = typeof body.download === "string" ? resolveDownloadUrl(body.download) : null;
  if (url && validHash(body.sha256) && validSize(body.size)) {
    return { action: "install", reason: "verified-installer", url, switchUrl: `${CLOUD_ORIGIN}/` };
  }
  return { action: "switch", reason: "newer-without-verified-file", switchUrl: `${CLOUD_ORIGIN}/` };
}

export function isManifest(value: unknown): value is { product: "adrians-mind"; build: number } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (value as { product?: unknown }).product === "adrians-mind"
    && Number.isInteger((value as { build?: unknown }).build);
}

export function chooseCloud(vercel: unknown, published: unknown): unknown {
  const feeds = [vercel, published].filter(isManifest);
  if (feeds.length === 0) return null;
  const newest = Math.max(...feeds.map((feed) => feed.build));
  return feeds.find((feed) => feed === vercel && feed.build === newest) ?? feeds.find((feed) => feed.build === newest) ?? null;
}

export function updateNote(localBuild: number, remote: unknown, decision: UpdateDecision): string {
  const remoteBuild = remote && typeof remote === "object" && Number.isInteger((remote as { build?: unknown }).build)
    ? (remote as { build: number }).build
    : null;
  if (decision.reason === "cloud-missing") {
    return `This copy is build ${localBuild}. The live site has no newer update feed, so this PC stays on the installed copy. A push does not update it until ${CLOUD_ORIGIN} serves a newer build.`;
  }
  if (decision.reason === "cloud-current") {
    return `This copy is build ${localBuild}. The live site is the same build. Nothing newer is published.`;
  }
  if (decision.reason === "cloud-older") {
    return `This copy is build ${localBuild}. The live site is older, so this PC stays on the installed copy.`;
  }
  if (decision.action === "install") {
    return `The live site is build ${remoteBuild}. This app will replace the program only after the downloaded file matches the published hash and size. Chats stay in the data folder.`;
  }
  return `The live site is build ${remoteBuild}. This PC stays open so local chats remain visible. The program is not replaced until a verified installer can be downloaded.`;
}

export function publicManifest(source: Partial<typeof publishedManifest> = publishedManifest) {
  const build = Number.isInteger(source.build) ? source.build as number : LOCAL_BUILD;
  return {
    product: "adrians-mind" as const,
    version: typeof source.version === "string" ? source.version.slice(0, 32) : LOCAL_VERSION,
    build,
    download: INSTALLER_PATH,
    sha256: validHash(source.sha256) ? source.sha256 : "",
    size: validSize(source.size) ? source.size : 0,
    cloud: CLOUD_ORIGIN,
  };
}

export async function readCloudManifest(fetcher: typeof fetch = fetch): Promise<unknown> {
  const vercel = await readFeed(fetcher, `${CLOUD_ORIGIN}${UPDATE_PATH}`, false);
  const published = await readFeed(fetcher, PUBLIC_FEED, true);
  return chooseCloud(vercel, published);
}

async function readFeed(fetcher: typeof fetch, url: string, allowPlain: boolean): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      redirect: allowPlain ? "follow" : "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!allowPlain && !type.includes("json")) return null;
    const body = type.includes("json") ? await response.json() : JSON.parse(await response.text());
    if (!isManifest(body)) return null;
    const record = body as Record<string, unknown>;
    return {
      product: "adrians-mind",
      version: typeof record.version === "string" ? record.version.slice(0, 32) : "",
      build: record.build,
      download: typeof record.download === "string" ? record.download.slice(0, 300) : "",
      sha256: typeof record.sha256 === "string" ? record.sha256.toLowerCase() : "",
      size: record.size,
    };
  } catch {
    return null;
  }
}
