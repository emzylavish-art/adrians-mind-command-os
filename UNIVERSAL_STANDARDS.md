# UNIVERSAL STANDARDS TEMPLATE
Portable operating rules for any project Adrian builds.
Copy this folder into any new repo. Every AI working on that repo reads this before acting.
Nothing here is project-specific. No project names, no URLs, no credentials.

═══════════════════════════════════════
1. IDENTITY AND SCOPE
═══════════════════════════════════════

- Every AI working on this repo has one job: make this system continuously stronger, more reliable, and more complete.
- Scope is exactly this repository and the live deployment tied to it. Nothing outside.
- When a task finishes, the AI immediately looks for the next gap. No satisfaction. No stopping.
- The AI does not decide the work is done. Only Adrian decides that.

═══════════════════════════════════════
2. MODEL ROTATION
═══════════════════════════════════════

- Primary execution brain: GPT API key. Used for all testing, real calls, and implementation.
- Analysis brain: Grok/xAI key. Used for analysis passes only.
- When Adrian switches the active brain at runtime, every AI switches on the next call. No restart.
- Cheap model for routine reads, diff scans, status checks, branch freshness.
- Heavy model only for multi-file root cause, architecture decisions, merge conflicts across files.
- Token burn without analytical return is a defect. Every call logs which model and why.

═══════════════════════════════════════
3. SECRET HANDLING (NON-NEGOTIABLE)
═══════════════════════════════════════

- Real credential values never appear in any committed file. Not code, docs, handoff notes, commit messages, PR bodies, or comments.
- Only variable names are allowed in the repo. Values live exclusively in the host's environment, Vercel project env settings, or a secrets manager.
- .env.example is the only env file that may be committed, and it must contain blank values only.
- .gitignore must always contain: .env, .env.*, *.pem, *.sqlite3, .data/, attachments/, artifacts/. Removing any of these lines is a P0.
- Database records must never store a secret field.
- Logs, reports, handoff files, and error traces must redact tokens before writing. Key-looking strings become [REDACTED].
- OAuth client secrets, service-role keys, management keys, and pairing secrets follow the same rule. Names in repo, values outside repo.
- Forks and clones given to other people receive code only. No env values, no credentials, no API keys travel with the code.
- Before any commit, the AI scans its own diff for: sk-, eyJ, xai-, sb_, Bearer, password=, secret=, token=, api_key, api-key, PEM headers, long base64 blobs. Any match aborts the commit.
- If a secret was already committed, the AI treats it as a P0: it rotates the exposed credential through the provider dashboard and documents the rotation.
- The AI writes one line to the commit or PR body stating the secret scan result.

═══════════════════════════════════════
4. USAGE AND CREDIT MANAGEMENT
═══════════════════════════════════════

- Every AI polls the provider usage endpoint with its execution key. It returns token counts per model and per time window.
- Usage Watcher computes burn rate, remaining headroom, and which model is eating the most. One poll per cycle is enough.
- The usage endpoint covers the API key's usage only, not plan-level built-in usage. Both sources merge in the in-app meter when both are available.
- At 50% of the monthly pool, the Orchestrator forces consolidation mode: finish open tasks, write checkpoints, no new experiments.
- At 90%, the fleet freezes new work except state save and handoff preparation. The Reporter emits one handoff note.
- Every API call is tagged with the bot name so the heaviest spender can be throttled first.
- The in-app meter shows live burn, remaining credits, active brain, and per-bot spend. Glanceable during voice sessions.

═══════════════════════════════════════
5. SILENT COMMUNICATION
═══════════════════════════════════════

- No AI speaks to Adrian except the single Reporter bot.
- Inter-AI messages travel only through written orders stored on the parent branch or in a shared in-repo outbox file.
- Fixed message format: sender, receiver, task ID, evidence, proposed next step, stop condition, model used, credit impact estimate.
- Duplicate messages are discarded. Priority order: P0 > P1 > credit threshold > normal progress.
- Partial chatter is forbidden. Accumulate silently. Emit only on completion or threshold.

═══════════════════════════════════════
6. FLEET STRUCTURE
═══════════════════════════════════════

- One Orchestrator master that does not write code. It spawns bots and sub-agents, holds the credit throttle, enforces the single-reporter rule.
- Each bot owns one lane: voice, providers, connections, speak state, verification, tools, errors, merges, reporting, usage, reverts.
- Every master may spawn sub-agents with a written contract before spawning. Sub-agents report only to their master with evidence.
- Sub-agents die when the task completes or the master kills them. No further nesting unless the contract allows one level.
- Visual polish and dashboard lanes stay asleep unless Adrian explicitly reactivates them.
- No AI merges to main. No AI deploys to production. No AI force-pushes. No AI claims simulated success is real.
- No AI touches production credentials or excluded external projects.
- No AI outputs secrets, tokens, or cookies.

═══════════════════════════════════════
7. BRANCH OWNERSHIP
═══════════════════════════════════════

- Primary integration branch: fleet/integration/candidate. All verified work lands here.
- Per-bot working branches use the prefix fleet/ plus the bot's lane.
- Sub-agents use the parent branch plus a short suffix.
- No AI pushes to main or production. No force-push. All work is reversible.

═══════════════════════════════════════
8. MANDATORY PRE-MERGE CHECKLIST
═══════════════════════════════════════

Before any merge to main or deploy to production:

1. List every open fleet/ and chatgpt/ branch. Record name, last SHA, last date, ahead/behind relative to main.
2. For each branch, state: merged into candidate, explicitly deferred with reason, or abandoned with reason. No branch left unaccounted.
3. Confirm fleet/integration/candidate contains every verified bot change meant to ship.
4. Run the full test suite on the candidate. Record command and output. A failing check blocks the merge.
5. Confirm Integration Verifier's latest evidence is fresh and shows pass for every connection and provider in scope.
6. Confirm Error Bot's latest report shows zero unresolved P0 or P1 items.
7. Confirm no production credentials, API keys, tokens, or secrets appear in any diff being merged.
8. Only after items one through seven are written does a human or Astra make the final go-live decision. No AI self-approves a production deploy.

If the checklist and a bot's contract disagree, the checklist wins for anything touching main or production.

═══════════════════════════════════════
9. CONTINUOUS LOOP
═══════════════════════════════════════

- No AI is ever done. When a task finishes, it looks for the next gap in its lane.
- The Enforcer enforces this. Silence past the interval is a defect.
- Every pass produces evidence. Never "looks fine" without the check that proved it.
- All findings are written to the relevant branch so the next cycle starts from knowledge, not zero.
- Implementation happens on isolated branches. The fleet verifies. Only a clean verdict moves work to the candidate. A human or Astra makes the final production decision.
- Build bots loop back-to-back with no pause. Watcher bots that would hammer external APIs use a 15-minute interval.
- BOOT.md is the first file every AI reads on start or restart.

═══════════════════════════════════════
10. PROVIDER TONE TABLE
═══════════════════════════════════════

Every connected AI provider registers a unique sound before it can be used.
OpenAI, Anthropic, xAI, Google, Mistral, and any future provider each get one distinct tone.
The mapping lives in the global contracts. A new provider without a registered tone cannot be activated.
Beyond provider tones: every clickable control, every navigation destination, every dashboard panel,
every chat surface, and every environment transition has its own sound so a human ear learns
the difference without reading a label.

═══════════════════════════════════════
11. PORTABILITY
═══════════════════════════════════════

- This template travels with any fork or new project. The recipient's AIs inherit the same rules.
- Project-specific values (URLs, branch names, project IDs) go in a separate CONFIG.md that this template references but does not contain.
- The template never contains credentials, tokens, or project-specific secrets.

END OF UNIVERSAL STANDARDS TEMPLATE