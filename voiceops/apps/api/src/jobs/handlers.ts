import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { appointments, businesses, callbacks, handoffs, knowledgeGaps } from "../db/schema.js";
import { addDays, localParts, speakDate, zonedToUtc } from "../lib/time.js";
import type { Receptionist } from "../receptionist/index.js";
import { expireStaleHolds, getAppointmentView } from "../services/booking.js";
import { checkCallbackSla } from "../services/callbacks.js";
import type { Ctx } from "../services/context.js";
import { getInsights, dailyNumbers } from "../services/insights.js";
import { enqueue, type JobRunner } from "../services/jobs.js";
import { deliverMessage, queueMessage } from "../services/messages.js";
import { templates } from "../services/templates.js";
import { expireOffer, offerFreedSlot } from "../services/waitlist.js";
import { getBusiness } from "../services/business.js";

const str = (v: unknown) => String(v ?? "");

export function registerJobs(runner: JobRunner, deps: { receptionist: Receptionist }) {
  runner
    .register("deliver_message", (ctx, p) => deliverMessage(ctx, str(p.messageId)))

    .register("appointment_reminder", async (ctx, p) => {
      const [a] = await ctx.db.select().from(appointments).where(eq(appointments.id, str(p.appointmentId))).limit(1);
      // Skip if cancelled or moved since the reminder was scheduled.
      if (!a || a.status !== "confirmed" || a.startsAt.toISOString() !== str(p.startsAt)) return;
      const view = await getAppointmentView(ctx.db, a.businessId, a.id);
      if (!view.customer) return;
      const business = await getBusiness(ctx.db, a.businessId);
      await queueMessage(ctx.db, {
        businessId: a.businessId,
        phone: view.customer.phone,
        customerId: view.customer.id,
        kind: `reminder_${str(p.lead)}`,
        relatedId: a.id,
        body: templates.reminder(business, { serviceName: view.serviceName, when: view.when, ref: view.bookingRef ?? "" }, p.lead === "24h" ? "24h" : "2h"),
      });
    })

    .register("waitlist_offer", async (ctx, p) => {
      await offerFreedSlot(ctx, { businessId: str(p.businessId), startsAt: str(p.startsAt) });
    })

    .register("offer_expiry", (ctx, p) => expireOffer(ctx, { businessId: str(p.businessId), holdId: str(p.holdId) }))

    .register("callback_sla", (ctx, p) => checkCallbackSla(ctx, str(p.callbackId)))

    .register("daily_digest", async (ctx, p) => sendDailyDigest(ctx, str(p.businessId), str(p.date)))

    .register("maintenance", async (ctx) => {
      const expired = await expireStaleHolds(ctx.db, ctx.now());
      if (expired.length) {
        const rows = await ctx.db.select({ businessId: appointments.businessId }).from(appointments).where(inArray(appointments.id, expired));
        for (const b of new Set(rows.map((r) => r.businessId))) ctx.events.publish({ type: "appointment.changed", businessId: b });
      }
      await deps.receptionist.closeStaleCalls(15);
      await scheduleRecurring(ctx);
    });
}

/** Make sure the next maintenance tick and each business's evening digest are queued. Idempotent. */
export async function scheduleRecurring(ctx: Ctx) {
  const now = ctx.now();
  const nextMinute = new Date(Math.floor(now.getTime() / 60000) * 60000 + 60000);
  await enqueue(ctx.db, "maintenance", {}, { runAt: nextMinute, dedupeKey: `maintenance:${nextMinute.toISOString()}` });
  const all = await ctx.db.select({ id: businesses.id, tz: businesses.timezone }).from(businesses).where(eq(businesses.status, "active"));
  for (const b of all) {
    const today = localParts(now, b.tz).date;
    for (const date of [today, addDays(today, 1)]) {
      const runAt = zonedToUtc(date, "20:30", b.tz);
      if (runAt > now) await enqueue(ctx.db, "daily_digest", { businessId: b.id, date }, { runAt, dedupeKey: `digest:${b.id}:${date}` });
    }
  }
}

export async function sendDailyDigest(ctx: Ctx, businessId: string, date: string) {
  const business = await getBusiness(ctx.db, businessId);
  if (!business.ownerPhone) return;
  const from = zonedToUtc(date, "00:00", business.timezone);
  const to = zonedToUtc(addDays(date, 1), "00:00", business.timezone);
  const nums = await dailyNumbers(ctx.db, businessId, from, to);
  const cbs = await ctx.db.select({ id: callbacks.id }).from(callbacks).where(and(eq(callbacks.businessId, businessId), eq(callbacks.status, "open")));
  const hos = await ctx.db.select({ id: handoffs.id }).from(handoffs).where(and(eq(handoffs.businessId, businessId), eq(handoffs.status, "open")));
  const [gap] = await ctx.db
    .select({ q: knowledgeGaps.question })
    .from(knowledgeGaps)
    .where(and(eq(knowledgeGaps.businessId, businessId), eq(knowledgeGaps.resolved, false), gte(knowledgeGaps.lastAskedAt, from), lt(knowledgeGaps.lastAskedAt, to)))
    .limit(1);
  const insights = await getInsights(ctx.db, businessId, { days: 7, now: ctx.now() });
  await queueMessage(ctx.db, {
    businessId,
    phone: business.ownerPhone,
    kind: "owner_digest",
    body: templates.ownerDigest({
      date: speakDate(date),
      calls: nums.calls,
      booked: nums.booked,
      callbacksOpen: cbs.length,
      handoffsOpen: hos.length,
      topGap: gap?.q,
      unmet: insights.unmet[0] ? `${insights.unmet[0].label} (${insights.unmet[0].count} callers this week)` : undefined,
    }),
  });
}

