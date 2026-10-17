/**
 * Synthetic history so the dashboard and insights aren't empty on first run.
 * Every row is flagged is_demo and labelled in the UI; one click in Settings removes it all.
 * Deterministic (seeded random), relative to "now", so the shape is the same on every machine.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { localParts, zonedToUtc, addDays } from "../lib/time.js";
import { confirmHold, holdSlot } from "../services/booking.js";
import { getBusiness, listServices } from "../services/business.js";
import type { Ctx } from "../services/context.js";
import {
  appointments,
  callOutcomes,
  callTurns,
  callbacks,
  calls,
  customers,
  handoffs,
  knowledgeGaps,
  messages,
  waitlistEntries,
  actionLedger,
  auditLog,
} from "./schema.js";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const NAMES = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Anjali", "Rohit", "Kavya", "Arjun", "Neha", "Suresh", "Pooja", "Karan", "Divya", "Manoj", "Ritu", "Sanjay", "Meera", "Aditya", "Isha"];
const GAP_QUESTIONS: [string, number][] = [
  ["Do you do ceramic coating for SUVs?", 9],
  ["Can you fix dents and scratches?", 6],
  ["Do you give a discount for two cars?", 4],
  ["Do you service bikes too?", 3],
];

type Plan = {
  intent: string;
  outcome: "booked" | "answered" | "callback" | "waitlist" | "handoff" | "abandoned" | "cancelled" | "rescheduled";
  reason?: string;
  service?: string;
  unmet?: boolean;
  caller: string;
  agent: string;
};

const PLANS: { weight: number; make: (svc: string, r: () => number) => Plan }[] = [
  { weight: 30, make: (svc) => ({ intent: "book", outcome: "booked", service: svc, caller: `${svc} book karna hai kal ke liye`, agent: `Done! You're booked. You'll get a WhatsApp confirmation shortly.` }) },
  { weight: 9, make: (svc) => ({ intent: "book", outcome: "waitlist", reason: "no_slot", unmet: true, service: svc, caller: `${svc} Saturday shaam 5 baje?`, agent: "That slot is full. You're on the waitlist — we'll WhatsApp you if it opens." }) },
  { weight: 8, make: (svc) => ({ intent: "book", outcome: "abandoned", reason: "no_slot", unmet: true, service: svc, caller: `I need ${svc} on Saturday evening`, agent: "Saturday evening is full, but I have 11 AM or 2 PM." }) },
  { weight: 6, make: (svc) => ({ intent: "book", outcome: "callback", reason: "callback_requested", service: svc, caller: `Can someone call me about ${svc}?`, agent: "Done — our team will call you back tomorrow morning." }) },
  { weight: 14, make: (svc) => ({ intent: "price", outcome: "answered", service: svc, caller: `${svc} kitne ka hai?`, agent: `${svc} ka rate bata diya. Book karna chahenge?` }) },
  { weight: 8, make: () => ({ intent: "hours", outcome: "answered", caller: "What are your timings on Sunday?", agent: "We're open Mon–Sat 9 AM to 8 PM; closed on Sunday." }) },
  { weight: 7, make: () => ({ intent: "question", outcome: "answered", caller: "Do you provide pickup and drop?", agent: "Yes, free pickup and drop within 5 km for General Service and Detailing." }) },
  { weight: 6, make: () => ({ intent: "question", outcome: "callback", reason: "unknown_answer", caller: "Do you do ceramic coating for SUVs?", agent: "I'm not sure about that. Our team will call you back." }) },
  { weight: 4, make: (svc) => ({ intent: "reschedule", outcome: "rescheduled", service: svc, caller: "Mera appointment shift karna hai", agent: "Done — your booking has moved. Same reference." }) },
  { weight: 3, make: (svc) => ({ intent: "cancel", outcome: "cancelled", service: svc, caller: "I need to cancel my booking", agent: "Your booking is cancelled." }) },
  { weight: 3, make: () => ({ intent: "complaint", outcome: "handoff", reason: "complaint", caller: "My car came back with a scratch after the last service", agent: "I'm really sorry. I've flagged this to our manager as urgent." }) },
  { weight: 2, make: () => ({ intent: "other", outcome: "abandoned", reason: "hung_up_early", caller: "hello?", agent: "Namaste! How can I help you today?" }) },
];

// Call volume by hour (index = local hour). Evenings are busiest, like most service businesses.
const HOUR_WEIGHTS = [0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 6, 6, 5, 4, 4, 5, 7, 9, 10, 9, 6, 3, 1, 0];

function pick<T>(items: { weight: number; v: T }[], r: () => number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = r() * total;
  for (const i of items) {
    x -= i.weight;
    if (x <= 0) return i.v;
  }
  return items[items.length - 1]!.v;
}

export async function seedDemoHistory(ctx: Ctx, businessId: string) {
  const r = rng(42);
  const business = await getBusiness(ctx.db, businessId);
  const tz = business.timezone;
  const svcs = await listServices(ctx.db, businessId);
  const svcWeights = [
    { name: "Car Wash", weight: 30 },
    { name: "Premium Detailing", weight: 22 },
    { name: "General Service", weight: 18 },
    { name: "Oil Change", weight: 15 },
    { name: "AC Service", weight: 15 },
  ].filter((w) => svcs.some((s) => s.name === w.name));
  const now = ctx.now();
  const today = localParts(now, tz).date;

  // Demo customers
  const custRows = await ctx.db
    .insert(customers)
    .values(NAMES.map((name, i) => ({ businessId, name, phone: `+9199000${String(10000 + i * 137).padStart(5, "0")}`, isDemo: true, languagePref: i % 3 === 0 ? "en" : "hinglish" })))
    .onConflictDoNothing()
    .returning();

  // About 250 calls over the past 4 weeks; detailing demand rises in the last two.
  const callValues: (typeof calls.$inferInsert)[] = [];
  const plans: Plan[] = [];
  for (let day = 28; day >= 1; day--) {
    const date = addDays(today, -day);
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    const n = wd === 0 ? 3 : wd === 6 ? 13 : 8 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const hour = pick(HOUR_WEIGHTS.map((w, h) => ({ weight: w, v: h })), r);
      const minute = Math.floor(r() * 60);
      const startedAt = zonedToUtc(date, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, tz);
      const rising = day <= 14 ? svcWeights.map((w) => (w.name === "Premium Detailing" ? { ...w, weight: w.weight * 1.6 } : w)) : svcWeights;
      const svc = pick(rising.map((w) => ({ weight: w.weight, v: w.name })), r);
      const planDef = pick(PLANS.map((p) => ({ weight: p.weight, v: p })), r);
      // Full-slot complaints are mostly about the long Saturday jobs.
      const probe = planDef.make(svc, r);
      const plan = probe.unmet ? planDef.make(r() < 0.55 ? "Premium Detailing" : r() < 0.6 ? "General Service" : svc, r) : probe;
      const cust = custRows[Math.floor(r() * custRows.length)];
      callValues.push({
        businessId,
        channel: r() < 0.7 ? "phone" : "web",
        callerPhone: cust?.phone ?? null,
        callerVerified: true,
        customerId: cust?.id ?? null,
        engine: "rules",
        status: "ended",
        state: {},
        language: r() < 0.65 ? "hi" : "en",
        summary: summaryFor(plan),
        isDemo: true,
        startedAt,
        endedAt: new Date(startedAt.getTime() + (40 + Math.floor(r() * 140)) * 1000),
      });
      plans.push(plan);
    }
  }
  const inserted = await ctx.db.insert(calls).values(callValues).returning({ id: calls.id, startedAt: calls.startedAt, customerId: calls.customerId, callerPhone: calls.callerPhone });

  const turns: (typeof callTurns.$inferInsert)[] = [];
  const outcomes: (typeof callOutcomes.$inferInsert)[] = [];
  inserted.forEach((c, i) => {
    const p = plans[i]!;
    const service = svcs.find((s) => s.name === p.service);
    turns.push(
      { callId: c.id, seq: 1, speaker: "agent", text: `Namaste! Thanks for calling ${business.name}. How can I help you today?`, createdAt: c.startedAt },
      { callId: c.id, seq: 2, speaker: "caller", text: p.caller, createdAt: c.startedAt },
      { callId: c.id, seq: 3, speaker: "agent", text: p.agent, latencyMs: 300 + Math.floor(r() * 500), createdAt: c.startedAt },
    );
    const converted = p.outcome === "booked" || p.outcome === "rescheduled";
    const highIntent = p.intent === "book" && !converted;
    let requestedStart: Date | null = null;
    if (p.unmet) {
      // Unmet demand clusters on Saturday evening.
      const sat = addDays(localParts(c.startedAt, tz).date, (6 - new Date(`${localParts(c.startedAt, tz).date}T12:00:00Z`).getUTCDay() + 7) % 7 || 7);
      requestedStart = zonedToUtc(sat, r() < 0.75 ? "17:00" : "11:00", tz);
    }
    outcomes.push({
      callId: c.id,
      businessId,
      intent: p.intent,
      outcome: p.outcome,
      reason: p.reason ?? null,
      serviceId: service?.id ?? null,
      requestedStart,
      highIntent,
      estValuePaise: highIntent && service ? service.pricePaise : 0,
      isDemo: true,
      createdAt: c.startedAt,
    });
  });
  for (let i = 0; i < turns.length; i += 300) await ctx.db.insert(callTurns).values(turns.slice(i, i + 300));
  for (let i = 0; i < outcomes.length; i += 300) await ctx.db.insert(callOutcomes).values(outcomes.slice(i, i + 300));

  // Open follow-ups from the most recent unconverted calls.
  const recent = inserted.map((c, i) => ({ c, p: plans[i]! })).slice(-30);
  const cbCandidates = recent.filter((x) => x.p.outcome === "callback" || (x.p.outcome === "abandoned" && x.p.intent === "book")).slice(-5);
  for (const { c, p } of cbCandidates) {
    const cust = custRows.find((x) => x.id === c.customerId);
    await ctx.db.insert(callbacks).values({
      businessId,
      customerId: c.customerId,
      callId: c.id,
      name: cust?.name ?? null,
      phone: c.callerPhone ?? "+919900000000",
      reason: p.reason === "unknown_answer" ? `Question we couldn't answer: "${p.caller}"` : `Wanted ${p.service ?? "a booking"}; couldn't finish on the call`,
      serviceId: svcs.find((s) => s.name === p.service)?.id ?? null,
      priority: p.intent === "book" ? "high" : "normal",
      dueAt: new Date(now.getTime() - Math.floor(r() * 6) * 3600000),
      isDemo: true,
    });
  }
  const complaint = recent.find((x) => x.p.outcome === "handoff");
  if (complaint) {
    await ctx.db.insert(handoffs).values({
      businessId,
      callId: complaint.c.id,
      customerId: complaint.c.customerId,
      phone: complaint.c.callerPhone,
      reason: "complaint",
      summary: `Complaint. They said: "${complaint.p.caller}". Wants the manager to call back today.`,
      priority: "high",
      isDemo: true,
    });
  }
  for (const [question, n] of GAP_QUESTIONS) {
    await ctx.db
      .insert(knowledgeGaps)
      .values({ businessId, question, normalized: question.toLowerCase().replace(/[^a-z ]/g, ""), count: n, isDemo: true, lastAskedAt: now })
      .onConflictDoNothing();
  }

  // A few real upcoming bookings so Today and Appointments aren't empty.
  const upcoming: [number, string, string][] = [
    [0, "15:00", "Car Wash"],
    [0, "17:30", "Oil Change"],
    [1, "10:00", "General Service"],
    [1, "11:00", "Premium Detailing"],
    [1, "16:00", "AC Service"],
    [1, "18:00", "Car Wash"],
    [2, "09:30", "Car Wash"],
    [2, "12:00", "Premium Detailing"],
  ];
  const before = new Set((await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.businessId, businessId))).map((m) => m.id));
  const created: string[] = [];
  for (const [i, [dayOffset, time, name]] of upcoming.entries()) {
    const svc = svcs.find((s) => s.name === name);
    const cust = custRows[i % custRows.length];
    if (!svc || !cust) continue;
    let date = addDays(today, dayOffset);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) date = addDays(date, 1); // skip Sunday
    try {
      const hold = await holdSlot(ctx, { businessId, serviceId: svc.id, startsAt: zonedToUtc(date, time, tz), source: i % 3 === 0 ? "staff" : "voice", ignorePolicy: true });
      const appt = await confirmHold(ctx, {
        businessId,
        holdId: hold.holdId,
        customer: { phone: cust.phone, name: cust.name },
        actionKey: `demo:${date}:${time}:${name}`,
        actor: { kind: "system" },
        ignoreDailyLimit: true,
      });
      created.push(appt.id);
    } catch {
      // Slot in the past or taken; skip.
    }
  }
  if (created.length) await ctx.db.update(appointments).set({ isDemo: true }).where(inArray(appointments.id, created));
  const after = await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.businessId, businessId));
  const newMsgs = after.filter((m) => !before.has(m.id)).map((m) => m.id);
  if (newMsgs.length) await ctx.db.update(messages).set({ isDemo: true }).where(inArray(messages.id, newMsgs));

  // One waitlist entry for Saturday evening.
  const sat = addDays(today, (6 - localParts(now, tz).weekday + 7) % 7 || 7);
  const detailing = svcs.find((s) => s.name === "Premium Detailing");
  if (detailing && custRows[3]) {
    await ctx.db.insert(waitlistEntries).values({ businessId, customerId: custRows[3].id, serviceId: detailing.id, date: sat, windowStart: "16:00", windowEnd: "19:00", isDemo: true });
  }
  return { calls: inserted.length, appointments: created.length };
}

function summaryFor(p: Plan) {
  const svc = p.service ?? "a service";
  return {
    booked: `Booked ${svc}.`,
    rescheduled: `Rescheduled ${svc}.`,
    cancelled: `Cancelled ${svc}.`,
    callback: `Callback requested${p.service ? ` about ${svc}` : ""}.`,
    waitlist: `Joined waitlist for ${svc}. Wanted time was full.`,
    handoff: "Complaint — handed to staff.",
    answered: "Answered 1 question.",
    abandoned: p.intent === "book" ? `Wanted ${svc} but left before booking. Wanted time was full.` : "Caller left without a result.",
  }[p.outcome];
}

/** Remove every demo row. Real data is untouched. */
export async function clearDemoData(ctx: Ctx, businessId: string) {
  await ctx.db.transaction(async (tx) => {
    const demoAppts = (await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.businessId, businessId), eq(appointments.isDemo, true)))).map((a) => a.id);
    if (demoAppts.length) {
      await tx.delete(auditLog).where(and(eq(auditLog.businessId, businessId), inArray(auditLog.entityId, demoAppts)));
      await tx.execute(sql`DELETE FROM jobs WHERE payload->>'appointmentId' IN (${sql.join(demoAppts.map((id) => sql`${id}`), sql`, `)})`);
    }
    await tx.delete(actionLedger).where(and(eq(actionLedger.businessId, businessId), sql`${actionLedger.actionKey} LIKE 'demo:%'`));
    await tx.delete(waitlistEntries).where(and(eq(waitlistEntries.businessId, businessId), eq(waitlistEntries.isDemo, true)));
    await tx.delete(appointments).where(and(eq(appointments.businessId, businessId), eq(appointments.isDemo, true)));
    await tx.delete(callbacks).where(and(eq(callbacks.businessId, businessId), eq(callbacks.isDemo, true)));
    await tx.delete(handoffs).where(and(eq(handoffs.businessId, businessId), eq(handoffs.isDemo, true)));
    await tx.delete(messages).where(and(eq(messages.businessId, businessId), eq(messages.isDemo, true)));
    await tx.delete(knowledgeGaps).where(and(eq(knowledgeGaps.businessId, businessId), eq(knowledgeGaps.isDemo, true)));
    await tx.delete(calls).where(and(eq(calls.businessId, businessId), eq(calls.isDemo, true)));
    await tx.delete(customers).where(and(eq(customers.businessId, businessId), eq(customers.isDemo, true)));
  });
}

export async function hasDemoData(ctx: Ctx, businessId: string) {
  const [row] = await ctx.db.select({ id: calls.id }).from(calls).where(and(eq(calls.businessId, businessId), eq(calls.isDemo, true))).limit(1);
  return Boolean(row);
}
