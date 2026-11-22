# local-model-runner

## Purpose
Always-on local nervous system for Adrian Mind OS. Tier-1 doorman (Qwen 0.5B Q4), job loops, three-tier router, proposal-only review queue.

## When to use
Local grunt work and background schedules. Never live social send, production deploy, git commit, or delete.

## Tiers
1. Doorman always on — wake/intent/route/log/heartbeat. Confidence < 0.8 → Tier 2
2. Worker 7B Q4 load-on-demand; hard 30s idle unload; never preload at Mind OS startup
3. Cloud brain via OpenAI Key Proxy — logged to Daily Command Log

## Endpoints
127.0.0.1:9400 — GET /health /jobs /tiers — POST /run /propose /route /tier-feedback

## Safety
Proposes/queues/drafts/flags/summarizes only. Never deletes, sends, deploys, or commits.
Every proposal → local-model/review/<timestamp>-*.md awaiting Adrian or cloud approval.

## Swappability
Drop GGUF into desktop/engines/local-model/models/ and restart. Zero code changes.

## Blueprints
Read-only memory cited when proposing. Never reinvent paid-for rules.

## RAM
Stack ~2–3 GB always-on (Mind OS + engines + 0.5B).

## No-loose-ends rule
Manus does not stop until the installer builds, installs, boots, and every registered loop is proven running on a clean machine path (or documented owner-PC-only if host-bound).

## Obligation skills
See OBLIGATIONS.md and skills/local-ob-*/SKILL.md for each named job.
