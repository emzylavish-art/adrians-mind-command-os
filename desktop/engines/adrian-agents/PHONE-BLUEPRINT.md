# Phone companion — not built

This file is the PC-side record of the iPhone 13 Pro companion. It is not an IPA, not a signed app, and not a running phone worker.

The PC half is the heartbeat and handoff module in `failover.mjs`. The phone half starts only after the PC installer that contains this module is published and a clean Windows install is proven. Signing is not done.

Planned phone behaviour, not verified:

- One local model only, loaded while the companion is awake, unloaded when the task finishes. The candidate is Qwen3.5 2B Instruct Q4_K_M. A compatible GGUF is the fallback if that architecture is unsupported. Never run a second model beside it.
- Phone pings every 30 seconds. Two missed PC heartbeats promote the phone to email triage, message triage, and critical notifications. Everything else stays queued for the PC.
- When the PC heartbeat returns, in-flight phone work stays with the phone until it finishes or the PC writes an explicit reclaim. Shared sends read the handoff first.
- Telegram only carries the down and back notices. It does not run the code. iOS cannot keep a Node service after the screen locks.
