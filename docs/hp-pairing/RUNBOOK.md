# HP Pairing runbook (EliteBook)

Do this once the HP EliteBook is online. Server-side code is on branch `hp-pairing`.

## One-line install (on the EliteBook)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-MindAgent.ps1 -DashboardUrl "https://YOUR_DASHBOARD" -PairingCode "ABCD-EFGH"
```

Run from the repo's `agent/windows/` directory (or copy that folder to the laptop first). Dashboard URL must be **HTTPS** (localhost HTTP only for dev).

## Server side

1. Set `MIND_PAIRING_MANAGEMENT_KEY` **or** place a key at `/home/box/.secrets/mind_pairing_management.key` (never commit; never paste into Notion).
2. Deploy/merge `hp-pairing` so `/api/mind/pairing/*` is live.
3. Signed-in owner: `POST /api/mind/pairing/code` → `{ code, expiresAt }` (5 minutes, one-time; mint rate-limited).
4. Laptop install generates a local keypair, posts `{ code, publicKeyPem, deviceName, dashboardUrl }` to `POST /api/mind/pairing/handshake`, stores token + `publicKeyFingerprint` under `%LOCALAPPDATA%\MindCommandAgent\`, writes `agent.manifest.json`, starts heartbeat.
5. Agent posts heartbeats ~30s with token + fingerprint; verifies manifest each loop.

## Verify the card flips

1. Integrations / Service board: **Local computer** → `Connected` via `localComputer` prop from `GET /api/mind/pairing/status`.
2. `PairingCard` shows the same (mount into Build when `command-app.tsx` is free).
3. File-edit / terminal stay disabled unless `card.fileEditEnabled` / `terminalEnabled` are true.

## Emergency stop

**Dashboard:** `POST /api/mind/pairing/stop` (session auth).

**Laptop:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MindCommandAgent\Emergency-Stop.ps1"
```

Effects: local `EMERGENCY_STOP` flag, process killed, token revoked. Model output cannot clear it.

**Clear (human only):** `POST /api/mind/pairing/stop?op=clear` with `{ deviceId }` as the owner who engaged stop, then re-pair (old token is not restored).

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-MindAgent.ps1
```

## Security quick checks

- Stolen token alone must not authorize actions (binding proof required).
- Non-HTTPS dashboard URL must be refused by the installer.
- Editing `MindAgent.ps1` after install must cause the agent to exit on integrity failure.
