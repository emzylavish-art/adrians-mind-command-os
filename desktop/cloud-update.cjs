const crypto = require("crypto");
const bundled = require("node:fs").existsSync(require("node:path").join(__dirname, "desktop-update.json"));
const release = bundled ? require("./desktop-update.json") : require("../public/desktop-update.json");
const CLOUD_ORIGIN = "https://adrians-mind.vercel.app";
const UPDATE_PATH = "/api/mind/desktop-update";
const INSTALLER_PATH = "/downloads/AdriansMind-Setup.exe";
const PUBLIC_FEED = "https://raw.githubusercontent.com/emzylavish-art/adrians-mind-command-os/main/public/desktop-update.json";
const PUBLIC_INSTALLER = release.download;
const LOCAL_BUILD = release.build;
const LOCAL_VERSION = release.version;
const PAYLOAD_HASH_MARK = "\nADRIAN_PAYLOAD_SHA256=";
const PAYLOAD_HASH_TAIL = "\n";
const contract = require("./update-contract.cjs");
const isAllowedDownloadUrl = contract.allowedAssetUrl;
const isFullPackageSpec = contract.isFullPackageSpec;
const FULL_PACKAGE = release.fullPackage;
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validSize = value => Number.isSafeInteger(value) && value > 0 && value < 2_000_000_000;
const validFullSize = value => Number.isSafeInteger(value) && value > 0 && value < 12_000_000_000;
function resolveDownloadUrl(download) {
  if (download === INSTALLER_PATH) return `${CLOUD_ORIGIN}${INSTALLER_PATH}`;
  return typeof download === "string" && download.length <= 500 && isAllowedDownloadUrl(download) ? download : null;
}
function decideFullUpdate(localBuild, remote, options = {}) {
  if (!Number.isSafeInteger(localBuild)) return { action: "stay", reason: "local-missing" };
  if (!remote) return { action: "stay", reason: "cloud-missing" };
  const result = contract.validateReleaseCandidate(remote, { ...options, installedBuild: localBuild });
  return result.ok ? { action: "full-install", reason: "signed-release-eligible", fullPackage: result.manifest.fullPackage } : { action: "stay", reason: result.code };
}
function hashesMatch(expected, actual) {
  if (!validHash(expected) || !validHash(actual) || expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}


function payloadHashField(buffer) {
  const mark = Buffer.from(PAYLOAD_HASH_MARK);
  const at = buffer.lastIndexOf(mark);
  if (at < 0) return null;
  const start = at + mark.length;
  const end = start + 64;
  if (end + PAYLOAD_HASH_TAIL.length > buffer.length) return null;
  if (buffer.subarray(end, end + PAYLOAD_HASH_TAIL.length).toString() !== PAYLOAD_HASH_TAIL) return null;
  const stored = buffer.subarray(start, end).toString("ascii");
  if (!validHash(stored)) return null;
  return { payloadEnd: at, stored };
}

function hashInstallerPayload(buffer) {
  const field = payloadHashField(buffer);
  const end = field ? field.payloadEnd : buffer.length;
  return crypto.createHash("sha256").update(buffer.subarray(0, end)).digest("hex");
}

function readPackedPayloadHash(buffer) {
  const field = payloadHashField(buffer);
  return field ? field.stored : null;
}

function packedPayloadRecordMatches(buffer) {
  const stored = readPackedPayloadHash(buffer);
  return Boolean(stored) && hashesMatch(stored, hashInstallerPayload(buffer));
}

function decideUpdate(localBuild, remote, options = {}) {
  const result = decideFullUpdate(localBuild, remote, options);
  return result.action === "full-install" ? { action: "install", reason: result.reason, url: contract.releasePageUrl(result.fullPackage) } : { action: "stay", reason: result.reason };
}
function isManifest(value) { return value && typeof value === "object" && value.product === "adrians-mind" && Number.isSafeInteger(value.build); }
function chooseCloud(vercel, published, options = {}) { return contract.chooseReleaseCandidates([{ source: "vercel", manifest: vercel }, { source: "github", manifest: published }], options).selected; }
function updateNote(localBuild, remote, decision) { return `Bundled release metadata: build ${localBuild}. Update check: ${decision.reason}. Installed executable and hosted website versions are separate. No installation occurs without owner confirmation.`; }
module.exports = {
  ...contract,
  CLOUD_ORIGIN,
  UPDATE_PATH,
  INSTALLER_PATH,
  PUBLIC_FEED,
  PUBLIC_INSTALLER,
  LOCAL_BUILD,
  LOCAL_VERSION,
  isAllowedDownloadUrl,
  resolveDownloadUrl,
  validHash,
  validSize,
  validFullSize,
  FULL_PACKAGE,
  isFullPackageSpec,
  decideFullUpdate,
  hashesMatch,
  PAYLOAD_HASH_MARK,
  hashInstallerPayload,
  readPackedPayloadHash,
  packedPayloadRecordMatches,
  decideUpdate,
  chooseCloud,
  updateNote,
};
