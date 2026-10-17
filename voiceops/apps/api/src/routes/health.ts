import { Router } from "express";
import { sql } from "drizzle-orm";
import { APP_VERSION } from "../config.js";
import type { Ctx } from "../services/context.js";

export function healthRouter(ctx: Ctx, dbKind: string) {
  const router = Router();
  router.get("/health", async (_req, res) => {
    let db: "ok" | "down" = "ok";
    try {
      await ctx.db.execute(sql`SELECT 1`);
    } catch {
      db = "down";
    }
    res.status(db === "ok" ? 200 : 503).json({ ok: db === "ok", db, database: dbKind, version: APP_VERSION, time: new Date().toISOString() });
  });
  return router;
}
