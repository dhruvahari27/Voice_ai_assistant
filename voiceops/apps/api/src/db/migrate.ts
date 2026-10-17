import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { API_ROOT } from "../config.js";
import type { DbHandle } from "./client.js";

export const MIGRATIONS_DIR = path.join(API_ROOT, "drizzle");

/** Apply all pending SQL migrations in apps/api/drizzle. Safe to run on every start. */
export async function runMigrations(handle: DbHandle) {
  const config = { migrationsFolder: MIGRATIONS_DIR };
  // Both migrators accept the same shape; the cast picks the right one for the driver.
  if (handle.kind === "pglite") await migratePglite(handle.db as never, config);
  else await migratePg(handle.db as never, config);
}

/** Drop everything (dev/test only) so migrations run from scratch. */
export async function resetDatabase(handle: DbHandle) {
  await handle.db.execute(sql.raw("DROP SCHEMA IF EXISTS public CASCADE"));
  await handle.db.execute(sql.raw("DROP SCHEMA IF EXISTS drizzle CASCADE"));
  await handle.db.execute(sql.raw("CREATE SCHEMA public"));
}
