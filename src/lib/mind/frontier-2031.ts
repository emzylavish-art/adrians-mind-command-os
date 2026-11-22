export type FrontierState = "gated" | "missing";

export type FrontierCapability = {
  id: string;
  group: "identity" | "operations" | "rights" | "spatial" | "creation" | "trust";
  state: FrontierState;
  proof: string;
};

export const FRONTIER_CAPABILITIES: readonly FrontierCapability[] = [
  { id: "owner-identity", group: "identity", state: "gated", proof: "Local owner record only. No external identity provider is connected." },
  { id: "agent-identity", group: "identity", state: "gated", proof: "Agents get local ids. No outside verifier accepts them yet." },
  { id: "delegated-authority", group: "identity", state: "gated", proof: "A child grant cannot outlive or widen its parent. No outside agent was presented with one." },
  { id: "permission-constitution", group: "identity", state: "gated", proof: "Money, contracts, travel, and data release stay owner-approved." },
  { id: "expiring-credentials", group: "identity", state: "gated", proof: "Expired and revoked grants fail closed." },
  { id: "external-verification", group: "identity", state: "missing", proof: "No external agent network was called." },
  { id: "procurement", group: "operations", state: "missing", proof: "A purchase is refused. No merchant or payment provider is connected." },
  { id: "negotiation", group: "operations", state: "missing", proof: "Terms can be recorded as a proposal. Nothing is sent or agreed." },
  { id: "financial-operations", group: "operations", state: "missing", proof: "No bank, card, or ledger movement exists." },
  { id: "contracts", group: "operations", state: "missing", proof: "An obligation can be listed. It cannot be signed or filed." },
  { id: "invoice-reconciliation", group: "operations", state: "missing", proof: "No invoice source is connected." },
  { id: "refunds", group: "operations", state: "missing", proof: "A refund request is refused until a verified provider exists." },
  { id: "administration", group: "operations", state: "missing", proof: "No government or account office is connected." },
  { id: "travel", group: "operations", state: "missing", proof: "No booking provider is connected." },
  { id: "stakeholders", group: "operations", state: "missing", proof: "No contact graph or outreach path was added." },
  { id: "data-vault", group: "rights", state: "gated", proof: "Records stay in memory for the process. They are not a durable vault and were not stored on the laptop." },
  { id: "access-broker", group: "rights", state: "gated", proof: "Release requires a matching, unexpired consent grant." },
  { id: "privacy-firewall", group: "rights", state: "gated", proof: "Outbound release is blocked unless the purpose is on the allow list and consent exists." },
  { id: "consent", group: "rights", state: "gated", proof: "Consent is purpose-scoped, expiring, and revocable." },
  { id: "provenance", group: "rights", state: "gated", proof: "A record keeps its source and a content hash. No external notary exists." },
  { id: "integrity", group: "rights", state: "gated", proof: "A changed body fails its stored hash. This is not a deception detector." },
  { id: "legacy", group: "rights", state: "gated", proof: "Ownership can be recorded. No transfer or estate filing is executed." },
  { id: "licensing", group: "rights", state: "gated", proof: "A licence note can be attached. No registry is contacted." },
  { id: "information-inspection", group: "rights", state: "gated", proof: "Store, access, share, export, and delete events are listed in process memory. They were not shown on the laptop." },
  { id: "spatial-presentation", group: "spatial", state: "missing", proof: "No headset or spatial display is connected." },
  { id: "mixed-reality", group: "spatial", state: "missing", proof: "No augmented or mixed-reality adapter answered." },
  { id: "environment-control", group: "spatial", state: "missing", proof: "No room, light, or climate controller is connected." },
  { id: "sensors", group: "spatial", state: "missing", proof: "No sensor returned a reading." },
  { id: "real-world-services", group: "spatial", state: "missing", proof: "No physical service provider is connected." },
  { id: "wearables", group: "spatial", state: "missing", proof: "No wearable or ambient device is connected." },
  { id: "neural-input", group: "spatial", state: "missing", proof: "No neural or non-traditional input device is connected. None is simulated." },
  { id: "creative-production", group: "creation", state: "missing", proof: "No production studio or render pipeline is connected." },
  { id: "source-assets", group: "creation", state: "gated", proof: "A source file can be recorded with its licence and hash. The file itself is not stored here." },
  { id: "modelling-3d", group: "creation", state: "missing", proof: "No 3D or CAD application is driven." },
  { id: "manufacturing", group: "creation", state: "missing", proof: "No machine or manufacturer is connected." },
  { id: "research-lab", group: "creation", state: "missing", proof: "No experiment runner or instrument is connected." },
  { id: "education", group: "creation", state: "missing", proof: "No course or skill ledger write was added." },
  { id: "accessibility", group: "creation", state: "missing", proof: "No device-specific accessibility adapter was detected." },
  { id: "multilingual", group: "creation", state: "missing", proof: "No new translation engine was added in this pass." },
  { id: "cyber-defence", group: "trust", state: "missing", proof: "No live defence centre or fraud desk is connected. No attack procedure was added." },
  { id: "external-trust", group: "trust", state: "gated", proof: "An unknown external agent is refused. No outside trust network was queried." },
  { id: "policy-compliance", group: "trust", state: "gated", proof: "Consequential actions still fail closed against the constitution." },
  { id: "disaster-recovery", group: "trust", state: "missing", proof: "No backup target or restore was run." },
  { id: "resource-scheduler", group: "trust", state: "missing", proof: "No infrastructure scheduler is connected." },
  { id: "emergency-mode", group: "trust", state: "gated", proof: "Crisis mode blocks consequential actions. It does not call emergency services. The existing emergency stop still belongs to the owner." },
  { id: "agent-accountability", group: "trust", state: "gated", proof: "A local note can record what an agent attempted. It does not replace the existing execution ledger." },
  { id: "portable-task", group: "trust", state: "gated", proof: "A versioned task envelope can be written. It is not sent to another model or device." },
  { id: "action-receipt", group: "trust", state: "gated", proof: "Durable receipts already live in mind_receipt. This gate does not open a second receipt store." },
  { id: "obligation-ledger", group: "trust", state: "gated", proof: "An obligation can be listed. It cannot be performed or filed." },
  { id: "service-contract", group: "trust", state: "gated", proof: "A service must name its inputs and outputs before it can be called. No marketplace was contacted." },
  { id: "reversibility", group: "trust", state: "gated", proof: "An irreversible action is refused unless the owner marks it approved. No rollback target is connected." },
  { id: "policy-simulator", group: "trust", state: "gated", proof: "A policy check is a dry run. It does not execute the action." },
  { id: "agent-marketplace", group: "trust", state: "missing", proof: "No external agent marketplace is connected." },
  { id: "shared-authority", group: "trust", state: "gated", proof: "Two named people must both approve. No second person was contacted." },
  { id: "versioned-adapter", group: "trust", state: "gated", proof: "An adapter can be registered by kind and version. Registration does not call the provider, and the product is not bound to one." },
];

export type Authority = {
  id: string;
  holder: string;
  scopes: string[];
  expiresAt: number;
  revoked: boolean;
  parentId: string | null;
  canDelegate: boolean;
};

export type Constitution = {
  owner: "adrian";
  consequential: "owner-approval";
  financialExecute: false;
  externalRepresent: false;
  dataRelease: "consent-required";
};

export const CONSTITUTION: Constitution = {
  owner: "adrian",
  consequential: "owner-approval",
  financialExecute: false,
  externalRepresent: false,
  dataRelease: "consent-required",
};

const CONSEQUENTIAL = new Set([
  "procurement",
  "financial-operations",
  "contracts",
  "refunds",
  "travel",
  "administration",
  "external-representation",
]);

export function issueAuthority(input: {
  id: string;
  holder: string;
  scopes: string[];
  expiresAt: number;
  canDelegate?: boolean;
}): Authority {
  return {
    id: input.id,
    holder: input.holder,
    scopes: [...new Set(input.scopes)],
    expiresAt: input.expiresAt,
    revoked: false,
    parentId: null,
    canDelegate: input.canDelegate === true,
  };
}

export function delegateAuthority(parent: Authority, child: Omit<Authority, "parentId" | "revoked">, now: number): Authority {
  if (parent.revoked || parent.expiresAt <= now || !parent.canDelegate) {
    throw new Error("Parent cannot delegate.");
  }
  if (child.expiresAt > parent.expiresAt) throw new Error("A child grant cannot outlive its parent.");
  if (child.canDelegate && !parent.canDelegate) throw new Error("Delegation right was not inherited.");
  const widened = child.scopes.some((scope) => !parent.scopes.includes(scope));
  if (widened) throw new Error("A child grant cannot widen its parent.");
  return { ...child, scopes: [...new Set(child.scopes)], revoked: false, parentId: parent.id };
}

export function verifyAuthority(grant: Authority, scope: string, now: number): { ok: boolean; reason: string } {
  if (grant.revoked) return { ok: false, reason: "revoked" };
  if (grant.expiresAt <= now) return { ok: false, reason: "expired" };
  if (!grant.scopes.includes(scope)) return { ok: false, reason: "scope" };
  if (CONSEQUENTIAL.has(scope) && !CONSTITUTION.financialExecute && scope !== "contracts") {
    return { ok: false, reason: "constitution refuses execution" };
  }
  if (scope === "contracts" || scope === "external-representation") {
    return { ok: false, reason: "constitution requires owner approval" };
  }
  return { ok: true, reason: "in force" };
}

export type VaultRecord = {
  id: string;
  owner: "adrian";
  classification: "personal" | "sensitive";
  body: string;
  source: string;
  hash: string;
  licence: string | null;
};

export type Consent = {
  id: string;
  recordId: string;
  purpose: string;
  recipient: string;
  expiresAt: number;
  revoked: boolean;
};

export function hashBody(body: string): string {
  let value = 2166136261;
  for (let i = 0; i < body.length; i += 1) {
    value ^= body.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}

export function storeRecord(input: Omit<VaultRecord, "owner" | "hash">): VaultRecord {
  return { ...input, owner: "adrian", hash: hashBody(input.body) };
}

export function recordIntact(record: VaultRecord): boolean {
  return record.hash === hashBody(record.body);
}

export function releaseRecord(record: VaultRecord, consent: Consent | null, purpose: string, now: number): { released: false; reason: string } | { released: true; body: string } {
  if (!recordIntact(record)) return { released: false, reason: "integrity" };
  if (!consent || consent.revoked || consent.recordId !== record.id || consent.purpose !== purpose || consent.expiresAt <= now) {
    return { released: false, reason: "consent" };
  }
  if (CONSTITUTION.dataRelease !== "consent-required") return { released: false, reason: "firewall" };
  return { released: true, body: record.body };
}

export function proposeOperation(kind: string): { executed: false; reason: string } {
  return { executed: false, reason: `${kind} is not connected. Nothing was purchased, signed, booked, or sent.` };
}

export type InformationEvent = {
  action: "store" | "access" | "share" | "export" | "delete";
  recordId: string;
  actor: string;
  at: number;
  detail: string;
};

const informationLog: InformationEvent[] = [];

export function recordInformation(event: InformationEvent): InformationEvent {
  const stored = { ...event, detail: redactSecrets(event.detail) };
  informationLog.push(stored);
  return stored;
}

export function inspectInformation(): readonly InformationEvent[] {
  return informationLog;
}

export function clearInformationLog(): void {
  informationLog.length = 0;
}
export function readInformationLog(): InformationEvent[] {
  return informationLog.map((event) => ({ ...event }));
}
export function replaceInformationLog(events: readonly InformationEvent[]): void {
  informationLog.splice(0, informationLog.length, ...events.map((event) => ({ ...event, detail: redactSecrets(event.detail) })));
}

export type ConnectedDevice = { id: string; kind: "spatial" | "sensor" | "wearable" | "environment" };

export function detectCapability(id: string, devices: readonly ConnectedDevice[] = []): { present: boolean; reason: string } {
  const known = FRONTIER_CAPABILITIES.find((item) => item.id === id);
  if (!known) return { present: false, reason: "unknown" };
  const matched = devices.some((device) => device.kind === "spatial" && (id === "spatial-presentation" || id === "mixed-reality"))
    || devices.some((device) => device.kind === "sensor" && id === "sensors")
    || devices.some((device) => device.kind === "wearable" && id === "wearables")
    || devices.some((device) => device.kind === "environment" && id === "environment-control");
  if (!matched) return { present: false, reason: "no supported device answered" };
  return { present: true, reason: "a named device is connected; no reading was taken" };
}

export function evaluateExternalAgent(input: { known: boolean; revoked: boolean }): { trusted: false; reason: string } | { trusted: true; reason: string } {
  if (!input.known || input.revoked) return { trusted: false, reason: "refused" };
  return { trusted: true, reason: "listed by the owner; no outside network was queried" };
}

export type SourceAsset = { id: string; path: string; licence: string; hash: string };

export function registerSource(input: { id: string; path: string; licence: string; body: string }): SourceAsset {
  if (!input.licence.trim()) throw new Error("A source needs a licence.");
  return { id: input.id, path: input.path, licence: input.licence, hash: hashBody(input.body) };
}

let crisis = false;

export function setCrisisMode(on: boolean): boolean {
  crisis = on;
  return crisis;
}

export function crisisBlocks(kind: string): { blocked: boolean; reason: string } {
  if (!crisis) return { blocked: false, reason: "crisis mode is off" };
  if (CONSEQUENTIAL.has(kind) || kind === "external-representation") {
    return { blocked: true, reason: "crisis mode blocks this. No emergency service was called." };
  }
  return { blocked: false, reason: "not consequential" };
}

export type AccountabilityNote = { agentId: string; attempted: string; ok: boolean; at: number };

const accountability: AccountabilityNote[] = [];

export function noteAgentAttempt(note: AccountabilityNote): AccountabilityNote {
  accountability.push(note);
  return note;
}

export function agentAttempts(agentId: string): readonly AccountabilityNote[] {
  return accountability.filter((note) => note.agentId === agentId);
}

export type PortableTask = { version: 1; id: string; goal: string; steps: string[] };

export function packTask(task: PortableTask): string {
  if (task.version !== 1 || !task.goal.trim()) throw new Error("Task envelope is incomplete.");
  return JSON.stringify(task);
}

export type Obligation = { id: string; text: string; dueAt: number; executed: false };

export function listObligation(input: Omit<Obligation, "executed">): Obligation {
  return { ...input, executed: false };
}

export function callService(contract: { name: string; inputs: string[]; outputs: string[] } | null): { called: false; reason: string } {
  if (!contract || contract.inputs.length === 0 || contract.outputs.length === 0) {
    return { called: false, reason: "service contract is incomplete" };
  }
  return { called: false, reason: `${contract.name} was not called. No marketplace is connected.` };
}

export function allowIrreversible(ownerApproved: boolean): { allowed: boolean; reason: string } {
  if (!ownerApproved) return { allowed: false, reason: "irreversible action needs owner approval" };
  return { allowed: false, reason: "approved only as a record. No rollback target is connected, so it still does not run." };
}

export function simulatePolicy(kind: string): { executed: false; wouldRefuse: boolean; reason: string } {
  const refused = CONSEQUENTIAL.has(kind) || kind === "external-representation";
  return { executed: false, wouldRefuse: refused, reason: refused ? "constitution refuses execution" : "not consequential" };
}

export function sharedDecision(approvals: Record<string, boolean>, required: string[]): { allowed: boolean; reason: string } {
  const missing = required.filter((person) => approvals[person] !== true);
  if (missing.length > 0) return { allowed: false, reason: `waiting for ${missing.join(", ")}` };
  return { allowed: false, reason: "both approved the record only. Nothing was sent." };
}

const SECRET = /(sk-|xai-|Bearer\s+)[A-Za-z0-9._-]{6,}/gi;

export function redactSecrets(text: string): string {
  return text.replace(SECRET, "[redacted]");
}

export type CapabilityClass = "planned" | "available" | "verified";

export function classifyCapability(id: string): CapabilityClass {
  const item = FRONTIER_CAPABILITIES.find((entry) => entry.id === id);
  if (!item || item.state === "missing") return "planned";
  return "available";
}

export function claimVerified(id: string): { verified: false; reason: string } {
  return { verified: false, reason: `${id} has no external observation. A unit test is not a live integration.` };
}

export function recordConsequential(input: { kind: string; actor: string; detail: string; at: number }): { executed: false; provenance: InformationEvent } {
  const provenance = recordInformation({
    action: "access",
    recordId: input.kind,
    actor: input.actor,
    at: input.at,
    detail: input.detail,
  });
  return { executed: false, provenance };
}

export function withdrawPermission(grant: Authority, at: number): Authority {
  grant.revoked = true;
  recordInformation({ action: "delete", recordId: grant.id, actor: "adrian", at, detail: "permission withdrawn" });
  return grant;
}

export function deleteRecord(recordId: string, at: number): { durableWipe: false; event: InformationEvent } {
  const event = recordInformation({ action: "delete", recordId, actor: "adrian", at, detail: "process copy marked deleted" });
  return { durableWipe: false, event };
}

export type AdapterKind = "identity" | "finance" | "spatial" | "wearable" | "robotics" | "input" | "model-context";

export type FrontierAdapter = {
  id: string;
  kind: AdapterKind;
  version: 1;
  provider: string;
};

const adapters: FrontierAdapter[] = [];

export function registerAdapter(adapter: FrontierAdapter): FrontierAdapter {
  if (adapter.version !== 1 || !adapter.provider.trim()) throw new Error("Adapter contract is incomplete.");
  const duplicate = adapters.find((item) => item.id === adapter.id);
  if (duplicate) return duplicate;
  adapters.push(adapter);
  return adapter;
}

export function listAdapters(kind?: AdapterKind): readonly FrontierAdapter[] {
  return kind ? adapters.filter((item) => item.kind === kind) : adapters;
}

export function runAdapter(id: string, payload: string): { ran: false; reason: string; payload: string } {
  const adapter = adapters.find((item) => item.id === id);
  const safe = redactSecrets(payload);
  if (!adapter) return { ran: false, reason: "no adapter is registered", payload: safe };
  return { ran: false, reason: `${adapter.provider} v${adapter.version} is registered only. It was not called.`, payload: safe };
}

const CONSEQUENTIAL_SPEECH = /\b(buy|purchase|book (?:a |my )?(?:flight|hotel)|sign (?:the |a )?contract|pay (?:the |an )?invoice|refund)\b/i;

export function consequentialSpeechRefusal(text: string): string | null {
  if (!CONSEQUENTIAL_SPEECH.test(text)) return null;
  recordConsequential({ kind: "procurement", actor: "speak", detail: text.slice(0, 160), at: Date.now() });
  return "Adrian refused that. Nothing was purchased, signed, booked, or sent.";
}
