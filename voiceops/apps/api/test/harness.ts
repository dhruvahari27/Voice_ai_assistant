import { eq } from "drizzle-orm";
import { loadConfig } from "../src/config.js";
import { createDb, type DbHandle } from "../src/db/client.js";
import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { businesses, services } from "../src/db/schema.js";
import { seed } from "../src/db/seed.js";
import { EventBus } from "../src/lib/events.js";
import { createLogger } from "../src/lib/logger.js";
import { zonedToUtc } from "../src/lib/time.js";
import type { Ctx } from "../src/services/context.js";

/**
 * A fresh, migrated, seeded database per test file.
 * Default: in-memory embedded Postgres. Set TEST_DATABASE_URL to run the same tests against a real server.
 */
export async function makeTestEnv(opts: { now?: string } = {}) {
  const url = process.env.TEST_DATABASE_URL;
  const handle: DbHandle = await createDb(url ? { url } : { dataDir: "memory://" });
  if (url) await resetDatabase(handle);
  await runMigrations(handle);
  const business = await seed(handle.db);

  // A fixed clock: Monday 12 Oct 2026, 10:00 IST unless the test says otherwise.
  let current = opts.now ? new Date(opts.now) : zonedToUtc("2026-10-12", "10:00", "Asia/Kolkata");
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    SEED_DEMO_HISTORY: "false",
    JOBS_ENABLED: "false",
    SESSION_SECRET: "test-secret",
    AGENT_SERVICE_TOKEN: "test-agent-token",
  });
  const ctx: Ctx = {
    db: handle.db,
    config,
    logger: createLogger("silent", false),
    events: new EventBus(),
    now: () => current,
  };

  const svc = await handle.db.select().from(services).where(eq(services.businessId, business.id));
  const serviceId = (name: string) => {
    const s = svc.find((x) => x.name === name);
    if (!s) throw new Error(`no service ${name}`);
    return s.id;
  };

  return {
    handle,
    ctx,
    business,
    businessId: business.id,
    serviceId,
    /** Local IST wall-clock → instant. */
    at: (date: string, time: string) => zonedToUtc(date, time, "Asia/Kolkata"),
    setNow: (d: Date) => {
      current = d;
    },
    advance: (minutes: number) => {
      current = new Date(current.getTime() + minutes * 60000);
    },
    close: () => handle.close(),
    reloadBusiness: async () => (await handle.db.select().from(businesses).where(eq(businesses.id, business.id)))[0]!,
  };
}

export type TestEnv = Awaited<ReturnType<typeof makeTestEnv>>;
