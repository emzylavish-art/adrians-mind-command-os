const { createPublicKey, verify } = require("node:crypto");
const trustDefaults = require("./publisher-trust.json");
const REPO_PATH = "/emzylavish-art/adrians-mind-command-os/releases/download/";
const ASSET_HOSTS = new Set(["release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"]);
const MAX_PARTS = 64;
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value < max;
const record = value => value && typeof value === "object" && !Array.isArray(value);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function signedPayload(manifest) {
  const value = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "signature"));
  return Buffer.from(canonical(value), "utf8");
}
function allowedAssetUrl(value, hop = 0) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
  if (hop > 0 && ASSET_HOSTS.has(url.hostname)) return true;
  if (url.search) return false;
  if (url.hostname === "adrians-mind.vercel.app") return url.pathname === "/downloads/AdriansMind-Setup.exe";
  if (url.hostname !== "github.com" || !url.pathname.startsWith(REPO_PATH)) return false;
  const tail = url.pathname.slice(REPO_PATH.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\/AdriansMind-Setup-Full\.exe\.(?:part\d{2}|sha256)$/.test(tail);
}
function isFullPackageSpec(value) {
  if (!record(value) || value.finalName !== "AdriansMind-Setup-Full.exe" || !hash(value.sha256) || !hash(value.payloadSha256) || !positive(value.size, 12_000_000_000)) return false;
  if (!Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > MAX_PARTS) return false;
  let total = 0;
  const urls = new Set();
  let releasePath = null;
  for (const [index, part] of value.parts.entries()) {
    if (!record(part) || part.name !== `${value.finalName}.part${String(index).padStart(2, "0")}` || !hash(part.sha256) || !positive(part.size, 2_000_000_000) || !allowedAssetUrl(part.url)) return false;
    const url = new URL(part.url);
    if (url.hostname !== "github.com" || url.pathname.split("/").at(-1) !== part.name || urls.has(part.url)) return false;
    const parent = url.pathname.slice(0, url.pathname.lastIndexOf("/"));
    if (releasePath && parent !== releasePath) return false;
    releasePath = parent;
    urls.add(part.url);
    total += part.size;
  }
  return total === value.size;
}
function validateReleaseCandidate(value, options = {}) {
  const trust = options.trust ?? trustDefaults;
  const now = options.now ?? Date.now();
  const reject = (code, detail) => ({ ok: false, code, detail });
  if (!record(value) || value.product !== "adrians-mind" || !Number.isSafeInteger(value.build) || value.build < 1 || typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version)) return reject("invalid_manifest", "Release identity or version is invalid.");
  if (value.schemaVersion !== 2) return reject("unsigned_legacy", "This release feed has no supported publisher signature. It cannot authorize installation.");
  if (value.platform !== "win32" || value.arch !== "x64" || (options.platform && options.platform !== value.platform) || (options.arch && options.arch !== value.arch)) return reject("incompatible_platform", "This release is only packaged for Windows x64.");
  if (typeof value.revision !== "string" || !/^[a-f0-9]{40}$/.test(value.revision)) return reject("invalid_manifest", "The package source revision is missing or invalid.");
  if (!positive(value.installedSize, 64_000_000_000)) return reject("invalid_package", "The unpacked installation size is missing or invalid.");
  if (!isFullPackageSpec(value.fullPackage) || value.sha256 !== value.fullPackage.sha256 || value.size !== value.fullPackage.size || value.payloadSha256 !== value.fullPackage.payloadSha256) return reject("invalid_package", "Package parts, sizes, destinations or hashes do not agree.");
  const published = Date.parse(value.publishedAt);
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(published) || !Number.isFinite(expires) || published > now + 60_000 || expires <= now || expires <= published) return reject("expired_manifest", "Release timestamps are invalid or its authorization has expired.");
  if (!hash(value.installerSignerSha256) || !Array.isArray(trust.installerSignersSha256) || !trust.installerSignersSha256.includes(value.installerSignerSha256)) return reject("publisher_unconfigured", "The installer signing identity is not in this application's trusted publisher configuration.");
  const key = typeof value.signingKeyId === "string" && record(trust.keys) ? trust.keys[value.signingKeyId] : null;
  if (typeof key !== "string") return reject("publisher_unconfigured", "No independently trusted release-signing key is configured for this publisher.");
  if (typeof value.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature)) return reject("invalid_signature", "Release signature is missing or malformed.");
  try {
    const publicKey = createPublicKey(key);
    if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, signedPayload(value), publicKey, Buffer.from(value.signature, "base64"))) return reject("invalid_signature", "Release signature does not match the trusted publisher key.");
  } catch { return reject("invalid_signature", "Release signature could not be verified."); }
  if (Number.isSafeInteger(options.installedBuild) && value.build <= options.installedBuild) return reject(value.build === options.installedBuild ? "current" : "older", "No newer eligible package. An installed application is never downgraded automatically.");
  return { ok: true, manifest: value, detail: "Signed release metadata validated. Downloaded bytes and installer signature still require verification." };
}
function releasePageUrl(pack) {
  if (!isFullPackageSpec(pack)) return null;
  const tag = new URL(pack.parts[0].url).pathname.split("/").at(-2);
  return `https://github.com/emzylavish-art/adrians-mind-command-os/releases/tag/${tag}`;
}
function chooseReleaseCandidates(candidates, options = {}) {
  const checks = candidates.map(candidate => ({ source: candidate.source, manifest: candidate.manifest, result: validateReleaseCandidate(candidate.manifest, options) }));
  const eligible = checks.filter(check => check.result.ok).sort((a, b) => b.manifest.build - a.manifest.build || (a.source === "vercel" ? -1 : 1));
  return { selected: eligible[0]?.manifest ?? null, source: eligible[0]?.source ?? null, checks: checks.map(check => ({ source: check.source, build: record(check.manifest) && Number.isInteger(check.manifest.build) ? check.manifest.build : null, ok: check.result.ok, code: check.result.ok ? "eligible" : check.result.code, detail: check.result.detail })) };
}
async function readUpdateFeed(fetcher, url, source, options = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = Math.min(30_000, Math.max(1, options.timeoutMs ?? 8000));
  let deadline;
  const timeout = new Promise((_, reject) => { deadline = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("timeout")); }, timeoutMs); });
  const bounded = promise => Promise.race([promise, timeout]);
  try {
    const response = await bounded(fetcher(url, { redirect: "error", headers: { accept: "application/json" }, signal: controller.signal }));
    if (!response.ok) return { source, ok: false, code: "http_error", httpStatus: response.status, detail: "Update service returned an HTTP error." };
    const type = response.headers.get("content-type") ?? "";
    if (!/application\/json|text\/plain/.test(type)) return { source, ok: false, code: "invalid_content_type", detail: "Update service returned an unexpected content type." };
    const declared = response.headers.get("content-length");
    if (declared && Number(declared) > 100_000) return { source, ok: false, code: "invalid_manifest", detail: "Release manifest exceeds its supported size." };
    let raw = "";
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = []; let length = 0;
      try {
        for (;;) {
          const part = await bounded(reader.read());
          if (part.done) break;
          length += part.value.byteLength;
          if (length > 100_000) { await reader.cancel(); return { source, ok: false, code: "invalid_manifest", detail: "Release manifest exceeds its supported size." }; }
          chunks.push(Buffer.from(part.value));
        }
        raw = Buffer.concat(chunks).toString("utf8");
      } finally { reader.releaseLock(); }
    } else raw = await bounded(response.text());
    if (raw.length > 100_000) return { source, ok: false, code: "invalid_manifest", detail: "Release manifest exceeds its supported size." };
    let manifest;
    try { manifest = JSON.parse(raw); } catch { return { source, ok: false, code: "invalid_json", detail: "Release information could not be parsed." }; }
    if (!record(manifest) || manifest.product !== "adrians-mind" || !Number.isSafeInteger(manifest.build)) return { source, ok: false, code: "invalid_manifest", detail: "Release identity is invalid." };
    return { source, ok: true, manifest, detail: "Feed received; signature and compatibility must be evaluated separately." };
  } catch { return { source, ok: false, code: timedOut ? "timeout" : "network_error", detail: timedOut ? "Update service did not answer before the deadline." : "Update service could not be reached. Newer-release availability is unknown." }; }
  finally { clearTimeout(deadline); controller.abort(); }
}
module.exports = { MAX_PARTS, allowedAssetUrl, isFullPackageSpec, validateReleaseCandidate, chooseReleaseCandidates, readUpdateFeed, signedPayload, canonical, releasePageUrl };
