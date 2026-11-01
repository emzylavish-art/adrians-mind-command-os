# Perf Phase A audit (read-only) — 2026-11-02 Africa/Lagos

## Remote tip at audit start
- origin/preview/integration: cc29e961 visual(c96): reassert nav z48/z46 + a11y hits + logo purple after polish
- Unify job (eb-trial-retry): still consolidating; integration.lock held by Grok Build; NOT pushed yet
- Do NOT touch /workspace/eb-trial-retryfix or /workspace/locks/integration.lock

## Already exists (anti-duplication)

### Lazy / code-split
- React.lazy + Suspense for DashboardApp in `src/components/mind/command-app.tsx` (preview/integration, main)
- React.lazy for MonoMotionGraphic in `src/routes/login.tsx`
- BUT `src/routes/dashboard.tsx` EAGERLY imports DashboardApp (pulls 3D on /dashboard route)
- NO `manualChunks` anywhere on audited branches
- NO IntersectionObserver
- `loading="lazy"` only on dashboard-3d HUD images (flyover-hud.tsx, node-detail-panel.tsx)
- InlineImage (`src/components/mind/media/inline-image.tsx`) has NO loading=lazy / decoding=async / IO

### Storage / signed URLs
- NO createSignedUrl / R2 / Backblaze / S3 client code on any remote branch
- NO @aws-sdk/client-s3 or s3-request-presigner in package.json
- Media storage rotation exists: Drive/Dropbox/OneDrive under `src/lib/mind/media/storage/` (media-integration lane) — NOT R2/B2
- Imagine returns data URLs / temporary xAI URLs; client blob-store = IndexedDB (`blob-store.ts`)
- Secrets: no R2/B2 filenames or env keys in /home/box/.secrets
- Vercel env names: only Supabase + DB + XAI (no STORAGE_* / R2 / B2)
- Supabase project xarxhdsnprpnosimehon already has PRIVATE buckets: media-images, media-audio, media-camera, media-video
- Env for service role: SUPABASE_SERVICE_ROLE_KEY (also SUPABASE_SECRET_KEY) present in Vercel + am.env

### Cloud memory / session
- localStorage WORKSPACE_KEY `amcos.workspace.v1` + IndexedDB blobs
- Server: loadMindCopy/saveMindCopy via createServerFn → PGLite/Postgres mind_snapshot (NOT Supabase cloud by default; note says "not cloud backup")
- use-mind-workspace.ts: hydrate local first, then reconcile with server copy (chooseServerSync)
- Pattern store tables ALREADY LIVE in Supabase: patterns, pattern_outcomes, pattern_adjustments, pattern_proposals
- mind_* tables ALREADY LIVE in Supabase public schema
- Migrations on remotes: 0001–0004 only; 0005_intel_patterns.sql + 0006_pattern_proposals.sql exist in unify worktree (service-role RLS style), will land with unify
- No dedicated chat_sessions/messages Supabase tables beyond mind_chat/mind_snapshot

### CSS/JS defer
- No deferred non-critical CSS strategy; vite.config has no rollup manualChunks / cssCodeSplit tweaks
- dashboard-3d.css co-located with 3D

## Gaps to implement (Phase B) — only missing pieces
1. S3-compatible storage provider (R2/B2 via @aws-sdk) using STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_REGION=auto; fallback to Supabase Storage signed URLs when STORAGE_* absent
2. Lazy image component + wire Imagine/media render sites; signed URL server fn
3. manualChunks for three / examples / postprocessing; ensure landing+chat don't pull three; lazy dashboard route
4. Defer non-critical routes/panels/CSS; preload critical fonts only
5. Cloud memory: if still local-server-only after unify, add 0007 migration + server fns writing to Supabase (or verify mind_snapshot already on Supabase DATABASE_URL) + local-first hydrate (partially exists)

## Committed media assets (migrate to bucket later) — 62 files, ~5.86 MiB
See inventory; largest are public/dashboard-3d/art-src/*.jpg and art/*.webp portraits/scenes/backdrops.

## Lane boundaries (steering 2026-11-02)
- OUT OF SCOPE: dashboard-3d scene internals (Dashboard Bot); CSS critical/defer + decorative texture lazy (Visual Polish / visual/perf-assets)
- IN SCOPE: vite manualChunks (vendor-three, vendor-postfx, vendor-charts, vendor-voice, vendor-media); TanStack route-level splitting; dynamic import of heavy voice/media from shell; S3 signed URL layer + LazyImagine/media img; vercel.json long-cache for /assets/* /art/* + keep deploymentEnabled; Supabase cloud memory

## Route-split blockers (report)
1. `src/routeTree.gen.ts` statically imports EVERY page route (including dashboard). No `autoCodeSplitting` in vite/`tanstackStart()` config observed — without enabling it (or converting to lazy route files), the generated tree keeps eager imports.
2. `src/routes/dashboard.tsx` imports `@/lib/auth/verify.server` in beforeLoad — **breaks client build** via import-protection (baseline `VERCEL=1 npm run build` failed on this). Also static-imports DashboardApp. Dashboard Bot owns scene; we can only fix route wrapper for splitting/server-fn if in our lane — verify.server import is a server/router blocker for splitting+build.
3. Landing `src/routes/index.tsx` → CommandApp statically imports large voice/* and media/* module graphs into the shell chunk; needs dynamic import() boundaries (our lane).
4. DashboardApp is already React.lazy inside command-app (good for in-app panel) but /dashboard route bypasses that.

## Storage steering update
- Prefer S3-compatible R2/B2 via @aws-sdk/client-s3 + s3-request-presigner; env STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_REGION=auto
- Fallback Supabase Storage signed URLs only when STORAGE_* absent
- Account setup separate; don't block

## Steering updates incorporated
- Storage owner: Media Storage Fleet → Supabase Storage project xarxhdsnprpnosimehon (NOT build full storage layer)
- Contract (from /workspace/audit/perf/owner-prompts.md): getAssetUrl/getAssetUrls in src/lib/mind/media/storage/asset-url.ts on branch media-storage-fleet (WIP, NOT on GitHub); endpoint /api/mind/media/asset-url; bucket media-brand; fallback /<key>
- Visual Polish has swap point in src/visual/resolve-asset-urls.ts (visual/perf-assets worktree)
- Do NOT touch dashboard-3d internals or CSS defer

## Media Storage Fleet status (Phase A)
- Remotes: NO createSignedUrl / storage.from signed-URL implementation on any GitHub branch
- Existing media/storage/* = Drive/Dropbox/OneDrive rotation only (media-integration)
- Buckets live (private): media-audio, media-camera, media-images, media-video, media-brand (new); object counts = 0
- /workspace/media-storage-fleet = status scripts only, not the asset-url.ts module
- Phase B plan: thin adapter getSignedAssetUrl(path) + server fn createSignedUrl marked REPLACE-BY-FLEET; lazy media component consuming it; Imagine/chat imgs

## Chunk split anti-duplication
- MCP Integration Bot local commit 4a79f1a on /workspace/perf-audit (perf-split, NOT on origin yet): environments.client build.rollupOptions.output.codeSplitting.groups for three + dashboard-3d
- Rolldown: manualChunks IGNORED when codeSplitting set — use codeSplitting.groups (vendor-voice, vendor-media, vendor-charts, vendor-postfx extensions)
- Baseline (cc29e96, measure patch): entry index ~430 kB; dashboard-app 696.78 kB held three
- After MCP split: three 576.31 + dashboard-3d 99.44 + dashboard-app 22.04; entry still ~430 kB; three NOT in entry
- Remaining for us: voice/media dynamic import from command-app shell; extend groups; vercel cache headers; cloud memory; thin signed URL adapter

## Committed Imagine/media assets (for Fleet migration)
62 files ~5.86 MiB under public/ — see .handoff/repo-media-assets.txt
Largest: public/dashboard-3d/art-src/*.jpg (~349–499 KB each), art/*.webp portraits/scenes/backdrops, brand textures, avatars

## Fleet client API (authoritative for our lazy media)
- Path: src/lib/mind/media/storage/asset-url.ts
- getAssetUrl(key), getAssetUrls(keys); fallback '/<key>' if storage unset
- Endpoints (Fleet owns — we do NOT implement): GET /api/mind/media/asset-url?key= → {url,expiresAt}; POST {keys:[]} → {urls:{[key]:{url,expiresAt}}}; TTL 3600s
- Bucket media-brand; key = path under public/ (public/art/x.webp → art/x.webp)
- If missing at implement time: create same path+signatures as thin shim returning '/<key>' for clean Fleet replace; flag in report
- No createSignedUrl / storage server code in our commit
