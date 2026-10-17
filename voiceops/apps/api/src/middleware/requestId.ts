import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * Reuse an incoming X-Request-Id (e.g. from the phone agent) or mint one, and echo it back.
 * pino-http picks it up as req.id, so every log line for this request carries it.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as { id?: unknown }).id = id;
  res.setHeader("x-request-id", id);
  next();
};
