import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export type CodingToolReceipt = {
  method: string;
  path?: string;
  status: "succeeded" | "denied" | "failed" | "written_locally";
  detail?: string;
  durable?: boolean;
  truncated?: boolean;
};

export type CodingFileChange = { path: string; before: string; after: string; beforeExists: boolean };
export type CodingFileResult = { ok: boolean; result?: Record<string, unknown>; error?: string; receipt: CodingToolReceipt; change?: CodingFileChange };

function safeTarget(cwd: string, requested: unknown): string | null {
  if (typeof requested !== "string" || !requested.trim() || requested.includes("\0")) return null;
  const root = resolve(cwd);
  const target = resolve(root, requested);
  const path = relative(root, target).replaceAll("\\", "/");
  if (!path || path.startsWith("../") || path === ".." || path.split("/").includes(".git") || /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i.test(path)) return null;
  // Resolve an existing ancestor before allowing a new file; an in-workspace link is not permission to another destination.
  try {
    const canonicalRoot = realpathSync(root);
    let ancestor = target;
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
      const parent = dirname(ancestor);
      if (parent === ancestor) return null;
      ancestor = parent;
    }
    const canonicalTarget = resolve(realpathSync(ancestor), relative(ancestor, target));
    const canonicalPath = relative(canonicalRoot, canonicalTarget).replaceAll("\\", "/");
    if (!canonicalPath || canonicalPath === ".." || canonicalPath.startsWith("../") || canonicalPath.split("/").includes(".git") || /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i.test(canonicalPath)) return null;
    return canonicalTarget;
  } catch { return null; }
}

/** Complete bounded content for change review; missing, unreadable and empty are different outcomes. */
export function readCodingFileSnapshot(cwd: string, path: string): { ok: true; path: string; exists: boolean; content: string } | { ok: false; error: string } {
  const target = safeTarget(cwd, path);
  if (!target) return { ok: false, error: "The observed path is outside this workspace or is secret." };
  try {
    const info = statSync(target, { throwIfNoEntry: false });
    if (!info) return { ok: true, path, exists: false, content: "" };
    if (!info.isFile() || info.size > 1_000_000) return { ok: false, error: "The observed file exceeds the complete review limit or is not a regular file." };
    return { ok: true, path, exists: true, content: readFileSync(target, "utf8") };
  } catch { return { ok: false, error: "The observed file could not be read. Its change was not assumed." }; }
}

export async function codingFileRequest(input: {
  method: "fs/read_text_file" | "fs/write_text_file";
  cwd: string;
  ownerId: string;
  allowWrite: boolean;
  params: Record<string, unknown>;
  persist: (ownerId: string, path: string, content: string) => Promise<boolean>;
}): Promise<CodingFileResult> {
  const { method, params } = input;
  const target = safeTarget(input.cwd, params.path);
  const receipt: CodingToolReceipt = { method, path: target ? relative(realpathSync(input.cwd), target) : undefined, status: "failed" };
  const fail = (error: string, status: CodingToolReceipt["status"] = "failed"): CodingFileResult => ({ ok: false, error, receipt: { ...receipt, status, detail: error } });
  if (!target) return fail("That path is outside the coding workspace or is secret. No file operation was performed.", "denied");
  try {
    if (method === "fs/read_text_file") {
      const info = statSync(target, { throwIfNoEntry: false });
      if (!info?.isFile()) return fail("File not found. This is different from an existing empty file.");
      if (info.size > 1_000_000) return fail("The file exceeds the supported read size. Use a bounded file reader.");
      const content = readFileSync(target, "utf8");
      const all = content.split("\n");
      const line = typeof params.line === "number" && Number.isFinite(params.line) ? Math.max(0, Math.floor(params.line)) : 0;
      const limit = typeof params.limit === "number" && Number.isFinite(params.limit) ? Math.max(0, Math.floor(params.limit)) : all.length;
      const selected = all.slice(line, line + limit).join("\n");
      const offset = typeof params.offset === "number" && Number.isFinite(params.offset) ? Math.max(0, Math.floor(params.offset)) : 0;
      const excerpt = selected.slice(offset, offset + 20_000);
      const truncated = selected.length > excerpt.length || line > 0 || line + limit < all.length;
      const continuation = offset + excerpt.length < selected.length ? { line, limit, offset: offset + excerpt.length, unit: "characters" } : null;
      return { ok: true, result: { content: excerpt, exists: true, truncated, totalLines: all.length, startLine: line, returnedCharacters: excerpt.length, selectedCharacters: selected.length, ...(offset || continuation ? { startCharacter: offset, continuation } : {}) }, receipt: { ...receipt, status: "succeeded", truncated } };
    }
    if (!input.allowWrite) return fail("File writes require an acknowledged Run mode. Nothing was written.", "denied");
    if (typeof params.content !== "string" || params.content.length > 1_000_000) return fail("Write content is missing or exceeds 1,000,000 characters. Nothing was written.", "denied");
    const previous = statSync(target, { throwIfNoEntry: false });
    if (previous && (!previous.isFile() || previous.size > 1_000_000)) return fail("The existing file cannot be captured within the supported review limit. Nothing was written.", "denied");
    const before = previous ? readFileSync(target, "utf8") : "";
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, params.content);
    if (readFileSync(target, "utf8") !== params.content) return fail("The local write could not be verified. Review the file before retrying.", "written_locally");
    const change: CodingFileChange = { path: receipt.path!, before, after: params.content, beforeExists: Boolean(previous) };
    let durable = false;
    try { durable = await input.persist(input.ownerId, receipt.path!, params.content); } catch { /* Keep the confirmed local outcome distinct from durability. */ }
    if (!durable) return { ...fail("The file was written and verified locally, but durable persistence was not confirmed. Reconcile the existing file before retrying.", "written_locally"), receipt: { ...receipt, status: "written_locally", durable: false, detail: "Local write verified; durable persistence unconfirmed." }, change };
    return { ok: true, result: { written: true, verified: true, durable: true }, receipt: { ...receipt, status: "succeeded", durable: true }, change };
  } catch {
    return fail("The file operation failed. Its completion was not assumed; inspect the file before retrying.");
  }
}
