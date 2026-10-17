/**
 * Booking lifecycle. Every write runs in one transaction and follows the same pipeline:
 *   validate → idempotency (ledger) → policy → confirmation gate → write (DB constraint) → audit → notify.
 *
 * Holds are appointment rows with status 'held'. The exclusion constraint covers held/pending/confirmed,
 * so a hold reserves the slot against every other caller and staff member until it is confirmed or expires.
 */
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode, type Executor, type Tx } from "../db/client.js";
import { appointments, callTurns, customers, resources, services } from "../db/schema.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { bookingRef, refPrefix } from "../lib/ids.js";
import { addMinutes, localParts, speakInstant } from "../lib/time.js";
import { isAffirmative } from "../nlu/entities.js";
import { normalize } from "../nlu/normalize.js";
import { audit } from "./audit.js";
import { findSlots, nearestSlots, slotView } from "./availability.js";
import { getBusiness, getPolicy, getService } from "./business.js";
import type { Actor, Ctx } from "./context.js";
import { upsertCustomer } from "./customers.js";
import { enqueue } from "./jobs.js";
import { once } from "./ledger.js";
import { queueMessage } from "./messages.js";
import { checkChangeWindow, checkDailyLimit, checkStartAllowed } from "./policy.js";
import { templates } from "./templates.js";

export type AppointmentRow = typeof appointments.$inferSelect;
type Source = AppointmentRow["source"];

export interface AppointmentView {
  id: string;
  bookingRef: string | null;
  status: AppointmentRow["status"];
  source: Source;
  serviceId: string;
  serviceName: string;
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  when: string; // "Saturday, 18 October, 6:30 PM"
  pricePaise: number;
  customer: { id: string; name: string | null; phone: string } | null;
  holdExpiresAt: string | null;
  notes: string | null;
  checkedInAt: string | null;
  cancelReason: string | null;
  callId: string | null;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

const viewColumns = {
  a: appointments,
  serviceName: services.name,
  resourceName: resources.name,
  customerName: customers.name,
  customerPhone: customers.phone,
};

function toView(row: {
  a: AppointmentRow;
  serviceName: string;
  resourceName: string;
  customerName: string | null;
  customerPhone: string | null;
}, tz: string): AppointmentView {
  const a = row.a;
  return {
    id: a.id,
    bookingRef: a.bookingRef,
    status: a.status,
    source: a.source,
    serviceId: a.serviceId,
    serviceName: row.serviceName,
    resourceId: a.resourceId,
    resourceName: row.resourceName,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    when: speakInstant(a.startsAt, tz),
    pricePaise: a.pricePaise,
    customer: a.customerId && row.customerPhone ? { id: a.customerId, name: row.customerName, phone: row.customerPhone } : null,
    holdExpiresAt: a.holdExpiresAt?.toISOString() ?? null,
    notes: a.notes,
    checkedInAt: a.checkedInAt?.toISOString() ?? null,
    cancelReason: a.cancelReason,
    callId: a.callId,
    isDemo: a.isDemo,
  };
}

function viewQuery(ex: Executor) {
  return ex
    .select(viewColumns)
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(resources, eq(resources.id, appointments.resourceId))
    .leftJoin(customers, eq(customers.id, appointments.customerId));
}

export async function getAppointmentView(ex: Executor, businessId: string, id: string): Promise<AppointmentView> {
  const business = await getBusiness(ex, businessId);
  const [row] = await viewQuery(ex).where(and(eq(appointments.id, id), eq(appointments.businessId, businessId))).limit(1);
  if (!row) throw notFound("Appointment");
  return toView(row, business.timezone);
}

export async function listAppointments(
  ex: Executor,
  businessId: string,
  q: { from: Date; to: Date; includeInactive?: boolean },
): Promise<AppointmentView[]> {
  const business = await getBusiness(ex, businessId);
  const statuses: AppointmentRow["status"][] = q.includeInactive
    ? ["pending", "confirmed", "completed", "cancelled", "no_show"]
    : ["pending", "confirmed", "completed", "no_show"];
  const rows = await viewQuery(ex)
    .where(
      and(
        eq(appointments.businessId, businessId),
        inArray(appointments.status, statuses),
        gte(appointments.startsAt, q.from),
        lt(appointments.startsAt, q.to),
      ),
    )
    .orderBy(asc(appointments.startsAt));
  return rows.map((r) => toView(r, business.timezone));
}

/** Upcoming live bookings for a caller, soonest first. */
export async function findUpcomingForPhone(ex: Executor, businessId: string, phone: string, now: Date) {
  const business = await getBusiness(ex, businessId);
  const rows = await viewQuery(ex)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(customers.phone, phone),
        inArray(appointments.status, ["pending", "confirmed"]),
        gte(appointments.startsAt, addMinutes(now, -60)),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(5);
  return rows.map((r) => toView(r, business.timezone));
}

export async function findByRef(ex: Executor, businessId: string, ref: string) {
  const [row] = await ex
    .select()
    .from(appointments)
    .where(and(eq(appointments.businessId, businessId), eq(appointments.bookingRef, ref.toUpperCase())))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// holds
// ---------------------------------------------------------------------------

/** Mark holds past their expiry as expired so they stop blocking. Returns ids. */
export async function expireStaleHolds(ex: Executor, now: Date, businessId?: string): Promise<string[]> {
  const rows = await ex
    .update(appointments)
    .set({ status: "expired" })
    .where(
      and(
        eq(appointments.status, "held"),
        lte(appointments.holdExpiresAt, now),
        businessId ? eq(appointments.businessId, businessId) : undefined,
      ),
    )
    .returning({ id: appointments.id });
  return rows.map((r) => r.id);
}

export async function releaseHold(ex: Executor, businessId: string, holdId: string) {
  await ex
    .update(appointments)
    .set({ status: "expired", holdExpiresAt: null })
    .where(and(eq(appointments.id, holdId), eq(appointments.businessId, businessId), eq(appointments.status, "held")));
}

export async function releaseHoldsForCall(ex: Executor, businessId: string, callId: string) {
  await ex
    .update(appointments)
    .set({ status: "expired" })
    .where(and(eq(appointments.businessId, businessId), eq(appointments.callId, callId), eq(appointments.status, "held")));
}

export interface HoldResult {
  holdId: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  when: string;
  pricePaise: number;
  resourceId: string;
}

/**
 * Reserve a slot for a short time while the caller confirms.
 * Throws 409 `slot_unavailable` with up to 3 alternatives when the time isn't free.
 */
export async function holdSlot(
  ctx: Ctx,
  input: {
    businessId: string;
    serviceId: string;
    startsAt: Date;
    source: Source;
    callId?: string | null;
    ttlSeconds?: number;
    /** Staff can place a walk-in inside the lead time. */
    ignorePolicy?: boolean;
    /** Keep other holds from the same call (used when offering a waitlist slot). */
    keepOtherHolds?: boolean;
  },
): Promise<HoldResult> {
  return ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    await expireStaleHolds(tx, now, input.businessId);
    if (input.callId && !input.keepOtherHolds) await releaseHoldsForCall(tx, input.businessId, input.callId);

    const business = await getBusiness(tx, input.businessId);
    const [policy, service] = await Promise.all([getPolicy(tx, input.businessId), getService(tx, input.businessId, input.serviceId)]);
    if (!service.active) throw badRequest("That service isn't offered right now.");
    if (!input.ignorePolicy) checkStartAllowed(policy, input.startsAt, now);

    const local = localParts(input.startsAt, business.timezone);
    const { slots, closed } = await findSlots(tx, {
      businessId: input.businessId,
      serviceId: input.serviceId,
      date: local.date,
      now,
      ignorePolicy: input.ignorePolicy,
    });
    const slot = slots.find((s) => s.startsAt.getTime() === input.startsAt.getTime());
    if (!slot) {
      throw conflict("slot_unavailable", closed ? "We're closed that day." : "That time isn't available.", {
        closed: closed ?? null,
        alternatives: nearestSlots(slots, local.time, 3).map(slotView),
      });
    }

    const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? policy.holdSeconds) * 1000);
    for (const resourceId of slot.freeResourceIds) {
      try {
        const [hold] = await tx.transaction(async (sp) =>
          sp
            .insert(appointments)
            .values({
              businessId: input.businessId,
              serviceId: service.id,
              resourceId,
              status: "held",
              source: input.source,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              blockedUntil: slot.blockedUntil,
              holdExpiresAt: expiresAt,
              pricePaise: service.pricePaise,
              callId: input.callId ?? null,
            })
            .returning(),
        );
        return {
          holdId: hold!.id,
          serviceId: service.id,
          serviceName: service.name,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          when: speakInstant(slot.startsAt, business.timezone),
          pricePaise: service.pricePaise,
          resourceId,
        };
      } catch (err) {
        if (pgErrorCode(err) === PG_EXCLUSION_VIOLATION) continue; // someone took this bay a moment ago; try the next
        throw err;
      }
    }
    throw conflict("slot_taken", "That slot was just taken.", {
      alternatives: nearestSlots(slots.filter((s) => s !== slot), local.time, 3).map(slotView),
    });
  });
}

// ---------------------------------------------------------------------------
// confirmation gate
// ---------------------------------------------------------------------------

/**
 * The agent may only write after the caller said yes. We don't take the model's word for it:
 * the backend reads the caller's latest turn from the transcript and checks it is affirmative.
 */
export async function assertCallerConfirmed(ex: Executor, actor: Actor) {
  if (actor.kind !== "agent") return;
  if (!actor.callId) throw conflict("needs_confirmation", "Agent writes must be tied to a call.");
  const [last] = await ex
    .select({ text: callTurns.text })
    .from(callTurns)
    .where(and(eq(callTurns.callId, actor.callId), eq(callTurns.speaker, "caller")))
    .orderBy(desc(callTurns.seq))
    .limit(1);
  if (!last || !isAffirmative(normalize(last.text).text)) {
    throw conflict("needs_confirmation", "Read the details back and get a clear yes from the caller before booking.");
  }
}

// ---------------------------------------------------------------------------
// confirm / create
// ---------------------------------------------------------------------------

async function lockAppointment(tx: Tx, businessId: string, id: string) {
  const rows = await tx.execute(
    sql`SELECT id FROM appointments WHERE id = ${id} AND business_id = ${businessId} FOR UPDATE`,
  );
  const [row] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.businessId, businessId)));
  void rows;
  if (!row) throw notFound("Appointment");
  return row;
}

async function scheduleReminders(tx: Tx, a: { id: string; startsAt: Date }, now: Date) {
  for (const [lead, minutes] of [["24h", 24 * 60], ["2h", 120]] as const) {
    const runAt = addMinutes(a.startsAt, -minutes);
    if (runAt.getTime() > now.getTime() + 5 * 60000) {
      await enqueue(
        tx,
        "appointment_reminder",
        { appointmentId: a.id, lead, startsAt: a.startsAt.toISOString() },
        { runAt, dedupeKey: `reminder:${a.id}:${lead}:${a.startsAt.toISOString()}` },
      );
    }
  }
}

async function uniqueRef(tx: Tx, businessId: string, businessName: string) {
  for (let i = 0; i < 6; i++) {
    const ref = bookingRef(refPrefix(businessName));
    const [taken] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.businessId, businessId), eq(appointments.bookingRef, ref)))
      .limit(1);
    if (!taken) return ref;
  }
  throw new Error("Could not allocate a booking reference");
}

/** Turn a hold into a confirmed booking for a customer. Idempotent per actionKey. */
export async function confirmHold(
  ctx: Ctx,
  input: {
    businessId: string;
    holdId: string;
    customer: { phone: string; name?: string | null; languagePref?: string | null };
    actionKey: string;
    actor: Actor;
    notes?: string | null;
    /** Staff can exceed the per-customer daily limit. */
    ignoreDailyLimit?: boolean;
    /**
     * Unverified callers (the public web widget) can type any phone number, so their bookings are
     * requests: the slot is reserved but staff confirm it before the customer is told it's final.
     */
    pending?: boolean;
  },
): Promise<AppointmentView & { replayed: boolean }> {
  const { result, replayed } = await ctx.db.transaction(async (tx) => {
    return once(
      tx,
      {
        businessId: input.businessId,
        actionKey: input.actionKey,
        tool: "book_appointment",
        args: { holdId: input.holdId, phone: input.customer.phone },
        callId: input.actor.kind === "agent" ? input.actor.callId : null,
      },
      async () => {
        // Replays skip this: a stored result is returned before we get here.
        await assertCallerConfirmed(tx, input.actor);
        const now = ctx.now();
        const business = await getBusiness(tx, input.businessId);
        const policy = await getPolicy(tx, input.businessId);
        const hold = await lockAppointment(tx, input.businessId, input.holdId);
        if (hold.status !== "held" && hold.status !== "expired") {
          throw conflict("hold_not_active", `This hold is already ${hold.status}.`);
        }
        const customer = await upsertCustomer(tx, input.businessId, {
          phone: input.customer.phone,
          name: input.customer.name,
          languagePref: input.customer.languagePref,
          consent: true,
        });
        if (!(input.ignoreDailyLimit || input.actor.kind === "user")) {
          await checkDailyLimit(tx, {
            businessId: input.businessId,
            customerId: customer.id,
            startsAt: hold.startsAt,
            tz: business.timezone,
            policy,
          });
        }
        const ref = await uniqueRef(tx, input.businessId, business.name);
        try {
          await tx.transaction(async (sp) => {
            await sp
              .update(appointments)
              .set({
                status: input.pending ? "pending" : "confirmed",
                customerId: customer.id,
                bookingRef: ref,
                holdExpiresAt: null,
                notes: input.notes ?? hold.notes,
                updatedAt: now,
              })
              .where(eq(appointments.id, hold.id));
          });
        } catch (err) {
          const code = pgErrorCode(err);
          if (code === PG_EXCLUSION_VIOLATION) throw conflict("slot_taken", "That slot was taken while we were confirming.");
          if (code === PG_UNIQUE_VIOLATION) throw conflict("in_progress", "Please try again.");
          throw err;
        }
        const view = await getAppointmentView(tx, input.businessId, hold.id);
        await audit(tx, {
          businessId: input.businessId,
          actor: input.actor,
          action: input.pending ? "appointment.requested" : "appointment.booked",
          entity: "appointment",
          entityId: hold.id,
          data: { ref, startsAt: view.startsAt, service: view.serviceName, source: hold.source },
        });
        const details = { serviceName: view.serviceName, when: view.when, ref, pricePaise: view.pricePaise };
        await queueMessage(tx, {
          businessId: input.businessId,
          phone: customer.phone,
          customerId: customer.id,
          kind: input.pending ? "booking_requested" : "booking_confirmation",
          relatedId: hold.id,
          body: input.pending ? templates.bookingRequested(business, details) : templates.bookingConfirmation(business, details),
        });
        if (!input.pending && policy.remindersEnabled) await scheduleReminders(tx, { id: hold.id, startsAt: hold.startsAt }, now);
        return view;
      },
    );
  });
  ctx.events.publish({ type: "appointment.changed", businessId: input.businessId, data: { id: result.id } });
  return { ...result, replayed };
}

/** Staff approve a pending request (from the web widget): it becomes a confirmed booking. */
export async function approvePending(ctx: Ctx, input: { businessId: string; appointmentId: string; userId: string }) {
  const view = await ctx.db.transaction(async (tx) => {
    const appt = await lockAppointment(tx, input.businessId, input.appointmentId);
    if (appt.status !== "pending") throw conflict("not_pending", `This booking is ${appt.status}, not waiting for approval.`);
    const now = ctx.now();
    if (appt.startsAt.getTime() < now.getTime()) throw conflict("in_past", "This request is for a time that has already passed. Cancel it instead.");
    const business = await getBusiness(tx, input.businessId);
    const policy = await getPolicy(tx, input.businessId);
    await tx.update(appointments).set({ status: "confirmed", updatedAt: now }).where(eq(appointments.id, appt.id));
    const v = await getAppointmentView(tx, input.businessId, appt.id);
    await audit(tx, {
      businessId: input.businessId,
      actor: { kind: "user", userId: input.userId },
      action: "appointment.approved",
      entity: "appointment",
      entityId: appt.id,
    });
    if (v.customer) {
      await queueMessage(tx, {
        businessId: input.businessId,
        phone: v.customer.phone,
        customerId: v.customer.id,
        kind: "booking_confirmation",
        relatedId: appt.id,
        body: templates.bookingConfirmation(business, { serviceName: v.serviceName, when: v.when, ref: v.bookingRef ?? "", pricePaise: v.pricePaise }),
      });
    }
    if (policy.remindersEnabled) await scheduleReminders(tx, { id: appt.id, startsAt: appt.startsAt }, now);
    return v;
  });
  ctx.events.publish({ type: "appointment.changed", businessId: input.businessId, data: { id: view.id } });
  return view;
}

/** Staff booking from the dashboard: hold + confirm in one step. */
export async function createAppointmentByStaff(
  ctx: Ctx,
  input: {
    businessId: string;
    userId: string;
    serviceId: string;
    startsAt: Date;
    customer: { phone: string; name?: string | null };
    notes?: string | null;
    actionKey: string;
  },
) {
  const hold = await holdSlot(ctx, {
    businessId: input.businessId,
    serviceId: input.serviceId,
    startsAt: input.startsAt,
    source: "staff",
    ignorePolicy: true,
  });
  return confirmHold(ctx, {
    businessId: input.businessId,
    holdId: hold.holdId,
    customer: input.customer,
    actionKey: input.actionKey,
    actor: { kind: "user", userId: input.userId },
    notes: input.notes,
    ignoreDailyLimit: true,
  });
}

// ---------------------------------------------------------------------------
// change / cancel
// ---------------------------------------------------------------------------

async function resolveTarget(tx: Tx, businessId: string, target: { appointmentId?: string; bookingRef?: string }) {
  let id = target.appointmentId;
  if (!id && target.bookingRef) id = (await findByRef(tx, businessId, target.bookingRef))?.id;
  if (!id) throw notFound("Appointment");
  const appt = await lockAppointment(tx, businessId, id);
  if (appt.status !== "confirmed" && appt.status !== "pending") {
    throw conflict("not_active", `This booking is ${appt.status}.`);
  }
  return appt;
}

export async function cancelAppointment(
  ctx: Ctx,
  input: {
    businessId: string;
    target: { appointmentId?: string; bookingRef?: string };
    reason: string;
    actor: Actor;
    actionKey?: string;
  },
): Promise<AppointmentView & { replayed: boolean }> {
  const { result, replayed } = await ctx.db.transaction(async (tx) => {
    return once(
      tx,
      {
        businessId: input.businessId,
        actionKey: input.actionKey ?? `cancel:${input.target.appointmentId ?? input.target.bookingRef}:${ctx.now().getTime()}`,
        tool: "cancel_appointment",
        args: input.target,
        callId: input.actor.kind === "agent" ? input.actor.callId : null,
      },
      async () => {
        // Replays skip this: a stored result is returned before we get here.
        await assertCallerConfirmed(tx, input.actor);
        const now = ctx.now();
        const business = await getBusiness(tx, input.businessId);
        const policy = await getPolicy(tx, input.businessId);
        const appt = await resolveTarget(tx, input.businessId, input.target);
        checkChangeWindow(policy, appt.startsAt, now, input.actor);
        await tx
          .update(appointments)
          .set({ status: "cancelled", cancelledAt: now, cancelReason: input.reason.slice(0, 300), updatedAt: now })
          .where(eq(appointments.id, appt.id));
        const view = await getAppointmentView(tx, input.businessId, appt.id);
        await audit(tx, {
          businessId: input.businessId,
          actor: input.actor,
          action: "appointment.cancelled",
          entity: "appointment",
          entityId: appt.id,
          data: { reason: input.reason },
        });
        if (view.customer) {
          await queueMessage(tx, {
            businessId: input.businessId,
            phone: view.customer.phone,
            customerId: view.customer.id,
            kind: "cancellation",
            relatedId: appt.id,
            body: templates.cancellation(business, { serviceName: view.serviceName, when: view.when, ref: view.bookingRef ?? "" }),
          });
        }
        // Freed capacity → offer it to the waitlist.
        await enqueue(tx, "waitlist_offer", {
          businessId: input.businessId,
          startsAt: appt.startsAt.toISOString(),
          resourceId: appt.resourceId,
        });
        return view;
      },
    );
  });
  ctx.events.publish({ type: "appointment.changed", businessId: input.businessId, data: { id: result.id } });
  return { ...result, replayed };
}

/** Move a booking to a held slot. The hold is consumed; the booking keeps its reference. */
export async function rescheduleAppointment(
  ctx: Ctx,
  input: {
    businessId: string;
    target: { appointmentId?: string; bookingRef?: string };
    holdId: string;
    actor: Actor;
    actionKey: string;
  },
): Promise<AppointmentView & { replayed: boolean; previousStartsAt: string }> {
  const { result, replayed } = await ctx.db.transaction(async (tx) => {
    return once(
      tx,
      {
        businessId: input.businessId,
        actionKey: input.actionKey,
        tool: "reschedule_appointment",
        args: { ...input.target, holdId: input.holdId },
        callId: input.actor.kind === "agent" ? input.actor.callId : null,
      },
      async () => {
        // Replays skip this: a stored result is returned before we get here.
        await assertCallerConfirmed(tx, input.actor);
        const now = ctx.now();
        const business = await getBusiness(tx, input.businessId);
        const policy = await getPolicy(tx, input.businessId);
        const appt = await resolveTarget(tx, input.businessId, input.target);
        checkChangeWindow(policy, appt.startsAt, now, input.actor);
        const hold = await lockAppointment(tx, input.businessId, input.holdId);
        if (hold.status !== "held" && hold.status !== "expired") throw conflict("hold_not_active", "The new slot is no longer held.");
        if (hold.serviceId !== appt.serviceId) throw badRequest("The new slot is for a different service.");
        if (appt.customerId && input.actor.kind !== "user") {
          await checkDailyLimit(tx, {
            businessId: input.businessId,
            customerId: appt.customerId,
            startsAt: hold.startsAt,
            tz: business.timezone,
            policy,
            excludeId: appt.id,
          });
        }
        const previousStartsAt = appt.startsAt;
        try {
          await tx.transaction(async (sp) => {
            await sp.delete(appointments).where(eq(appointments.id, hold.id));
            await sp
              .update(appointments)
              .set({
                startsAt: hold.startsAt,
                endsAt: hold.endsAt,
                blockedUntil: hold.blockedUntil,
                resourceId: hold.resourceId,
                updatedAt: now,
              })
              .where(eq(appointments.id, appt.id));
          });
        } catch (err) {
          if (pgErrorCode(err) === PG_EXCLUSION_VIOLATION) throw conflict("slot_taken", "That slot was just taken.");
          throw err;
        }
        const view = await getAppointmentView(tx, input.businessId, appt.id);
        await audit(tx, {
          businessId: input.businessId,
          actor: input.actor,
          action: "appointment.rescheduled",
          entity: "appointment",
          entityId: appt.id,
          data: { from: previousStartsAt.toISOString(), to: view.startsAt },
        });
        if (view.customer) {
          await queueMessage(tx, {
            businessId: input.businessId,
            phone: view.customer.phone,
            customerId: view.customer.id,
            kind: "rescheduled",
            relatedId: appt.id,
            body: templates.rescheduled(business, { serviceName: view.serviceName, when: view.when, ref: view.bookingRef ?? "" }),
          });
        }
        if (policy.remindersEnabled) await scheduleReminders(tx, { id: appt.id, startsAt: hold.startsAt }, now);
        await enqueue(tx, "waitlist_offer", {
          businessId: input.businessId,
          startsAt: previousStartsAt.toISOString(),
          resourceId: appt.resourceId,
        });
        return { ...view, previousStartsAt: previousStartsAt.toISOString() };
      },
    );
  });
  ctx.events.publish({ type: "appointment.changed", businessId: input.businessId, data: { id: result.id } });
  return { ...result, replayed };
}

/** Staff actions from the dashboard: check-in (→ completed) and no-show. */
export async function setAttendance(
  ctx: Ctx,
  input: { businessId: string; appointmentId: string; status: "completed" | "no_show"; userId: string },
) {
  const view = await ctx.db.transaction(async (tx) => {
    const appt = await lockAppointment(tx, input.businessId, input.appointmentId);
    if (!["confirmed", "pending", "completed", "no_show"].includes(appt.status)) {
      throw conflict("not_active", `This booking is ${appt.status}.`);
    }
    await tx
      .update(appointments)
      .set({
        status: input.status,
        checkedInAt: input.status === "completed" ? ctx.now() : null,
        updatedAt: ctx.now(),
      })
      .where(eq(appointments.id, appt.id));
    await audit(tx, {
      businessId: input.businessId,
      actor: { kind: "user", userId: input.userId },
      action: `appointment.${input.status}`,
      entity: "appointment",
      entityId: appt.id,
    });
    return getAppointmentView(tx, input.businessId, appt.id);
  });
  ctx.events.publish({ type: "appointment.changed", businessId: input.businessId, data: { id: view.id } });
  return view;
}

/** Translate an AppError from a booking call into something the agent can reason about. */
export function bookingErrorInfo(err: unknown) {
  if (err instanceof AppError) {
    const details = (err.details ?? {}) as { rule?: string; alternatives?: unknown[]; closed?: string | null };
    return { code: err.code, message: err.message, rule: details.rule, alternatives: details.alternatives ?? [], closed: details.closed };
  }
  return { code: "upstream_error", message: "Something went wrong.", alternatives: [] };
}
