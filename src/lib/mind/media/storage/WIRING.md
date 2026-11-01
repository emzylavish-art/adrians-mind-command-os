# Media storage rotation — wiring hooks

This lane owns **new files only** under `src/lib/mind/media/storage/` and
`src/routes/api/mind/media/storage/`. Do **not** edit claimed media-integration
files from this job; call the hooks below from the other lane when ready.

## Primary API

```ts
import { storeMedia } from "@/lib/mind/media/storage";

const result = await storeMedia({
  ownerId,
  bytes,          // Uint8Array
  fileName,       // sanitized server-side
  mimeType,       // optional
  folderSegments: ["media", "imagine"], // under AdriansMind/
});
```

## Call sites (document for Media Integration Bot)

1. **Imagine generate success** — after a generated image is ready in
   `imagine-http.ts` / `imagine.ts`, optionally offload with
   `storeMedia({ ..., folderSegments: ["media", "imagine"] })`.
2. **Camera capture persist** — when a capture is saved server-side, call
   `storeMedia({ ..., folderSegments: ["media", "camera"] })`.
3. **Attachment offload** — large composer attaches can call
   `storeMedia({ ..., folderSegments: ["media", "attachments"] })`.

## Server barrel (optional one-liner)

In `src/lib/mind/media/index.server.ts` add:

```ts
export { storeMedia, storageStatusForOwner } from "./storage/index.ts";
```

Do **not** export storage from the client barrel `index.ts` (barrel guard must pass).

## HTTP routes (already added)

- `POST /api/mind/media/storage/upload` — JSON `{ fileName, mimeType?, base64, folderSegments? }`
- `GET  /api/mind/media/storage/status` — per-account used/cap + connected

## package.json test entry (minimal wiring for the other job)

Add to the `test` script list:

`src/lib/mind/media/storage/rotation.test.ts`

## Config

Copy `media-storage-accounts.example.json` to `.data/media-storage-accounts.json`
and replace placeholder emails. No secrets in that file.

## Collision check (2026-11-01T14:50+01:00)

Searched locks/branches/worktrees for **Media Storage Fleet**. No lock, branch, or worktree found. Proceeded with full rotation implementation under `src/lib/mind/media/storage/`.
