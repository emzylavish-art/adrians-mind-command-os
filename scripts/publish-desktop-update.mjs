import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRepo = "emzylavish-art/adrians-mind-live";
const privateRepo = "emzylavish-art/adrians-mind-command-os";
const tag = "desktop-installer";
const assetName = "AdriansMind-Setup.exe";
const download = `https://github.com/${publicRepo}/releases/download/${tag}/${assetName}`;
const exe = process.argv[2];
const publish = process.argv.includes("--publish");

if (!exe) {
  console.error("Usage: node scripts/publish-desktop-update.mjs <installer.exe> [--publish]");
  console.error("A source push does not rebuild the installer. Do not invent a token and do not deploy from this script.");
  process.exit(2);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result.stdout.trim();
}

function constant(source, name) {
  const match = source.match(new RegExp(`const ${name} = "?([^"\\n;]+)"?`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

const asar = join(root, "desktop/dist/win-unpacked/resources/app.asar");
const extracted = join(tmpdir(), "adrian-packed-launcher");
rmSync(extracted, { recursive: true, force: true });
run("node", [join(root, "desktop/node_modules/@electron/asar/bin/asar.js"), "extract", asar, extracted]);
const rules = readFileSync(join(root, "desktop/cloud-update.cjs"), "utf8");
const packedRules = readFileSync(join(extracted, "cloud-update.cjs"), "utf8");
if (constant(rules, "LOCAL_BUILD") !== constant(packedRules, "LOCAL_BUILD")) {
  throw new Error("packed launcher build does not match source");
}

const bytes = readFileSync(exe);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  product: "adrians-mind",
  version: constant(rules, "LOCAL_VERSION"),
  build: Number(constant(rules, "LOCAL_BUILD")),
  path: "/downloads/AdriansMind-Setup.exe",
  download,
  sha256,
  size: bytes.length,
  cloud: "https://adrians-mind.vercel.app",
};
const body = `${JSON.stringify(manifest, null, 2)}\n`;
if (body.includes("ghp_") || body.includes("github_pat_") || body.includes("Bearer ")) {
  throw new Error("refusing a token in the update feed");
}
const feedPath = join(tmpdir(), "desktop-update.json");
writeFileSync(feedPath, body);
const preview = join(root, "public/downloads", assetName);
const chatCopy = join("/home/ubuntu/Downloads", assetName);
mkdirSync(dirname(preview), { recursive: true });
copyFileSync(exe, preview);
copyFileSync(exe, chatCopy);
console.log(JSON.stringify({ sha256, size: bytes.length, build: manifest.build, download, feedPath, preview, chatCopy }));

if (!publish) process.exit(0);

if (run("gh", ["api", `repos/${publicRepo}`, "--jq", ".permissions.push"]) !== "true") {
  throw new Error("the signed-in GitHub account cannot publish the public feed");
}
const sourcePath = join(root, "src/lib/mind/desktop-update.ts");
const source = readFileSync(sourcePath, "utf8");
const next = source
  .replace(/sha256: "[a-f0-9]{64}"/, `sha256: "${sha256}"`)
  .replace(/size: \d+,/, `size: ${bytes.length},`);
if (next === source || next.includes("ghp_")) throw new Error("could not record the installer hash in source");
writeFileSync(sourcePath, next);

const encoded = Buffer.from(body).toString("base64");
const existing = spawnSync("gh", ["api", `repos/${publicRepo}/contents/desktop-update.json`, "--jq", ".sha"], { encoding: "utf8" });
const put = [
  "api", "--method", "PUT", `repos/${publicRepo}/contents/desktop-update.json`,
  "-f", "message=Publish the desktop update feed for the current installer.",
  "-f", `content=${encoded}`,
  "-f", "branch=main",
];
if (existing.status === 0 && existing.stdout.trim()) put.push("-f", `sha=${existing.stdout.trim()}`);
run("gh", put);

const notes = "Current Adrian's Mind Windows installer. A source push does not rebuild this file.";
const viewed = spawnSync("gh", ["release", "view", tag, "--repo", publicRepo], { encoding: "utf8" });
if (viewed.status !== 0) {
  run("gh", ["release", "create", tag, "--repo", publicRepo, "--title", "Adrian's Mind desktop installer", "--notes", notes]);
}
run("gh", ["release", "upload", tag, chatCopy, "--repo", publicRepo, "--clobber"]);
run("gh", ["release", "upload", tag, chatCopy, "--repo", privateRepo, "--clobber"]);
console.log("published");
