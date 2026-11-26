const { readFileSync } = require("node:fs");
const path = require("node:path");
function validateBuildIdentity(identity, version) {
  if (!identity || identity.product !== "adrians-mind" || identity.version !== version || !Number.isInteger(identity.build) || !/^[a-f0-9]{40}$/.test(identity.revision || "") || !/^[a-f0-9-]{36}$/.test(identity.artifactId || "") || identity.dirty !== false) throw new Error("A clean committed server build with matching executable version is required before packaging. Run the build from the release commit; do not reuse another app-server directory.");
}
module.exports = async context => {
  const root = context.packager?.projectDir || __dirname;
  const identity = JSON.parse(readFileSync(path.join(root, "runtime-build.json"), "utf8"));
  const desktop = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  validateBuildIdentity(identity, desktop.version);
};
module.exports.validateBuildIdentity = validateBuildIdentity;
