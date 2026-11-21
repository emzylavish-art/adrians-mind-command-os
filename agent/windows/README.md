# Windows local companion (HP EliteBook)

This per-user Companion supervises the local Kimi Code CLI process in ACP mode. It does not request admin elevation, disable Defender/UAC/firewall, or expose a LAN listener.

## Prerequisites

- Windows PowerShell 5.1 or newer.
- Node.js 20 or newer available as `node`, or pass `-NodePath` with an absolute path.
- Kimi Code CLI installed and logged in on this Windows user account.
- `kimi` available on `PATH`, or pass `-KimiPath` with the absolute CLI path.
- A dashboard URL using HTTPS. HTTP is allowed only for localhost development.

Verify Kimi before pairing:

```powershell
kimi --version
kimi acp
```

The second command should wait for ACP JSON-RPC input without printing a banner. Press `Ctrl+C` after that check.

## Install

1. On the signed-in site, open Build and press Mint pairing code. The code looks like `ABCD-EFGH` and expires in five minutes.
2. Run `AdriansMind-Setup.exe`. Paste the code. The dashboard field is already `https://adrians-mind.vercel.app`.
3. The installer copies these scripts, then runs `Pair-Now.ps1`, which calls `Install-MindAgent.ps1`. Leave the code blank only to install the files and pair later from Start menu, Adrian's Mind, Pair this PC.

The companion install performs the signed handshake, stores the token and local keypair under `%LOCALAPPDATA%\MindCommandAgent`, verifies the signed Companion manifest, creates `%USERPROFILE%\MindWorkspace`, and registers a current-user Startup entry named `MindCommandLocalAgent`. Node.js 20 and the `kimi` command are not inside this file. If either is missing, pairing can still finish and later PC jobs report that they cannot run.

The dashboard’s local Companion card should become Connected after the first heartbeat. The Companion polls for typed jobs every five seconds.

## Build runtime behavior

A Build request is queued as a typed `kimi-acp` job. The Companion launches:

```text
kimi acp
```

It speaks newline-delimited ACP JSON-RPC over stdin/stdout, creates one session in the approved workspace, submits the prompt, streams normalized session/tool/permission events back to Adrian OS, and posts the final result. ACP file reads and writes are restricted to configured `allowedRoots`. Adrian OS can also queue bounded list/read/write file operations and owner-approved shell jobs. ACP reverse-RPC terminal requests remain denied unless they arrive through the explicit owner-approval terminal path.

No fake Connected state or fake completion is reported: if Kimi is missing, not logged in, outside the allowed workspace, stopped, or unable to complete, the job reports an error.

## Emergency stop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MindCommandAgent\Emergency-Stop.ps1"
```

The flag is checked before every heartbeat, job poll, ACP launch, and integrity check. Clearing the dashboard stop requires a human dashboard action; re-pairing may be required.

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-MindAgent.ps1
```

## Hardening notes

- Dashboard URL must be HTTPS, except localhost development.
- The device token is bound to the local keypair fingerprint.
- `agent.manifest.json` includes `MindAgent.ps1`, `Emergency-Stop.ps1`, and `KimiAcpClient.mjs`; hashes are checked each loop.
- Kimi file access is confined to the configured allowed roots.
- Shell jobs require an owner approval record and are bounded to the approved workspace with capped output and a timeout.
- Active Kimi sessions poll for owner cancellation and terminate when cancellation is requested.
- Logs redact bearer tokens and password-like fields.
- The sandbox implementation cannot execute or validate PowerShell on the Windows machine; after installation, verify `kimi --version`, the first heartbeat, and one controlled Build prompt on that machine.
