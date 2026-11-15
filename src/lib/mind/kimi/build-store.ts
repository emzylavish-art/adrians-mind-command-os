import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encryptSecret } from "../connectors/crypto.ts";

export type BuildProject = {
  id: string;
  ownerId: string;
  label: string;
  cwd: string;
  instructions: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BuildSessionMeta = {
  id: string;
  ownerId: string;
  jobId: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BuildProviderPublic = {
  id: string;
  label: string;
  provider: "moonshot";
  model: string;
  baseUrl: string;
  hasKey: boolean;
  runtimeUse: "not_injected";
  createdAt: string;
  updatedAt: string;
};

type ProviderRecord = BuildProviderPublic & { ownerId: string; keyCiphertext?: string };

type AuditRecord = { id: string; ownerId: string; action: string; detail: string; createdAt: string };

let directory = join(process.cwd(), ".data", "mind-build");

export function setBuildDirectory(next: string) {
  directory = next;
}

function ensure() {
  mkdirSync(directory, { recursive: true });
}

function readAll<T>(prefix: string): T[] {
  ensure();
  const out: T[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(join(directory, name), "utf8")) as T); } catch { /* ignore corrupt record */ }
  }
  return out;
}

function writeNamed(prefix: string, id: string, value: unknown) {
  ensure();
  if (!/^[a-z0-9_-]{8,80}$/i.test(id)) throw new Error("Invalid record id.");
  writeFileSync(join(directory, `${prefix}${id}.json`), JSON.stringify(value));
}

function id() {
  return randomBytes(12).toString("hex");
}

const LEGACY_WORKSPACE = "/tmp/adrian-build-workspace";

function durableWorkspace() {
  return process.env.ADRIAN_BUILD_WORKSPACE || join(process.cwd(), ".data", "adrian-build-workspace");
}

function rewriteLegacy(project: BuildProject): BuildProject {
  if (project.cwd !== LEGACY_WORKSPACE && project.label !== LEGACY_WORKSPACE) return project;
  const next: BuildProject = {
    ...project,
    cwd: project.cwd === LEGACY_WORKSPACE ? durableWorkspace() : project.cwd,
    label: project.label === LEGACY_WORKSPACE ? "Hosted workspace" : project.label,
    updatedAt: new Date().toISOString(),
  };
  writeNamed("project-", next.id, next);
  return next;
}

export function listProjects(ownerId: string): BuildProject[] {
  const items = readAll<BuildProject>("project-").filter((item) => item.ownerId === ownerId && !item.archived).map(rewriteLegacy).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const seen = new Set<string>();
  const unique: BuildProject[] = [];
  for (const item of items) {
    if (seen.has(item.cwd)) {
      item.archived = true;
      writeNamed("project-", item.id, item);
      continue;
    }
    seen.add(item.cwd);
    unique.push(item);
  }
  return unique;
}

export function saveProject(input: { ownerId: string; id?: string; label: string; cwd: string; instructions?: string }): BuildProject {
  const now = new Date().toISOString();
  const cwd = input.cwd.trim() === LEGACY_WORKSPACE ? durableWorkspace() : input.cwd;
  const label = input.label.trim() === LEGACY_WORKSPACE ? "Hosted workspace" : input.label;
  const existing = input.id ? readAll<BuildProject>("project-").find((item) => item.id === input.id && item.ownerId === input.ownerId) : undefined;
  const project: BuildProject = {
    id: existing?.id || id(),
    ownerId: input.ownerId,
    label: label.trim().slice(0, 80) || "Workspace",
    cwd: cwd.trim().slice(0, 500),
    instructions: (input.instructions || existing?.instructions || "").slice(0, 4_000),
    archived: false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!project.cwd) throw new Error("Workspace path is required.");
  writeNamed("project-", project.id, project);
  audit(input.ownerId, "project_save", project.id);
  return project;
}

export function archiveProject(ownerId: string, projectId: string): boolean {
  const project = readAll<BuildProject>("project-").find((item) => item.id === projectId && item.ownerId === ownerId);
  if (!project) return false;
  project.archived = true;
  project.updatedAt = new Date().toISOString();
  writeNamed("project-", project.id, project);
  audit(ownerId, "project_archive", project.id);
  return true;
}

export function listSessions(ownerId: string): BuildSessionMeta[] {
  return readAll<BuildSessionMeta>("session-").filter((item) => item.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveSessionMeta(input: { ownerId: string; jobId: string; name?: string; archived?: boolean }): BuildSessionMeta {
  const now = new Date().toISOString();
  const existing = readAll<BuildSessionMeta>("session-").find((item) => item.ownerId === input.ownerId && item.jobId === input.jobId);
  const meta: BuildSessionMeta = {
    id: existing?.id || id(),
    ownerId: input.ownerId,
    jobId: input.jobId,
    name: (input.name || existing?.name || "Build session").trim().slice(0, 80),
    archived: input.archived ?? existing?.archived ?? false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  writeNamed("session-", meta.id, meta);
  audit(input.ownerId, "session_meta", meta.jobId);
  return meta;
}

export function listProviders(ownerId: string): BuildProviderPublic[] {
  return readAll<ProviderRecord>("provider-").filter((item) => item.ownerId === ownerId).map(publicProvider);
}

export function saveProvider(input: { ownerId: string; label?: string; model: string; baseUrl?: string; apiKey?: string }): BuildProviderPublic {
  const model = input.model.trim().slice(0, 120);
  if (!model) throw new Error("model is required.");
  const baseUrl = (input.baseUrl || "https://api.moonshot.ai/v1").trim().slice(0, 300);
  if (!baseUrl.startsWith("https://")) throw new Error("Provider base URL must use HTTPS.");
  let keyCiphertext: string | undefined;
  if (input.apiKey?.trim()) keyCiphertext = encryptSecret(input.apiKey.trim()).ciphertext;
  const now = new Date().toISOString();
  const record: ProviderRecord = {
    id: id(),
    ownerId: input.ownerId,
    label: (input.label || "Moonshot").trim().slice(0, 80),
    provider: "moonshot",
    model,
    baseUrl,
    hasKey: Boolean(keyCiphertext),
    runtimeUse: "not_injected",
    keyCiphertext,
    createdAt: now,
    updatedAt: now,
  };
  writeNamed("provider-", record.id, record);
  audit(input.ownerId, "provider_save", record.id);
  return publicProvider(record);
}

export function audit(ownerId: string, action: string, detail: string) {
  const record: AuditRecord = { id: id(), ownerId, action: action.slice(0, 80), detail: detail.slice(0, 300), createdAt: new Date().toISOString() };
  writeNamed("audit-", record.id, record);
}

export function listAudit(ownerId: string): AuditRecord[] {
  return readAll<AuditRecord>("audit-").filter((item) => item.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

function publicProvider(record: ProviderRecord): BuildProviderPublic {
  return { id: record.id, label: record.label, provider: record.provider, model: record.model, baseUrl: record.baseUrl, hasKey: record.hasKey, runtimeUse: "not_injected", createdAt: record.createdAt, updatedAt: record.updatedAt };
}

export function providerKeyLeaks(value: unknown): boolean {
  return JSON.stringify(value).includes("keyCiphertext") || JSON.stringify(value).includes("apiKey");
}
