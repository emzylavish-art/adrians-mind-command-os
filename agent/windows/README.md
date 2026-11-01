# Windows local companion (HP EliteBook)

Per-user agent. No admin required. Does not touch Defender, firewall, or UAC.

## Install (once the laptop is online)

1. On the dashboard (signed in), `POST /api/mind/pairing/code` to mint a one-time code.
2. On the EliteBook, from an elevated-**not**-required PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-MindAgent.ps1 -DashboardUrl "https://YOUR_DASHBOARD" -PairingCode "ABCD-EFGH"
```

3. Confirm the Build / Integrations "Local computer" card flips to Connected after the first heartbeat (~30s).

## Emergency stop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MindCommandAgent\Emergency-Stop.ps1"
```

Or use the dashboard Emergency stop. Clearing requires a human dashboard action, then re-pair.

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-MindAgent.ps1
```

## Hardening notes

- Dashboard URL must be HTTPS (localhost HTTP only for dev).
- Device token is bound to the local keypair fingerprint; stolen tokens fail binding checks.
- `agent.manifest.json` hashes are verified each loop; tamper exits the agent.
- Startup uses `%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe` (PATH/DLL hijack mitigation).
- Local control auth token is stored in config; bind host is `127.0.0.1` only.
- Logs redact Bearer tokens and password-like fields.
