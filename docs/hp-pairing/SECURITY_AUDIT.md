# HP Pairing security audit (adversarial)

Probed against `src/lib/mind/pairing/*` and `agent/windows/*` on branch `hp-pairing`.
No real management keys or production device tokens were minted. Test harness uses `setManagementKeyForTests` only.

Legend: **Blocked** = rejected by code under test · **Fixed** = hardened this pass · **Residual** = remaining risk / ops follow-up.

## Classic scope / signing

| Path probed | Result | Notes |
|---|---|---|
| Unsigned action (empty signature) | **Blocked** | `verifyAndAuthorizeAction` rejects incomplete/unsigned payloads |
| Tampered path after sign | **Blocked** | HMAC over canonical payload incl. fingerprint |
| Replayed nonce / actionId | **Blocked** | `usedNonces` store |
| Expired / reused / wrong pairing code | **Blocked** | TTL 5m, one-time `usedAt`, management-key MAC |
| Path traversal `..\` / `../` | **Blocked** | Fragment + segment denylist |
| Absolute path outside roots | **Blocked** | Prefix check against allowed roots |
| System paths (`\Windows\`, `\System32\`) | **Blocked** | Fragment denylist |
| Command injection `; \| \` &` | **Blocked** | `isCommandInScope` |
| `file_delete` / `file_write` without owner approval | **Blocked** | Reuses `policy.decide` protected classes |
| Fake Connected without heartbeat | **Blocked** | Card requires unrevoked token + fresh heartbeat |
| Management key leak to client | **Blocked** | Status returns `[management-key:redacted]` only |

## Attacker checklist (this pass)

| Path probed | Result | Notes |
|---|---|---|
| Stolen / exfiltrated device token reused on another host | **Fixed / Blocked** | Token bound to `publicKeyFingerprint`; `verifyDeviceBinding` requires challenge proof (HMAC of token+fingerprint or RSA over challenge). Wrong key → reject |
| Replay / nonce reuse | **Blocked** | Same as classic; covered in unit + adversarial suites |
| MITM / downgraded transport | **Fixed / Blocked** | `assertPinnedOrigin` / `agentMustUseTls`: HTTPS required except localhost; Origin must match pinned dashboard URL when present. Install/agent refuse non-TLS |
| Forged pairing code | **Blocked** | Needs management-key MAC |
| Brute-forced short code | **Fixed / Blocked** | `handshakeRateLimited` (8 failures / 15m per attempt key); mint rate limit 5 codes / 15m per user; codes still expire in 5m |
| Prompt injection in file/web content driving model to issue actions | **Blocked** | Model cannot mint actions — only `signDeviceAction` on the server. Device rejects unsigned forged actions even with a valid token+binding |
| Model clears / bypasses emergency stop | **Blocked** | `localStopCheck` independent of model text; `clearDeviceEmergencyStop` uses `canChangeHalt` (human owner); clear does not restore revoked token |
| Env / secret leakage via terminal output or logs | **Fixed / Blocked** | `redactSecretsFromOutput` on action reports; agent log scrub for Bearer/token; never logs management key |
| Symlink / junction / UNC / `\\?\` / `\\.\` | **Fixed / Blocked** | String denylist rejects UNC, extended-length, device-namespace, `:junction` markers |
| Windows device names (`CON`, `NUL`, `COM1`, …) | **Fixed / Blocked** | Segment check against reserved names |
| PowerShell / cmd metacharacters & argument smuggling | **Fixed / Blocked** | Expanded patterns: `-EncodedCommand`, `iex`, `Invoke-Expression`, `%ENV%`, `$(…)`, backticks, redirections, `cmd /c` |
| Tampered / hijacked agent script update | **Fixed / Blocked** | `agent.manifest.json` sha256 verified at install and each agent loop; mismatch exits |
| DLL / PATH hijack in install dir | **Fixed** (partial) | Startup uses `%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe` absolute path; scripts live under user LocalAppData with ACL. **Residual**: full DLL search-order hardening for native helpers not applicable (PowerShell-only agent) |
| Local non-admin process talking to agent port | **Fixed / Blocked** | Policy: bind `127.0.0.1` only + `localControl.authToken`. `localControlAuth` unit-tested. Agent defaults to no LAN socket (flag-file control); future HttpListener must use the same gate |

## Remaining risks (residual)

1. **Build page mount gap**: `command-app.tsx` still locked by other lanes. `PairingCard` + status API + ServiceBoard `localComputer` prop are ready; static Build hero text may still say "not paired" until mounted.
2. **OS-level reparse resolution**: string checks block UNC/junction markers; the Windows agent should still resolve final paths (`GetFinalPathNameByHandle`) before write and refuse reparse points — not fully implemented in the PowerShell stub (**residual**).
3. **Management key provisioning**: ops must set `MIND_PAIRING_MANAGEMENT_KEY` or `/home/box/.secrets/mind_pairing_management.key` before real pairing.
4. **Token at rest on laptop**: config ACL is current-user; BitLocker remains owner responsibility.
5. **Heartbeat with stolen token + stolen private key**: if an attacker steals both the token and the device private key material from disk, they can prove binding — mitigate with short TTL, rotate, emergency stop, disk encryption (**residual**).
6. **Manifest trust root**: first install trusts the scripts copied from the install source; distribute install folder over a trusted channel or sign the manifest with the management key in a follow-up (**residual**).

## Test coverage

- `handshake.test.ts`, `actions.test.ts`, `emergency-stop.test.ts`, `status.test.ts`
- `adversarial.test.ts` — stolen-token binding, rate limit, TLS/origin pin, UNC/device names, PS/cmd smuggling, prompt-injection/forged action, redaction, manifest tamper, local control auth
