# REA Feature Hunter — Adrian's Mind blueprint gap cycle 1

- **When:** 2026-11-03 ~02:02 WAT (Africa/Lagos)
- **Cycle:** 1 (continuous analysis, internal lane)
- **Live site:** https://adrians-mind.vercel.app
- **Repo:** emzylavish-art/adrians-mind-command-os
- **Refs:** `main` @ `014b36d7f891ee5497d404b04c511e6363dff8d2` · `preview/integration` tip @ `bba4e849c107acaaf0ff18e1afa186b46c90a5e6` (includes `4af6cc9`)
- **Authorized local tree scanned:** `/workspace/audit/edurain-baseline` @ `4af6cc9` (folder name is a legacy search artifact only — product name is Adrian's Mind)
- **Blueprint doc:** **Not found.** Notion search for search-term "Edurain" returned zero pages; pillar-name search found Voice Cloning Studio / Whisper-related handoffs but no master blueprint page. Spec used = four named pillars below.
- **Audience:** Gap Dispatcher

---

## 1. Tool discovery (source-verified + safety)

| Path | Role | Source-verified | Safe to run this cycle |
| --- | --- | --- | --- |
| `tools/registry.json` (on **main** only) | Machine registry | Yes @ `014b36d` | Read-only inventory |
| `tools/rea/rea.py` | REA CLI (offline repo recon) | Yes — status `implemented` | **Yes** — no network, no writes to target, no secrets printed |
| `tools/security_review/security_review.py` | Defensive static review (registry: *Mind Command OS Security Review*; **no** literal `security.scan` binary) | Yes — status `implemented` | **Yes** — offline heuristics, redacts secret values |
| `tools/knowledge/knowledge_search.py` | Local lexical search | Yes — `implemented` | **Yes** — offline read-only |
| BlackEye | Restricted | Listed `install: blocked` | **EXCLUDED — never run** |
| God's Eyes / GodEye | `identity-unconfirmed` | No callable source | **Not run** |
| Ghidra/JADX/Frida/ZAP/Burp/GDB/x64dbg | source-verified pins, `live: not-connected` | Pins only | **Not run** against live |
| Durable Queue / Allowlisted Worker / Windows Bootstrap | implemented | Writes / installs | **Not run** |

**Note:** REA + security review are **offline directory scanners**. They cannot probe a URL. Live site capture used `curl`. Tools ran against authorized local source (`/workspace/audit/edurain-baseline`).

### Exact paths

- REA CLI: `tools/rea/rea.py` (materialized at `/workspace/rea-captures/tools-main-014b36d/tools/rea/rea.py`)
- Security review (= registry security tool): `tools/security_review/security_review.py`
- Registry: `tools/registry.json`

### Commands that worked (reuse every ~45 min)

```bash
cd /workspace/rea-features-wt && git fetch origin main preview/integration
TOOLS=/workspace/rea-captures/tools-main-014b36d
mkdir -p "$TOOLS" && git archive origin/main tools | tar -x -C "$TOOLS"

python3 "$TOOLS/tools/rea/rea.py" /workspace/audit/edurain-baseline \
  --json --out /workspace/rea-captures/tool-runs-2026-11-03-1/rea-report.json

python3 "$TOOLS/tools/security_review/security_review.py" /workspace/audit/edurain-baseline/src \
  --json --out /workspace/rea-captures/tool-runs-2026-11-03-1/security-scan-src.json

BASE=https://adrians-mind.vercel.app
OUT=/workspace/rea-captures/edurain-live-2026-11-03-1
mkdir -p "$OUT"
for p in / /login /memory /explore /dashboard; do
  safe=$(echo "$p" | tr '/' '_' | sed 's/^_//'); [ -z "$safe" ] && safe=root
  curl -sS -L -o "$OUT/${safe}.html" -w "path=$p http=%{http_code} final=%{url_effective}\n" \
    -A 'Mozilla/5.0 (compatible; REA-FeatureHunter/1.0)' --max-time 30 "$BASE$p"
done
```

### Tool run results (this cycle)

| Tool | Result |
| --- | --- |
| REA | Exit 0 — 1201 files; TS 820; markers network=1689 credentials=690 (locations only) → `tool-runs-2026-11-03-1/rea-report.json` |
| security_review | Exit 0 — 821 files, 59 findings (35 high hardcoded_secret_assignment mostly tests; 24 medium dynamic_eval) → `tool-runs-2026-11-03-1/security-scan-src.json` |
| knowledge_search | Ran; no blueprint master doc hit for search-term Edurain |
| Live curl | `/` 200, `/login` 200, `/memory` 200, `/explore` 200, `/dashboard` → `/login?next=%2Fdashboard` |
| Captures | `/workspace/rea-captures/edurain-live-2026-11-03-1/` (legacy folder name; content is Adrian's Mind live HTML) |
| Command log | `/workspace/rea-captures/tool-runs-2026-11-03-1/commands.log` |

---

## 2. Pillar status vs blueprint (evidence-cited)

| Pillar | Status | Evidence |
| --- | --- | --- |
| **Whisper Flow** (dictation / voice input) | **Partial / live + branch-only delta** | Live HTML contains Dictate/dictation/Speak (`edurain-live-2026-11-03-1/root.html`). Code on **main** `014b36d` and **preview/integration** `bba4e84`: `src/components/mind/dictation-pill.tsx`, `src/lib/mind/voice/dictation.ts`, `src/lib/mind/voice/stt.ts` (xAI `grok-voice-transcribe-2.0`, not OpenAI Whisper), `VoiceModeOverlay` + barge-in in `command-app.tsx`. **Whisper Flow Bot** claimed lane `whisper-flow` @ base `bba4e84` (`/workspace/locks/whisper-flow.lock`) — new `src/lib/mind/whisper-flow/**` not on main/live yet. |
| **Voice Cloning Studio** | **Missing** (branch claimed) | Builtin allowlist only (`ara`,`eve`,…) in `src/lib/mind/voice/voices.ts` on main+preview — no clone upload/train. Lock `/workspace/locks/voice-cloning-studio.lock`; worktree `/workspace/voice-cloning-studio` @ `bba4e84`. **Not live.** |
| **Tool Registry (GodEye only; BlackEye excluded)** | **Partial on main; missing as product GodEye** | `tools/registry.json` on **main** `014b36d` only (absent on `preview/integration`). BlackEye correctly `install: blocked`. God's Eyes = `identity-unconfirmed` / not installed — **no GodEye-only registry**. App MCP registry (`src/lib/mind/mcp/registry.ts`) is separate. |
| **Continuous evolution** | **Partial / branch-heavier** | Intent outcome plane on preview: `src/routes/api/intent/outcomes.ts`, `src/lib/intent/*` (present preview `bba4e84`; outcomes route **not** on main). No in-repo autonomous prod mutator. Controlled evolution = bots/process. |

Supporting audit (read-only): `/workspace/audit/edurain-baseline/AUDIT.md` §6.

Also on preview (noted): Effort↔`MODEL_TIERS` wiring (`composer-modes.ts`, `command-app.tsx`); visual polish pass-9 (`c35c7cc`, `b052ce9`).

---

## 3. Ranked gap list → Gap Dispatcher

| Pri | Gap | Owner | Notes |
| --- | --- | --- | --- |
| **P0** | `XAI_API_KEY` unset in Vercel production | Grok Build / **Zack** | Standing. Live bundle shows "Not configured". Unblocks chat + tiers. |
| **P0** | forbidden_cross_site 403 / login fixes | Grok Build | Standing. Fix on `preview/integration` (login/soft-auth @ `c947fe9`+); **not on main / not verified live**. |
| **P0** | Promote verified `preview/integration` build to live (or reconcile main↔product) | Grok Build | Product tip `bba4e84` ahead of live; deploy author gating in flight. |
| **P1** | Whisper Flow productization (formal dictation lane vs ad-hoc STT) | Voice Integration Bot (+ Whisper Flow Bot lane) | Partial live; whisper-flow branch greenfield. |
| **P1** | Voice Cloning Studio (greenfield) | Voice Wiring Bot / Voice Integration Bot | Missing; studio branch claimed. |
| **P1** | Voice keys / mint honesty in prod (`XAI_VOICE_API_KEY`) | Voice Wiring Bot | client-secret "No speech key…" path when unset. |
| **P2** | Tool Registry: GodEye identity + GodEye-only surface; keep BlackEye blocked | MCP Integration Bot | Registry on main catalog only; GodEye unresolved. |
| **P2** | Continuous evolution loop (intent→proposal→human-gated ship) | Intelligence Evolution | Partial data-plane; no closed loop. |
| **P2** | Effort tier UX vs live model availability | Logic Bot | Wired on preview; dead without XAI key live. |
| **P3** | Visual polish pass-9 / Chat layout not live | Visual Polish | On preview only. |
| **P3** | Dashboard auth-gated Universe (expected) + signed-in verify | Dashboard Bot / Grok Build | `/dashboard` → login; expected per prior owner response. |

---

## 4. Outputs / handoff

- This file: `/workspace/rea-captures/adrians-mind-blueprint-gap-cycle-2026-11-03-1.md`
- Gap Dispatcher inbox: `/workspace/rea-captures/.handoff/gap-dispatcher-inbox.md` (append)
- Docs commit: `docs/rea/` on branch `rea-features` via `/workspace/rea-features-wt`
- Notion child under mirror parent `40bb95f33e42814aacf8c3281b4f528d` (primary `40b1aa27…` inaccessible)

## 5. Zack blockers

1. Set **`XAI_API_KEY`** (and voice key if separate) in Vercel **production**.
2. Confirm/finish **production deploy** of a verified `preview/integration` SHA once author/SSO gates clear.
