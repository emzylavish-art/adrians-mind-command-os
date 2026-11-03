# Media Integration — handoff

**Date:** 2026-11-01 (Africa/Lagos)  
**Branch:** `media-integration`  
**Worktree:** `/workspace/mind-command-os-media`  
**Base:** `aee35a81a07dbf97f58cc609c455b8179efac7a1` (`logic-wiring` tip — model-tier threading)  
**Status:** complete

## Upgrade: Grok Imagine (composer) — 2026-11-01T13:13:17+01:00 (Africa/Lagos)

**Status:** complete on `media-integration`

### Model / endpoint
- Model: `grok-imagine-image` (also listed: `grok-imagine-image-2.0`, `grok-imagine-image-quality`)
- Endpoint: `POST https://api.x.ai/v1/images/generations` with `response_format: b64_json`
- Key: existing `/home/box/.secrets/xai_inference.env` via `resolveXaiInferenceApiKey` (never printed/minted)
- ACL: granted `api-key:endpoint:image` on inference key `0922b6a4-…` via Management API (nested `apiKey.aclStrings` + `fieldMask`) so chat+image work on the same key

### What shipped
- Helper: `src/lib/mind/media/imagine.ts` + `imagine-http.ts`
- Route: `POST /api/mind/media/generate`
- Composer: **Imagine** button + `/imagine <prompt>` in home + chat composers
- Results render as assistant bubble images (existing `MessageBody` / inline image) and stage into `pendingImages` for follow-up vision (Direct Send + Orchestrator Agent)
- Honest errors as composer/`setError` + assistant bubble text (no error-banner components)
- Unit tests: `imagine.test.ts`; live artifact: `/workspace/audit/media-integration/imagine-live.jpg`

### Orchestrator
- Composer path works in both modes: generated images attach for Agent planner vision turns
- Did **not** add a separate agent planner tool registry entry (would touch Logic/agent tool surface) — deferred

### Deferred
- Native Orchestrator `imagine` tool in planner registry
- OneDrive OAuth (MCP)
- Encrypted Drive token without MCP decrypt helper
- `server.ts` mindStatus env-only (voice claim)
- Workspace data-URL bloat / disk cache for huge generations

### Collision notes
- Shared `command-app.tsx` Imagine wiring only; avoided styles.css, voice/, xai-adapter, model picker, MCP OAuth, server.ts


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

---

## Verification gap fixes (2026-11-01) — build step

**Commit:** `57c20a9`  
**Source:** `/workspace/audit/media-integration/VERIFY_REPORT.md`

### Fixed
1. **HIGH** Retry/regenerate retain `Msg.images` (`prepareRetry` / `prepareRegenerate` + `deliver(..., images)`).
2. **HIGH** Follow-up history sends multimodal parts for prior user images (`buildHistoryMessages`, max 3 images / ~2.7M chars budget).
3. **HIGH/ops** Live script + turn/agent key resolution prefer `/home/box/.secrets/xai_inference.env` over a stale `XAI_API_KEY` (`resolveXaiInferenceApiKey`). Did **not** edit `server.ts` (voice claim); `mindStatus` may still reflect process env until that lane adopts the helper.
5. **MED** Client downscale recompresses/rejects past `MAX_DATA_URL_CHARS` with a clear composer error.
6. **MED** `checkTurnSize` counts current + history image data-URL chars.
7. **MED** Non-Grok provider branch returns an honest “cannot see images” error instead of silently dropping them.

### Deferred
4. **MED** Persist/export strategy for full data-URLs in workspace (storage bloat) — not in this step; still useful later.
- `xai-adapter.ts` / error banners / model picker untouched by request.
- Library copy lightly clarified (images can go to vision models in chat).

### Verification this step
- typecheck pass; mind/media tests **237/237**; build pass
- live script with `XAI_API_KEY=invalid-...` still replied **red** via secrets file

## Upgrade A: Orchestrator native `imagine` tool — 2026-11-01T13:30 Africa/Lagos

- Registered `imagine` in `AGENT_TOOLS` (`agent.ts`); validates `prompt`; default executor calls `generateImagineImages`.
- `runBoundedAgent` returns `images[]` for inline client render; `agent-run.server.ts` includes them in JSON.
- Agents panel shows `InlineImage` results and stages into `pendingImages` for follow-up vision.
- Did not touch `model-tiers.ts` or picker UI.
- Tests: agent.test imagine cases + registry includes four tools.


## Upgrade B: Edit with Imagine — 2026-11-01T13:40 Africa/Lagos

- **Supported:** `POST https://api.x.ai/v1/images/edits` with JSON `{ model, prompt, image_url: dataUrl, response_format: "b64_json" }` (live-probed).
- **Not supported:** OpenAI-style `POST /v1/images/variations` returns HTTP 405 — documented via `XAI_IMAGE_VARIATIONS_SUPPORTED = false`; no Variations UI.
- Helper `editImagineImage`; generate route accepts `mode:"edit"` / `image` data URL.
- UI: **Edit with Imagine** on inline bubble images + **Edit** on attachment chips (composer draft = edit instruction).


## Hotfix: client media barrel Node crash — 2026-11-01T13:34 Africa/Lagos

- **CRITICAL:** `@/lib/mind/media` re-exported `xai-key.ts` / server `imagine.ts` → Vite client crash `Cannot access node:fs.existsSync`.
- Client barrel now exports only `types`, `data-url`, `pack`, `history`, `imagine-shared`.
- Server helpers via direct imports or `index.server.ts`.
- Guard: `client-barrel.test.ts` fails if barrel export lines pull Node-only modules.
- Playwright: Attach/Camera visible, camera dialog opens, no pageErrors (`v2-barrel-fix-result.json`).


## Fold-in: honesty / export / size cap — 2026-11-01T13:40 Africa/Lagos

- Non-Grok + images returns “cannot see images” **before** missing-key errors.
- `exportChat` keeps `images` (data URLs + names) in the JSON export.
- `MAX_TURN_IMAGE_CHARS` aligned to **2_700_000** (history cap).


## Upgrade C: blob store for large images — 2026-11-01T13:50 Africa/Lagos

- IndexedDB store `amcos.media.blobs.v1` via `blob-store.ts`.
- Persist path compacting: data-URLs ≥ 80k chars → `blobId` refs (dataUrl omitted in localStorage JSON).
- Load path hydrates refs back to data-URLs for display/send.
- Legacy inline-only messages remain valid (backward compatible).
- `exportChat` keeps `dataUrl` and/or `blobId` references.
- `MsgImage.dataUrl` optional; `toImageAttachments` filters for model turns.


## Upgrade D: save/download, camera facing, Library copy — 2026-11-01T13:55 Africa/Lagos

- Inline images: **Save** (stage into composer) + **Download** (browser file).
- Camera: **Switch to front/back** facingMode toggle; restarts stream.
- Library + `describeFile` image copy no longer implies images are useless/not decoded for chat — clarifies Command vision vs Library OCR.


## Next ranked ideas (continuous lane)

1. Multi-image Imagine edits (`multi-image-editing` docs) from several bubble attachments.
2. Server-side media cache (disk/S3) for sync across devices beyond IndexedDB.
3. Camera burst / multiple snapshots into chips before Send.
4. Imagine quality model toggle (`grok-imagine-image-quality`) in composer.
5. Video generation (Grok Imagine video) — separate paid capability; defer until image lane solid.
6. Drag generated image onto Agent goal field as vision input affordance.

## Upgrade: Imagine Quality toggle — 2026-11-01T13:52 Africa/Lagos

- Live catalog includes `grok-imagine-image-quality`.
- Composer **Quality on/off** toggles model for generate + edit requests (`resolveImagineModel`).


## Upgrade: Use generated image as Agent vision input — 2026-11-01T13:55 Africa/Lagos

- **Use as Agent input** on inline images stages into `pendingImages`, opens Agents view.
- Drag generated/inline images onto the Agent goal textarea (`application/x-amcos-image`); file drops also accepted.
- Planner already sends `pendingImages` as vision attachments.

## Next ranked ideas
1. Server-side media cache (deferred)
2. Imagine video generation (deferred)
3. Multi-select chips for edit subset
4. Quality/resolution picker beyond on/off
5. Camera burst countdown / timed interval

## Evolve: dead controls + lightbox zoom + camera mirror — 2026-11-02T20:20:00-06:00 (America/Chicago)

**Branch tip (after push):** see git log on `media-integration`.

### Dead controls (Visual Polish a11y audit)
- **Generate Image** Quick → real `runImagine` from composer prompt / `/imagine`.
- **Generate Video** Quick → honestly `disabled` + `aria-disabled` + title `Coming soon: xAI video generation is not wired…`.
- **Image and video Setup** (ServiceBoard home + Connected) → `Open media` calls `onImageVideoSetup` (nav to command, notice about Imagine/Drive; video not wired).
- **Imagine / Drive / Browse Drive** already did real work; added honest `title` / `aria-label` / `data-media` hooks.

### Evolve (2)
1. Inline image lightbox: zoom in/out (100/150/200/300%) + Download + Close (`media-ui-helpers` zoom steps).
2. Camera **Mirror on/off** (preview `scaleX(-1)` + capture canvas flip) — facingMode switch already existed.

### Visual Polish hooks (`data-media`)
`generate-image`, `generate-video`, `attach`, `attach-image`, `camera`, `drive`, `imagine`, `browse-drive`, `image-video-setup`, `camera-dialog`, `camera-mirror`, `lightbox`, `lightbox-zoom-in`, `lightbox-zoom-out`, `lightbox-download`. No CSS written.

### Tests
- `tsc --noEmit`: pass
- Src unit suite (package.json mind/media list + media-ui-helpers): **340/340**
- Full `npm test` still hits known-red `scripts/**` (`.grok/skills/og` missing) — not this lane

### Next
- Multi-select chips / reorder tray
- Client downscale-quality toggle
- Video gen only if Zack approves spend + endpoint
- Parent: SendToAgent Visual Polish with SHA + hooks (executor lacks SendToAgent tool)

## Evolve round: chips reorder + downscale quality + harden + VP CSS — 2026-11-02T20:30:00-06:00 (America/Chicago)

### Shipped
1. **Attachment chips:** drag reorder, ←/→ keyboard-accessible move, multi-select + Remove selected. `data-media="attachment-chips"` (+ chip/tray hooks).
2. **Attach quality toggle:** Fast / Balanced / Full (persisted `localStorage` key `amcos.media.downscaleQuality.v1`). Feeds `downscale.ts` while keeping canvas EXIF-strip + re-encode + `MAX_DATA_URL_CHARS`.
3. **Harden:** download filenames no longer echo chat/prompt text (`safeImageDownloadName`). Generate Image still routes through `runImagine` → `/api/mind/media/generate` (rate limit + spend ledger). Camera mirror is canvas-only (no EXIF/metadata flag).
4. **Visual Polish CSS cherry-pick:** `ebf7f59` → `styles-media-visual.css` + `@import` in `styles.css` (as-is). VP markup hooks: `cloud-picker`, `attachment-chips`, `inline-image` (+ `data-loading`), `lightbox-close`, `camera-capture`.

### Tests
- tsc pass; src suite **344/344**; `npm run build` pass

## Evolve: camera burst pick + batch Imagine edit — 2026-11-02T20:35:00-06:00 (America/Chicago)

### Camera burst
- Run burst ×3–5 into a tray (EXIF-strip/downscale path). Pick frames, **Attach selected** (respects 4-chip + char budget). Discard / Stop burst. No immediate attach spam.
- Hooks: `camera-burst-tray`, `camera-burst-candidate`, `camera-burst-attach`, `camera-burst-discard`, `camera-burst-cancel`, `camera-burst-size`, `camera-burst-run`.

### Batch Imagine edit
- Replaces multi-image single-call “Edit all” with **sequential** per-image edits through `/api/mind/media/generate` (spend ledger + rate limit each call).
- Cost preview + hard cap `BATCH_EDIT_MAX=4`, Confirm/Cancel, in-flight Stop via AbortController.
- Tab lock + `imagineBusy` guard double-submit / multi-tab.

### Attack fixes
- Burst candidates are data-URLs only (no object URL leaks); cleared on close; MediaStream tracks still stopped.
- Batch/single edit both acquire Imagine tab lock; no auto-retry; abort cancels remaining spend.

### Tests
- tsc pass; src **346/346**; build pass

## Evolve: Use in composer + composer DnD harden (V4 INFO) — 2026-11-02T21:00:00-06:00 (America/Chicago)

### V4 INFO UX
- Image picker is **multiple**.
- Burst default-selects only the **first 2** new frames (pick-2 friendlier).

### Use in composer
- Inline/generated **Use in composer** re-attaches via `dataUrlToDownscaled` (EXIF strip + quality preset), for vision follow-up or Imagine edit. Hook `data-media="use-in-composer"`.

### Composer drag-drop
- Home + chat composers: `data-media="composer-drop"`; shared `accept-image-files` + queued attach. Clear reject text for SVG/HTML/HEIC/non-image (existing `setError`/`setNotice` only).

### Attack
- Magic-byte sniff before canvas in `downscale.ts`.
- SVG/HTML rejected up front; decompression bomb still blocked; rapid drops serialized via attach queue.

### Tests
- tsc pass; src **349/349**; build pass
