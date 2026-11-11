import { randomBytes } from "node:crypto";
import { getSql } from "../../db.ts";

export async function recordKimiAttempt(input: { ownerId: string; status: string; error?: string }): Promise<boolean> {
  try {
    const sql = await getSql();
    const id = randomBytes(8).toString("hex");
    await sql.query(
      "insert into mind_kimi_session (user_id, id, title, status) values ($1, $2, $3, $4)",
      [input.ownerId, id, (input.error || "").slice(0, 180), input.status.slice(0, 40)],
    );
    return true;
  } catch {
    return false;
  }
}
