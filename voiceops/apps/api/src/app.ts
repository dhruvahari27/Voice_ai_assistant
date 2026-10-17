import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { API_ROOT } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import type { Receptionist } from "./receptionist/index.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { eventsRouter } from "./routes/events.js";
import { healthRouter } from "./routes/health.js";
import { publicRouter } from "./routes/public.js";
import type { Ctx } from "./services/context.js";

export interface AppDeps {
  ctx: Ctx;
  receptionist: Receptionist;
  dbKind: string;
  /** Serve the built React app (production single-process mode). */
  serveWeb?: boolean;
}

function fullUrl(req: { url?: string; originalUrl?: string }) {
  return (req.originalUrl ?? req.url ?? "").split("?")[0];
}

export function createApp({ ctx, receptionist, dbKind, serveWeb }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req) => String((req as { id?: unknown }).id ?? ""),
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/api/v1/events" },
      // One short line per request. Successful reads (the dashboard polls a lot) aren't logged;
      // writes and every failure are.
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400 && res.statusCode !== 401) return "warn";
        if (req.method === "GET" || res.statusCode === 401) return "silent";
        return "info";
      },
      customSuccessMessage: (req, res, ms) => `${req.method} ${fullUrl(req)} ${res.statusCode} ${Math.round(ms)}ms`,
      customErrorMessage: (req, res, err) => `${req.method} ${fullUrl(req)} ${res.statusCode}: ${err.message}`,
      // The message already says it all; don't print the request/response objects too.
      customAttributeKeys: { req: "_req", res: "_res", responseTime: "_ms" },
      serializers: { _req: () => undefined, _res: () => undefined },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: serveWeb
        ? { directives: { "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "connect-src": ["'self'"], "img-src": ["'self'", "data:"], "media-src": ["'self'"] } }
        : false,
    }),
  );
  const allowedOrigins = ctx.config.WEB_ORIGIN.split(",").map((o) => o.trim());
  app.use(cors({ origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(ctx, dbKind));
  app.use("/api/v1", authRouter(ctx));
  app.use("/api/v1", publicRouter(ctx, { receptionist }));
  app.use("/api/v1", eventsRouter(ctx));
  app.use("/api/v1", dashboardRouter(ctx, { receptionist, dbKind }));

  const webDist = path.resolve(API_ROOT, "../web/dist");
  if (serveWeb && fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|health).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
