const { createHash } = require("node:crypto");
const { createReadStream, createWriteStream, statSync, mkdirSync, renameSync, rmSync, statfsSync } = require("node:fs");
const { join } = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { validateReleaseCandidate, allowedAssetUrl } = require("./update-contract.cjs");

function canceled(signal) { if (signal?.aborted) throw new Error("Update canceled. Verified package parts are retained; the installed app was not changed."); }
async function verifiedFile(file, size, sha256) {
  try {
    if (statSync(file).size !== size) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex") === sha256;
  } catch { return false; }
}
function availableDiskBytes(dir) {
  try { const stat = statfsSync(dir, { bigint: true }); return Number(stat.bavail * stat.bsize); }
  catch { return null; }
}
async function downloadPart(part, dir, options) {
  const file = join(dir, part.name);
  if (await verifiedFile(file, part.size, part.sha256)) return { file, reused: true };
  const partial = `${file}.partial`;
  let offset = 0;
  try { offset = statSync(partial).size; } catch { /* first download */ }
  if (offset >= part.size) {
    if (offset === part.size && await verifiedFile(partial, part.size, part.sha256)) { renameSync(partial, file); return { file, reused: true }; }
    rmSync(partial, { force: true }); offset = 0;
  }
  let current = part.url;
  for (let hop = 0; hop < 4; hop++) {
    canceled(options.signal);
    if (!allowedAssetUrl(current, hop)) throw new Error("The package redirect is not an authorized download destination.");
    const response = await options.fetch(current, { redirect: "manual", signal: options.signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The update service returned an invalid redirect.");
      current = new URL(location, current).toString(); continue;
    }
    if (!response.ok || !response.body) throw new Error(`Package download failed (HTTP ${response.status}). Verified parts can be resumed.`);
    if (offset) {
      if (response.status !== 206) {
        const approved = options.confirmPartRestart && await options.confirmPartRestart({ name: part.name, bytes: part.size, previouslyDownloaded: offset });
        if (!approved) { await response.body.cancel(); throw new Error("This source cannot resume the current part. Confirm its download restart; completed parts remain saved."); }
        offset = 0; rmSync(partial, { force: true });
        if (response.status !== 200) throw new Error("The update service returned an unexpected resume response.");
      } else if (response.headers.get("content-range") !== `bytes ${offset}-${part.size - 1}/${part.size}`) {
        await response.body.cancel(); throw new Error("The resumed package byte range does not match the signed release.");
      }
    } else if (response.status !== 200) { await response.body.cancel(); throw new Error("An unexpected partial package response was rejected."); }
    const declared = response.headers.get("content-length");
    if (declared != null && Number(declared) !== part.size - offset) { await response.body.cancel(); throw new Error("Package content length differs from the signed manifest."); }
    let count = offset;
    await pipeline(Readable.fromWeb(response.body), async function* (chunks) {
      for await (const chunk of chunks) {
        canceled(options.signal);
        count += chunk.length;
        if (count > part.size) throw new Error("Package download exceeds its signed byte length.");
        options.onProgress?.({ name: part.name, bytes: count, total: part.size, reused: false });
        yield chunk;
      }
    }, createWriteStream(partial, { flags: offset ? "a" : "w" }), { signal: options.signal });
    if (!await verifiedFile(partial, part.size, part.sha256)) { rmSync(partial, { force: true }); throw new Error("Package part failed byte/hash verification. It was discarded; verified parts remain saved."); }
    renameSync(partial, file);
    return { file, reused: false };
  }
  throw new Error("The update service exceeded the allowed redirect count.");
}
async function downloadRelease(manifest, dir, options = {}) {
  const checked = validateReleaseCandidate(manifest, options);
  if (!checked.ok) throw new Error(checked.detail);
  const pack = checked.manifest.fullPackage;
  mkdirSync(dir, { recursive: true });
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000);
  const finalPath = join(dir, pack.finalName);
  if (await verifiedFile(finalPath, pack.size, pack.sha256)) {
    canceled(signal);
    return { file: finalPath, manifest: checked.manifest, reusedBytes: pack.size, downloadedBytes: 0, installerSignatureVerified: false };
  }
  let reusedBytes = 0;
  for (const part of pack.parts) if (await verifiedFile(join(dir, part.name), part.size, part.sha256)) reusedBytes += part.size;
  const requiredCacheBytes = pack.size - reusedBytes + pack.size + 256 * 1024 * 1024;
  const available = options.availableBytes ?? availableDiskBytes(dir);
  if (available == null || available < requiredCacheBytes) throw new Error(available == null ? "Free disk space could not be verified. No download started." : `Update cache needs ${requiredCacheBytes} free bytes; ${available} are available. No download started.`);
  const paths = [];
  for (const part of pack.parts) {
    canceled(signal);
    const result = await downloadPart(part, dir, { ...options, fetch: options.fetch ?? fetch, signal });
    paths.push(result.file);
    options.onProgress?.({ name: part.name, bytes: part.size, total: part.size, reused: result.reused });
  }
  canceled(signal);
  if (!await verifiedFile(finalPath, pack.size, pack.sha256)) {
    const staging = `${finalPath}.assembling`;
    await pipeline(async function* () { for (const file of paths) { canceled(signal); yield* createReadStream(file); } }, createWriteStream(staging), { signal });
    if (!await verifiedFile(staging, pack.size, pack.sha256)) { rmSync(staging, { force: true }); throw new Error("The assembled installer failed signed hash/size verification."); }
    renameSync(staging, finalPath);
  }
  return { file: finalPath, manifest: checked.manifest, reusedBytes, downloadedBytes: pack.size - reusedBytes, installerSignatureVerified: false };
}
module.exports = { downloadRelease, verifiedFile, availableDiskBytes };
