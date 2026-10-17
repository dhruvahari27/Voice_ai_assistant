import { Redis } from "ioredis";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { createLogger } from "../src/lib/logger.js";
import { TEST_DATABASE_URL, TEST_REDIS_URL } from "./testEnv.js";

export function makeTestApp() {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    LOG_LEVEL: "silent",
  });
  const { db, pool } = createDb(TEST_DATABASE_URL);
  const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 1 });
  const app = createApp({ config, logger: createLogger("silent", false), db, pool, redis });
  const close = async () => {
    await pool.end();
    redis.disconnect();
  };
  return { app, db, pool, redis, close };
}
