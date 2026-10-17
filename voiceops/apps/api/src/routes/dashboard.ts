/**
 * Dashboard API. Every route is behind the session cookie and scoped to the signed-in user's business
 * (`bid(req)`), so one business can never read or change another's data.
 */
import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { LocalTimeSchema } from "@voiceops/shared";
import { businessHours, businesses, closures, policies, resources, services } from "../db/schema.js";
import { clearDemoData, hasDemoData, seedDemoHistory } from "../db/demo.js";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import { addDays, localParts, zonedToUtc } from "../lib/time.js";
import { parse } from "../lib/validate.js";
import { bid, requireAuth, requireOwner } from "../middleware/auth.js";
import type { Receptionist } from "../receptionist/index.js";
import { findSlots, slotView } from "../services/availability.js";
import {
  approvePending,
  cancelAppointment,
  createAppointmentByStaff,
  getAppointmentView,
  holdSlot,
  listAppointments,
  rescheduleAppointment,
  setAttendance,
} from "../services/booking.js";
import { getBusiness, getPolicy, listHours, listResources, listServices, openStatus, summariseHours } from "../services/business.js";
import { listCallbacks, listHandoffs, resolveHandoff, updateCallback } from "../services/callbacks.js";
import { getCallDetail, listCalls } from "../services/calls.js";
import type { Ctx } from "../services/context.js";
import { processInbound } from "../services/inbound.js";
import { getInsights } from "../services/insights.js";
import { deleteKnowledge, dismissGap, listGaps, listKnowledge, upsertKnowledge } from "../services/knowledge.js";
import { listMessages, whatsappConfigured } from "../services/messages.js";
import { cancelWaitlistEntry, listWaitlist } from "../services/waitlist.js";
import { APP_VERSION } from "../config.js";

const Id = z.object({ id: z.string().uuid() });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Phone = z.string().min(8).max(20);
const upcomingLimit = (d: Date) => new Date(d.getTime() + 60 * 86400000);

export function dashboardRouter(ctx: Ctx, deps: { receptionist: Receptionist; dbKind: string }) {
  const r = Router();
  r.use(requireAuth(ctx));
  const userId = (req: { auth?: { userId: string } }) => req.auth!.userId;

  // ------------------------------------------------------------------ system
  r.get("/system", async (req, res) => {
    res.json({
      version: APP_VERSION,
      database: deps.dbKind,
      llmAvailable: deps.receptionist.llmAvailable,
      llmModel: deps.receptionist.llmAvailable ? ctx.config.LLM_MODEL : null,
      whatsappConfigured: whatsappConfigured(ctx),
      demoData: await hasDemoData(ctx, bid(req)),
    });
  });

  // ------------------------------------------------------------------ overview
  r.get("/overview", async (req, res) => {
    const businessId = bid(req);
    const business = await getBusiness(ctx.db, businessId);
    const now = ctx.now();
    const today = localParts(now, business.timezone).date;
    const from = zonedToUtc(today, "00:00", business.timezone);
    const to = zonedToUtc(addDays(today, 1), "00:00", business.timezone);
    const [appts, cbs, hos, calls, insights, hours] = await Promise.all([
      listAppointments(ctx.db, businessId, { from, to }),
      listCallbacks(ctx.db, businessId),
      listHandoffs(ctx.db, businessId),
      listCalls(ctx.db, businessId, { limit: 8 }),
      getInsights(ctx.db, businessId, { days: 7, now }),
      listHours(ctx.db, businessId),
    ]);
    const todayCalls = calls.filter((c) => c.startedAt >= from);
    // Web requests waiting for a person to approve, any day from now on.
    const pending = (await listAppointments(ctx.db, businessId, { from: now, to: upcomingLimit(now) })).filter((a) => a.status === "pending");
    res.json({
      business: { name: business.name, timezone: business.timezone, today },
      openStatus: openStatus(hours, business.timezone, now),
      today: {
        appointments: appts,
        callsToday: todayCalls.length,
        pendingRequests: pending,
        liveCalls: calls.filter((c) => c.status === "active"),
      },
      callbacks: cbs.slice(0, 6),
      handoffs: hos.slice(0, 4),
      recentCalls: calls,
      radar: insights.radar,
      week: insights.totals,
      demoShare: insights.demoShare,
    });
  });

  // ------------------------------------------------------------------ business setup
  r.get("/business", async (req, res) => {
    const businessId = bid(req);
    const [business, hours, policy, svc, res_] = await Promise.all([
      getBusiness(ctx.db, businessId),
      listHours(ctx.db, businessId),
      getPolicy(ctx.db, businessId),
      listServices(ctx.db, businessId, { includeInactive: true }),
      listResources(ctx.db, businessId),
    ]);
    const upcomingClosures = await ctx.db
      .select()
      .from(closures)
      .where(eq(closures.businessId, businessId))
      .orderBy(asc(closures.date));
    res.json({ business, hours, hoursSummary: summariseHours(hours), policy, services: svc, resources: res_, closures: upcomingClosures });
  });

  r.patch("/business", requireOwner(), async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().min(2).max(100).optional(),
        city: z.string().max(80).nullable().optional(),
        address: z.string().max(300).nullable().optional(),
        phone: Phone.nullable().optional(),
        ownerPhone: Phone.nullable().optional(),
      }),
      req.body,
    );
    const [row] = await ctx.db.update(businesses).set(body).where(eq(businesses.id, bid(req))).returning();
    res.json({ business: row });
  });

  r.put("/hours", requireOwner(), async (req, res) => {
    const body = parse(
      z.object({
        hours: z
          .array(z.object({ weekday: z.number().int().min(0).max(6), opensAt: LocalTimeSchema, closesAt: LocalTimeSchema }))
          .refine((hs) => hs.every((h) => h.opensAt < h.closesAt), "Opening time must be before closing time"),
      }),
      req.body,
    );
    const businessId = bid(req);
    await ctx.db.transaction(async (tx) => {
      await tx.delete(businessHours).where(eq(businessHours.businessId, businessId));
      if (body.hours.length) await tx.insert(businessHours).values(body.hours.map((h) => ({ ...h, businessId })));
    });
    res.json({ hours: await listHours(ctx.db, businessId) });
  });

  r.patch("/policy", requireOwner(), async (req, res) => {
    const body = parse(
      z.object({
        minLeadMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
        maxHorizonDays: z.number().int().min(1).max(365).optional(),
        cancelWindowHours: z.number().int().min(0).max(168).optional(),
        maxBookingsPerCustomerPerDay: z.number().int().min(1).max(20).optional(),
        slotStepMinutes: z.number().int().min(5).max(240).optional(),
        holdSeconds: z.number().int().min(60).max(1800).optional(),
        callbackSlaMinutes: z.number().int().min(10).max(24 * 60).optional(),
        remindersEnabled: z.boolean().optional(),
      }),
      req.body,
    );
    await getPolicy(ctx.db, bid(req));
    const [row] = await ctx.db.update(policies).set(body).where(eq(policies.businessId, bid(req))).returning();
    res.json({ policy: row });
  });

  const ServiceBody = z.object({
    name: z.string().min(2).max(80),
    aliases: z.array(z.string().min(1).max(40)).max(20).default([]),
    durationMin: z.number().int().min(5).max(12 * 60),
    bufferMin: z.number().int().min(0).max(240).default(0),
    pricePaise: z.number().int().min(0),
    resourceKind: z.enum(["bay", "chair", "room", "staff"]).default("bay"),
    active: z.boolean().default(true),
  });

  r.post("/services", requireOwner(), async (req, res) => {
    const body = parse(ServiceBody, req.body);
    try {
      const [row] = await ctx.db.insert(services).values({ ...body, aliases: body.aliases.map((a) => a.toLowerCase()), businessId: bid(req) }).returning();
      res.status(201).json({ service: row });
    } catch {
      throw new AppError(409, "duplicate", "A service with that name already exists.");
    }
  });

  r.patch("/services/:id", requireOwner(), async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(ServiceBody.partial(), req.body);
    const [row] = await ctx.db
      .update(services)
      .set({ ...body, ...(body.aliases ? { aliases: body.aliases.map((a) => a.toLowerCase()) } : {}), updatedAt: ctx.now() })
      .where(and(eq(services.id, id), eq(services.businessId, bid(req))))
      .returning();
    if (!row) throw notFound("Service");
    res.json({ service: row });
  });

  r.post("/resources", requireOwner(), async (req, res) => {
    const body = parse(z.object({ name: z.string().min(1).max(40), kind: z.enum(["bay", "chair", "room", "staff"]) }), req.body);
    const [row] = await ctx.db.insert(resources).values({ ...body, businessId: bid(req) }).returning();
    res.status(201).json({ resource: row });
  });

  r.patch("/resources/:id", requireOwner(), async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ name: z.string().min(1).max(40).optional(), active: z.boolean().optional() }), req.body);
    const [row] = await ctx.db.update(resources).set(body).where(and(eq(resources.id, id), eq(resources.businessId, bid(req)))).returning();
    if (!row) throw notFound("Resource");
    res.json({ resource: row });
  });

  r.post("/closures", requireOwner(), async (req, res) => {
    const body = parse(z.object({ date: DATE, reason: z.string().max(100).nullable().optional() }), req.body);
    const [row] = await ctx.db
      .insert(closures)
      .values({ businessId: bid(req), date: body.date, reason: body.reason ?? null })
      .onConflictDoUpdate({ target: [closures.businessId, closures.date], set: { reason: body.reason ?? null } })
      .returning();
    res.status(201).json({ closure: row });
  });

  r.delete("/closures/:id", requireOwner(), async (req, res) => {
    const { id } = parse(Id, req.params);
    await ctx.db.delete(closures).where(and(eq(closures.id, id), eq(closures.businessId, bid(req))));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ appointments
  r.get("/appointments", async (req, res) => {
    const q = parse(z.object({ from: DATE, to: DATE, includeCancelled: z.enum(["true", "false"]).optional() }), req.query);
    const business = await getBusiness(ctx.db, bid(req));
    const list = await listAppointments(ctx.db, business.id, {
      from: zonedToUtc(q.from, "00:00", business.timezone),
      to: zonedToUtc(addDays(q.to, 1), "00:00", business.timezone),
      includeInactive: q.includeCancelled === "true",
    });
    res.json({ appointments: list, resources: await listResources(ctx.db, business.id) });
  });

  r.get("/availability", async (req, res) => {
    const q = parse(z.object({ serviceId: z.string().uuid(), date: DATE }), req.query);
    const result = await findSlots(ctx.db, { businessId: bid(req), serviceId: q.serviceId, date: q.date, now: ctx.now(), ignorePolicy: true });
    res.json({ slots: result.slots.filter((s) => s.startsAt > ctx.now()).map(slotView), closed: result.closed ?? null });
  });

  r.post("/appointments", async (req, res) => {
    const body = parse(
      z.object({
        serviceId: z.string().uuid(),
        date: DATE,
        time: LocalTimeSchema,
        phone: Phone,
        name: z.string().max(80).optional(),
        notes: z.string().max(500).optional(),
        idempotencyKey: z.string().min(8).max(100),
      }),
      req.body,
    );
    const business = await getBusiness(ctx.db, bid(req));
    const appt = await createAppointmentByStaff(ctx, {
      businessId: business.id,
      userId: userId(req),
      serviceId: body.serviceId,
      startsAt: zonedToUtc(body.date, body.time, business.timezone),
      customer: { phone: body.phone, name: body.name },
      notes: body.notes,
      actionKey: `staff:${body.idempotencyKey}`,
    });
    res.status(201).json({ appointment: appt });
  });

  r.post("/appointments/:id/cancel", async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ reason: z.string().max(300).default("Cancelled by staff") }), req.body);
    const appt = await cancelAppointment(ctx, {
      businessId: bid(req),
      target: { appointmentId: id },
      reason: body.reason,
      actor: { kind: "user", userId: userId(req) },
      actionKey: `staff-cancel:${id}`,
    });
    res.json({ appointment: appt });
  });

  r.post("/appointments/:id/reschedule", async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ date: DATE, time: LocalTimeSchema }), req.body);
    const business = await getBusiness(ctx.db, bid(req));
    const current = await getAppointmentView(ctx.db, business.id, id);
    const hold = await holdSlot(ctx, {
      businessId: business.id,
      serviceId: current.serviceId,
      startsAt: zonedToUtc(body.date, body.time, business.timezone),
      source: "staff",
      ignorePolicy: true,
    });
    const appt = await rescheduleAppointment(ctx, {
      businessId: business.id,
      target: { appointmentId: id },
      holdId: hold.holdId,
      actor: { kind: "user", userId: userId(req) },
      actionKey: `staff-move:${id}:${hold.holdId}`,
    });
    res.json({ appointment: appt });
  });

  r.post("/appointments/:id/approve", async (req, res) => {
    const { id } = parse(Id, req.params);
    res.json({ appointment: await approvePending(ctx, { businessId: bid(req), appointmentId: id, userId: userId(req) }) });
  });

  r.post("/appointments/:id/attendance", async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ status: z.enum(["completed", "no_show"]) }), req.body);
    res.json({ appointment: await setAttendance(ctx, { businessId: bid(req), appointmentId: id, status: body.status, userId: userId(req) }) });
  });

  // ------------------------------------------------------------------ calls
  r.get("/calls", async (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.string().datetime().optional() }), req.query);
    res.json({ calls: await listCalls(ctx.db, bid(req), { limit: q.limit, before: q.before ? new Date(q.before) : undefined }) });
  });

  r.get("/calls/:id", async (req, res) => {
    const { id } = parse(Id, req.params);
    res.json(await getCallDetail(ctx.db, bid(req), id));
  });

  // ------------------------------------------------------------------ inbox
  r.get("/callbacks", async (req, res) => {
    const q = parse(z.object({ status: z.enum(["open", "done", "cancelled", "all"]).default("open") }), req.query);
    const statuses = q.status === "all" ? (["open", "done", "cancelled"] as const) : ([q.status] as const);
    res.json({ callbacks: await listCallbacks(ctx.db, bid(req), { status: [...statuses] }) });
  });

  r.patch("/callbacks/:id", async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ status: z.enum(["open", "done", "cancelled"]), notes: z.string().max(1000).optional() }), req.body);
    res.json({ callback: await updateCallback(ctx, { businessId: bid(req), id, status: body.status, notes: body.notes, userId: userId(req) }) });
  });

  r.get("/handoffs", async (req, res) => {
    const q = parse(z.object({ status: z.enum(["open", "done", "all"]).default("open") }), req.query);
    const statuses = q.status === "all" ? (["open", "done"] as const) : ([q.status] as const);
    res.json({ handoffs: await listHandoffs(ctx.db, bid(req), { status: [...statuses] }) });
  });

  r.post("/handoffs/:id/resolve", async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(z.object({ notes: z.string().max(1000).optional() }), req.body);
    res.json({ handoff: await resolveHandoff(ctx, { businessId: bid(req), id, notes: body.notes, userId: userId(req) }) });
  });

  r.get("/waitlist", async (req, res) => {
    res.json({ waitlist: await listWaitlist(ctx.db, bid(req)) });
  });

  r.delete("/waitlist/:id", async (req, res) => {
    const { id } = parse(Id, req.params);
    await cancelWaitlistEntry(ctx, bid(req), id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ messages
  r.get("/messages", async (req, res) => {
    const q = parse(z.object({ phone: z.string().optional() }), req.query);
    res.json({ messages: await listMessages(ctx.db, bid(req), { phone: q.phone }), whatsappConfigured: whatsappConfigured(ctx) });
  });

  /** Test the WhatsApp reply flows without a phone: pretend a customer replied. */
  r.post("/messages/simulate-reply", async (req, res) => {
    const body = parse(z.object({ phone: Phone, body: z.string().min(1).max(500) }), req.body);
    res.json(await processInbound(ctx, { businessId: bid(req), phone: body.phone, body: body.body }));
  });

  // ------------------------------------------------------------------ knowledge
  r.get("/knowledge", async (req, res) => {
    const [items, gaps] = await Promise.all([listKnowledge(ctx.db, bid(req)), listGaps(ctx.db, bid(req))]);
    res.json({ items, gaps });
  });

  const KnowledgeBody = z.object({
    question: z.string().min(3).max(300),
    answer: z.string().min(2).max(1000),
    tags: z.array(z.string().max(40)).max(20).default([]),
    active: z.boolean().optional(),
    resolveGapId: z.string().uuid().optional(),
  });

  r.post("/knowledge", async (req, res) => {
    const body = parse(KnowledgeBody, req.body);
    res.status(201).json({ item: await upsertKnowledge(ctx, { ...body, businessId: bid(req) }) });
  });

  r.patch("/knowledge/:id", async (req, res) => {
    const { id } = parse(Id, req.params);
    const body = parse(KnowledgeBody, req.body);
    res.json({ item: await upsertKnowledge(ctx, { ...body, id, businessId: bid(req) }) });
  });

  r.delete("/knowledge/:id", async (req, res) => {
    const { id } = parse(Id, req.params);
    await deleteKnowledge(ctx, bid(req), id);
    res.json({ ok: true });
  });

  r.post("/knowledge/gaps/:id/dismiss", async (req, res) => {
    const { id } = parse(Id, req.params);
    await dismissGap(ctx, bid(req), id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ insights
  r.get("/insights", async (req, res) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }), req.query);
    res.json(await getInsights(ctx.db, bid(req), { days: q.days, now: ctx.now() }));
  });

  // ------------------------------------------------------------------ demo data
  r.post("/demo/clear", requireOwner(), async (req, res) => {
    await clearDemoData(ctx, bid(req));
    res.json({ ok: true });
  });

  r.post("/demo/seed", requireOwner(), async (req, res) => {
    if (await hasDemoData(ctx, bid(req))) throw badRequest("Demo data is already loaded.");
    res.json(await seedDemoHistory(ctx, bid(req)));
  });

  return r;
}
