import release from "../../../public/desktop-update.json" with { type: "json" };

export const CLOUD_ORIGIN = "https://adrians-mind.vercel.app";
export const UPDATE_PATH = "/api/mind/desktop-update";
export const INSTALLER_PATH = "/downloads/AdriansMind-Setup.exe";
export const PUBLIC_FEED = "https://raw.githubusercontent.com/emzylavish-art/adrians-mind-command-os/main/public/desktop-update.json";
export const PUBLIC_INSTALLER = release.download;
export const LOCAL_BUILD = release.build;
export const LOCAL_VERSION = release.version;

const GITHUB_ASSETS = new Set([
  "/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part00",
  "/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part01",
  "/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part02",
  "/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part03",
  "/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.sha256",
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

export const publishedManifest = release;
export const FULL_PACKAGE = release.fullPackage;

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
  return Number.isInteger(value) && (value as number) > 0 && (value as number) < 2_000_000_000;
}

export function validFullSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) < 12_000_000_000;
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
  const full = decideFullUpdate(localBuild, remote);
  if (full.action === "full-install") return { action: "install", reason: full.reason, url: PUBLIC_INSTALLER };
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

export function publicManifest(source = publishedManifest) {
  return { ...source, fullPackage: source.fullPackage };
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
      fullPackage: isFullPackageSpec(record.fullPackage) ? record.fullPackage : undefined,
    };
  } catch {
    return null;
  }
}

export function isFullPackageSpec(value: unknown): value is typeof FULL_PACKAGE {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as { finalName?: unknown; sha256?: unknown; size?: unknown; parts?: unknown };
  if (body.finalName !== "AdriansMind-Setup-Full.exe") return false;
  if (!validHash(body.sha256) || !validHash((value as Record<string, unknown>).payloadSha256) || !validFullSize(body.size)) return false;
  if (!Array.isArray(body.parts) || body.parts.length !== 4) return false;
  let sum = 0;
  for (const [index, part] of body.parts.entries()) {
    if (!part || typeof part !== "object") return false;
    const row = part as { name?: unknown; sha256?: unknown; size?: unknown; url?: unknown };
    const expected = FULL_PACKAGE.parts[index];
    if (row.name !== expected.name || row.url !== expected.url) return false;
    if (!validHash(row.sha256) || !validSize(row.size)) return false;
    if (typeof row.url !== "string" || !isAllowedDownloadUrl(row.url, 0)) return false;
    sum += row.size as number;
  }
  return sum === body.size;
}

export function decideFullUpdate(localBuild: number, remote: unknown): { action: "stay" | "full-install"; reason: string; fullPackage?: typeof FULL_PACKAGE } {
  if (!Number.isInteger(localBuild)) return { action: "stay", reason: "local-missing" };
  if (!isManifest(remote)) return { action: "stay", reason: "cloud-missing" };
  const remoteBuild = remote.build;
  if (remoteBuild <= localBuild) return { action: "stay", reason: "not-newer" };
  const header = remote as Record<string, unknown>;
  const pack = header.fullPackage;
  if (!pack) return { action: "stay", reason: "full-missing" };
  if (!isFullPackageSpec(pack) || header.sha256 !== pack.sha256 || header.size !== pack.size) {
    return { action: "stay", reason: "full-invalid" };
  }
  if (pack.sha256 === FULL_PACKAGE.sha256) return { action: "stay", reason: "same-file" };
  return { action: "full-install", reason: "verified-full-parts", fullPackage: pack };
}
