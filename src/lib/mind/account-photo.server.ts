import type { Sql } from "../db.ts";
import type { AccountPhoto } from "./account-photo.ts";

const columns = 'data_url as "dataUrl", revision::text';

export async function readAccountPhoto(sql: Sql, owner: string): Promise<AccountPhoto> {
  const [photo] = await sql.query<AccountPhoto>(`select ${columns} from mind_account_photo where user_id=$1`, [owner]);
  return photo ?? { dataUrl: null, revision: null };
}

export async function saveAccountPhoto(sql: Sql, owner: string, dataUrl: string | null, revision: string | null) {
  if (revision === null) {
    const [created] = await sql.query<AccountPhoto>(`insert into mind_account_photo(user_id,data_url)
      values($1,$2) on conflict do nothing returning ${columns}`, [owner, dataUrl]);
    return created;
  }
  const [updated] = await sql.query<AccountPhoto>(`update mind_account_photo
    set data_url=$2, revision=case when data_url is distinct from $2 then gen_random_uuid() else revision end
    where user_id=$1 and revision=$3::uuid returning ${columns}`, [owner, dataUrl, revision]);
  return updated;
}
