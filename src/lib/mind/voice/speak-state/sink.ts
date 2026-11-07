import type { MicPermissionState } from "./events.ts";

/** What LiveMicStream needs from speak state. Kept narrow so the mic class does not own the bus. */
export type SpeakMicSink = {
  readonly permission: MicPermissionState | null;
  readonly deviceId: string | null;
  setPermission(state: MicPermissionState, deviceId: string | null): void;
  setMicOpen(open: boolean): void;
  pushLevel(linearRms: number): void;
  pumpLevel(): void;
};
