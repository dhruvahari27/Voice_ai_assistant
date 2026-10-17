import { createDb } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { TEST_DATABASE_URL } from "./testEnv.js";

/** Rebuild the test database from migrations, then seed AutoCare. */
export default async function setup() {
  await resetDatabase(TEST_DATABASE_URL);
  await runMigrations(TEST_DATABASE_URL);
  const { db, pool } = createDb(TEST_DATABASE_URL);
  try {
    await seed(db);
  } finally {
    await pool.end();
  }
}
