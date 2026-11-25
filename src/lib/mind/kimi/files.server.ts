import { getSql } from "../../db.ts";
import { accountFileOperation, machineRequired } from "./account-workspace.ts";
import { requireUserId } from "../../auth/verify.server";
import { assertSameOrigin } from "../connectors/oauth-csrf";
import { haltIsOn } from "../halt.server";
import { enqueueJob, listJobEvents, onlineAgents, readJob } from "../pc-pairing/store";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { adrianHostedWorkspace } from "./hosted/acp-client.ts";
import { branchHostedGit, commitHostedGit, initHostedGit, inspectHostedGit, listHostedCheckpoints, restoreHostedCheckpoint } from "./hosted/shell.server.ts";
import { forgetWorkspaceFile, renameWorkspaceFile, restoreWorkspaceFiles, saveWorkspaceFile } from "./persist.ts";

const MAX_CWD = 500;
const MAX_PATH = 1_000;
const MAX_CONTENT = 1_000_000;
const OPERATIONS = new Set(["list", "read", "write", "search", "rename", "delete"]);
const SECRET = /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i;

function blocked(relativePath: string): boolean {
  return relativePath.split("/").some((part) => part === ".." || part === ".git") || SECRET.test(relativePath);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

async function runHostedFileOperation(body: { operation?: unknown; path?: unknown; content?: unknown; query?: unknown; to?: unknown; confirm?: unknown; expectedContent?: unknown; expectedMissing?: unknown; expectedRevision?: unknown; workspace?: unknown }, ownerId: string): Promise<Response> {
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
  const root = adrianHostedWorkspace();
  const operation = operationName;
  const relativePath = typeof body.path === "string" ? body.path.replace(/^\/+/, "") : "";
  const target = resolve(root, relativePath);
  if (!inside(root, target)) return json({ ok: false, error: "Path is outside the hosted workspace." }, 400);
  if (relativePath && blocked(relativePath)) return json({ ok: false, error: "That path is secret or outside the hosted workspace. Nothing changed." }, 400);
  if (operation === "list") {
    await restoreWorkspaceFiles(ownerId, root);
    const all = readdirSync(root, { recursive: true }).flatMap((entry) => {
      const name = String(entry);
      const path = join(root, name);
      if (!statSync(path).isFile()) return [];
      const relativePath = relative(root, path);
      if (relativePath.split("/").includes(".git") || /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i.test(relativePath)) return [];
      return [{ path: relative(root, path), bytes: statSync(path).size }];
    });
    const files = all.slice(0, 200);
    return json({ ok: true, files, truncated: all.length > 200, total: all.length, result: { files, truncated: all.length > 200, total: all.length } });
  }
  if (operation === "read") {
    if (!statSync(target, { throwIfNoEntry: false })?.isFile()) return json({ ok: false, error: `${relativePath || "That file"} is not in the hosted workspace.` }, 404);
    const content = readFileSync(target, "utf8");
    return json({ ok: true, path: relativePath, content: content.slice(0, MAX_CONTENT), truncated: content.length > MAX_CONTENT, result: { content: content.slice(0, MAX_CONTENT), truncated: content.length > MAX_CONTENT } });
  }
  if (operation === "write") {
    if (typeof body.content !== "string" || body.content.length > MAX_CONTENT) return json({ ok: false, error: "content is required and must be at most 1 MB." }, 400);
    const exists = Boolean(statSync(target, { throwIfNoEntry: false }));
    const before = exists ? readFileSync(target, "utf8") : "";
    if ((body.expectedMissing && exists) || (typeof body.expectedContent === "string" && (!exists || before !== body.expectedContent))) {
      return json({ ok: false, error: "The file changed on disk. Review the current file before saving." }, 409);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body.content, { flag: body.expectedMissing ? "wx" : "w" });
    const saved = await saveWorkspaceFile(ownerId, relativePath, body.content);
    if (!saved) return json({ ok: false, error: "The file was written on disk but was not saved to the account store. It will not survive a restart." }, 500);
    return json({ ok: true, path: relativePath, before, after: body.content, result: { path: relativePath, before, after: body.content } });
  }
  if (operation === "search") {
    const query = typeof body.query === "string" ? body.query.slice(0, 200) : "";
    const matches = readdirSync(root, { recursive: true }).flatMap((entry) => {
      const name = String(entry);
      const path = join(root, name);
      if (!statSync(path).isFile()) return [];
      const content = readFileSync(path, "utf8");
      return name.includes(query) || content.includes(query) ? [{ path: relative(root, path) }] : [];
    }).slice(0, 100);
    return json({ ok: true, matches, result: { matches } });
  }
  if ((operation === "rename" || operation === "delete") && body.confirm !== true) return json({ ok: false, error: "Explicit confirmation is required. Nothing changed." }, 400);
  if (operation === "rename") {
    const next = resolve(root, typeof body.to === "string" ? body.to.replace(/^\/+/, "") : "");
    if (!inside(root, next)) return json({ ok: false, error: "Destination is outside the hosted workspace." }, 400);
    renameSync(target, next);
    await renameWorkspaceFile(ownerId, relativePath, relative(root, next));
    return json({ ok: true, path: relativePath, to: relative(root, next) });
  }
  if (operation === "delete") {
    rmSync(target);
    await forgetWorkspaceFile(ownerId, relativePath);
    return json({ ok: true, path: relativePath });
  }
  return json({ ok: false, error: "Unsupported hosted file operation." }, 400);
}

async function ownerIdFromRequest(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

export async function handleKimiFiles(request: Request): Promise<Response> {
  try {
    const ownerId = await ownerIdFromRequest(request);
    if (request.method === "POST") {
      const origin = assertSameOrigin(request);
      if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
      if (await haltIsOn(ownerId)) return json({ ok: false, error: "Emergency stop is on. No file operation was queued." }, 403);
      const body = (await request.json().catch(() => ({}))) as { operation?: unknown; cwd?: unknown; path?: unknown; content?: unknown; to?: unknown; query?: unknown; confirm?: unknown; expectedContent?: unknown; expectedMissing?: unknown; expectedRevision?: unknown; workspace?: unknown };
      const agents = onlineAgents(ownerId);
      const requested = body.workspace;
      if (requested !== undefined && (typeof requested !== "string" || !requested)) return json({ ok: false, error: "Invalid workspace." }, 400);
      const agent = requested === undefined ? agents[0] : agents.find((item) => item.id === requested);
      if (requested !== undefined && requested !== "hosted" && !agent) {
        return json({ ok: false, error: "The PC that owns this file is offline. Reconnect it to continue." }, 409);
      }
      if (!agent) {
        if (body.cwd && requested !== "hosted") return json({ ok: false, error: "Reconnect the PC that owns this workspace path." }, 409);
        const response = await runHostedFileOperation(body, ownerId);
        response.headers.set("X-Mind-Workspace", "hosted");
        return response;
      }
      const operation = typeof body.operation === "string" ? body.operation : "";
      if (!OPERATIONS.has(operation)) return json({ ok: false, error: "Unsupported file operation." }, 400);
      const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim().slice(0, MAX_CWD) : undefined;
      const path = typeof body.path === "string" ? body.path.slice(0, MAX_PATH) : undefined;
      const content = typeof body.content === "string" ? body.content : undefined;
      const to = typeof body.to === "string" ? body.to.slice(0, MAX_PATH) : undefined;
      const query = typeof body.query === "string" ? body.query.slice(0, 200) : undefined;
      if ((operation === "read" || operation === "write" || operation === "rename" || operation === "delete") && !path) return json({ ok: false, error: "path is required." }, 400);
      if (operation === "rename" && !to) return json({ ok: false, error: "to is required." }, 400);
      if (operation === "search" && !query) return json({ ok: false, error: "query is required." }, 400);
      if ((operation === "rename" || operation === "delete") && body.confirm !== true) return json({ ok: false, error: "Explicit confirmation is required. Nothing changed." }, 400);
      if (operation === "write" && (content === undefined || content.length > MAX_CONTENT)) return json({ ok: false, error: "content is required and must be at most 1 MB." }, 400);

      if ((body.expectedContent !== undefined || body.expectedMissing === true || body.expectedRevision !== undefined) && agent.fileProtocol !== 2) {
        return json({ ok: false, error: "Update the paired companion before changing a reviewed file." }, 409);
      }
      if ((operation === "rename" || operation === "delete") && typeof body.expectedRevision !== "string") {
        return json({ ok: false, error: "Read the file again before confirming this change." }, 409);
      }
      const job = enqueueJob({ ownerId, agentId: agent.id, kind: "file-op", command: `file:${operation}`, confirm: false, payload: { operation, cwd, path, content, to, query, expectedContent: body.expectedContent, expectedRevision: body.expectedRevision, expectedMissing: body.expectedMissing === true, confirm: body.confirm === true } });
      return json({ ok: true, jobId: job.id, workspace: agent.id, status: job.status, operation }, 202);
    }
    if (request.method === "GET") {
      const jobId = new URL(request.url).searchParams.get("jobId") || "";
      const job = readJob(jobId);
      if (!job || job.ownerId !== ownerId || job.kind !== "file-op") return json({ ok: false, error: "File operation not found." }, 404);
      return json({ ok: true, job: { id: job.id, status: job.status, output: job.output || "", error: job.error || "", createdAt: job.createdAt, updatedAt: job.updatedAt }, events: listJobEvents(ownerId, job.id) });
    }
    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
  }
}
