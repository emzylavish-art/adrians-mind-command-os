import { createFileRoute } from "@tanstack/react-router";
import { DEV_USER_ID, requireUserId } from "@/lib/auth/verify.server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { getSql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { notificationDeviceId } from "@/lib/mind/notification-delivery";
import { mayDisplayScheduledPush, notificationStatus, updateNotificationDelivery } from "@/lib/mind/notification-delivery.server";
import { notificationTransports } from "@/lib/mind/notification-transports.server";
import { listNotificationMarks, saveNotificationMarks } from "@/lib/mind/notification-marks.server";
import { readJsonObjectBody } from "@/lib/mind/request-body";

const headers = { "cache-control": "private, no-store" };
const json = (body: object, status = 200) => Response.json(body, { status, headers });

async function handle(request: Request) {
  if (!assertSameOrigin(request).ok) return json({ error: "Open this action inside Adrian." }, 403);
  let owner: string;
  try { owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")); }
  catch (error) { return json({ error: "Sign in to manage notification delivery." }, sessionErrorStatus(error)); }
  if (owner === DEV_USER_ID) return json({ error: "Sign in to manage notification delivery." }, 401);
  try {
    const params = new URL(request.url).searchParams;
    const sql = await getSql();
    if (request.method === "GET" && params.has("receipt")) {
      const allowed = await mayDisplayScheduledPush(sql, owner, params.get("device") ?? "", params.get("receipt") ?? "");
      return new Response(null, { status: allowed ? 204 : 404, headers });
    }
    const transports = notificationTransports();
    const workerConfigured = (process.env.MIND_NOTIFICATION_WORKER_TOKEN?.length ?? 0) >= 32;
    if (request.method === "GET") {
      if (params.get("owner") !== owner) return json({ error: "The account changed. Reopen Alerts." }, 409);
      if (params.get("marks") === "1") return json({ marks: await listNotificationMarks(sql, owner) });
      const device = params.get("device");
      if (device && !notificationDeviceId(device)) return json({ error: "Invalid browser registration." }, 400);
      return json(await notificationStatus(sql, owner, device, transports, workerConfigured));
    }
    const payload = await readJsonObjectBody(request, 50000);
    if (!payload.ok) return json({ error: payload.error }, payload.status);
    if (payload.body.owner !== owner) return json({ error: "The account changed. Reopen Alerts." }, 409);
    if (payload.body.action === "mark") {
      const saved = await saveNotificationMarks(sql, owner, payload.body.marks);
      return json(saved.body, saved.status);
    }
    if (Buffer.byteLength(JSON.stringify(payload.body)) > 8192) return json({ error: "The notification request is too large." }, 413);
    if (payload.body.action === "enable" && !workerConfigured) return json({ error: "The notification worker is not configured." }, 503);
    const updated = await updateNotificationDelivery(sql, owner, payload.body, transports);
    return json(updated.body, updated.status);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") return json({ error: "The subscription changed elsewhere. Reopen Alerts before retrying." }, 409);
    return json({ error: "Notification storage could not confirm this action." }, 503);
  }
}

export const Route = createFileRoute("/api/mind/notifications")({ server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } } });
