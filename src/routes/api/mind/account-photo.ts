import { createFileRoute } from "@tanstack/react-router";
import { DEV_USER_ID, requireUserId } from "@/lib/auth/verify.server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { getSql } from "@/lib/db";
import { ACCOUNT_PHOTO_MAX_CHARS, accountPhotoData } from "@/lib/mind/account-photo";
import { readAccountPhoto, saveAccountPhoto } from "@/lib/mind/account-photo.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";

const json = (body: object, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "private, no-store" },
});
const revisionFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handle(request: Request) {
  if (!assertSameOrigin(request).ok) return json({ error: "Open profile settings inside Adrian." }, 403);
  let owner: string;
  try { owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")); }
  catch (error) { return json({ error: "Sign in to manage your account photo." }, sessionErrorStatus(error)); }
  if (owner === DEV_USER_ID) return json({ error: "Sign in to manage your account photo." }, 401);
  try {
    if (request.method === "GET") {
      if (new URL(request.url).searchParams.get("owner") !== owner) return json({ error: "The account changed. Reopen Profile." }, 409);
      return json(await readAccountPhoto(await getSql(), owner));
    }
    const parsed = await readJsonObjectBody(request, ACCOUNT_PHOTO_MAX_CHARS + 8192);
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
    const body = parsed.body;
    if (body.owner !== owner) return json({ error: "The account changed. Reopen Profile." }, 409);
    const revision = body.revision;
    if (revision !== null && (typeof revision !== "string" || !revisionFormat.test(revision))) {
      return json({ error: "Refresh your account photo before saving." }, 400);
    }
    const photo = accountPhotoData(body.dataUrl);
    if (body.dataUrl !== null && !photo) return json({ error: "Choose a supported PNG or JPEG photo." }, 400);
    const saved = await saveAccountPhoto(await getSql(), owner, photo, revision);
    return saved ? json(saved) : json({ error: "Your account photo changed in another session. Refresh before saving again." }, 409);
  } catch {
    return json({ error: "Profile storage could not confirm this action." }, 503);
  }
}

export const Route = createFileRoute("/api/mind/account-photo")({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
});
