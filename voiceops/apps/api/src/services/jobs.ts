import { eq, sql } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { jobs } from "../db/schema.js";
import type { Ctx } from "./context.js";

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (ctx: Ctx, payload: Record<string, unknown>, job: JobRow) => Promise<void>;

const IMMEDIATELY = new Date(0);

/** Add a job. With a dedupeKey, a second enqueue of the same key is a no-op. */
export async function enqueue(
  ex: Executor,
  kind: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string } = {},
) {
  await ex
    .insert(jobs)
    // No runAt = run as soon as a worker looks (epoch sorts first, independent of any clock).
    .values({ kind, payload, runAt: opts.runAt ?? IMMEDIATELY, dedupeKey: opts.dedupeKey ?? null })
    .onConflictDoNothing();
}

const MAX_ATTEMPTS = 5;

/**
 * Postgres-backed worker. Claims due jobs with FOR UPDATE SKIP LOCKED, so several API
 * processes can run it without picking the same job twice.
 */
export class JobRunner {
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private ctx: Ctx, private intervalMs = 2000) {}

  register(kind: string, handler: JobHandler) {
    this.handlers.set(kind, handler);
    return this;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Run every due job once. Returns how many ran. Tests call this directly. */
  async tick(limit = 20): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = this.ctx.now();
      const claimed = (await this.ctx.db.execute(sql`
        UPDATE jobs SET status = 'running', attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM jobs WHERE status = 'pending' AND run_at <= ${now.toISOString()}::timestamptz
          ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `)) as unknown as { rows: { id: string }[] };
      for (const { id } of claimed.rows) {
        const [job] = await this.ctx.db.select().from(jobs).where(eq(jobs.id, id));
        if (job) await this.runOne(job);
      }
      return claimed.rows.length;
    } catch (err) {
      this.ctx.logger.error({ err }, "job tick failed");
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Keep ticking until nothing is due (tests). */
  async drain(max = 50) {
    let total = 0;
    for (let i = 0; i < max; i++) {
      const n = await this.tick();
      total += n;
      if (!n) break;
    }
    return total;
  }

  private async runOne(job: JobRow) {
    const handler = this.handlers.get(job.kind);
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(this.ctx, job.payload as Record<string, unknown>, job);
      await this.ctx.db.update(jobs).set({ status: "done", finishedAt: this.ctx.now(), lastError: null }).where(eq(jobs.id, job.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = job.attempts >= MAX_ATTEMPTS;
      this.ctx.logger.warn({ job: job.kind, id: job.id, attempt: job.attempts, err: message }, "job failed");
      await this.ctx.db
        .update(jobs)
        .set({
          status: failed ? "failed" : "pending",
          lastError: message.slice(0, 500),
          runAt: new Date(this.ctx.now().getTime() + 2 ** job.attempts * 15000),
          finishedAt: failed ? this.ctx.now() : null,
        })
        .where(eq(jobs.id, job.id));
    }
  }
}
