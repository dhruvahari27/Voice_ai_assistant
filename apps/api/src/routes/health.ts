import { Router } from "express";
import type pg from "pg";
import type { Redis } from "ioredis";
import type { HealthResponse } from "@voiceops/shared";
import { APP_VERSION } from "../config.js";

async function check(fn: () => Promise<unknown>, timeoutMs = 1500): Promise<"ok" | "down"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return "ok";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export function healthRouter(deps: { pool: pg.Pool; redis: Redis }) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const [db, redis] = await Promise.all([
      check(() => deps.pool.query("SELECT 1")),
      check(() => deps.redis.ping()),
    ]);
    const body: HealthResponse = {
      ok: db === "ok" && redis === "ok",
      db,
      redis,
      version: APP_VERSION,
      time: new Date().toISOString(),
    };
    res.status(body.ok ? 200 : 503).json(body);
  });

  return router;
}
