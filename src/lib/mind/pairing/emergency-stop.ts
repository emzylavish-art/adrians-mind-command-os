import { findDeviceByToken } from "./handshake.ts";
import { readPairingStore, writePairingStore } from "./store.ts";
import { canChangeHalt } from "../halt-policy.ts";

/**
 * Emergency stop for a paired device.
 * - Sets emergencyStopped on the device record (survives agent restart).
 * - Revokes the device token so no further signed actions verify.
 * - Model / agent instructions cannot clear this; clearing needs a human
 *   dashboard caller that passes canChangeHalt.
 */
export function engageDeviceEmergencyStop(input: {
  deviceId?: string;
  deviceToken?: string;
  userId: string;
  now?: number;
}): { ok: true; deviceId: string } | { ok: false; error: string } {
  const now = input.now ?? Date.now();
  const store = readPairingStore();
  let device = input.deviceId
    ? store.devices.find((d) => d.id === input.deviceId && d.userId === input.userId)
    : undefined;
  if (!device && input.deviceToken) {
    const found = findDeviceByToken(input.deviceToken, now);
    if (found.ok && found.device.userId === input.userId) {
      device = store.devices.find((d) => d.id === found.device.id);
    }
  }
  if (!device) {
    // Also allow owner to stop any of their devices by scanning active ones
    const active = store.devices.filter((d) => d.userId === input.userId && !d.revokedAt);
    if (!input.deviceId && !input.deviceToken && active.length === 1) {
      device = active[0];
    }
  }
  if (!device) return { ok: false, error: "Device not found for emergency stop." };

  device.emergencyStopped = true;
  device.emergencyStoppedAt = new Date(now).toISOString();
  device.emergencyStoppedBy = input.userId;
  device.revokedAt = new Date(now).toISOString();
  writePairingStore(store);
  return { ok: true, deviceId: device.id };
}

export function clearDeviceEmergencyStop(input: {
  deviceId: string;
  userId: string;
  now?: number;
}): { ok: true } | { ok: false; error: string } {
  const store = readPairingStore();
  const device = store.devices.find((d) => d.id === input.deviceId && d.userId === input.userId);
  if (!device) return { ok: false, error: "Device not found." };
  const decision = canChangeHalt(input.userId, device.emergencyStoppedBy, true);
  if (!decision.ok) return decision;
  // Clearing stop does NOT restore the revoked token — human must re-pair.
  device.emergencyStopped = false;
  device.emergencyStoppedAt = null;
  device.emergencyStoppedBy = null;
  writePairingStore(store);
  return { ok: true };
}

/** Pre-model / pre-action gate. Model output cannot clear this flag. */
export function isDeviceStopped(deviceId: string): boolean {
  const store = readPairingStore();
  const device = store.devices.find((d) => d.id === deviceId);
  return Boolean(device?.emergencyStopped);
}

/**
 * Local agent must check this before any model-driven step.
 * Returning true means: kill process tree, do not execute, do not ask the model.
 */
export function localStopCheck(flags: { serverStopped: boolean; localHotkey: boolean; localCli: boolean }): {
  stop: boolean;
  reason: string | null;
} {
  if (flags.serverStopped) return { stop: true, reason: "Server emergency stop is engaged." };
  if (flags.localHotkey) return { stop: true, reason: "Local emergency-stop hotkey pressed." };
  if (flags.localCli) return { stop: true, reason: "Local emergency-stop CLI invoked." };
  return { stop: false, reason: null };
}
