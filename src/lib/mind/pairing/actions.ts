import { hmacHex, randomToken, safeEqualHex } from "./crypto.ts";
import { findDeviceByToken } from "./handshake.ts";
import {
  deviceHasScope,
  governanceAllowsDeviceAction,
  isCommandInScope,
  isPathInScope,
  scopeForKind,
  type DeviceActionKind,
} from "./scope.ts";
import { newId, readPairingStore, writePairingStore, type ActionReport } from "./store.ts";
import type { Autonomy } from "../policy.ts";
import {
  makeBindingChallenge,
  hmacBindingProof,
  verifyDeviceBinding,
} from "./binding.ts";
import { redactSecretsFromOutput } from "./redact.ts";

export type SignedAction = {
  actionId: string;
  kind: DeviceActionKind;
  path?: string;
  command?: string;
  args?: string[];
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  approvalToken?: string | null;
  /** Binds the action to the registered device key fingerprint. */
  publicKeyFingerprint: string;
};

const ACTION_TTL_MS = 60_000;

function payloadToSign(parts: {
  actionId: string;
  kind: string;
  path: string;
  command: string;
  args: string[];
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  tokenId: string;
  publicKeyFingerprint: string;
}): string {
  return [
    parts.actionId,
    parts.kind,
    parts.path,
    parts.command,
    JSON.stringify(parts.args),
    parts.nonce,
    parts.issuedAt,
    parts.expiresAt,
    parts.tokenId,
    parts.publicKeyFingerprint,
  ].join("|");
}

/** Server mints a signed action. Model output cannot mint this — only the server can. */
export function signDeviceAction(input: {
  deviceToken: string;
  kind: DeviceActionKind;
  path?: string;
  command?: string;
  args?: string[];
  approvalToken?: string | null;
  autonomy?: Autonomy;
  allowedRoots?: string[];
  now?: number;
}): { ok: true; action: SignedAction } | { ok: false; error: string } {
  const now = input.now ?? Date.now();
  const found = findDeviceByToken(input.deviceToken, now);
  if (!found.ok) return found;
  const device = found.device;
  if (device.emergencyStopped) {
    return { ok: false, error: "Emergency stop is on. No new action can run." };
  }
  if (!deviceHasScope(device.scopes, input.kind)) {
    return { ok: false, error: `Device token lacks scope ${scopeForKind(input.kind)}.` };
  }

  const roots = input.allowedRoots ?? [];
  if (input.kind.startsWith("file_") || input.path) {
    const pathCheck = isPathInScope(input.path ?? "", roots.length ? roots : ["C:\\Users\\Public\\MindWorkspace"]);
    if (!pathCheck.ok) return { ok: false, error: pathCheck.reason };
  }
  if (input.kind === "terminal") {
    const cmdCheck = isCommandInScope(input.command ?? "", input.args ?? []);
    if (!cmdCheck.ok) return { ok: false, error: cmdCheck.reason };
  }

  const actionId = newId("act");
  const gov = governanceAllowsDeviceAction({
    kind: input.kind,
    halted: false,
    autonomy: input.autonomy ?? "ask",
    approvalToken: input.approvalToken ?? null,
    actionId,
  });
  if (!gov.ok) return { ok: false, error: gov.reason };

  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ACTION_TTL_MS).toISOString();
  const nonce = randomToken(16);
  const path = input.path ?? "";
  const command = input.command ?? "";
  const args = input.args ?? [];
  const message = payloadToSign({
    actionId,
    kind: input.kind,
    path,
    command,
    args,
    nonce,
    issuedAt,
    expiresAt,
    tokenId: device.tokenId,
    publicKeyFingerprint: device.publicKeyFingerprint,
  });
  const signature = hmacHex(input.deviceToken, message);
  return {
    ok: true,
    action: {
      actionId,
      kind: input.kind,
      path: path || undefined,
      command: command || undefined,
      args,
      nonce,
      issuedAt,
      expiresAt,
      signature,
      approvalToken: input.approvalToken ?? null,
      publicKeyFingerprint: device.publicKeyFingerprint,
    },
  };
}

/**
 * Device-side verification. Requires:
 * - valid HMAC signature from server
 * - nonce not replayed
 * - path/command allowlist
 * - governance
 * - device key binding proof (stolen token on another host fails)
 * Model-authored "actions" without a server signature are always rejected.
 */
export function verifyAndAuthorizeAction(input: {
  deviceToken: string;
  action: SignedAction;
  emergencyStopped: boolean;
  autonomy?: Autonomy;
  allowedRoots?: string[];
  now?: number;
  /** Required: proves possession of the registered device key material. */
  binding?: {
    claimedFingerprint: string;
    challenge: string;
    hmacProof?: string;
    rsaSignatureBase64?: string;
  };
  /** If true, skip binding (legacy tests only). Prefer always requiring binding. */
  skipBindingForTests?: boolean;
}): { ok: true } | { ok: false; error: string; outcome: "rejected" } {
  const now = input.now ?? Date.now();
  if (input.emergencyStopped) {
    return { ok: false, error: "Emergency stop is on. No new action can run.", outcome: "rejected" };
  }
  const found = findDeviceByToken(input.deviceToken, now);
  if (!found.ok) return { ok: false, error: found.error, outcome: "rejected" };
  const device = found.device;
  if (device.emergencyStopped) {
    return { ok: false, error: "Emergency stop is on. No new action can run.", outcome: "rejected" };
  }
  if (!input.action?.signature || !input.action.nonce || !input.action.actionId) {
    return { ok: false, error: "Action is unsigned or incomplete.", outcome: "rejected" };
  }
  if (Date.parse(input.action.expiresAt) <= now) {
    return { ok: false, error: "Action expired.", outcome: "rejected" };
  }
  if (Date.parse(input.action.issuedAt) > now + 5_000) {
    return { ok: false, error: "Action issuedAt is in the future.", outcome: "rejected" };
  }

  if (!input.skipBindingForTests) {
    if (!input.binding) {
      return { ok: false, error: "Device binding proof is required.", outcome: "rejected" };
    }
    const bound = verifyDeviceBinding({
      device,
      deviceToken: input.deviceToken,
      claimedFingerprint: input.binding.claimedFingerprint,
      challenge: input.binding.challenge,
      hmacProof: input.binding.hmacProof,
      rsaSignatureBase64: input.binding.rsaSignatureBase64,
    });
    if (!bound.ok) return { ok: false, error: bound.error, outcome: "rejected" };
  }

  if (input.action.publicKeyFingerprint !== device.publicKeyFingerprint) {
    return { ok: false, error: "Action fingerprint does not match device key.", outcome: "rejected" };
  }

  const message = payloadToSign({
    actionId: input.action.actionId,
    kind: input.action.kind,
    path: input.action.path ?? "",
    command: input.action.command ?? "",
    args: input.action.args ?? [],
    nonce: input.action.nonce,
    issuedAt: input.action.issuedAt,
    expiresAt: input.action.expiresAt,
    tokenId: device.tokenId,
    publicKeyFingerprint: device.publicKeyFingerprint,
  });
  const expected = hmacHex(input.deviceToken, message);
  if (!safeEqualHex(expected, input.action.signature)) {
    return { ok: false, error: "Action signature is invalid (unsigned or tampered).", outcome: "rejected" };
  }

  const store = readPairingStore();
  if (store.usedNonces.some((n) => n.nonce === input.action.nonce || n.actionId === input.action.actionId)) {
    return { ok: false, error: "Action nonce was already used (replay).", outcome: "rejected" };
  }

  if (!deviceHasScope(device.scopes, input.action.kind)) {
    return { ok: false, error: "Out of scope for this device token.", outcome: "rejected" };
  }

  const roots = input.allowedRoots ?? ["C:\\Users\\Public\\MindWorkspace"];
  if (input.action.kind.startsWith("file_") || input.action.path) {
    const pathCheck = isPathInScope(input.action.path ?? "", roots);
    if (!pathCheck.ok) return { ok: false, error: pathCheck.reason, outcome: "rejected" };
  }
  if (input.action.kind === "terminal") {
    const cmdCheck = isCommandInScope(input.action.command ?? "", input.action.args ?? []);
    if (!cmdCheck.ok) return { ok: false, error: cmdCheck.reason, outcome: "rejected" };
  }

  const gov = governanceAllowsDeviceAction({
    kind: input.action.kind,
    halted: false,
    autonomy: input.autonomy ?? "ask",
    approvalToken: input.action.approvalToken ?? null,
    actionId: input.action.actionId,
  });
  if (!gov.ok) return { ok: false, error: gov.reason, outcome: "rejected" };

  store.usedNonces.push({
    nonce: input.action.nonce,
    actionId: input.action.actionId,
    at: new Date(now).toISOString(),
  });
  writePairingStore(store);
  return { ok: true };
}

export function reportActionOutcome(input: {
  deviceToken: string;
  actionId: string;
  kind: string;
  outcome: "success" | "failure" | "rejected";
  detail: string;
  now?: number;
}): { ok: true; report: ActionReport } | { ok: false; error: string } {
  const now = input.now ?? Date.now();
  const found = findDeviceByToken(input.deviceToken, now);
  if (!found.ok) return found;
  const store = readPairingStore();
  const report: ActionReport = {
    id: newId("rpt"),
    deviceId: found.device.id,
    actionId: input.actionId,
    kind: input.kind,
    outcome: input.outcome,
    detail: redactSecretsFromOutput(input.detail || "").slice(0, 2000),
    at: new Date(now).toISOString(),
  };
  store.reports.push(report);
  writePairingStore(store);
  return { ok: true, report };
}

export function deviceBindingHelpers(deviceToken: string) {
  const found = findDeviceByToken(deviceToken);
  if (!found.ok) return found;
  const challenge = makeBindingChallenge(found.device.id, found.device.tokenId);
  const hmacProof = hmacBindingProof(deviceToken, found.device.publicKeyFingerprint, challenge);
  return {
    ok: true as const,
    challenge,
    hmacProof,
    fingerprint: found.device.publicKeyFingerprint,
  };
}
