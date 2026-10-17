import { createDb } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

const { db, pool } = createDb(url);
try {
  const business = await seed(db);
  console.log(`Seeded ${business.name} (${business.slug}).`);
} finally {
  await pool.end();
}
