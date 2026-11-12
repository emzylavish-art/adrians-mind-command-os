/** Kimi device login is not used. Adrian Build uses the saved Grok key. */

export type DeviceStart = {
  ok: true;
  verificationUri: string;
  verificationUriComplete: string;
  userCode: string;
  expiresIn: number;
  interval: number;
};

const OFF = "Kimi login is off. Build uses the saved Grok key.";

export async function startKimiDeviceLogin(
  _ownerId: string,
  _fetchImpl: typeof fetch = fetch,
): Promise<DeviceStart | { ok: false; error: string }> {
  return { ok: false, error: OFF };
}

export async function pollKimiDeviceLogin(
  _ownerId: string,
  _fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; state: "pending" | "connected"; accountLabel?: string } | { ok: false; error: string }> {
  return { ok: false, error: OFF };
}

export async function kimiDeviceStatus(
  _ownerId: string,
): Promise<{ state: "connected" | "pending" | "not_connected"; detail: string }> {
  return { state: "not_connected", detail: OFF };
}
