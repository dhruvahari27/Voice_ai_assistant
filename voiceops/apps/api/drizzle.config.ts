import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` diffs src/db/schema.ts against the last migration and writes new SQL.
// Review every generated file; hand-written SQL (e.g. exclusion constraints) goes in its own migration.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
