import { delegateGrant, issueGrant, revokeGrant, useGrant } from "./delegated-authority.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AuthorityGrant } from "./delegated-authority.ts";
import { hashBody, packTask, readInformationLog, recordInformation, registerAdapter, releaseRecord, replaceInformationLog, storeRecord, type Consent, type InformationEvent } from "./frontier-2031.ts";
import type { FrontierAdapter } from "./frontier-2031.ts";
import { dryRun } from "./reversibility.ts";
import { blueprintReply, type AttemptRecord, type PackedTaskRecord, type SourceRecord } from "./blueprint-surface.ts";

export type Obligation = { id: string; text: string; executed: false };

const obligations: Obligation[] = [];
let nextId = 1;
let crisis = false;
const notes: { id: string; body: string; hash: string }[] = [];
const consents: Consent[] = [];
const skills: string[] = [];
const workflows: string[] = [];
const approvals = new Set<string>();
const adapters: FrontierAdapter[] = [];
let language = "English";
let textSize = "normal";
const grants: AuthorityGrant[] = [];
const tasks: PackedTaskRecord[] = [];
const sources: SourceRecord[] = [];
const attempts: AttemptRecord[] = [];
let storeFile: string | null = null;

function persist(): void {
  if (!storeFile) return;
  mkdirSync(path.dirname(storeFile), { recursive: true });
  writeFileSync(storeFile, JSON.stringify({ nextId, obligations, notes, consents, grants, skills, workflows, crisis, language, textSize, approvals: [...approvals], adapters, tasks, sources, attempts, events: readInformationLog() }));
}

export function setLocalCapabilityFile(file: string): void {
  storeFile = file;
  resetLocalCapabilities();
}

export function ensureLocalCapabilityFile(file: string): void {
  if (storeFile === file) return;
  storeFile = file;
  if (existsSync(file)) reloadLocalCapabilities();
  else persist();
}

export function reloadLocalCapabilities(): void {
  if (!storeFile) return;
  const saved = JSON.parse(readFileSync(storeFile, "utf8")) as { nextId: number; obligations: Obligation[]; notes: typeof notes; consents: Consent[]; grants: AuthorityGrant[]; skills?: string[]; workflows?: string[]; crisis?: boolean; language?: string; textSize?: string; approvals?: string[]; adapters?: FrontierAdapter[]; tasks?: PackedTaskRecord[]; sources?: SourceRecord[]; attempts?: AttemptRecord[]; events?: InformationEvent[] };
  nextId = saved.nextId;
  obligations.splice(0, obligations.length, ...saved.obligations);
  notes.splice(0, notes.length, ...saved.notes);
  consents.splice(0, consents.length, ...saved.consents);
  grants.splice(0, grants.length, ...saved.grants);
  skills.splice(0, skills.length, ...(saved.skills ?? []));
  workflows.splice(0, workflows.length, ...(saved.workflows ?? []));
  crisis = saved.crisis === true;
  language = saved.language || "English";
  textSize = saved.textSize || "normal";
  approvals.clear();
  for (const name of saved.approvals ?? []) approvals.add(name);
  adapters.splice(0, adapters.length, ...(saved.adapters ?? []));
  tasks.splice(0, tasks.length, ...(saved.tasks ?? []));
  sources.splice(0, sources.length, ...(saved.sources ?? []));
  attempts.splice(0, attempts.length, ...(saved.attempts ?? []));
  replaceInformationLog(saved.events ?? []);
  for (const adapter of adapters) registerAdapter(adapter);
}

export function resetLocalCapabilities(): void {
  obligations.length = 0;
  nextId = 1;
  crisis = false;
  notes.length = 0;
  consents.length = 0;
  skills.length = 0;
  workflows.length = 0;
  approvals.clear();
  adapters.length = 0;
  language = "English";
  textSize = "normal";
  grants.length = 0;
  tasks.length = 0;
  sources.length = 0;
  attempts.length = 0;
  replaceInformationLog([]);
  persist();
}

export function runLocalCommand(text: string): string | null {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (lower === "list capabilities") {
    return [
      "Available here: delegated grants, obligations, task envelope, dry-run reversibility, purchase refusal, wipe refusal, reply actions.",
      "Not verified on a device: screen, mouse finding, headset, sensors, backup restore.",
    ].join(" ");
  }
  if (lower === "list obligations") {
    return obligations.length ? obligations.map((item) => `${item.id}: ${item.text}`).join("; ") : "No obligations are listed.";
  }
  const added = raw.match(/^add obligation\s+(.{1,180})$/i);
  if (added) {
    const item: Obligation = { id: `o${nextId++}`, text: added[1].trim(), executed: false };
    obligations.push(item);
    persist();
    return `Listed ${item.id}. It was not filed or performed.`;
  }
  const packed = raw.match(/^pack task\s+(.{1,180})$/i);
  if (packed) {
    const id = `t${nextId++}`;
    const envelope = packTask({ version: 1, id, goal: packed[1].trim(), steps: [] });
    tasks.push({ id, goal: packed[1].trim(), envelope });
    persist();
    return envelope;
  }
  if (lower === "check grant") {
    const parent = issueGrant({ id: "owner", holder: "adrian", scopes: ["files"], expiresAt: Date.now() + 1000, canDelegate: true });
    const child = delegateGrant(parent, { id: "bot", holder: "bot", scopes: ["files"], expiresAt: parent.expiresAt, canDelegate: false }, Date.now());
    const used = useGrant(child, "files", Date.now());
    revokeGrant(child);
    const after = useGrant(child, "files", Date.now());
    grants.push(child);
    persist();
    return `Grant was ${used.reason}, then ${after.reason}. No identity network was contacted.`;
  }
  if (lower === "dry run rename") {
    const result = dryRun({ id: "local", action: "rename file", reversible: true, permitted: true });
    return `${result.reason} Executed: ${result.executed}.`;
  }
  const stored = raw.match(/^store note\s+(.{1,180})$/i);
  if (stored) {
    const record = storeRecord({ id: `n${nextId++}`, classification: "personal", body: stored[1].trim(), source: "owner", licence: "owner" });
    notes.push({ id: record.id, body: record.body, hash: record.hash });
    persist();
    return `Stored ${record.id}. It is written when a store file is set.`;
  }
  if (lower === "inspect information") {
    return notes.length ? notes.map((note) => `${note.id} stored hash ${note.hash}`).join("; ") : "Nothing is stored.";
  }
  if (lower === "list grants") {
    return grants.length ? grants.map((grant) => `${grant.id} ${grant.revoked ? "revoked" : "in force"}`).join("; ") : "No grants are stored.";
  }
  const consent = raw.match(/^grant consent\s+(.{1,80})$/i);
  if (consent) {
    const recordId = notes.at(-1)?.id;
    if (!recordId) return "Store a note before granting consent.";
    consents.push({ id: `c${nextId++}`, recordId, purpose: consent[1].trim(), recipient: "owner", expiresAt: Date.now() + 60_000, revoked: false });
    persist();
    return `Consent granted for ${recordId}.`;
  }
  const release = raw.match(/^release note\s+(\S+)\s+for\s+(.{1,80})$/i);
  if (release) {
    const note = notes.find((item) => item.id === release[1]);
    if (!note) return "That note is not stored.";
    const record = { id: note.id, owner: "adrian" as const, classification: "personal" as const, body: note.body, source: "owner", hash: note.hash, licence: "owner" };
    const grant = consents.find((item) => item.recordId === note.id && item.purpose === release[2].trim() && !item.revoked) ?? null;
    const result = releaseRecord(record, grant, release[2].trim(), Date.now());
    return result.released ? result.body : `Refused: ${result.reason}.`;
  }
  if (lower === "crisis on") {
    crisis = true;
    persist();
    return "Crisis mode is on. Consequential actions stay blocked. No emergency service was called.";
  }
  if (lower === "crisis off") {
    crisis = false;
    persist();
    return "Crisis mode is off.";
  }
  if (lower === "crisis status") return crisis ? "Crisis mode is on." : "Crisis mode is off.";
  const adapter = raw.match(/^register adapter\s+(identity|finance|spatial|wearable|robotics|input|model-context)\s+(.{1,80})$/i);
  if (adapter) {
    const saved = registerAdapter({ id: `${adapter[1]}-${nextId++}`, kind: adapter[1].toLowerCase() as "identity", version: 1, provider: adapter[2].trim() });
    adapters.push(saved);
    persist();
    return `Registered ${saved.id}. It was not called.`;
  }
  if (lower === "list adapters") return adapters.length ? adapters.map((item) => `${item.id} ${item.provider}`).join("; ") : "No adapters are registered.";
  const lang = raw.match(/^set language\s+([A-Za-z][A-Za-z -]{1,40})$/i);
  if (lang) {
    language = lang[1].trim();
    persist();
    return `Language preference is ${language}. No translation was performed.`;
  }
  const size = raw.match(/^set text size\s+(normal|large)$/i);
  if (size) {
    textSize = size[1].toLowerCase();
    persist();
    return `Text size preference is ${textSize}.`;
  }
  const skill = raw.match(/^add skill\s+(.{1,80})$/i);
  if (skill) {
    skills.push(skill[1].trim());
    persist();
    return `Skill noted: ${skill[1].trim()}. This is not a completed course.`;
  }
  if (lower === "list skills") return skills.length ? skills.join(", ") : "No skills are noted.";
  const workflow = raw.match(/^add workflow\s+(.{1,180})$/i);
  if (workflow) {
    workflows.push(workflow[1].trim());
    persist();
    return "Workflow saved as a description. It was not scheduled or run.";
  }
  const simulated = raw.match(/^simulate\s+(.{1,180})$/i);
  if (simulated) {
    const result = dryRun({ id: "sim", action: simulated[1].trim(), reversible: false, permitted: false });
    return `Simulation only. ${result.reason}. Nothing ran.`;
  }
  const approval = raw.match(/^approve as\s+([A-Za-z][A-Za-z -]{1,40})$/i);
  if (approval) {
    approvals.add(approval[1].trim().toLowerCase());
    persist();
    return approvals.has("adrian") && approvals.has("other")
      ? "Both names are recorded. Nothing was sent."
      : `Recorded ${approval[1].trim()}. Waiting for every required person.`;
  }
  if (lower === "list approvals") return approvals.size ? [...approvals].join(", ") : "No approvals are recorded.";
  if (lower === "list workflows") return workflows.length ? workflows.join("; ") : "No workflows are saved.";
  if (lower === "show preferences") return `Language ${language}. Text size ${textSize}. Hash check ${hashBody("adrian")}.`;
  const event = raw.match(/^record event\s+(store|access|share|export|delete)\s+(\S+)\s+(.{1,160})$/i);
  if (event) {
    const saved = recordInformation({ action: event[1].toLowerCase() as "store", recordId: event[2], actor: "adrian", at: Date.now(), detail: event[3].trim() });
    persist();
    return `Event ${saved.action} recorded for ${saved.recordId}. Nothing was sent.`;
  }
  if (lower === "list events") {
    const events = readInformationLog();
    return events.length ? events.map((item) => `${item.recordId} ${item.detail}`).join("; ") : "No events are stored.";
  }
  const blueprint = blueprintReply(raw, { tasks, sources, attempts });
  if (blueprint) {
    persist();
    return blueprint;
  }
  return null;
}
