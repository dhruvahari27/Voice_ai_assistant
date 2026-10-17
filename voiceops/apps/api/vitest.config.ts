import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each DB test file gets its own in-memory Postgres (PGlite), so files can run in parallel.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
