# Media storage rotation — wiring hooks

This lane owns **new files only** under `src/lib/mind/media/storage/` and
`src/routes/api/mind/media/storage/`. Do **not** edit claimed media-integration
files from this job; call the hooks below from the other lane when ready.

There is one router: `storeMedia()`. Supabase, Google Drive, Dropbox, and
OneDrive are accounts in that rotation. Do not add a second upload router.

## Primary API

```ts
import { storeMedia, storageStatusForOwner } from "@/lib/mind/media/storage";

const result = await storeMedia({
  ownerId,
  bytes,          // Uint8Array
  fileName,       // sanitized server-side
  mimeType,       // optional; also used for Supabase bucket routing
  mediaKind,      // optional: "image" | "camera" | "video" | "audio"
  folderSegments: ["media", "imagine"], // under AdriansMind/
});

const status = await storageStatusForOwner(ownerId);
// status[] includes supabase usedBytes vs capBytes (1 GiB free-plan quota)
```

## Order

When the accounts file is missing, or it matches the example, the order is:

1. **supabase** — 1 GiB project quota. Private buckets `media-images`,
   `media-video`, `media-audio`, `media-camera` (50 MiB per object).
2. **google_drive** — 15 GiB
3. **dropbox** — 2 GiB
4. **onedrive** — 5 GiB

The loop switches when `used + fileSize > cap × 0.9`. It never deletes remote
objects. A file larger than 50 MiB skips Supabase and continues to the next
connected account. `storeMedia()` itself refuses buffers over 512 MiB. The
HTTP upload route still refuses bodies over 50 MiB, which always fit Supabase.

Supabase bucket choice (inside the Supabase provider, not a second router):

| Signal | Bucket |
|---|---|
| `mediaKind: "camera"` or a `camera` folder | `media-camera` |
| video mime, `mediaKind: "video"`, or a `video` folder | `media-video` |
| audio mime, `mediaKind: "audio"`, or an `audio` folder | `media-audio` |
| images, Imagine output (`imagine` folder or image mime) | `media-images` |
| anything else | `media-images` |

An explicit `mediaKind` wins over the folder and the mime type.

Uploads go only to project `xarxhdsnprpnosimehon`
(`https://xarxhdsnprpnosimehon.supabase.co`). Any other project URL is treated
as not configured, and the service key is not sent.

## Credentials (env only, server-side)

| Purpose | Env vars (first match wins) |
|---|---|
| Project URL | `MIND_SUPABASE_URL`, then `SUPABASE_URL` |
| Service key | `SUPABASE_SERVICE_ROLE_KEY`, then `SUPABASE_SECRET_KEY` |

Drive / Dropbox / OneDrive still use `MIND_GOOGLE_DRIVE_TOKEN`,
`MIND_DROPBOX_TOKEN`, and `MIND_ONEDRIVE_TOKEN` (or a ServiceBoard connection
record). Supabase does **not** read a connector record. Do not put the service
key in config, client code, logs, or the audit log. `ENV_KEYS.supabase` is
`SUPABASE_SERVICE_ROLE_KEY`.

## Call sites (document for Media Integration Bot)

1. **Imagine generate success** — after a generated image is ready in
   `imagine-http.ts` / `imagine.ts`, optionally offload with
   `storeMedia({ ..., folderSegments: ["media", "imagine"], mediaKind: "image" })`.
2. **Camera capture persist** — when a capture is saved server-side, call
   `storeMedia({ ..., folderSegments: ["media", "camera"], mediaKind: "camera" })`.
3. **Attachment offload** — large composer attaches can call
   `storeMedia({ ..., folderSegments: ["media", "attachments"] })`.

## Server barrel (optional one-liner)

In `src/lib/mind/media/index.server.ts` add:

```ts
export { storeMedia, storageStatusForOwner } from "./storage/index.ts";
```

Do **not** export storage from the client barrel `index.ts` (barrel guard must pass).

## HTTP routes (already added)

- `POST /api/mind/media/storage/upload` — JSON `{ fileName, mimeType?, mediaKind?, base64, folderSegments? }`
- `GET  /api/mind/media/storage/status` — per-account used/cap + connected, including Supabase used vs the 1 GiB quota

## Brand assets (`media-brand`)

The same Supabase project has a fifth private bucket, `media-brand` (50 MiB per file; png, jpeg, webp, avif, svg, mp4, webm). It holds site chrome: hero backgrounds, card, glass and noise textures, and other brand files. It is not a rotation upload target. Objects live at the same relative path they have under `public/`, with that prefix removed. `public/brand/textures/noise.webp` is object `brand/textures/noise.webp`.

Signing uses the Storage `createSignedUrl` API (`expiresIn: 3600`). The service key stays on the server. Keys are allowlisted and cross-site requests are blocked.

A signed-out caller may only sign `media-brand`. A key prefixed with `media-images/`, `media-video/`, `media-audio/`, or `media-camera/` addresses that user-media bucket (the prefix is not part of the object path). GET and POST both require the app session check (`requireUserId`) before signing those buckets, and respond **401** when nobody is signed in or **403** when auth fails closed. The shared dev user is not a session. `media-brand` keys such as `brand/textures/noise.webp` stay available without a session.

- `GET /api/mind/media/asset-url?key=<key>` → `{ url, expiresAt }`
- `POST /api/mind/media/asset-url` with `{ keys: string[] }` → `{ urls: Record<key, { url, expiresAt }> }`

```ts
import { getAssetUrl, getAssetUrls } from "@/lib/mind/media/storage/asset-url";

const hero = await getAssetUrl("brand/hero/background.webp");
const textures = await getAssetUrls([
  "brand/textures/noise.webp",
  "brand/textures/glass.webp",
]);
```

Import that module directly. Do not import it from the server storage barrel or the client media barrel.

The client keeps each URL in memory until five minutes before `expiresAt`. If Supabase is not configured, the object is missing, or the request fails, the URL is `/` + key (the file already in `public/`). Keys with `..`, a leading slash, or any other extension are rejected. Nothing in this contract uploads or deletes files in `public/`.

## package.json test entry

`src/lib/mind/media/storage/rotation.test.ts`
`src/lib/mind/media/storage/supabase.test.ts`
`src/lib/mind/media/storage/asset-url.test.ts`

## Config

Copy `media-storage-accounts.example.json` to `.data/media-storage-accounts.json`
and replace placeholder emails. No secrets in that file. Supabase is `order: 1`.

## Collision check (2026-11-01T14:50+01:00)

Searched locks/branches/worktrees for **Media Storage Fleet**. No lock, branch, or worktree found. Proceeded with full rotation implementation under `src/lib/mind/media/storage/`.

Supabase Storage was added later on `media-storage-fleet` as the first account in this same rotation.
