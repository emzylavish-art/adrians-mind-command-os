# HP Pairing security audit (adversarial + Cycle 2)

Probed against `src/lib/mind/pairing/*` and `agent/windows/*` on `hp-pairing`.
Management key used for dry-run signing is never logged, printed, or committed.

Legend: **Blocked** · **Fixed** · **Residual**

## Classic + Cycle 1

| Path | Result |
|---|---|
| Unsigned / tampered / replayed actions | **Blocked** |
| Expired / reused / wrong pairing code | **Blocked** |
| Path traversal / system paths | **Blocked** |
| Command injection | **Blocked** |
| Protected file write/delete without approval | **Blocked** |
| Fake Connected without heartbeat | **Blocked** |
| Stolen token on another host (no device key) | **Fixed/Blocked** (fingerprint + binding proof) |
| MITM / HTTP downgrade | **Fixed/Blocked** (TLS + pinned origin) |
| Brute-force short codes | **Fixed/Blocked** (rate limits + TTL) |
| Prompt injection → forged actions | **Blocked** (server-only signing) |
| Model clears emergency stop | **Blocked** |
| Secret leakage in logs/reports | **Fixed/Blocked** |
| UNC / `\\?\` / device names / junctions | **Fixed/Blocked** |
| PS/cmd metachar + arg smuggling | **Fixed/Blocked** |
| Tampered agent scripts (hash) | **Fixed/Blocked** |
| Local control port abuse | **Fixed/Blocked** (127.0.0.1 + auth) |

## Cycle 2 additions

| Path | Result | Notes |
|---|---|---|
| First-install manifest trust root | **Fixed** | Server signs manifest with management-key HMAC (`signAgentManifest`). Installer fetches `/api/mind/pairing/manifest`, checks file hashes, POSTs `?op=verify` for signature check. Key never sent to client. |
| Action outcomes without timestamp | **Fixed** | `executeDeviceActionWithReport` always calls `reportActionOutcome` (success/failure/rejected) with `at`. Covered by `report.test.ts` + dry-run. |
| E2E dry-run (sim device) | **Done** | Lib + HTTP dry-runs under `/workspace/audit/hp-pairing/`: connected → stop → Not paired; store cleaned. |

## Remaining residual

1. **Build page mount**: `command-app.tsx` still locked — `PairingCard` ready via status API / ServiceBoard.
2. **OS reparse resolution** on Windows before write (string checks already block UNC/junction markers).
3. **Stolen token + stolen private key** together — BitLocker + short TTL + stop.
4. **Live EliteBook** not yet online — standby until laptop appears; use `pair-elitebook.mjs`.
5. **Authenticated mint in browser**: `/api/mind/pairing/code` requires session (confirmed 401 in dry-run); ops mint via `pair-elitebook.mjs` or signed-in UI.

## Evidence

- `/workspace/audit/hp-pairing/dry-run-summary.json`
- `/workspace/audit/hp-pairing/http-dry-run-summary.json`
- `/workspace/audit/hp-pairing/pairing-card-dry-run.html`
