import { createApp } from "./app.js";
import { boot } from "./boot.js";
import { loadConfig } from "./config.js";
import { DEMO_LOGIN } from "./db/seed-data.js";
import { loadDotEnv } from "./env.js";

loadDotEnv();

const config = loadConfig();
const { ctx, handle, receptionist, runner, logger } = await boot(config);

// The built server (dist/) also serves the built dashboard, so one process runs everything.
const serveWeb = process.env.SERVE_WEB !== "false" && import.meta.url.includes("/dist/");
const app = createApp({ ctx, receptionist, dbKind: handle.kind, serveWeb });
const server = app.listen(config.API_PORT, () => {
  const web = serveWeb ? `http://localhost:${config.API_PORT}` : config.WEB_ORIGIN;
  logger.info(`API ready on http://localhost:${config.API_PORT}`);
  console.log(
    `\n  VoiceOps is running.\n  Dashboard:  ${web}\n  Sign in:    ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password}\n  Talk page:  ${web}/talk\n`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  runner.stop();
  server.close();
  await handle.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
