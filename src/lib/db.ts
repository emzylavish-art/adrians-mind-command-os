import { applyMigrationSet } from "../../scripts/migration-runner.mjs";
import { mkdirSync, mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { postgresPool } from "./auth/pg-pool.ts";
import { resolveDatabaseUrl } from "./env.server.ts";
import { localDataPath } from "./local-data.ts";
import { verifyDatabaseReadiness } from "./database-readiness.ts";

/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

// An empty/whitespace DATABASE_URL / POSTGRES_URL (easy misconfig in deploy UIs)
// must mean "unset" — otherwise production would silently run on PGLite.
const databaseUrl =
  typeof process !== "undefined" ? resolveDatabaseUrl(process.env) : undefined;

/**
 * Active backend: real **Postgres** when `DATABASE_URL` or `POSTGRES_URL` is set
 * (deployed / configured sandbox), otherwise a local embedded **PGLite**
 * (Postgres compiled to WASM) so the app has a working database even with
 * nothing configured — the live preview included. On Vercel + Supabase, the
 * integration injects `POSTGRES_URL`; set that (server-only) for durable memory.
 */
export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";

/**
 * Minimal shared SQL surface, satisfied by both Neon and PGLite. Both the
 * tagged-template and `.query()` forms resolve to an array of row objects:
 *
 *   const sql = await getSql();
 *   const rows = await sql`select * from todos where id = ${id}`; // parameterized
 *   const rows2 = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
  transaction?: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
  /** Optional non-result exec (PGLite). */
  exec?: (text: string) => Promise<void>;
  /** Actual backend for this client (pglite_query uses this, not env sniffing). */
  engine?: "pglite" | "postgres";
  /**
   * Neon: borrow one pool client for the duration of fn so SET LOCAL
   * statement_timeout applies, then release.
   */
  withExclusiveClient?: <T>(
    fn: (client: { query: Sql["query"]; exec?: (text: string) => Promise<void> }) => Promise<T>,
  ) => Promise<T>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * pool or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects — and would get memoized, poisoning every later
 * `getSql()`). A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
};

/**
 * Result-type parity: Postgres sends every value as text plus a type OID — the
 * JS value is the DRIVER's parsing choice, and pg and PGLite disagree (pg:
 * int8 -> string, date -> local-midnight Date; PGLite: int8 -> BigInt, which
 * JSON.stringify rejects, date -> UTC Date). Normalize both so preview and
 * production return identical, JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision — cast
 *                                   `::text` if you ever need huge integers)
 *   date                         -> 'YYYY-MM-DD' string
 *   interval                     -> Postgres interval text
 * numeric already comes back as a string on both (arbitrary precision).
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` `Sql` surface. */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    // Regular Postgres driver: node-postgres (`pg`) — works directly with Neon's
    // pooled endpoint. One pool per process; warm serverless instances reuse it.
    const { types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    if (!databaseUrl) throw new Error("DATABASE_URL or POSTGRES_URL is required.");
    const pool = postgresPool(databaseUrl);
    const sql = toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
    sql.engine = "postgres";
    sql.withExclusiveClient = async (fn) => {
      const client = await pool.connect();
      try {
        const exclusive = {
          query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
            const res = await client.query(text, params);
            return res.rows as T[];
          },
          exec: async (text: string) => {
            await client.query(text);
          },
        };
        return await fn(exclusive);
      } finally {
        client.release();
      }
    };
    sql.transaction = (fn) => sql.withExclusiveClient!(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn(toSql(client.query));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
    return sql;
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

async function createPgliteSql(): Promise<Sql> {
  // Embedded Postgres. The file under .data/pglite survives a process restart
  // on this machine. It is not a hosted database and not cloud backup.
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    // Each Node test file has a separate worker process. Share one DB within
    // the process, but never collide on the same PGLite files across workers.
    const dataDir = process.env.NODE_TEST_CONTEXT
      ? mkdtempSync(join(tmpdir(), "adrians-mind-pglite-test-"))
      : localDataPath("pglite");
    if (process.env.NODE_TEST_CONTEXT) {
      // Random directory avoids PID reuse/collisions across parallel executor namespaces.
      // Disposable tests never leave a 40 MB database behind after a normal worker exit.
      process.once("exit", () => { rmSync(dataDir, { recursive: true, force: true }); });
    }
    mkdirSync(dataDir, { recursive: true });
    const pg = new PGlite({
      dataDir,
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // SQL is inlined by the bundler via import.meta.glob (no runtime fs); applied
  // files are tracked in _migrations. The glob does not descend, so the opt-in
  // auth schema under migrations/auth/ stays out. Runs once per module instance
  // — so an HMR reload after adding a migration file applies it live — with
  // passes serialized on a global chain so concurrent callers never
  // double-apply.
  const migrate = async (): Promise<void> => {
    let migrations: Record<string, string>;
    try {
      // Vite replaces this call at build time. Keep the literal call so the
      // plugin can inline the SQL files into the production server bundle.
      migrations = import.meta.glob("/migrations/*.sql", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>;
    } catch (error) {
      // Node's --experimental-strip-types test runner does not supply
      // import.meta.glob. Load the identical migration source from disk
      // without weakening production's Vite bundling path.
      if (!(error instanceof TypeError) ||
          typeof process === "undefined" || !process.cwd()) throw error;
      const folder = join(process.cwd(), "migrations");
      migrations = Object.fromEntries(
        readdirSync(folder)
          .filter((name) => /^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(name))
          .map((name) => ["/migrations/" + name, readFileSync(join(folder, name), "utf8")]),
      );
    }
    await pg.transaction(async (tx) => {
      await applyMigrationSet(tx, migrations);
    });
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined) // an earlier failed pass must not wedge the chain
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  const sql = toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
  sql.transaction = (fn) => pg.transaction((tx) =>
    fn(toSql(async <T>(text: string, params: unknown[]) => (await tx.query<T>(text, params)).rows)),
  );
  sql.engine = "pglite";
  sql.exec = async (text: string) => {
    await pg.exec(text);
  };
  return sql;
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  return dbSource === "neon" ? createNeonSql() : createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client. Postgres when `DATABASE_URL` or
 * `POSTGRES_URL` is set, otherwise the local PGLite fallback. Memoized — safe to call per request.
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query on
 * both backends — define tables there, never inline in server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null; // don't memoize failures — let the next call retry
    throw err;
  });
  return sqlPromise;
}

/**
 * The shared PGLite instance (preview only), with `migrations/*.sql` applied.
 * Lets Better Auth persist to the SAME embedded DB as app data in preview (via a
 * Kysely dialect). Throws when a hosted Postgres URL is set (that path uses pg).
 */
export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (dbSource !== "pglite") {
    throw new Error("getPglite() is only available on the PGLite fallback (no DATABASE_URL/POSTGRES_URL)");
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

/**
 * Finish DB bootstrap before the server handles traffic.
 *
 * - **PGLite** (preview / no hosted URL): open the file database under `.data/pglite` and apply
 *   `migrations/*.sql`. Idempotent — concurrent callers share one promise.
 * - **Neon/Postgres**: read-only connectivity and workspace schema checks.
 *   This does not prove backup recovery, provider availability or migrations outside this schema.
 *
 * Vite `configureServer` awaits this at dev startup. Production callers explicitly
 * initialize on first query; merely importing types/helpers never starts a database.
 */
export function ensureDbReady(): Promise<void> {
  return getSql().then(async (sql) => {
    await verifyDatabaseReadiness(sql);
  });
}
