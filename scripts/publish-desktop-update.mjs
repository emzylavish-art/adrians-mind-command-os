// Stage the reviewed full release. Uploading assets requires the existing
// explicit --publish switch and never edits source or updates the website.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import rules from "../desktop/cloud-update.cjs";
import manifest from "../public/desktop-update.json" with { type: "json" };

export async function stageFullInstaller(source, pack, output) {
  if (basename(source) !== pack.finalName || (await stat(source)).size !== pack.size) throw Error("Use the reviewed full installer with its exact name and byte length.");
  let offset = 0;
  const joined = createHash("sha256");
  for (const part of pack.parts) {
    const digest = createHash("sha256");
    await pipeline(
      createReadStream(source, { start: offset, end: offset + part.size - 1 }),
      async function* hash(chunks) {
        for await (const chunk of chunks) {
          digest.update(chunk);
          joined.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(join(output, part.name), { flags: "wx" }),
    );
    if (digest.digest("hex") !== part.sha256) throw Error("Part checksum differs from the approved manifest: " + part.name);
    offset += part.size;
  }
  if (offset !== pack.size || joined.digest("hex") !== pack.sha256) throw Error("Joined installer differs from the approved manifest.");
  await writeFile(join(output, pack.finalName + ".sha256"), pack.sha256 + "  " + pack.finalName + "\n", { flag: "wx" });
}

async function main() {
  const [source, flag] = process.argv.slice(2);
  if (!source || (flag && flag !== "--publish") || process.argv.length > 4) throw Error("Usage: node scripts/publish-desktop-update.mjs <AdriansMind-Setup-Full.exe> [--publish]");
  const pack = manifest.fullPackage;
  if (!rules.isFullPackageSpec(pack) || pack.sha256 !== manifest.sha256 || pack.size !== manifest.size) throw Error("Full release metadata is inconsistent.");
  const output = await mkdtemp(join(tmpdir(), "adrian-full-release-"));
  try {
    await stageFullInstaller(source, pack, output);
    await writeFile(join(output, "desktop-update.json"), JSON.stringify(manifest, null, 2) + "\n");
  } catch (error) {
    await rm(output, {recursive: true, force: true});
    throw error;
  }
  console.log("Verified full installer and four parts in " + output);
  if (flag !== "--publish") return;
  const repo = "emzylavish-art/adrians-mind-command-os";
  const tag = "desktop-installer";
  const release = spawnSync("gh", ["api", "repos/" + repo + "/releases/tags/" + tag], { encoding: "utf8" });
  if (release.status !== 0) throw Error("Could not verify the existing release. No assets uploaded.");
  const { assets } = JSON.parse(release.stdout);
  const checksumName = pack.finalName + ".sha256";
  const checksumDigest = createHash("sha256").update(await readFile(join(output, checksumName))).digest("hex");
  const expected = [...pack.parts, { name: checksumName, sha256: checksumDigest }];
  const missing = [];
  for (const part of expected) {
    const asset = assets.find(a => a.name === part.name);
    if (!asset) missing.push(join(output, part.name));
    else if (asset.digest !== "sha256:" + part.sha256) throw Error("Existing release asset differs: " + part.name + ". No assets uploaded.");
  }
  if (missing.length) {
    const result = spawnSync("gh", ["release", "upload", tag, "--repo", repo, ...missing], { stdio: "inherit" });
    if (result.status !== 0) throw Error("Upload was interrupted. Retry to verify the uploaded assets.");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
