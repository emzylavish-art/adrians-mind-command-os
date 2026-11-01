export { setManagementKeyForTests, readManagementKey, managementKeyLabel } from "./management-key.ts";
export {
  setPairingStoreDirectory,
  pairingStoreDirectory,
  readPairingStore,
  writePairingStore,
  resetPairingStoreForTests,
  newId,
} from "./store.ts";
export {
  mintPairingCode,
  exchangePairingCode,
  findDeviceByToken,
  rotateDeviceToken,
  PAIRING_CODE_TTL_MS,
  DEVICE_TOKEN_TTL_MS,
  HEARTBEAT_FRESH_MS,
} from "./handshake.ts";
export { signDeviceAction, verifyAndAuthorizeAction, reportActionOutcome } from "./actions.ts";
export {
  engageDeviceEmergencyStop,
  clearDeviceEmergencyStop,
  isDeviceStopped,
  localStopCheck,
} from "./emergency-stop.ts";
export { pairingCardState, recordHeartbeat, pcCapabilityFromPairing, pairingCardFromApi } from "./status.ts";
export {
  DEVICE_SCOPES,
  isPathInScope,
  isCommandInScope,
  deviceHasScope,
  governanceAllowsDeviceAction,
} from "./scope.ts";
export type { DeviceScope, DeviceActionKind } from "./scope.ts";
export type { PairingCardState } from "./status.ts";
export type { SignedAction } from "./actions.ts";
