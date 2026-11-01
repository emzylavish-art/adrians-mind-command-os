import { HEARTBEAT_FRESH_MS } from "./handshake.ts";
import { readPairingStore, writePairingStore, type DeviceRecord } from "./store.ts";
import { findDeviceByToken } from "./handshake.ts";
import type { Capability, CapabilityStatus } from "../registry.ts";

export type PairingCardState =
  | {
      paired: false;
      label: "Not paired";
      detail: string;
      fileEditEnabled: false;
      terminalEnabled: false;
    }
  | {
      paired: true;
      label: "Connected";
      detail: string;
      deviceName: string;
      deviceId: string;
      lastSeenAt: string;
      emergencyStopped: boolean;
      fileEditEnabled: boolean;
      terminalEnabled: boolean;
    };

function activeDevicesForUser(userId: string, now: number): DeviceRecord[] {
  const store = readPairingStore();
  return store.devices.filter(
    (d) =>
      d.userId === userId &&
      !d.revokedAt &&
      Date.parse(d.expiresAt) > now,
  );
}

export function recordHeartbeat(
  deviceToken: string,
  now = Date.now(),
  publicKeyFingerprint?: string,
):
  | { ok: true; lastHeartbeatAt: string }
  | { ok: false; error: string } {
  const found = findDeviceByToken(deviceToken, now);
  if (!found.ok) return found;
  if (found.device.emergencyStopped) {
    return { ok: false, error: "Emergency stop is on." };
  }
  if (publicKeyFingerprint && publicKeyFingerprint !== found.device.publicKeyFingerprint) {
    return { ok: false, error: "Device key fingerprint mismatch." };
  }
  const store = readPairingStore();
  const device = store.devices.find((d) => d.id === found.device.id);
  if (!device) return { ok: false, error: "Device not found." };
  device.lastHeartbeatAt = new Date(now).toISOString();
  writePairingStore(store);
  return { ok: true, lastHeartbeatAt: device.lastHeartbeatAt };
}

/**
 * Honest pairing card state. Never fakes Connected.
 * Connected requires: valid unrevoked token + recent heartbeat + not expired.
 */
export function pairingCardState(userId: string, now = Date.now()): PairingCardState {
  const devices = activeDevicesForUser(userId, now);
  const withBeat = devices.filter((d) => {
    if (!d.lastHeartbeatAt) return false;
    return now - Date.parse(d.lastHeartbeatAt) <= HEARTBEAT_FRESH_MS;
  });
  if (withBeat.length === 0) {
    return {
      paired: false,
      label: "Not paired",
      detail: "No HP laptop or phone is paired. No files are changed.",
      fileEditEnabled: false,
      terminalEnabled: false,
    };
  }
  // Prefer a non-stopped device; if only stopped ones have heartbeats, still show connected but disabled.
  const preferred = withBeat.find((d) => !d.emergencyStopped) ?? withBeat[0]!;
  const enabled = !preferred.emergencyStopped;
  return {
    paired: true,
    label: "Connected",
    detail: preferred.emergencyStopped
      ? `${preferred.name} is paired but emergency-stopped. File edit and terminal are disabled.`
      : `${preferred.name} last seen ${preferred.lastHeartbeatAt}.`,
    deviceName: preferred.name,
    deviceId: preferred.id,
    lastSeenAt: preferred.lastHeartbeatAt!,
    emergencyStopped: preferred.emergencyStopped,
    fileEditEnabled: enabled,
    terminalEnabled: enabled,
  };
}

export function pcCapabilityFromPairing(userId: string, now = Date.now()): Capability {
  const card = pairingCardState(userId, now);
  if (!card.paired) {
    return {
      id: "pc",
      name: "PC control",
      status: "blocked" satisfies CapabilityStatus,
      why: "The HP EliteBook is not paired. No commands are sent to it.",
    };
  }
  if (card.emergencyStopped) {
    return {
      id: "pc",
      name: "PC control",
      status: "configured",
      why: `${card.deviceName} is paired but emergency-stopped. Clear the stop in the dashboard to resume.`,
    };
  }
  return {
    id: "pc",
    name: "PC control",
    status: "ready",
    why: `${card.deviceName} is paired. Last seen ${card.lastSeenAt}. File-edit and terminal follow governance rules.`,
  };
}


export function pairingCardFromApi(payload: { card?: PairingCardState } | null | undefined): PairingCardState {
  if (payload?.card?.paired) return payload.card;
  return {
    paired: false,
    label: "Not paired",
    detail: "No HP laptop or phone is paired. No files are changed.",
    fileEditEnabled: false,
    terminalEnabled: false,
  };
}
