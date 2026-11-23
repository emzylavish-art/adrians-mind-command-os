const crypto = require("crypto");
const CLOUD_ORIGIN = "https://adrians-mind.vercel.app";
const UPDATE_PATH = "/api/mind/desktop-update";
const INSTALLER_PATH = "/downloads/AdriansMind-Setup.exe";
const PUBLIC_FEED = "https://raw.githubusercontent.com/emzylavish-art/adrians-mind-live/main/desktop-update.json";
const PUBLIC_INSTALLER = "https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part00";
const LOCAL_BUILD = 9;
const LOCAL_VERSION = "0.9.1";
const PAYLOAD_HASH_MARK = "\nADRIAN_PAYLOAD_SHA256=";
const PAYLOAD_HASH_TAIL = "\n";
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

function isAllowedDownloadUrl(value, hop = 0) {
  let url;
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

function resolveDownloadUrl(download) {
  if (typeof download !== "string" || download.length === 0 || download.length > 300) return null;
  if (download.startsWith("/")) {
    if (download !== INSTALLER_PATH) return null;
    return `${CLOUD_ORIGIN}${INSTALLER_PATH}`;
  }
  if (!isAllowedDownloadUrl(download, 0)) return null;
  return download;
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validSize(value) {
  return Number.isInteger(value) && value > 0 && value < 2_000_000_000;
}

function validFullSize(value) {
  return Number.isInteger(value) && value > 0 && value < 12_000_000_000;
}

const FULL_PACKAGE = {
  finalName: "AdriansMind-Setup-Full.exe",
  sha256: "2453144ed1f600ad6d6d0dfb74dcc9fec2a42a3284ff79105b2dbd242a75bf02",
  payloadSha256: "f3b251c5241a4eb7833fd1c176df87564d1f8120260909e75d387e33a94a00d2",
  size: 6398368708,
  parts: [
    { name: "AdriansMind-Setup-Full.exe.part00", sha256: "986587fc11c7f411fd990b601d0b3199a5a1c70c59be913dcfb0a6f3d274973b", size: 1992294400, url: "https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part00" },
    { name: "AdriansMind-Setup-Full.exe.part01", sha256: "f29d223edeee8b832b28b8f40f7171de64dd8226e48c48bd58b25700cb352749", size: 1992294400, url: "https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part01" },
    { name: "AdriansMind-Setup-Full.exe.part02", sha256: "0b201ccb5c002a580fe287406fb9c11490d7df2e9b38e9d62ab01d06c7b85425", size: 1992294400, url: "https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part02" },
    { name: "AdriansMind-Setup-Full.exe.part03", sha256: "16f2a6ea35cfd85f245883cfb2ba7a58628429287f09af9521daae70a82edcac", size: 421485508, url: "https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part03" },
  ],
};

function isFullPackageSpec(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.finalName !== "AdriansMind-Setup-Full.exe") return false;
  if (!validHash(value.sha256) || !validFullSize(value.size)) return false;
  if (!Array.isArray(value.parts) || value.parts.length !== 4) return false;
  let sum = 0;
  for (const part of value.parts) {
    if (!part || typeof part.name !== "string" || !part.name.startsWith("AdriansMind-Setup-Full.exe.part")) return false;
    if (!validHash(part.sha256) || !validSize(part.size)) return false;
    if (typeof part.url !== "string" || !isAllowedDownloadUrl(part.url, 0)) return false;
    sum += part.size;
  }
  return sum === value.size;
}

function decideFullUpdate(localBuild, remote) {
  if (!Number.isInteger(localBuild)) return { action: "stay", reason: "local-missing" };
  const remoteBuild = remote && Number.isInteger(remote.build) ? remote.build : LOCAL_BUILD;
  if (remoteBuild <= localBuild) return { action: "stay", reason: "not-newer" };
  const pack = remote && remote.fullPackage ? remote.fullPackage : null;
  if (!pack) return { action: "stay", reason: "full-missing" };
  if (!isFullPackageSpec(pack)) return { action: "stay", reason: "full-invalid" };
  if (pack.sha256 === FULL_PACKAGE.sha256) return { action: "stay", reason: "same-file" };
  return { action: "full-install", reason: "verified-full-parts", fullPackage: pack };
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

function decideUpdate(localBuild, remote) {
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return { action: "stay", reason: "cloud-missing" };
  if (remote.product !== "adrians-mind" || !Number.isInteger(remote.build) || !Number.isInteger(localBuild)) {
    return { action: "stay", reason: "cloud-missing" };
  }
  if (remote.build < localBuild) return { action: "stay", reason: "cloud-older" };
  if (remote.build === localBuild) return { action: "stay", reason: "cloud-current" };
  const url = typeof remote.download === "string" ? resolveDownloadUrl(remote.download) : null;
  if (url && validHash(remote.sha256) && validSize(remote.size)) {
    return { action: "install", reason: "verified-installer", url, switchUrl: `${CLOUD_ORIGIN}/` };
  }
  return { action: "switch", reason: "newer-without-verified-file", switchUrl: `${CLOUD_ORIGIN}/` };
}

function isManifest(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.product === "adrians-mind" && Number.isInteger(value.build);
}

function chooseCloud(vercel, published) {
  const feeds = [vercel, published].filter(isManifest);
  if (feeds.length === 0) return null;
  const newest = Math.max(...feeds.map((feed) => feed.build));
  return feeds.find((feed) => feed === vercel && feed.build === newest) || feeds.find((feed) => feed.build === newest) || null;
}

function updateNote(localBuild, remote, decision) {
  const remoteBuild = remote && typeof remote === "object" && Number.isInteger(remote.build) ? remote.build : null;
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

module.exports = {
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
