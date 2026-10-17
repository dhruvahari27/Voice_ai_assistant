import { createDb } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");

await resetDatabase(url);
await runMigrations(url);
const { db, pool } = createDb(url);
try {
  await seed(db);
} finally {
  await pool.end();
}
console.log("Database reset, migrated and seeded.");
