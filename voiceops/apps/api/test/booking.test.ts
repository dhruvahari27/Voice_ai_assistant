import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, inArray } from "drizzle-orm";
import { appointments, callTurns, calls, closures, jobs, messages } from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import { findSlots } from "../src/services/availability.js";
import {
  cancelAppointment,
  confirmHold,
  findUpcomingForPhone,
  holdSlot,
  rescheduleAppointment,
} from "../src/services/booking.js";
import { makeTestEnv, type TestEnv } from "./harness.js";

let env: TestEnv;
beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(() => env.close());

const TUE = "2026-10-13"; // tomorrow in the test clock (now = Mon 12 Oct 10:00 IST)
const user = () => ({ kind: "user" as const, userId: "staff-1" });

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected an error");
}

async function liveCount(start: Date) {
  const [r] = await env.ctx.db
    .select({ n: count() })
    .from(appointments)
    .where(and(eq(appointments.startsAt, start), inArray(appointments.status, ["held", "confirmed"])));
  return r?.n ?? 0;
}

describe("availability", () => {
  it("offers 30-minute starts inside opening hours that fit the service", async () => {
    const { slots } = await findSlots(env.ctx.db, {
      businessId: env.businessId,
      serviceId: env.serviceId("Premium Detailing"), // 120 min
      date: TUE,
      now: env.ctx.now(),
    });
    expect(slots[0]?.time).toBe("09:00");
    expect(slots.at(-1)?.time).toBe("18:00"); // 18:00 + 2h = 20:00 close
    expect(slots[0]?.freeResourceIds).toHaveLength(2);
  });

  it("respects the minimum lead time today", async () => {
    const { slots } = await findSlots(env.ctx.db, {
      businessId: env.businessId,
      serviceId: env.serviceId("Car Wash"),
      date: "2026-10-12",
      now: env.ctx.now(), // 10:00, lead 60 min
    });
    expect(slots[0]?.time).toBe("11:00");
  });

  it("is closed on Sunday and on closure days", async () => {
    const sunday = await findSlots(env.ctx.db, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), date: "2026-10-18", now: env.ctx.now() });
    expect(sunday).toMatchObject({ slots: [], closed: "no_hours" });
    await env.ctx.db.insert(closures).values({ businessId: env.businessId, date: "2026-10-20", reason: "Diwali" });
    const diwali = await findSlots(env.ctx.db, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), date: "2026-10-20", now: env.ctx.now() });
    expect(diwali).toMatchObject({ slots: [], closed: "closure", closureReason: "Diwali" });
  });

  it("filters by a time window", async () => {
    const { slots } = await findSlots(env.ctx.db, {
      businessId: env.businessId,
      serviceId: env.serviceId("Car Wash"),
      date: TUE,
      from: "16:00",
      to: "20:00",
      now: env.ctx.now(),
    });
    expect(slots.map((s) => s.time)).toEqual(["16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00"]);
  });
});

describe("holds and booking", () => {
  it("holds, then confirms with a booking reference, confirmation message and reminders", async () => {
    const hold = await holdSlot(env.ctx, {
      businessId: env.businessId,
      serviceId: env.serviceId("Car Wash"),
      startsAt: env.at(TUE, "11:00"),
      source: "staff",
    });
    expect(hold.when).toBe("Tuesday, 13 October, 11 AM");

    const appt = await confirmHold(env.ctx, {
      businessId: env.businessId,
      holdId: hold.holdId,
      customer: { phone: "98765 43210", name: "Rahul" },
      actionKey: "k-basic",
      actor: user(),
    });
    expect(appt).toMatchObject({ status: "confirmed", serviceName: "Car Wash", pricePaise: 49900, replayed: false });
    expect(appt.bookingRef).toMatch(/^AS-[A-Z2-9]{5}$/);
    expect(appt.customer?.phone).toBe("+919876543210");

    const msgs = await env.ctx.db.select().from(messages).where(eq(messages.relatedId, appt.id));
    expect(msgs[0]?.kind).toBe("booking_confirmation");
    expect(msgs[0]?.body).toContain(appt.bookingRef!);
    const reminders = await env.ctx.db.select().from(jobs).where(eq(jobs.kind, "appointment_reminder"));
    expect(reminders.length).toBeGreaterThanOrEqual(1); // 2h reminder (24h one is already in the past-ish window)
  });

  it("a retried booking with the same action key returns the same booking", async () => {
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Oil Change"), startsAt: env.at(TUE, "12:00"), source: "staff" });
    const args = { businessId: env.businessId, holdId: hold.holdId, customer: { phone: "+919811111111" }, actionKey: "k-retry", actor: user() };
    const first = await confirmHold(env.ctx, args);
    const second = await confirmHold(env.ctx, args);
    expect(second.id).toBe(first.id);
    expect(second.bookingRef).toBe(first.bookingRef);
    expect(second.replayed).toBe(true);
  });

  it("rejects reusing an action key for different arguments", async () => {
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Oil Change"), startsAt: env.at(TUE, "13:00"), source: "staff" });
    const err = await errorOf(
      confirmHold(env.ctx, { businessId: env.businessId, holdId: hold.holdId, customer: { phone: "+919822222222" }, actionKey: "k-retry", actor: user() }),
    );
    expect(err.code).toBe("idempotency_key_reused");
  });

  it("never lets 20 simultaneous callers hold the same slot more than once per bay", async () => {
    const startsAt = env.at(TUE, "15:00");
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("General Service"), startsAt, source: "voice" }),
      ),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    expect(ok).toHaveLength(2); // two bays
    for (const a of attempts) {
      if (a.status === "rejected") expect((a.reason as AppError).code).toMatch(/slot_taken|slot_unavailable/);
    }
    expect(await liveCount(startsAt)).toBe(2);
  });

  it("the database itself rejects an overlapping booking even if application checks are bypassed", async () => {
    const [existing] = await env.ctx.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.startsAt, env.at(TUE, "15:00")), eq(appointments.status, "held")))
      .limit(1);
    await expect(
      env.ctx.db.insert(appointments).values({
        businessId: env.businessId,
        serviceId: existing!.serviceId,
        resourceId: existing!.resourceId,
        status: "held",
        source: "staff",
        startsAt: env.at(TUE, "16:00"),
        endsAt: env.at(TUE, "17:00"),
        blockedUntil: env.at(TUE, "17:00"),
      }),
    ).rejects.toThrow();
  });

  it("offers alternatives when the wanted time is full", async () => {
    // Both bays are held 15:00–18:00 by the previous test.
    const err = await errorOf(
      holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), startsAt: env.at(TUE, "16:00"), source: "voice" }),
    );
    expect(err.code).toBe("slot_unavailable");
    const alts = (err.details as { alternatives: { time: string }[] }).alternatives.map((a) => a.time);
    expect(alts).toHaveLength(3);
    expect(alts).toContain("18:00");
  });

  it("expired holds stop blocking", async () => {
    const startsAt = env.at("2026-10-17", "09:00"); // a day with no other bookings
    await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("General Service"), startsAt, source: "voice", ttlSeconds: 60 });
    await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("General Service"), startsAt, source: "voice", ttlSeconds: 60 });
    await expect(
      holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("General Service"), startsAt, source: "voice" }),
    ).rejects.toThrow();
    env.advance(2);
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("General Service"), startsAt, source: "voice" });
    expect(hold.holdId).toBeTruthy();
    env.advance(-2);
  });
});

describe("policies", () => {
  it("rejects bookings inside the lead time or beyond the horizon", async () => {
    const tooSoon = await errorOf(
      holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), startsAt: env.at("2026-10-12", "10:30"), source: "voice" }),
    );
    expect(tooSoon.details).toMatchObject({ rule: "min_lead" });
    const tooFar = await errorOf(
      holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), startsAt: env.at("2026-12-01", "11:00"), source: "voice" }),
    );
    expect(tooFar.details).toMatchObject({ rule: "horizon" });
  });

  it("limits one caller to 2 bookings a day (staff can override)", async () => {
    const phone = "+919833333333";
    const book = async (time: string, actor: { kind: "customer"; phone: string } | { kind: "user"; userId: string }) => {
      const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Oil Change"), startsAt: env.at("2026-10-14", time), source: "voice" });
      return confirmHold(env.ctx, { businessId: env.businessId, holdId: hold.holdId, customer: { phone }, actionKey: `limit-${time}`, actor });
    };
    await book("10:00", { kind: "customer", phone });
    await book("11:00", { kind: "customer", phone });
    const err = await errorOf(book("12:00", { kind: "customer", phone }));
    expect(err.details).toMatchObject({ rule: "daily_limit" });
    const staff = await book("13:00", user());
    expect(staff.status).toBe("confirmed");
  });
});

describe("agent confirmation gate", () => {
  async function newCall(lastCallerText: string) {
    const [call] = await env.ctx.db.insert(calls).values({ businessId: env.businessId, channel: "web" }).returning();
    await env.ctx.db.insert(callTurns).values([
      { callId: call!.id, seq: 1, speaker: "agent", text: "Shall I book Car Wash, Wednesday 11 AM?" },
      { callId: call!.id, seq: 2, speaker: "caller", text: lastCallerText },
    ]);
    return call!.id;
  }

  it("refuses to book unless the caller's latest words were a yes", async () => {
    const callId = await newCall("hmm let me think");
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), startsAt: env.at("2026-10-15", "11:00"), source: "voice", callId });
    const err = await errorOf(
      confirmHold(env.ctx, { businessId: env.businessId, holdId: hold.holdId, customer: { phone: "+919844444444" }, actionKey: "gate-1", actor: { kind: "agent", callId } }),
    );
    expect(err.code).toBe("needs_confirmation");
  });

  it("books when the caller said haan", async () => {
    const callId = await newCall("haan ji book kar do");
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), startsAt: env.at("2026-10-15", "12:00"), source: "voice", callId });
    const appt = await confirmHold(env.ctx, { businessId: env.businessId, holdId: hold.holdId, customer: { phone: "+919844444444" }, actionKey: "gate-2", actor: { kind: "agent", callId } });
    expect(appt.status).toBe("confirmed");
  });
});

describe("reschedule and cancel", () => {
  it("moves a booking, keeps its reference and frees the old slot", async () => {
    const phone = "+919855555555";
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("AC Service"), startsAt: env.at("2026-10-16", "10:00"), source: "voice" });
    const appt = await confirmHold(env.ctx, { businessId: env.businessId, holdId: hold.holdId, customer: { phone }, actionKey: "rs-1", actor: { kind: "customer", phone } });
    const newHold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("AC Service"), startsAt: env.at("2026-10-16", "17:00"), source: "voice" });
    const moved = await rescheduleAppointment(env.ctx, {
      businessId: env.businessId,
      target: { bookingRef: appt.bookingRef! },
      holdId: newHold.holdId,
      actor: { kind: "customer", phone },
      actionKey: "rs-2",
    });
    expect(moved.bookingRef).toBe(appt.bookingRef);
    expect(moved.when).toBe("Friday, 16 October, 5 PM");
    expect(moved.previousStartsAt).toBe(env.at("2026-10-16", "10:00").toISOString());
    const upcoming = await findUpcomingForPhone(env.ctx.db, env.businessId, phone, env.ctx.now());
    expect(upcoming).toHaveLength(1);
  });

  it("cancels, notifies and queues a waitlist offer; blocks late cancellations for callers but not staff", async () => {
    const phone = "+919866666666";
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Car Wash"), startsAt: env.at("2026-10-12", "12:00"), source: "voice" });
    const appt = await confirmHold(env.ctx, { businessId: env.businessId, holdId: hold.holdId, customer: { phone }, actionKey: "c-1", actor: { kind: "customer", phone } });
    // 12:00 is 2h away exactly at 10:00; move the clock to 10:30 → inside the 2h window
    env.advance(30);
    const late = await errorOf(
      cancelAppointment(env.ctx, { businessId: env.businessId, target: { appointmentId: appt.id }, reason: "busy", actor: { kind: "customer", phone } }),
    );
    expect(late.details).toMatchObject({ rule: "cancel_window" });
    const done = await cancelAppointment(env.ctx, { businessId: env.businessId, target: { appointmentId: appt.id }, reason: "busy", actor: user() });
    expect(done.status).toBe("cancelled");
    env.advance(-30);
    const offerJobs = await env.ctx.db.select().from(jobs).where(eq(jobs.kind, "waitlist_offer"));
    expect(offerJobs.length).toBeGreaterThanOrEqual(1);
  });
});
