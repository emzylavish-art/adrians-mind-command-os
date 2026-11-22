const CLOUD_ORIGIN = "https://adrians-mind.vercel.app";
const UPDATE_PATH = "/api/mind/desktop-update";
const INSTALLER_PATH = "/downloads/AdriansMind-Setup.exe";
const PUBLIC_FEED = "https://raw.githubusercontent.com/emzylavish-art/adrians-mind-live/main/desktop-update.json";
const PUBLIC_INSTALLER = "https://github.com/emzylavish-art/adrians-mind-live/releases/download/desktop-installer/AdriansMind-Setup.exe";
const LOCAL_BUILD = 1;
const LOCAL_VERSION = "0.9.0";
const GITHUB_ASSETS = new Set([
  "/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup.exe",
  "/emzylavish-art/adrians-mind-live/releases/download/desktop-installer/AdriansMind-Setup.exe",
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
  return Number.isInteger(value) && value > 0 && value < 500_000_000;
}

function hashesMatch(expected, actual) {
  if (!validHash(expected) || !validHash(actual) || expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
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
  hashesMatch,
  decideUpdate,
  chooseCloud,
  updateNote,
};
