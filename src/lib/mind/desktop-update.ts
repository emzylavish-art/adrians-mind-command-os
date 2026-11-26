import contract from "../../../desktop/update-contract.cjs";
import type { FullPackage, ValidationOptions } from "../../../desktop/update-contract.cjs";
import { CLOUD_ORIGIN, UPDATE_PATH, INSTALLER_PATH, PUBLIC_FEED, PUBLIC_INSTALLER, LOCAL_BUILD, publishedManifest } from "./desktop-update-info.ts";
export * from "./desktop-update-info.ts";
export type UpdateAction = "stay" | "switch" | "install";
export type UpdateDecision = { action: UpdateAction; reason: string; url?: string; switchUrl?: string };
export const isFullPackageSpec = contract.isFullPackageSpec;
export const isAllowedDownloadUrl = contract.allowedAssetUrl;
export const validateReleaseCandidate = contract.validateReleaseCandidate;
export const chooseReleaseCandidates = contract.chooseReleaseCandidates;
export const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const validSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) < 2_000_000_000;
export const validFullSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) < 12_000_000_000;
export function hashesMatch(expected: string, actual: string) { return validHash(expected) && validHash(actual) && expected === actual; }
export function resolveDownloadUrl(download: string): string | null {
  if (typeof download !== "string" || !download || download.length > 500) return null;
  if (download === INSTALLER_PATH) return `${CLOUD_ORIGIN}${INSTALLER_PATH}`;
  return isAllowedDownloadUrl(download) ? download : null;
}
export function isManifest(value: unknown): value is { product: "adrians-mind"; build: number } {
  return !!value && typeof value === "object" && !Array.isArray(value) && (value as { product?: unknown }).product === "adrians-mind" && Number.isSafeInteger((value as { build?: unknown }).build);
}
export function decideFullUpdate(localBuild: number, remote: unknown, options: ValidationOptions = {}): { action: "stay" | "full-install"; reason: string; fullPackage?: FullPackage } {
  if (!Number.isSafeInteger(localBuild)) return { action: "stay", reason: "local-missing" };
  if (!remote) return { action: "stay", reason: "cloud-missing" };
  const result = validateReleaseCandidate(remote, { ...options, installedBuild: localBuild });
  return result.ok ? { action: "full-install", reason: "signed-release-eligible", fullPackage: result.manifest.fullPackage } : { action: "stay", reason: result.code };
}
export function decideUpdate(localBuild: number, remote: unknown, options: ValidationOptions = {}): UpdateDecision {
  const full = decideFullUpdate(localBuild, remote, options);
  return full.action === "full-install" ? { action: "install", reason: full.reason, url: contract.releasePageUrl(full.fullPackage!) || undefined } : { action: "stay", reason: full.reason };
}
export function chooseCloud(vercel: unknown, published: unknown, options: ValidationOptions = {}): unknown {
  return chooseReleaseCandidates([{ source: "vercel", manifest: vercel }, { source: "github", manifest: published }], options).selected;
}
export function updateNote(localBuild: number, _remote: unknown, decision: UpdateDecision): string {
  const prefix = `This server bundles release metadata for build ${localBuild}; the installed executable version is reported only by the desktop app.`;
  if (decision.action === "install") return `${prefix} A newer signed release is eligible. Review exact download size and disk space in the desktop updater. Installation requires verified bytes, a trusted installer signature, and your separate confirmation.`;
  if (decision.reason === "current") return `${prefix} The authenticated release is the same build.`;
  if (decision.reason === "older") return `${prefix} The authenticated release is older. No downgrade is proposed.`;
  return `${prefix} Update availability could not be established (${decision.reason}). No download, installation, or site switch started. Check each feed's diagnostic result; ${CLOUD_ORIGIN} is the separate hosted application.`;
}
export function publicManifest(source = publishedManifest) { return source; }
export async function readCloudCheck(fetcher: typeof fetch = fetch, options: ValidationOptions & { timeoutMs?: number } = {}) {
  const feeds = await Promise.all([
    contract.readUpdateFeed(fetcher, `${CLOUD_ORIGIN}${UPDATE_PATH}`, "vercel", options),
    contract.readUpdateFeed(fetcher, PUBLIC_FEED, "github", options),
  ]);
  const selection = chooseReleaseCandidates(feeds.filter(feed => feed.ok).map(feed => ({ source: feed.source, manifest: feed.manifest })), options);
  return { ...selection, feeds };
}
export async function readCloudManifest(fetcher: typeof fetch = fetch, options: ValidationOptions = {}): Promise<unknown> {
  return (await readCloudCheck(fetcher, options)).selected;
}
