# HP Pairing security audit

Probed against `src/lib/mind/pairing/*` on branch `hp-pairing`. No real management keys or device tokens were minted outside the test harness (`setManagementKeyForTests`).

| Path probed | Result | Notes |
|---|---|---|
| Unsigned action (empty signature) | **Blocked** | `verifyAndAuthorizeAction` rejects incomplete/unsigned payloads |
| Tampered path after sign | **Blocked** | HMAC over canonical payload; path change invalidates signature |
| Replayed nonce / actionId | **Blocked** | `usedNonces` store; second verify returns replay error |
| Expired pairing code | **Blocked** | `PAIRING_CODE_TTL_MS` (5m) |
| Reused pairing code | **Blocked** | `usedAt` set on first exchange |
| Wrong management key / wrong code | **Blocked** | Code MAC includes management key; mismatch → invalid |
| Path traversal `..\` / `../` | **Blocked** | `isPathInScope` fragment denylist |
| Absolute path outside allowed roots | **Blocked** | Must prefix an allowed root |
| System paths (`\Windows\`, `\System32\`) | **Blocked** | Fragment denylist |
| Command injection via `;`, `\|`, backticks, `-enc` | **Blocked** | `isCommandInScope` patterns |
| `file_delete` / `file_write` without owner approval | **Blocked** | Reuses `policy.decide` protected classes (`delete` / `overwrite`) |
| Emergency stop then action | **Blocked** | Token revoked + `emergencyStopped`; verify fails |
| Model-text "clear stop" | **Blocked** | `localStopCheck` / `clearDeviceEmergencyStop` require human caller via `canChangeHalt`; model output has no API |
| Stop flag after process restart | **Persists** | Stored in `.data/mind-pairing/store.json` |
| Fake Connected without heartbeat | **Blocked** | Card requires unrevoked token + heartbeat ≤ `HEARTBEAT_FRESH_MS` |
| Management key leak to client | **Blocked** | Status returns `[management-key:redacted]` only |

## Remaining risks

1. **Build page mount gap**: `command-app.tsx` is locked by other lanes. `PairingCard` + `/api/mind/pairing/status` + `ServiceBoard` `localComputer` prop are ready, but the static Build hero text inside `command-app.tsx` still says "not paired" until a follow-up mount lands.
2. **Symlink resolution on device**: string checks block `..` and system paths; the Windows agent must still resolve the real path (`GetFinalPathNameByHandle` / refuse reparse points) before write — not yet implemented in the PowerShell stub beyond string checks. Tracked as follow-up hardening.
3. **Management key provisioning**: no key file is created by this lane (by design). Ops must place `MIND_PAIRING_MANAGEMENT_KEY` or `/home/box/.secrets/mind_pairing_management.key` before minting real codes.
4. **Token at rest on laptop**: config.json ACL is current-user only; full disk encryption (BitLocker) remains the owner's responsibility.
5. **Heartbeat spoofing**: heartbeats require the device token; a stolen token could keep the card green until revoke/stop — mitigate by short token TTL + rotate endpoint + emergency stop.

## Fixes applied this pass

- Canonical HMAC payload including `tokenId` and nonce.
- Replay cache for nonce/actionId.
- Governance reuse from `policy.ts` / `halt-policy.ts` (no parallel permission system).
- Emergency stop revokes token and persists; clear does not restore the old token.
