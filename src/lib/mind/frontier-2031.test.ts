import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearInformationLog,
  callService,
  CONSTITUTION,
  crisisBlocks,
  detectCapability,
  delegateAuthority,
  evaluateExternalAgent,
  FRONTIER_CAPABILITIES,
  inspectInformation,
  issueAuthority,
  listObligation,
  noteAgentAttempt,
  packTask,
  proposeOperation,
  recordIntact,
  recordInformation,
  registerSource,
  releaseRecord,
  setCrisisMode,
  sharedDecision,
  simulatePolicy,
  storeRecord,
  verifyAuthority,
  allowIrreversible,
  agentAttempts,
  claimVerified,
  classifyCapability,
  deleteRecord,
  recordConsequential,
  redactSecrets,
  registerAdapter,
  runAdapter,
  withdrawPermission,
} from "./frontier-2031.ts";

const now = 1_000;

describe("2031 frontier gates", () => {
  it("refuses a wider or longer child grant", () => {
    const parent = issueAuthority({ id: "owner", holder: "adrian", scopes: ["files"], expiresAt: 2_000, canDelegate: true });
    assert.throws(() => delegateAuthority(parent, { id: "bot", holder: "bot", scopes: ["files", "money"], expiresAt: 1_500, canDelegate: false }, now));
    assert.throws(() => delegateAuthority(parent, { id: "bot", holder: "bot", scopes: ["files"], expiresAt: 3_000, canDelegate: false }, now));
  });

  it("fails closed when a grant expires or is revoked", () => {
    const grant = issueAuthority({ id: "a", holder: "bot", scopes: ["files"], expiresAt: 1_500 });
    assert.equal(verifyAuthority(grant, "files", 1_500).ok, false);
    grant.revoked = true;
    assert.equal(verifyAuthority(grant, "files", 1_200).reason, "revoked");
  });

  it("does not execute money, travel, or a contract", () => {
    assert.equal(CONSTITUTION.financialExecute, false);
    const grant = issueAuthority({ id: "a", holder: "bot", scopes: ["procurement", "travel", "contracts"], expiresAt: 2_000 });
    assert.equal(verifyAuthority(grant, "procurement", now).ok, false);
    assert.equal(proposeOperation("procurement").executed, false);
    assert.match(proposeOperation("travel").reason, /Nothing was purchased/);
  });

  it("releases a record only with matching consent and an intact hash", () => {
    const record = storeRecord({ id: "r", classification: "personal", body: "private note", source: "owner", licence: "owner" });
    assert.equal(recordIntact(record), true);
    const blocked = releaseRecord(record, null, "read", now);
    assert.equal(blocked.released, false);
    const released = releaseRecord(record, { id: "c", recordId: "r", purpose: "read", recipient: "owner", expiresAt: 2_000, revoked: false }, "read", now);
    assert.equal(released.released, true);
    record.body = "changed";
    assert.equal(releaseRecord(record, { id: "c", recordId: "r", purpose: "read", recipient: "owner", expiresAt: 2_000, revoked: false }, "read", now).released, false);
  });

  it("does not mark unconnected offices as working", () => {
    const missing = FRONTIER_CAPABILITIES.filter((item) => item.state === "missing").map((item) => item.id);
    assert.ok(missing.includes("procurement"));
    assert.ok(missing.includes("travel"));
    assert.ok(missing.includes("external-verification"));
    assert.ok(missing.includes("neural-input"));
    assert.ok(missing.includes("cyber-defence"));
    assert.ok(missing.includes("disaster-recovery"));
  });

  it("lets the owner inspect store, share, and delete events", () => {
    clearInformationLog();
    recordInformation({ action: "store", recordId: "r", actor: "adrian", at: now, detail: "private note" });
    recordInformation({ action: "share", recordId: "r", actor: "adrian", at: now, detail: "refused" });
    const actions = inspectInformation().map((event) => event.action);
    assert.deepEqual(actions, ["store", "share"]);
  });

  it("does not invent a headset, sensor, or wearable", () => {
    assert.equal(detectCapability("spatial-presentation").present, false);
    assert.equal(detectCapability("sensors", [{ id: "band", kind: "wearable" }]).present, false);
    assert.equal(detectCapability("wearables", [{ id: "band", kind: "wearable" }]).present, true);
  });

  it("refuses an unknown external agent and a source with no licence", () => {
    assert.equal(evaluateExternalAgent({ known: false, revoked: false }).trusted, false);
    assert.throws(() => registerSource({ id: "s", path: "model.step", licence: " ", body: "solid" }));
    const source = registerSource({ id: "s", path: "model.step", licence: "owner", body: "solid" });
    assert.equal(source.licence, "owner");
  });

  it("blocks a purchase during crisis mode and does not call anyone", () => {
    setCrisisMode(true);
    assert.equal(crisisBlocks("procurement").blocked, true);
    setCrisisMode(false);
    assert.equal(crisisBlocks("procurement").blocked, false);
  });

  it("records an agent attempt without executing an obligation", () => {
    noteAgentAttempt({ agentId: "bot", attempted: "book travel", ok: false, at: now });
    assert.equal(agentAttempts("bot").some((note) => note.attempted === "book travel"), true);
    const obligation = listObligation({ id: "o", text: "file the form", dueAt: 2_000 });
    assert.equal(obligation.executed, false);
    assert.equal(callService({ name: "desk", inputs: ["goal"], outputs: ["result"] }).called, false);
    assert.equal(simulatePolicy("procurement").executed, false);
    assert.equal(allowIrreversible(false).allowed, false);
    assert.equal(sharedDecision({ adrian: true }, ["adrian", "other"]).allowed, false);
    assert.equal(JSON.parse(packTask({ version: 1, id: "t", goal: "list files", steps: [] })).version, 1);
  });

  it("redacts a credential, tracks withdrawal, and does not call a planned item verified", () => {
    clearInformationLog();
    const grant = issueAuthority({ id: "spend", holder: "bot", scopes: ["files"], expiresAt: 2_000 });
    withdrawPermission(grant, now);
    assert.equal(verifyAuthority(grant, "files", now).reason, "revoked");
    const event = recordInformation({ action: "export", recordId: "r", actor: "bot", at: now, detail: "key sk-live-secretvalue" });
    assert.equal(event.detail.includes("sk-live"), false);
    assert.match(redactSecrets("Bearer abcdef123456"), /redacted/);
    const gone = deleteRecord("r", now);
    assert.equal(gone.durableWipe, false);
    assert.equal(classifyCapability("procurement"), "planned");
    assert.equal(classifyCapability("consent"), "available");
    assert.equal(claimVerified("consent").verified, false);
    assert.equal(recordConsequential({ kind: "procurement", actor: "bot", detail: "card sk-card-secretvalue", at: now }).executed, false);
    assert.equal(inspectInformation().some((item) => item.detail.includes("sk-")), false);
  });

  it("registers an adapter without calling it or binding the product to one provider", () => {
    assert.equal(runAdapter("missing", "Bearer abcdef123456").ran, false);
    assert.equal(runAdapter("missing", "Bearer abcdef123456").payload.includes("abcdef"), false);
    const adapter = registerAdapter({ id: "spatial-v1", kind: "spatial", version: 1, provider: "unspecified" });
    assert.equal(adapter.version, 1);
    assert.match(runAdapter("spatial-v1", "room").reason, /not called/);
    assert.equal(classifyCapability("versioned-adapter"), "available");
    assert.equal(claimVerified("versioned-adapter").verified, false);
  });
});
