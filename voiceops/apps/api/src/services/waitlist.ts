/**
 * Waitlist recovery loop:
 *   cancellation → job finds waiting customers whose window covers the freed time
 *   → holds the slot for 30 min → WhatsApps up to 3 people → first "YES" books it, others hear it's gone.
 */
import { and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { appointments, customers, services, waitlistEntries, waitlistOffers } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { localParts, speakDate, speakInstant, speakTime } from "../lib/time.js";
import { audit } from "./audit.js";
import { confirmHold, holdSlot, releaseHold } from "./booking.js";
import { getBusiness, getService } from "./business.js";
import type { Actor, Ctx } from "./context.js";
import { upsertCustomer } from "./customers.js";
import { enqueue } from "./jobs.js";
import { queueMessage } from "./messages.js";
import { templates } from "./templates.js";

const OFFER_MINUTES = 30;
const OFFER_FANOUT = 3;

export async function joinWaitlist(
  ctx: Ctx,
  input: {
    businessId: string;
    phone: string;
    name?: string | null;
    serviceId: string;
    date: string;
    windowStart: string;
    windowEnd: string;
    callId?: string | null;
    actor: Actor;
  },
) {
  const row = await ctx.db.transaction(async (tx) => {
    const business = await getBusiness(tx, input.businessId);
    const service = await getService(tx, input.businessId, input.serviceId);
    const customer = await upsertCustomer(tx, input.businessId, { phone: input.phone, name: input.name });
    const [entry] = await tx
      .insert(waitlistEntries)
      .values({
        businessId: input.businessId,
        customerId: customer.id,
        serviceId: service.id,
        date: input.date,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        callId: input.callId ?? null,
      })
      .returning();
    await audit(tx, { businessId: input.businessId, actor: input.actor, action: "waitlist.joined", entity: "waitlist", entityId: entry!.id });
    const when = `${speakDate(input.date)}, ${speakTime(input.windowStart)}–${speakTime(input.windowEnd)}`;
    await queueMessage(tx, {
      businessId: input.businessId,
      phone: customer.phone,
      customerId: customer.id,
      kind: "waitlist_joined",
      relatedId: entry!.id,
      body: templates.waitlistJoined(business, { serviceName: service.name, when }),
    });
    return { ...entry!, serviceName: service.name, whenText: when };
  });
  ctx.events.publish({ type: "waitlist.changed", businessId: input.businessId, data: { id: row.id } });
  return row;
}

export async function listWaitlist(ex: Executor, businessId: string) {
  return ex
    .select({ entry: waitlistEntries, serviceName: services.name, customerName: customers.name, phone: customers.phone })
    .from(waitlistEntries)
    .innerJoin(services, eq(services.id, waitlistEntries.serviceId))
    .innerJoin(customers, eq(customers.id, waitlistEntries.customerId))
    .where(and(eq(waitlistEntries.businessId, businessId), inArray(waitlistEntries.status, ["waiting", "offered"])))
    .orderBy(asc(waitlistEntries.date), asc(waitlistEntries.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.entry, serviceName: r.serviceName, customerName: r.customerName, phone: r.phone })));
}

export async function cancelWaitlistEntry(ctx: Ctx, businessId: string, id: string) {
  await ctx.db
    .update(waitlistEntries)
    .set({ status: "cancelled", updatedAt: ctx.now() })
    .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.businessId, businessId)));
  ctx.events.publish({ type: "waitlist.changed", businessId });
}

/** Job: a slot was freed. Offer it to the waitlist. Returns how many people were messaged. */
export async function offerFreedSlot(ctx: Ctx, input: { businessId: string; startsAt: string }): Promise<number> {
  const business = await getBusiness(ctx.db, input.businessId);
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() <= ctx.now().getTime()) return 0;
  const local = localParts(startsAt, business.timezone);

  const candidates = await ctx.db
    .select({ entry: waitlistEntries, phone: customers.phone })
    .from(waitlistEntries)
    .innerJoin(customers, eq(customers.id, waitlistEntries.customerId))
    .where(
      and(
        eq(waitlistEntries.businessId, input.businessId),
        eq(waitlistEntries.status, "waiting"),
        eq(waitlistEntries.date, local.date),
        lte(waitlistEntries.windowStart, local.time),
        gt(waitlistEntries.windowEnd, local.time),
      ),
    )
    .orderBy(asc(waitlistEntries.createdAt));
  if (!candidates.length) return 0;

  // Try each wanted service in queue order until one fits the freed gap.
  const serviceOrder = [...new Set(candidates.map((c) => c.entry.serviceId))];
  for (const serviceId of serviceOrder) {
    let hold;
    try {
      hold = await holdSlot(ctx, {
        businessId: input.businessId,
        serviceId,
        startsAt,
        source: "whatsapp",
        ttlSeconds: OFFER_MINUTES * 60,
      });
    } catch (err) {
      if (err instanceof AppError) continue; // doesn't fit, or already taken
      throw err;
    }
    const chosen = candidates.filter((c) => c.entry.serviceId === serviceId).slice(0, OFFER_FANOUT);
    await ctx.db.transaction(async (tx) => {
      for (const c of chosen) {
        await tx.insert(waitlistOffers).values({
          businessId: input.businessId,
          entryId: c.entry.id,
          holdId: hold.holdId,
          expiresAt: new Date(hold.expiresAt),
        });
        await tx.update(waitlistEntries).set({ status: "offered", updatedAt: ctx.now() }).where(eq(waitlistEntries.id, c.entry.id));
        await queueMessage(tx, {
          businessId: input.businessId,
          phone: c.phone,
          customerId: c.entry.customerId,
          kind: "waitlist_offer",
          relatedId: hold.holdId,
          body: templates.waitlistOffer(business, { serviceName: hold.serviceName, when: hold.when, minutes: OFFER_MINUTES }),
        });
      }
      await enqueue(tx, "offer_expiry", { holdId: hold.holdId, businessId: input.businessId }, { runAt: new Date(hold.expiresAt), dedupeKey: `offer-exp:${hold.holdId}` });
    });
    ctx.events.publish({ type: "waitlist.changed", businessId: input.businessId });
    return chosen.length;
  }
  return 0;
}

/**
 * A customer replied YES on WhatsApp. If they have a live offer, try to book it.
 * Returns what happened so the caller can reply, or null if there was no offer.
 */
export async function acceptOffer(ctx: Ctx, input: { businessId: string; phone: string }) {
  const [offer] = await ctx.db
    .select({ offer: waitlistOffers, entry: waitlistEntries, name: customers.name })
    .from(waitlistOffers)
    .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOffers.entryId))
    .innerJoin(customers, eq(customers.id, waitlistEntries.customerId))
    .where(and(eq(waitlistOffers.businessId, input.businessId), eq(customers.phone, input.phone), eq(waitlistOffers.status, "pending")))
    .orderBy(desc(waitlistOffers.createdAt))
    .limit(1);
  if (!offer) return null;
  const business = await getBusiness(ctx.db, input.businessId);

  if (offer.offer.expiresAt.getTime() < ctx.now().getTime()) {
    await expireOffer(ctx, { businessId: input.businessId, holdId: offer.offer.holdId });
    return { result: "expired" as const };
  }

  try {
    const appt = await confirmHold(ctx, {
      businessId: input.businessId,
      holdId: offer.offer.holdId,
      customer: { phone: input.phone, name: offer.name },
      actionKey: `offer:${offer.offer.id}`,
      actor: { kind: "customer", phone: input.phone },
    });
    await ctx.db.transaction(async (tx) => {
      await tx.update(waitlistOffers).set({ status: "accepted" }).where(eq(waitlistOffers.id, offer.offer.id));
      await tx.update(waitlistEntries).set({ status: "booked", updatedAt: ctx.now() }).where(eq(waitlistEntries.id, offer.entry.id));
      // Everyone else who got this offer: tell them it's gone and put them back in the queue.
      const others = await tx
        .select({ offer: waitlistOffers, phone: customers.phone, customerId: customers.id })
        .from(waitlistOffers)
        .innerJoin(waitlistEntries, eq(waitlistEntries.id, waitlistOffers.entryId))
        .innerJoin(customers, eq(customers.id, waitlistEntries.customerId))
        .where(and(eq(waitlistOffers.holdId, offer.offer.holdId), eq(waitlistOffers.status, "pending")));
      for (const o of others) {
        await tx.update(waitlistOffers).set({ status: "lost" }).where(eq(waitlistOffers.id, o.offer.id));
        await tx.update(waitlistEntries).set({ status: "waiting", updatedAt: ctx.now() }).where(eq(waitlistEntries.id, o.offer.entryId));
        await queueMessage(tx, { businessId: input.businessId, phone: o.phone, customerId: o.customerId, kind: "waitlist_lost", body: templates.offerLost(business) });
      }
    });
    ctx.events.publish({ type: "waitlist.changed", businessId: input.businessId });
    return { result: "booked" as const, appointment: appt };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    await ctx.db.transaction(async (tx) => {
      await tx.update(waitlistOffers).set({ status: "lost" }).where(eq(waitlistOffers.id, offer.offer.id));
      await tx.update(waitlistEntries).set({ status: "waiting", updatedAt: ctx.now() }).where(eq(waitlistEntries.id, offer.entry.id));
      await queueMessage(tx, { businessId: input.businessId, phone: input.phone, kind: "waitlist_lost", body: templates.offerLost(business) });
    });
    ctx.events.publish({ type: "waitlist.changed", businessId: input.businessId });
    return { result: "lost" as const };
  }
}

/** Job: nobody took the offer in time. Release the slot and put people back in the queue. */
export async function expireOffer(ctx: Ctx, input: { businessId: string; holdId: string }) {
  await ctx.db.transaction(async (tx) => {
    const [hold] = await tx.select().from(appointments).where(eq(appointments.id, input.holdId)).limit(1);
    if (hold?.status === "held") await releaseHold(tx, input.businessId, input.holdId);
    const pending = await tx
      .select()
      .from(waitlistOffers)
      .where(and(eq(waitlistOffers.holdId, input.holdId), eq(waitlistOffers.status, "pending")));
    for (const o of pending) {
      await tx.update(waitlistOffers).set({ status: "expired" }).where(eq(waitlistOffers.id, o.id));
      await tx.update(waitlistEntries).set({ status: "waiting", updatedAt: ctx.now() }).where(eq(waitlistEntries.id, o.entryId));
    }
  });
  ctx.events.publish({ type: "waitlist.changed", businessId: input.businessId });
}

/** For "you're on the list for…" read-backs. */
export function describeWindow(date: string, from: string, to: string) {
  return `${speakDate(date)}, between ${speakTime(from)} and ${speakTime(to)}`;
}

export { speakInstant };
