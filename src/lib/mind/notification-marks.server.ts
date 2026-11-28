import type { Sql } from "../db.ts";
import { NOTIFICATION_MARK_BATCH, NOTIFICATION_MARK_LIMIT, readNotificationMarks, type NotificationMark } from "./notification-marks.ts";

export function listNotificationMarks(sql: Sql, owner: string) {
  return sql.query<NotificationMark>(`select notice_key as key,visibility from mind_notification_mark
    where user_id=$1 order by marked_at desc,notice_key limit $2`, [owner, NOTIFICATION_MARK_LIMIT]);
}

export async function saveNotificationMarks(sql: Sql, owner: string, input: unknown) {
  const entries = readNotificationMarks(input, NOTIFICATION_MARK_BATCH);
  if (!entries) return { status: 400, body: { error: "These inbox marks could not be validated." } };
  if (!sql.transaction) return { status: 503, body: { error: "Account inbox storage is unavailable." } };
  if (entries.length) await sql.transaction(async tx => {
    await tx.query("insert into mind_snapshot(user_id,payload) values($1,'{}'::jsonb) on conflict do nothing", [owner]);
    await tx.query("select user_id from mind_snapshot where user_id=$1 for update", [owner]);
    await tx.query(`insert into mind_notification_mark(user_id,notice_key,visibility)
      select $1,entry.key,entry.visibility from jsonb_to_recordset($2::jsonb) as entry(key text,visibility integer)
      on conflict (user_id,notice_key) do update set visibility=excluded.visibility,marked_at=now()
      where mind_notification_mark.visibility<excluded.visibility`, [owner, JSON.stringify(entries)]);
    await tx.query(`delete from mind_notification_mark where user_id=$1 and notice_key in (
      select notice_key from mind_notification_mark where user_id=$1 order by marked_at desc,notice_key offset $2)`,
      [owner, NOTIFICATION_MARK_LIMIT]);
  });
  return { status: 200, body: { saved: true } };
}
