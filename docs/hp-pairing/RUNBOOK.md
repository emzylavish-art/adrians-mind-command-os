# HP Pairing runbook (EliteBook)

Server-side code lives on branch `hp-pairing`. Management key: env `MIND_PAIRING_MANAGEMENT_KEY` **or** `/home/box/.secrets/mind_pairing_management.key` (mode 600). Never commit or paste the key.

## Fast path when the laptop appears

From the repo (server/ops box):

```bash
node --experimental-strip-types scripts/pairing/pair-elitebook.mjs --base "https://YOUR_DASHBOARD"
```

That prints only `PAIRING_CODE=…`, `EXPIRES_AT=…`, and the PowerShell line. Then on the EliteBook (from `agent/windows`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-MindAgent.ps1 -DashboardUrl "https://YOUR_DASHBOARD" -PairingCode "ABCD-EFGH"
```

Dashboard URL must be **HTTPS** (localhost HTTP only for lab).

## What the installer does

1. Generates a local RSA keypair under `%LOCALAPPDATA%\MindCommandAgent\keys\` (private key never uploaded).
2. Handshakes with `/api/mind/pairing/handshake`.
3. Fetches `/api/mind/pairing/manifest`, checks script hashes, POSTs `?op=verify` so the **server** validates the HMAC signature (management key never leaves the server).
4. Writes signed `agent.manifest.json`, user Startup entry, starts heartbeat.

## Verify the card

1. `GET /api/mind/pairing/status` (signed-in) → `card.paired === true` after heartbeat.
2. ServiceBoard `localComputer` / `PairingCard` show Connected with device name + last seen.
3. File-edit / terminal only when `fileEditEnabled` / `terminalEnabled`.

## Emergency stop

- Dashboard: `POST /api/mind/pairing/stop`
- Laptop: `Emergency-Stop.ps1` under LocalAppData
- Clear: `POST /api/mind/pairing/stop?op=clear` with `{ deviceId }`, then **re-pair** (token not restored)

## Dry-run on the box (no EliteBook)

```bash
node --experimental-strip-types scripts/pairing/dry-run.mjs
# with preview on :8191
node --experimental-strip-types scripts/pairing/http-dry-run.mjs
```

Evidence lands in `/workspace/audit/hp-pairing/`. Scripts wipe temp pairing store afterward so the card stays Not paired.

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-MindAgent.ps1
```
