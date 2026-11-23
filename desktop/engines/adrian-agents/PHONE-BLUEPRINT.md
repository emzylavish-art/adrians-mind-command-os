# Phone companion — not built

This is the PC-side record of the iPhone 13 Pro companion. It is not an IPA. No phone code has been started. Signing is not done. A clean Windows install has not been proven.

The PC half that exists is `failover.mjs`: a 30-second heartbeat, two missed beats, a handoff record, and a review refusal for send, delete, deploy, and commit. The packed installer on this machine contains that module. Production and the phone app do not yet count as done.

## Planned phone behaviour

Target: iPhone 13 Pro, 6 GB RAM, 128 GB, current iOS. The phone is a summoned worker, not a second Mind OS and not a server. iOS will not keep a Node service or a large model alive after the screen locks.

- One local model only, loaded while the companion is awake and unloaded when the task finishes. Candidate: Qwen3.5 2B Instruct Q4_K_M, about 1.31 GB. A compatible GGUF is the fallback if that architecture is unsupported. Never run a second model beside it.
- Phone pings every 30 seconds. Two missed PC heartbeats promote the phone to email triage, message triage, and critical notifications. Everything else stays queued for the PC.
- When the PC heartbeat returns, in-flight phone work stays with the phone until it finishes or the PC writes an explicit reclaim. Shared sends read the handoff first.
- Telegram only carries the down and back notices. It does not run the code.
- Screen control, local Git, and optional channel drafts are planned phone-native work. They are not installed or tested.
- Irreversible actions stay in the shared review folder unless a narrow auto-policy is later tested and explicitly enabled.
- Offline work is the local model, shared local files, and local commits. Online work may add a connected API and the PC when it is reachable.

## Not verified

The phone is done only after Adrian confirms an offline model reply, promotion and demotion, no duplicate sends, one approved screen action, a real Telegram notice, the review queue, wake after lock, and clean recovery. None of those have been run.

Linux cannot compile the IPA. The sideload path, when that work starts, is SideStore with the already installed LocalDevVPN, then the companion, one GGUF, and the shared status endpoint. Disk target is under 3.5 GB. That package does not exist.
