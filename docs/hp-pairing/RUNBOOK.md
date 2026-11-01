# HP Pairing runbook (EliteBook)

Do this once the HP EliteBook is online. Server-side code is already on branch `hp-pairing`.

## One-line install (on the EliteBook)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-MindAgent.ps1 -DashboardUrl "https://YOUR_DASHBOARD" -PairingCode "ABCD-EFGH"
```

Run from the repo's `agent/windows/` directory (or copy that folder to the laptop first).

## Server side

1. Ensure `MIND_PAIRING_MANAGEMENT_KEY` is set in the app env **or** a key file exists at `/home/box/.secrets/mind_pairing_management.key` (never commit it; never paste into Notion).
2. Deploy/merge `hp-pairing` so `/api/mind/pairing/*` routes are live.
3. Signed-in owner calls `POST /api/mind/pairing/code` → receive `{ code, expiresAt }` (5 minutes, one-time).
4. Laptop install script generates a local keypair, posts `{ code, publicKeyPem, deviceName }` to `POST /api/mind/pairing/handshake`, stores the device token under `%LOCALAPPDATA%\MindCommandAgent\`, and starts the heartbeat loop.
5. Agent posts `POST /api/mind/pairing/heartbeat` every ~30s.

## Verify the card flips

1. Open Integrations / Service board: **Local computer** should move from `Not paired` to `Connected` with device name + last-seen (via `localComputer` prop fed from `GET /api/mind/pairing/status`).
2. `PairingCard` component shows the same state (mount into Build when `command-app.tsx` is unlocked).
3. File-edit and terminal affordances stay disabled unless `card.fileEditEnabled` / `card.terminalEnabled` are true.

## Emergency stop

**Trigger (dashboard):** `POST /api/mind/pairing/stop` with session auth (optional `deviceId`).

**Trigger (laptop):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MindCommandAgent\Emergency-Stop.ps1"
```

Effects: local `EMERGENCY_STOP` flag, agent process killed, device token revoked. Model output cannot clear it.

**Clear (human only):** `POST /api/mind/pairing/stop?op=clear` with `{ deviceId }` as the owner who engaged the stop. Then mint a new pairing code and re-run the install/handshake (old token is not restored).

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-MindAgent.ps1
```
