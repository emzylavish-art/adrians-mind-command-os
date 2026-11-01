# Media Integration — handoff

**Date:** 2026-11-01 (Africa/Lagos)  
**Branch:** `media-integration`  
**Worktree:** `/workspace/mind-command-os-media`  
**Base:** `aee35a81a07dbf97f58cc609c455b8179efac7a1` (`logic-wiring` tip — model-tier threading)  
**Status:** complete

## Commits
- `23b2b70` Add multimodal image packaging and data-URL helpers.
- `d1cfb9c` Thread image attachments through Direct and Orchestrator turns.
- `c661582` Wire attach, camera, paste/drop, and inline image bubbles.
- `c6c5894` Add live xAI multimodal verify script and media unit test entry.

## What works
- **Attach / Image:** file picker (`image/*`), client canvas downscale (max 2048px), thumbnail chips with remove, paste + drag-drop onto composer.
- **Camera:** `getUserMedia` preview → canvas snapshot → same packaging; tracks stopped on close; permission-denied message.
- **Direct mode** (`/api/mind/turn`): images sent as OpenAI-compatible `[{type:text},{type:image_url}]` via `assembleTurn` + `relayModelStream`.
- **Orchestrator mode** (`/api/mind/agent` / `runBoundedAgent`): same `images` field; user content may be multimodal parts.
- **Bubbles:** user attachments + markdown `![alt](url)` / data-URLs render inline; click to enlarge.
- **Vision models:** current xAI catalog entries used by model tiers (incl. Fast `grok-4.20-0309-non-reasoning` and Expert `grok-4.5`) all list `input_modalities: image` — no separate vision override needed.

## Live xAI image call
- Script: `scripts/media/live-image-turn.mjs` (loads existing key from env / `/home/box/.secrets/xai_inference.env`; never prints key; did not mint a key).
- Model: `grok-4.20-0309-non-reasoning`
- Reply: **red** (32×32 solid red PNG; `sawImageHint: true`)
- Artifact: `scripts/media/live-image-result.json`

## Tests / build
- `tsc --noEmit`: pass
- Mind + media + app-data/auth unit tests: **228/228 pass**
- Full `npm test` still hits pre-existing `scripts/**` failures for missing gitignored `.grok/skills/og` (same as voice-wiring notes) — not introduced here
- `npm run build`: pass

## Collision notes
- Did **not** edit `styles.css` / Visual Polish files; used existing utility classNames only.
- Did **not** edit failure-states / error banners.
- Did **not** edit `model-tiers.ts` / picker UI.
- Did **not** edit `src/lib/mind/voice/**` or voice components.
- Did **not** edit `xai-adapter.ts` (XAI Verification Bot). Relay `RelayMessage.content` widened to `ChatContent` so arrays pass through JSON as-is.

## Cross-lane requests
### XAI Verification Bot
If/when `xai-adapter.ts` becomes the sole chat caller, please accept `content: string | MultimodalContentPart[]` on user messages (same shape as relay). Optional: expose `callXaiChatMultimodal({ content: ChatContent, ... })`. No change required for current Direct/Orchestrator paths on this branch (they use relay/agent fetch bodies directly).

### Visual Polish Bot
Composer gained Image/Camera controls and attachment chips using existing Tailwind utility classes. Optional polish: dedicated chip spacing / lightbox styles in a **new** `src/components/mind/media/media.css` if desired (this lane avoided new CSS).

### Merge note
Main checkout `/workspace/mind-command-os` remains on Visual Polish with uncommitted edits — do not merge blindly into that worktree.

## Paths touched
See `/workspace/locks/media-integration.lock`.

---

## Cloud file sources (2026-11-01 follow-up) — complete

**Commit:** `332c1f4` Add Google Drive browse-and-attach gated on connection records.

### What works
- Connection-aware status for `google_drive` / `onedrive` via MCP-compatible records under `.data/mind-connectors/<ownerHash>/<source>.json` (same layout MCP uses for Notion OAuth tokens).
- Composer **Drive** button + Library **Browse Drive** open `CloudPicker`.
- If not connected / unsupported: honest copy pointing to **ServiceBoard** (OAuth owned by MCP Integration — not implemented here).
- When connected (record with plaintext test token, or `MIND_GOOGLE_DRIVE_TOKEN` on server): list Drive files + fetch; images → existing multimodal chips/downscale path; text → existing staged-text attach.
- API: `GET /api/mind/media/cloud/status|list`, `POST /api/mind/media/cloud/fetch` (auth required; no secrets in client).

### Stubbed
- **OneDrive:** UI tab + helpers return `unsupported` / not implemented until MCP adds an OneDrive connection + OAuth path.
- **Google Docs native MIME** (`application/vnd.google-apps.*`): refused with clear error (export not wired).
- Encrypted `accessTokenEnc` without MCP decrypt helper: connected record may exist but fetch asks MCP to expose Drive token decrypt/helper.

### Requests for MCP Integration Bot
1. Add `google_drive` (and later `onedrive`) to connector OAuth + `ConnectorId`, writing records into `.data/mind-connectors/.../google_drive.json`.
2. Either allow media to call `getAccessToken(ownerId, "google_drive")` or document a shared server helper so browse works without plaintext tokens / `MIND_GOOGLE_DRIVE_TOKEN`.
3. Surface Drive Connected state on ServiceBoard (MCP already owns that UI).

### Verification
- typecheck pass; mind/media tests **232/232**; build pass.
- Did not edit styles.css, voice/, connectors OAuth, research search, error banners, or xai-adapter.
- Shared `command-app.tsx` edits limited to Drive/cloud picker wiring (voice-integration also claims voice wiring there).
