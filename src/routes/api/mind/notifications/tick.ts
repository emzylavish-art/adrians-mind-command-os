import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";
import { runNotificationPass } from "@/lib/mind/notification-delivery.server";
import { notificationTransports } from "@/lib/mind/notification-transports.server";

export const Route = createFileRoute("/api/mind/notifications/tick")({ server: { handlers: { POST: async ({ request }) => {
  const json = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const expected = process.env.MIND_NOTIFICATION_WORKER_TOKEN;
  if (!expected || expected.length < 32) return json({ error: "The notification worker is not configured." }, 503);
  const provided = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? "";
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return json({ error: "Worker authorization is required." }, 401);
  const transports = notificationTransports();
  if (!transports.push && !transports.email) return json({ error: "Notification providers are not configured." }, 503);
  try { return json({ summary: await runNotificationPass(await getSql(), transports) }); }
  catch { return json({ error: "The notification pass could not be verified." }, 503); }
} } } });
