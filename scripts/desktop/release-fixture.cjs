// Synthetic installer bytes and ephemeral publisher keys; never a live release.
const { generateKeyPairSync, createHash, sign } = require("node:crypto");
const { signedPayload } = require("../../desktop/update-contract.cjs");
const hash = value => createHash("sha256").update(value).digest("hex");
function releaseFixture(count = 4, build = 10) {
  const keys = generateKeyPairSync("ed25519");
  const bytes = Array.from({ length: count }, (_, index) => Buffer.from(`synthetic part ${index} for release ${build} `));
  const joined = Buffer.concat(bytes);
  const parts = bytes.map((chunk, index) => ({ name: `AdriansMind-Setup-Full.exe.part${String(index).padStart(2, "0")}`, size: chunk.length, sha256: hash(chunk), url: `https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/fixture-${build}/AdriansMind-Setup-Full.exe.part${String(index).padStart(2, "0")}` }));
  const fullPackage = { finalName: "AdriansMind-Setup-Full.exe", size: joined.length, sha256: hash(joined), payloadSha256: hash(joined), parts };
  const manifest = { schemaVersion: 2, product: "adrians-mind", build, version: `0.9.${build}`, revision: "b".repeat(40), platform: "win32", arch: "x64", installedSize: joined.length * 2, ...{ sha256: fullPackage.sha256, payloadSha256: fullPackage.payloadSha256, size: fullPackage.size }, fullPackage, publishedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), installerSignerSha256: "a".repeat(64), signingKeyId: "ephemeral-test-only", signature: "" };
  const resign = value => ({ ...value, signature: sign(null, signedPayload(value), keys.privateKey).toString("base64") });
  const trust = { keys: { "ephemeral-test-only": keys.publicKey.export({ type: "spki", format: "pem" }) }, installerSignersSha256: ["a".repeat(64)] };
  return { manifest: resign(manifest), trust, bytes, joined, resign };
}
module.exports = { releaseFixture, hash };
