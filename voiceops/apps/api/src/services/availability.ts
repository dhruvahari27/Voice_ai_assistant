import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { appointments } from "../db/schema.js";
import { addDays, addMinutes, localParts, minutesOf, zonedToUtc, hhmm } from "../lib/time.js";
import { getBusiness, getPolicy, getService, isClosedOn, listHours, listResources } from "./business.js";

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  blockedUntil: Date;
  date: string; // local
  time: string; // local "HH:MM"
  freeResourceIds: string[];
}

export interface SlotSearch {
  businessId: string;
  serviceId: string;
  date: string; // local date
  from?: string; // local "HH:MM", inclusive
  to?: string; // local "HH:MM", exclusive (start times)
  now: Date;
  /** Skip lead-time/horizon filtering (staff booking a walk-in). */
  ignorePolicy?: boolean;
}

export interface SlotResult {
  slots: Slot[];
  closed?: "closure" | "no_hours";
  closureReason?: string | null;
}

/**
 * Free start times for one service on one local day.
 * Rows that block a resource: confirmed, pending, and holds that haven't expired.
 * (Expired holds still in status 'held' are swept before any new hold is written.)
 */
export async function findSlots(ex: Executor, q: SlotSearch): Promise<SlotResult> {
  const business = await getBusiness(ex, q.businessId);
  const tz = business.timezone;
  const [policy, service, allResources, hours, closure] = await Promise.all([
    getPolicy(ex, q.businessId),
    getService(ex, q.businessId, q.serviceId),
    listResources(ex, q.businessId),
    listHours(ex, q.businessId),
    isClosedOn(ex, q.businessId, q.date),
  ]);
  if (closure) return { slots: [], closed: "closure", closureReason: closure.reason };

  const weekday = new Date(`${q.date}T12:00:00Z`).getUTCDay();
  const intervals = hours.filter((h) => h.weekday === weekday);
  if (!intervals.length) return { slots: [], closed: "no_hours" };

  const resources = allResources.filter((r) => r.active && r.kind === service.resourceKind);
  if (!resources.length) return { slots: [] };

  const dayStart = zonedToUtc(q.date, "00:00", tz);
  const dayEnd = zonedToUtc(addDays(q.date, 1), "00:00", tz);
  const blocking = await ex
    .select({ resourceId: appointments.resourceId, startsAt: appointments.startsAt, blockedUntil: appointments.blockedUntil })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, q.businessId),
        inArray(appointments.status, ["held", "pending", "confirmed"]),
        lt(appointments.startsAt, addMinutes(dayEnd, 24 * 60)),
        gt(appointments.blockedUntil, addMinutes(dayStart, -24 * 60)),
        or(isNull(appointments.holdExpiresAt), gt(appointments.holdExpiresAt, q.now)),
      ),
    );

  const earliest = addMinutes(q.now, policy.minLeadMinutes).getTime();
  const latest = addMinutes(q.now, policy.maxHorizonDays * 24 * 60).getTime();
  const fromMin = q.from ? minutesOf(q.from) : 0;
  const toMin = q.to ? minutesOf(q.to) : 24 * 60;
  const step = Math.max(5, policy.slotStepMinutes);

  const slots: Slot[] = [];
  for (const interval of intervals.sort((a, b) => a.opensAt.localeCompare(b.opensAt))) {
    const open = minutesOf(interval.opensAt);
    const close = minutesOf(interval.closesAt);
    for (let m = open; m + service.durationMin <= close; m += step) {
      if (m < fromMin || m >= toMin) continue;
      const time = hhmm(m);
      const startsAt = zonedToUtc(q.date, time, tz);
      if (!q.ignorePolicy && (startsAt.getTime() < earliest || startsAt.getTime() > latest)) continue;
      const endsAt = addMinutes(startsAt, service.durationMin);
      const blockedUntil = addMinutes(endsAt, service.bufferMin);
      const free = resources
        .filter((r) => !blocking.some((b) => b.resourceId === r.id && b.startsAt < blockedUntil && b.blockedUntil > startsAt))
        .map((r) => r.id);
      if (free.length) slots.push({ startsAt, endsAt, blockedUntil, date: q.date, time, freeResourceIds: free });
    }
  }
  return { slots };
}

/** The n slots closest to a wanted time, in time order. */
export function nearestSlots(slots: Slot[], wantedTime: string, n = 3): Slot[] {
  const target = minutesOf(wantedTime);
  return [...slots]
    .sort((a, b) => Math.abs(minutesOf(a.time) - target) - Math.abs(minutesOf(b.time) - target))
    .slice(0, n)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Spread picks across the window (first, middle, last) so the caller hears real choices. */
export function spreadSlots(slots: Slot[], n = 3): Slot[] {
  if (slots.length <= n) return slots;
  const picks = new Set<number>([0, Math.floor((slots.length - 1) / 2), slots.length - 1]);
  for (let i = 0; picks.size < n && i < slots.length; i++) picks.add(i);
  return [...picks].sort((a, b) => a - b).map((i) => slots[i]!).slice(0, n);
}

/** First free day (and its slots) on or after `fromDate`, looking ahead up to `days`. */
export async function nextAvailableDay(
  ex: Executor,
  q: Omit<SlotSearch, "date"> & { fromDate: string; days?: number },
): Promise<{ date: string; slots: Slot[] } | undefined> {
  for (let i = 0; i < (q.days ?? 7); i++) {
    const date = addDays(q.fromDate, i);
    const { slots } = await findSlots(ex, { ...q, date });
    if (slots.length) return { date, slots };
  }
  return undefined;
}

export function slotView(s: Slot) {
  return { startsAt: s.startsAt.toISOString(), date: s.date, time: s.time, freeResources: s.freeResourceIds.length };
}

export function todayLocal(now: Date, tz: string) {
  return localParts(now, tz).date;
}
