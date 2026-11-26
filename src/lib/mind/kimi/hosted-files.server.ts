import { getSql, type Sql } from "../../db.ts";
import { reconcileStoredMutation, type FileReconciliation } from "./file-reconciliation.ts";
import { accountFileOperation, machineRequired } from "./account-workspace.ts";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { adrianHostedWorkspace } from "./hosted/acp-client.ts";
import { branchHostedGit, commitHostedGit, initHostedGit, inspectHostedGit, listHostedCheckpoints, restoreHostedCheckpoint } from "./hosted/shell.server.ts";
import { forgetWorkspaceFile, renameWorkspaceFile, saveWorkspaceFile, restoreWorkspaceFilesDetailed } from "./persist.ts";
import { fileRevision, reviewedFileMatches } from "./file-revision.ts";
const MAX_CONTENT = 1_000_000;
const OPERATIONS = new Set(["list", "read", "write", "search", "rename", "delete"]);
const SECRET = /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i;
function blocked(path: string) { return path.split("/").some((part) => part === ".." || part === ".git") || SECRET.test(path); }
function inside(root: string, path: string) { return path === root || path.startsWith(`${root}/`); }
function hasSymlink(root: string, path: string) {
  const parts = relative(root, path).split("/");
  return parts.some((_, index) => lstatSync(join(root, ...parts.slice(0, index + 1)), { throwIfNoEntry: false })?.isSymbolicLink());
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }

export async function runHostedFileOperation(body: { operation?: unknown; path?: unknown; content?: unknown; query?: unknown; to?: unknown; confirm?: unknown; expectedContent?: unknown; expectedMissing?: unknown; expectedRevision?: unknown; workspace?: unknown; action?: unknown; expectedSnapshot?: unknown; cursor?: unknown; directory?: unknown }, ownerId: string, deps: { root?: string; save?: typeof saveWorkspaceFile; rename?: typeof renameWorkspaceFile; forget?: typeof forgetWorkspaceFile; sql?: Sql } = {}): Promise<Response> {
  if (ownerId !== "dev-user") {
    if (!OPERATIONS.has(String(body.operation))) return json({ ok: false, error: machineRequired }, 409);
    try { return await accountFileOperation(await getSql(), ownerId, body); }
    catch { return json({ ok: false, error: "Account workspace storage is unavailable." }, 503); }
  }
  const operationName = typeof body.operation === "string" ? body.operation : "";
  if (operationName === "checkpoints") return json({ ok: true, checkpoints: listHostedCheckpoints(), result: { checkpoints: listHostedCheckpoints() } });
  if (operationName === "restore") {
    if (body.confirm !== true) return json({ ok: false, error: "Confirm restore before replacing the workspace." }, 400);
    const id = typeof body.path === "string" ? body.path : "";
    const restored = restoreHostedCheckpoint(id);
    return json({ ok: restored, checkpoint: id, error: restored ? undefined : "Checkpoint was not found. Nothing was restored." }, restored ? 200 : 404);
  }
  if (operationName === "git") return json(await inspectHostedGit());
  if (operationName === "git-init") {
    if (body.confirm !== true) return json({ ok: false, error: "Confirm before starting local Git. Nothing was initialized." }, 400);
    return json(await initHostedGit());
  }
  if (operationName === "git-commit") {
    if (body.confirm !== true) return json({ ok: false, error: "Confirm the commit message before creating a local commit. Nothing was pushed." }, 400);
    return json(await commitHostedGit(typeof body.content === "string" ? body.content : ""));
  }
  if (operationName === "git-branch") {
    if (body.confirm !== true) return json({ ok: false, error: "Confirm the branch name before creating it. Nothing was pushed." }, 400);
    return json(await branchHostedGit(typeof body.to === "string" ? body.to : ""));
  }
  const root = deps.root ?? adrianHostedWorkspace();
  const operation = operationName;
  const relativePath = typeof body.path === "string" ? body.path.replace(/^\/+/, "") : "";
  const target = resolve(root, relativePath);
  if (!inside(root, target)) return json({ ok: false, error: "Path is outside the hosted workspace." }, 400);
  if (hasSymlink(root, target)) return json({ ok: false, error: "Symbolic links are not editable workspace files." }, 400);
  if (relativePath && blocked(relativePath)) return json({ ok: false, error: "That path is secret or outside the hosted workspace. Nothing changed." }, 400);
  if (operation === "storage-status" || operation === "restore-account-files") {
    if (operation === "restore-account-files" && (body.confirm !== true || typeof body.expectedSnapshot !== "string")) return json({ ok: false, error: "Confirm missing-file restoration after reviewing storage status." }, 400);
    const result = await restoreWorkspaceFilesDetailed(ownerId, root, deps.sql, operation === "restore-account-files", typeof body.expectedSnapshot === "string" ? body.expectedSnapshot : undefined);
    return json(result, result.ok ? 200 : 503);
  }
  if (operation === "reconcile") {
    if (body.confirm !== true || !["rename", "delete"].includes(String(body.action)) || typeof body.expectedRevision !== "string") return json({ ok: false, error: "Review and confirm the exact storage reconciliation." }, 400);
    const to = typeof body.to === "string" ? body.to : undefined;
    const next = to ? resolve(root, to) : undefined;
    if (next && (!inside(root, next) || blocked(relative(root, next)) || hasSymlink(root, next))) return json({ ok: false, error: "Invalid reconciliation destination." }, 400);
    const reviewed: FileReconciliation = { action: body.action as "rename" | "delete", path: relativePath, to, expectedRevision: body.expectedRevision };
    const diskMatches = () => !lstatSync(target, { throwIfNoEntry: false }) && (reviewed.action === "delete" || Boolean(next && lstatSync(next, { throwIfNoEntry: false })?.isFile() && fileRevision(readFileSync(next, "utf8")) === reviewed.expectedRevision));
    try {
      const outcome = await reconcileStoredMutation(deps.sql ?? await getSql(), ownerId, reviewed, diskMatches);
      return json({ ...outcome, durable: outcome.ok, path: relativePath, to }, outcome.ok ? 200 : 409);
    } catch { return json({ ok: false, error: "Account storage is unavailable. Reconciliation did not complete; inspect before retrying." }, 503); }
  }
  if (operation === "list") {
    const all = readdirSync(root, { recursive: true }).flatMap((entry) => {
      const name = String(entry);
      const path = join(root, name);
      if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile() || blocked(name)) return [];
      const relativePath = relative(root, path);
      if (relativePath.split("/").includes(".git") || /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i.test(relativePath)) return [];
      return [{ path: relative(root, path), bytes: statSync(path).size }];
    });
    const cursor = typeof body.cursor === "string" ? body.cursor : "";
    const directory = typeof body.directory === "string" ? body.directory.replace(/\/$/, "") : "";
    const matching = all.filter((file) => !directory || file.path.startsWith(directory + "/")).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const page = matching.filter((file) => file.path > cursor);
    const files = page.slice(0, 200);
    const result = { files, total: matching.length, truncated: page.length > 200, nextCursor: page.length > 200 ? files.at(-1)?.path : undefined };
    return json({ ok: true, ...result, result });
  }
  if (operation === "read") {
    if (!statSync(target, { throwIfNoEntry: false })?.isFile()) return json({ ok: false, error: `${relativePath || "That file"} is not in the hosted workspace.` }, 404);
    const content = readFileSync(target, "utf8");
    return json({ ok: true, path: relativePath, revision: fileRevision(content), content: content.slice(0, MAX_CONTENT), truncated: content.length > MAX_CONTENT, result: { revision: fileRevision(content), content: content.slice(0, MAX_CONTENT), truncated: content.length > MAX_CONTENT } });
  }
  if (operation === "write") {
    if (typeof body.content !== "string" || body.content.length > MAX_CONTENT) return json({ ok: false, error: "content is required and must be at most 1 MB." }, 400);
    const entry = statSync(target, { throwIfNoEntry: false });
    if (entry && !entry.isFile()) return json({ ok: false, error: "Choose a regular file." }, 400);
    const exists = Boolean(entry);
    const before = exists ? readFileSync(target, "utf8") : "";
    if ((body.expectedMissing === true && exists) || (body.expectedMissing !== true && (!exists || !reviewedFileMatches(before, body)))) {
      return json({ ok: false, error: "The file changed on disk. Review the current file before saving." }, 409);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body.content, { flag: body.expectedMissing ? "wx" : "w" });
    const saved = await (deps.save ?? saveWorkspaceFile)(ownerId, relativePath, body.content);
    if (!saved) return json({ ok: false, error: "The file was written on disk but was not saved to the account store. It will not survive a restart." }, 500);
    return json({ ok: true, path: relativePath, before, after: body.content, revision: fileRevision(body.content), result: { path: relativePath, before, after: body.content, revision: fileRevision(body.content) } });
  }
  if (operation === "search") {
    const query = typeof body.query === "string" ? body.query.slice(0, 200) : "";
    if (!query.trim()) return json({ ok: false, error: "Enter a search term." }, 400);
    const matches = readdirSync(root, { recursive: true }).flatMap((entry) => {
      const name = String(entry);
      const path = join(root, name);
      if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile() || blocked(name)) return [];
      const content = readFileSync(path, "utf8");
      return name.includes(query) || content.includes(query) ? [{ path: relative(root, path) }] : [];
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const cursor = typeof body.cursor === "string" ? body.cursor : "";
    const directory = typeof body.directory === "string" ? body.directory.replace(/\/$/, "") : "";
    const matching = matches.filter((item) => !directory || item.path.startsWith(directory + "/"));
    const page = matching.filter((item) => item.path > cursor);
    const result = { matches: page.slice(0, 100), total: matching.length, truncated: page.length > 100, nextCursor: page.length > 100 ? page[99]?.path : undefined };
    return json({ ok: true, ...result, result });
  }
  if ((operation === "rename" || operation === "delete") && body.confirm !== true) return json({ ok: false, error: "Explicit confirmation is required. Nothing changed." }, 400);
  if (operation === "rename") {
    const next = resolve(root, typeof body.to === "string" ? body.to.replace(/^\/+/, "") : "");
    if (!inside(root, next) || hasSymlink(root, next)) return json({ ok: false, error: "Destination is outside the hosted workspace." }, 400);
    if (blocked(relative(root, next)) || !statSync(target, { throwIfNoEntry: false })?.isFile() || lstatSync(target).isSymbolicLink()) return json({ ok: false, error: "Choose a regular file inside the workspace." }, 400);
    if (statSync(next, { throwIfNoEntry: false })) return json({ ok: false, error: "The destination file already exists." }, 409);
    const before = readFileSync(target, "utf8");
    if (typeof body.expectedRevision !== "string" || !reviewedFileMatches(before, body)) return json({ ok: false, error: "The file changed or its reviewed revision is missing. Read it before renaming." }, 409);
    mkdirSync(dirname(next), { recursive: true });
    renameSync(target, next);
    if (!await (deps.rename ?? renameWorkspaceFile)(ownerId, relativePath, relative(root, next))) return json({ ok: false, applied: "filesystem", durable: false, reconciliationRequired: true, reconciliation: { action: "rename", path: relativePath, to: relative(root, next), expectedRevision: body.expectedRevision }, path: relativePath, to: relative(root, next), error: "Renamed on disk, but account persistence failed. The account copy may still use the old path. Review both copies before retrying." }, 503);
    return json({ ok: true, path: relativePath, to: relative(root, next), revision: fileRevision(before) });
  }
  if (operation === "delete") {
    if (!statSync(target, { throwIfNoEntry: false })?.isFile() || lstatSync(target).isSymbolicLink()) return json({ ok: false, error: "File was not found." }, 404);
    if (typeof body.expectedRevision !== "string" || !reviewedFileMatches(readFileSync(target, "utf8"), body)) return json({ ok: false, error: "The file changed or its reviewed revision is missing. Read it before deleting." }, 409);
    rmSync(target);
    if (!await (deps.forget ?? forgetWorkspaceFile)(ownerId, relativePath)) return json({ ok: false, applied: "filesystem", durable: false, reconciliationRequired: true, reconciliation: { action: "delete", path: relativePath, expectedRevision: body.expectedRevision }, path: relativePath, error: "Deleted from disk, but account persistence failed. The account copy may remain. Review storage before retrying." }, 503);
    return json({ ok: true, path: relativePath });
  }
  return json({ ok: false, error: "Unsupported hosted file operation." }, 400);
}
