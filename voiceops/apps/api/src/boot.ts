import type { Config } from "./config.js";
import { createDb, type DbHandle } from "./db/client.js";
import { seedDemoHistory } from "./db/demo.js";
import { runMigrations } from "./db/migrate.js";
import { isEmpty, seed } from "./db/seed.js";
import { DEMO_LOGIN } from "./db/seed-data.js";
import { EventBus } from "./lib/events.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { registerJobs, scheduleRecurring } from "./jobs/handlers.js";
import { Receptionist } from "./receptionist/index.js";
import type { Ctx } from "./services/context.js";
import { JobRunner } from "./services/jobs.js";

export interface Booted {
  ctx: Ctx;
  handle: DbHandle;
  receptionist: Receptionist;
  runner: JobRunner;
  firstRun: boolean;
  logger: Logger;
}

/** Open the database, migrate, seed on first run, wire services, start the job worker. */
export async function boot(config: Config): Promise<Booted> {
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");
  const handle = await createDb(config.DATABASE_URL ? { url: config.DATABASE_URL } : { dataDir: config.PGLITE_DIR });
  logger.info(handle.kind === "pglite" ? `Database: embedded Postgres at ${config.PGLITE_DIR}` : "Database: Postgres server");
  await runMigrations(handle);

  const ctx: Ctx = { db: handle.db, config, logger, events: new EventBus(), now: () => new Date() };
  const firstRun = await isEmpty(handle.db);
  if (firstRun) {
    const business = await seed(handle.db);
    logger.info(`Created demo business "${business.name}"`);
    if (config.SEED_DEMO_HISTORY) {
      const r = await seedDemoHistory(ctx, business.id);
      logger.info(`Loaded demo history: ${r.calls} calls, ${r.appointments} upcoming bookings (remove it in Settings)`);
    }
  }

  const receptionist = new Receptionist(ctx);
  const runner = new JobRunner(ctx);
  registerJobs(runner, { receptionist });
  if (config.JOBS_ENABLED) {
    await scheduleRecurring(ctx);
    runner.start();
  }
  if (firstRun && config.DEMO_LOGIN) logger.info(`Demo sign-in: ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password} (or create your own business on the sign-in page)`);
  logger.info(receptionist.llmAvailable ? `Receptionist: LLM mode available (${config.LLM_MODEL})` : "Receptionist: rules engine (set LLM_API_KEY to enable LLM mode)");
  return { ctx, handle, receptionist, runner, firstRun, logger };
}
