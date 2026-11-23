# Failover status and contract

Production is not being moved. Nothing is being signed. The phone package has not started.

## Already built

- Source commit `e9954f1b` points the installer feed at the local file that contains the first heartbeat module.
- GitHub release `desktop-installer` matches that file: whole-file SHA-256 `2453144ed1f600ad6d6d0dfb74dcc9fec2a42a3284ff79105b2dbd242a75bf02`, payload SHA-256 `f3b251c5241a4eb7833fd1c176df87564d1f8120260909e75d387e33a94a00d2`, size `6398368708`.
- The PC module in this folder now defines the corrected contract: Supabase is the only machine transport, Telegram is a human notice to one allowlisted user, ownership is one row with epoch and lease, and a lost lease stops outbound work.
- Local tests cover two missed beats, no double send, a cut connection, a sleeping PC, and both devices silent.

## Still blocked

- https://adrians-mind.vercel.app still serves the older installer hash `6fd040d29a7e4e4ce1fb58e8f7d550ded2f6054ea4b5a061761c7038f4a4b90e`. That mismatch stays until production is moved on purpose. It is not being moved now.
- No Supabase table has been created or written. The contract refuses to pretend a relay exists.
- No Telegram message has been delivered. No allowlisted user ID is stored in this repository.
- Windows launch, autostart on the HP, and a clean install are not proven.
- Signing is intentionally not started.
- The phone package has not started because the live relay, the measured failover time, and a proven Windows install are not done. iOS background wake is not assumed.

## Contract the phone must use

Transport is one Supabase ownership row: `owner`, `epoch`, `lease_expires`. A writer must compare-and-set the epoch. The PC stops every outbound action if it cannot renew. A planned shutdown sets `goingDown`. Two missed 30-second heartbeats, or a going-down mark, let the minute watchdog flip the row to `phone` and raise a human alert. If both sides are silent, the alert is a dead-man notice on a separate channel. A flap cooldown blocks an immediate flip back.

A task is `id`, `state`, `claimed_by`, `epoch`, `lease_expires`, `checkpoint`, `failover_safe`, `protocol_version`. Only `failover_safe` work transfers. The append-only event log is the handoff. Every send carries the message ID and is refused the second time.

Telegram never carries machine state. It notifies Adrian and may carry an approval button for that user ID only. The approval queue is the Supabase row, not a folder that only the PC can see. The phone email token is read and draft. A model reply is a proposal. Both devices honor one pause flag.

The status view may later show primary, heartbeats, queue, approvals, and signature days left. Measured failover time is null until a real run records it.
