import { and, count, eq, gte, inArray, lt, ne } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { appointments } from "../db/schema.js";
import { policyViolation } from "../lib/errors.js";
import { addDays, addMinutes, localParts, zonedToUtc } from "../lib/time.js";
import type { PolicyRow } from "./business.js";
import type { Actor } from "./context.js";

/** Lead time and booking horizon. Opening hours and closures are enforced by availability. */
export function checkStartAllowed(policy: PolicyRow, startsAt: Date, now: Date) {
  if (startsAt.getTime() <= now.getTime()) {
    throw policyViolation("in_past", "That time has already passed.");
  }
  if (startsAt.getTime() < addMinutes(now, policy.minLeadMinutes).getTime()) {
    throw policyViolation(
      "min_lead",
      `Bookings need at least ${policy.minLeadMinutes} minutes' notice.`,
      { minLeadMinutes: policy.minLeadMinutes },
    );
  }
  if (startsAt.getTime() > addMinutes(now, policy.maxHorizonDays * 24 * 60).getTime()) {
    throw policyViolation(
      "horizon",
      `We take bookings up to ${policy.maxHorizonDays} days ahead.`,
      { maxHorizonDays: policy.maxHorizonDays },
    );
  }
}

/** Stops one caller from blocking the whole day. Staff can override. */
export async function checkDailyLimit(
  ex: Executor,
  opts: { businessId: string; customerId: string; startsAt: Date; tz: string; policy: PolicyRow; excludeId?: string },
) {
  const day = localParts(opts.startsAt, opts.tz).date;
  const from = zonedToUtc(day, "00:00", opts.tz);
  const to = zonedToUtc(addDays(day, 1), "00:00", opts.tz);
  const conditions = [
    eq(appointments.businessId, opts.businessId),
    eq(appointments.customerId, opts.customerId),
    inArray(appointments.status, ["pending", "confirmed"]),
    gte(appointments.startsAt, from),
    lt(appointments.startsAt, to),
  ];
  if (opts.excludeId) conditions.push(ne(appointments.id, opts.excludeId));
  const [row] = await ex.select({ n: count() }).from(appointments).where(and(...conditions));
  if ((row?.n ?? 0) >= opts.policy.maxBookingsPerCustomerPerDay) {
    throw policyViolation(
      "daily_limit",
      `You already have ${row?.n} booking(s) that day; the limit is ${opts.policy.maxBookingsPerCustomerPerDay}.`,
      { limit: opts.policy.maxBookingsPerCustomerPerDay },
    );
  }
}

/** Customers and the agent can't cancel or move a booking inside the window; staff can. */
export function checkChangeWindow(policy: PolicyRow, startsAt: Date, now: Date, actor: Actor) {
  if (actor.kind === "user" || actor.kind === "system") return;
  const cutoff = addMinutes(startsAt, -policy.cancelWindowHours * 60);
  if (now.getTime() > cutoff.getTime()) {
    throw policyViolation(
      "cancel_window",
      `Changes need at least ${policy.cancelWindowHours} hours' notice. Our team can help with a callback.`,
      { cancelWindowHours: policy.cancelWindowHours },
    );
  }
}
