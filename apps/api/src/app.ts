import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type pg from "pg";
import type { Redis } from "ioredis";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { Logger } from "./lib/logger.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { businessRouter } from "./routes/businesses.js";
import { createBusinessService } from "./services/businessService.js";

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: Db;
  pool: pg.Pool;
  redis: Redis;
}

/** Build the Express app from its dependencies. Tests call this with a test DB. */
export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: deps.config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));

  const businesses = createBusinessService(deps.db);

  app.use(healthRouter(deps));
  app.use("/api/v1", businessRouter({ businesses }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
