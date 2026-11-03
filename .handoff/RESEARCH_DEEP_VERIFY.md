# Research Deep — verify (Logic Bot)

**Product:** Adrian's Mind (never Edurain)  
**Branch:** `logic-research-deep`  
**Base:** `origin/logic-build-session` @ `83e027d`  
**When:** 2026-11-02 ~22:43 America/Chicago (CT)

## What landed

1. **`searchWeb` forwards `deep`** (`src/lib/mind/server.ts`) — validator `{ query, deep?, plan?, researchUploads? }` → `performSearch`.
2. **Search | Deep toggle** — persisted `amcos.research.depth.v1` (`research-mode.ts`); Research page + composer; heuristic is suggestion-only.
3. **Editable plan** before deep run (ResearchPanel) → start uses edited `plan[]`.
4. **SSE session** `/api/mind/research/{plan,start,stream,cancel}` — steps / partial / cancel via AbortSignal (BuildSession-style).
5. **Report object** + `.md` export (`buildResearchReport` / `researchReportToMarkdown`).
6. **Provider-neutral MIND_SEARCH adapter** — dedicated `MIND_SEARCH_ENDPOINT`+`KEY` preferred; else xAI Responses `web_search`/`x_search` via inference key (`xai-search-adapter.ts`). No Grok branding in tiers/UI.
7. **Optional `researchUploads`** — `{ name, mime, bytes, excerpts[] }` cited as `from your file` (Media Integration supplies payload).

## Quality gate

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean |
| `npm run test:mind` | **1842 / 1842 pass** |
| `npm run build` | green |
| Live adapter verify | **PASS** (real http(s) URLs; key never printed) |

### Live verify evidence

```
node --experimental-strip-types scripts/research-deep-live-verify.mjs
PASS: inference key loaded server-side (len=84; value not printed)
INFO: backend.kind=xai-adapter
INFO: ok=true configured=true citations=8
CITE: … — https://en.wikipedia.org/wiki/Toledo_Bend_Reservoir
… (tpwd.texas.gov, waterdatafortexas.org, twdb.texas.gov, …)
INFO: deep ok=true steps=2 partial=false cites=8
PASS: live MIND_SEARCH adapter returned real source URLs
```

Full log: `.handoff/RESEARCH_DEEP_LIVE.txt`

## researchUploads shape (for Media Integration)

```ts
type ResearchUpload = {
  name: string;
  mime: string;
  bytes: number;
  excerpts: string[]; // short chunks; cited as url "from your file"
};
```

Pass as `searchWeb({ data: { query, deep, researchUploads } })` or `POST /api/mind/research/start` body field `researchUploads`.

## Open items

| Item | Owner |
|------|-------|
| Visual polish of report pane / plan UI | Visual Polish (`tasks/to-visual-polish.md`) |
| Wire uploads from Media picker into `researchUploads` | Media Integration |
| MCP/Drive read sources + Sites allowlist | MCP |
| Error-banner copy for timeout/partial/rate | Error Banners |
| Voice announce deep complete / barge-in | Voice Integration / Wiring |
| Dashboard research run metrics | Dashboard |
| Merge Gate fold of `logic-research-deep` | Grok Build / Zack |
| Optional: dedicated `MIND_SEARCH_*` on Vercel (adapter works without it) | Grok Build |

## Next justified task

Hand Merge Gate / Grok Build the fold of `logic-research-deep` after Visual Polish wires report layout; Media can attach `researchUploads` independently.

