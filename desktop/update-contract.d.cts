export type PackagePart = { name: string; sha256: string; size: number; url: string };
export type FullPackage = { finalName: "AdriansMind-Setup-Full.exe"; sha256: string; payloadSha256: string; size: number; parts: PackagePart[] };
export type SignedRelease = { schemaVersion: 2; product: "adrians-mind"; version: string; build: number; revision: string; platform: "win32"; arch: "x64"; sha256: string; payloadSha256: string; size: number; installedSize: number; publishedAt: string; expiresAt: string; signingKeyId: string; signature: string; installerSignerSha256: string; fullPackage: FullPackage; download?: string };
export type Trust = { keys: Record<string, string>; installerSignersSha256: string[] };
export type ValidationOptions = { trust?: Trust; now?: number; installedBuild?: number; platform?: string; arch?: string };
export type ValidationResult = { ok: true; manifest: SignedRelease; detail: string } | { ok: false; code: string; detail: string };
export type FeedResult = { source: string; ok: true; manifest: unknown; detail: string } | { source: string; ok: false; code: string; httpStatus?: number; detail: string };
export const MAX_PARTS: number;
export function allowedAssetUrl(value: string, hop?: number): boolean;
export function isFullPackageSpec(value: unknown): value is FullPackage;
export function validateReleaseCandidate(value: unknown, options?: ValidationOptions): ValidationResult;
export function chooseReleaseCandidates(candidates: Array<{ source: string; manifest: unknown }>, options?: ValidationOptions): { selected: SignedRelease | null; source: string | null; checks: Array<{ source: string; build: number | null; ok: boolean; code: string; detail: string }> };
export function readUpdateFeed(fetcher: typeof fetch, url: string, source: string, options?: { timeoutMs?: number }): Promise<FeedResult>;
export function signedPayload(manifest: unknown): Buffer;
export function canonical(value: unknown): string;

export function releasePageUrl(pack: FullPackage): string | null;
