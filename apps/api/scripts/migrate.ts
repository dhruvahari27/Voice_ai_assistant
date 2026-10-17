import { runMigrations } from "../src/db/migrate.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

await runMigrations(url);
console.log("Migrations applied.");
