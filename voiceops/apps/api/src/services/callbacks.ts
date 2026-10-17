import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { callbacks, handoffs, services } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { addMinutes, localParts, speakInstant, speakTime } from "../lib/time.js";
import { audit } from "./audit.js";
import { getBusiness, getPolicy, listHours, openStatus } from "./business.js";
import type { Actor, Ctx } from "./context.js";
import { upsertCustomer } from "./customers.js";
import { enqueue } from "./jobs.js";
import { queueMessage } from "./messages.js";
import { templates } from "./templates.js";
import { zonedToUtc } from "../lib/time.js";

export type CallbackRow = typeof callbacks.$inferSelect;
export type HandoffRow = typeof handoffs.$inferSelect;

/** When the team can realistically call back: now if open, else 30 min after next opening. */
async function defaultDue(ex: Executor, businessId: string, now: Date) {
  const business = await getBusiness(ex, businessId);
  const status = openStatus(await listHours(ex, businessId), business.timezone, now);
  if (status.open) return addMinutes(now, 30);
  if (status.nextOpenDate && status.nextOpensAt) {
    return addMinutes(zonedToUtc(status.nextOpenDate, status.nextOpensAt, business.timezone), 30);
  }
  return addMinutes(now, 24 * 60);
}

export async function createCallback(
  ctx: Ctx,
  input: {
    businessId: string;
    phone: string;
    name?: string | null;
    reason: string;
    serviceId?: string | null;
    preferredAt?: Date | null;
    priority?: "high" | "normal" | "low";
    callId?: string | null;
    actor: Actor;
  },
) {
  const row = await ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    const business = await getBusiness(tx, input.businessId);
    const policy = await getPolicy(tx, input.businessId);
    const customer = await upsertCustomer(tx, input.businessId, { phone: input.phone, name: input.name });
    const dueAt = input.preferredAt && input.preferredAt > now ? input.preferredAt : await defaultDue(tx, input.businessId, now);
    const [cb] = await tx
      .insert(callbacks)
      .values({
        businessId: input.businessId,
        customerId: customer.id,
        callId: input.callId ?? null,
        name: input.name ?? customer.name,
        phone: customer.phone,
        reason: input.reason.slice(0, 500),
        serviceId: input.serviceId ?? null,
        preferredAt: input.preferredAt ?? null,
        priority: input.priority ?? "normal",
        dueAt,
      })
      .returning();
    await audit(tx, { businessId: input.businessId, actor: input.actor, action: "callback.created", entity: "callback", entityId: cb!.id });
    const local = localParts(dueAt, business.timezone);
    const today = localParts(now, business.timezone).date;
    const when = local.date === today ? `today around ${speakTime(local.time)}` : `on ${speakInstant(dueAt, business.timezone)}`;
    await queueMessage(tx, {
      businessId: input.businessId,
      phone: customer.phone,
      customerId: customer.id,
      kind: "callback_ack",
      relatedId: cb!.id,
      body: templates.callbackAck(business, { when }),
    });
    await enqueue(tx, "callback_sla", { callbackId: cb!.id }, { runAt: addMinutes(dueAt, policy.callbackSlaMinutes), dedupeKey: `cb-sla:${cb!.id}` });
    return { ...cb!, whenText: when };
  });
  ctx.events.publish({ type: "callback.changed", businessId: input.businessId, data: { id: row.id } });
  return row;
}

export async function listCallbacks(ex: Executor, businessId: string, opts: { status?: CallbackRow["status"][] } = {}) {
  return ex
    .select({ cb: callbacks, serviceName: services.name })
    .from(callbacks)
    .leftJoin(services, eq(services.id, callbacks.serviceId))
    .where(and(eq(callbacks.businessId, businessId), inArray(callbacks.status, opts.status ?? ["open"])))
    .orderBy(asc(callbacks.dueAt))
    .then((rows) => rows.map((r) => ({ ...r.cb, serviceName: r.serviceName })));
}

export async function updateCallback(
  ctx: Ctx,
  input: { businessId: string; id: string; status: "done" | "cancelled" | "open"; notes?: string | null; userId: string },
) {
  const [row] = await ctx.db
    .update(callbacks)
    .set({ status: input.status, notes: input.notes ?? undefined, completedAt: input.status === "open" ? null : ctx.now() })
    .where(and(eq(callbacks.id, input.id), eq(callbacks.businessId, input.businessId)))
    .returning();
  if (!row) throw notFound("Callback");
  await audit(ctx.db, { businessId: input.businessId, actor: { kind: "user", userId: input.userId }, action: `callback.${input.status}`, entity: "callback", entityId: row.id });
  ctx.events.publish({ type: "callback.changed", businessId: input.businessId, data: { id: row.id } });
  return row;
}

/** Job: a callback still open long after it was due gets escalated to the owner on WhatsApp. */
export async function checkCallbackSla(ctx: Ctx, callbackId: string) {
  const [cb] = await ctx.db.select().from(callbacks).where(eq(callbacks.id, callbackId)).limit(1);
  if (!cb || cb.status !== "open" || cb.escalatedAt) return;
  const business = await getBusiness(ctx.db, cb.businessId);
  if (!business.ownerPhone) return;
  const overdueMin = Math.max(0, Math.round((ctx.now().getTime() - cb.dueAt.getTime()) / 60000));
  await ctx.db.transaction(async (tx) => {
    await tx.update(callbacks).set({ escalatedAt: ctx.now() }).where(eq(callbacks.id, cb.id));
    await queueMessage(tx, {
      businessId: cb.businessId,
      phone: business.ownerPhone!,
      kind: "owner_escalation",
      relatedId: cb.id,
      body: templates.ownerCallbackOverdue({ name: cb.name, phone: cb.phone, reason: cb.reason, overdueMin }),
    });
  });
}

// ---------------------------------------------------------------------------
// handoffs
// ---------------------------------------------------------------------------

export async function createHandoff(
  ctx: Ctx,
  input: {
    businessId: string;
    callId?: string | null;
    phone?: string | null;
    name?: string | null;
    reason: "complaint" | "human_request" | "low_confidence" | "other";
    summary: string;
    actor: Actor;
  },
) {
  const row = await ctx.db.transaction(async (tx) => {
    const business = await getBusiness(tx, input.businessId);
    const customer = input.phone ? await upsertCustomer(tx, input.businessId, { phone: input.phone, name: input.name }) : null;
    const [h] = await tx
      .insert(handoffs)
      .values({
        businessId: input.businessId,
        callId: input.callId ?? null,
        customerId: customer?.id ?? null,
        phone: customer?.phone ?? null,
        reason: input.reason,
        summary: input.summary.slice(0, 1000),
        priority: input.reason === "complaint" ? "high" : "normal",
      })
      .returning();
    await audit(tx, { businessId: input.businessId, actor: input.actor, action: "handoff.created", entity: "handoff", entityId: h!.id, data: { reason: input.reason } });
    if (business.ownerPhone) {
      await queueMessage(tx, {
        businessId: input.businessId,
        phone: business.ownerPhone,
        kind: "owner_handoff",
        relatedId: h!.id,
        body: templates.ownerHandoff({ reason: input.reason, summary: input.summary, phone: customer?.phone ?? null }),
      });
    }
    return h!;
  });
  ctx.events.publish({ type: "handoff.changed", businessId: input.businessId, data: { id: row.id } });
  return row;
}

export async function listHandoffs(ex: Executor, businessId: string, opts: { status?: HandoffRow["status"][] } = {}) {
  return ex
    .select()
    .from(handoffs)
    .where(and(eq(handoffs.businessId, businessId), inArray(handoffs.status, opts.status ?? ["open"])))
    .orderBy(desc(handoffs.createdAt));
}

export async function resolveHandoff(ctx: Ctx, input: { businessId: string; id: string; notes?: string | null; userId: string }) {
  const [row] = await ctx.db
    .update(handoffs)
    .set({ status: "done", resolvedAt: ctx.now(), notes: input.notes ?? undefined })
    .where(and(eq(handoffs.id, input.id), eq(handoffs.businessId, input.businessId)))
    .returning();
  if (!row) throw notFound("Handoff");
  await audit(ctx.db, { businessId: input.businessId, actor: { kind: "user", userId: input.userId }, action: "handoff.resolved", entity: "handoff", entityId: row.id });
  ctx.events.publish({ type: "handoff.changed", businessId: input.businessId, data: { id: row.id } });
  return row;
}
