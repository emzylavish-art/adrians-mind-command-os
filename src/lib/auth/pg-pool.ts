import { Pool } from "pg";
import { supabasePostgresPoolOptions } from "./postgres-ssl.mjs";

/**
 * Open the deployed Postgres pool with the same pinned Supabase CA used by
 * deploy-time migrations. Certificate verification stays enabled.
 */
export function postgresPool(connectionString: string): Pool {
  return new Pool(supabasePostgresPoolOptions(connectionString));
}
