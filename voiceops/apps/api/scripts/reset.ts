/**
 * Wipe the local database and start fresh (dev only). Next `pnpm dev` re-seeds it.
 * Embedded mode: deletes the data folder. Server mode: drops all tables.
 */
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { resetDatabase } from "../src/db/migrate.js";
import { loadDotEnv } from "../src/env.js";

loadDotEnv();

const config = loadConfig();
if (config.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");

if (config.DATABASE_URL) {
  const handle = await createDb({ url: config.DATABASE_URL });
  await resetDatabase(handle);
  await handle.close();
  console.log("Dropped all tables. Start the app to migrate and seed again.");
} else {
  fs.rmSync(config.PGLITE_DIR, { recursive: true, force: true });
  console.log(`Deleted ${config.PGLITE_DIR}. Start the app to create a fresh database.`);
}
