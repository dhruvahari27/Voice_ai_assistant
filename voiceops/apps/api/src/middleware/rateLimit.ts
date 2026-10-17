import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";

/**
 * Fixed-window limiter in memory. Enough for one process; put a shared store (or the proxy's limiter)
 * in front when running several instances.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Parameters<RequestHandler>[0]) => string }): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, opts.windowMs).unref();

  return (req, res, next) => {
    const key = opts.key?.(req) ?? req.ip ?? "unknown";
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader("x-ratelimit-remaining", String(Math.max(0, opts.max - entry.count)));
    if (entry.count > opts.max) {
      res.setHeader("retry-after", String(Math.ceil((entry.reset - now) / 1000)));
      throw new AppError(429, "rate_limited", "Too many requests. Please slow down.");
    }
    next();
  };
}
