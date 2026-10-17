import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import type { Ctx } from "../services/context.js";

/** Server-Sent Events: the dashboard refreshes the right panels when something happens. */
export function eventsRouter(ctx: Ctx) {
  const r = Router();
  r.get("/events", requireAuth(ctx), (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`event: ready\ndata: {}\n\n`);
    const unsubscribe = ctx.events.subscribe(req.auth!.businessId, (e) => {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data ?? {})}\n\n`);
    });
    const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
  return r;
}
