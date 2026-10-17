import { and, asc, eq, gte } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { businessHours, businesses, closures, policies, resources, services } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { addDays, localParts, minutesOf } from "../lib/time.js";

export type BusinessRow = typeof businesses.$inferSelect;
export type ServiceRow = typeof services.$inferSelect;
export type ResourceRow = typeof resources.$inferSelect;
export type PolicyRow = typeof policies.$inferSelect;
export type HoursRow = typeof businessHours.$inferSelect;

export async function getBusiness(ex: Executor, businessId: string): Promise<BusinessRow> {
  const [b] = await ex.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw notFound("Business");
  return b;
}

export async function getBusinessBySlug(ex: Executor, slug: string): Promise<BusinessRow> {
  const [b] = await ex.select().from(businesses).where(eq(businesses.slug, slug)).limit(1);
  if (!b) throw notFound("Business");
  return b;
}

export async function getPolicy(ex: Executor, businessId: string): Promise<PolicyRow> {
  const [p] = await ex.select().from(policies).where(eq(policies.businessId, businessId)).limit(1);
  if (p) return p;
  const [created] = await ex.insert(policies).values({ businessId }).onConflictDoNothing().returning();
  return created ?? (await getPolicy(ex, businessId));
}

export async function listHours(ex: Executor, businessId: string): Promise<HoursRow[]> {
  return ex
    .select()
    .from(businessHours)
    .where(eq(businessHours.businessId, businessId))
    .orderBy(asc(businessHours.weekday), asc(businessHours.opensAt));
}

export async function listServices(ex: Executor, businessId: string, opts: { includeInactive?: boolean } = {}) {
  return ex
    .select()
    .from(services)
    .where(
      opts.includeInactive
        ? eq(services.businessId, businessId)
        : and(eq(services.businessId, businessId), eq(services.active, true)),
    )
    .orderBy(asc(services.name));
}

export async function getService(ex: Executor, businessId: string, serviceId: string): Promise<ServiceRow> {
  const [s] = await ex
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)))
    .limit(1);
  if (!s) throw notFound("Service");
  return s;
}

export async function listResources(ex: Executor, businessId: string) {
  return ex.select().from(resources).where(eq(resources.businessId, businessId)).orderBy(asc(resources.name));
}

export async function listUpcomingClosures(ex: Executor, businessId: string, fromDate: string) {
  return ex
    .select()
    .from(closures)
    .where(and(eq(closures.businessId, businessId), gte(closures.date, fromDate)))
    .orderBy(asc(closures.date));
}

export async function isClosedOn(ex: Executor, businessId: string, date: string) {
  const [c] = await ex
    .select()
    .from(closures)
    .where(and(eq(closures.businessId, businessId), eq(closures.date, date)))
    .limit(1);
  return c ?? null;
}

/** Is the shop open right now, and when does it next open? Used for greetings and "are you open?". */
export function openStatus(hours: HoursRow[], tz: string, now: Date, closedDates: Set<string> = new Set()) {
  const local = localParts(now, tz);
  const todays = closedDates.has(local.date) ? [] : hours.filter((h) => h.weekday === local.weekday);
  const current = todays.find((h) => local.minutes >= minutesOf(h.opensAt) && local.minutes < minutesOf(h.closesAt));
  if (current) return { open: true as const, closesAt: current.closesAt };
  for (let i = 0; i < 8; i++) {
    const date = addDays(local.date, i);
    if (closedDates.has(date)) continue;
    const wd = (local.weekday + i) % 7;
    const next = hours
      .filter((h) => h.weekday === wd && (i > 0 || minutesOf(h.opensAt) > local.minutes))
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))[0];
    if (next) return { open: false as const, nextOpenDate: date, nextOpensAt: next.opensAt };
  }
  return { open: false as const };
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon–Sat 09:00–20:00; Sun closed" */
export function summariseHours(hours: Pick<HoursRow, "weekday" | "opensAt" | "closesAt">[]): string {
  const byDay = new Map<number, string>();
  for (const h of hours) {
    const span = `${h.opensAt}–${h.closesAt}`;
    byDay.set(h.weekday, byDay.has(h.weekday) ? `${byDay.get(h.weekday)}, ${span}` : span);
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { from: number; to: number; span: string }[] = [];
  for (const wd of order) {
    const span = byDay.get(wd) ?? "closed";
    const last = groups.at(-1);
    if (last && last.span === span) last.to = wd;
    else groups.push({ from: wd, to: wd, span });
  }
  return groups
    .map((g) => `${DAY_SHORT[g.from]}${g.from === g.to ? "" : `–${DAY_SHORT[g.to]}`} ${g.span}`)
    .join("; ");
}
