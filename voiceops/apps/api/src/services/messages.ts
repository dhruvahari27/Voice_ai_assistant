import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { messages } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";
import { enqueue } from "./jobs.js";

export type MessageRow = typeof messages.$inferSelect;

/**
 * Outbox pattern: the message row and its delivery job are written in the caller's transaction,
 * so a booking can't commit without its confirmation being queued (and vice versa).
 */
export async function queueMessage(
  ex: Executor,
  m: { businessId: string; phone: string; kind: string; body: string; customerId?: string | null; relatedId?: string | null },
) {
  const [row] = await ex
    .insert(messages)
    .values({
      businessId: m.businessId,
      phone: m.phone,
      kind: m.kind,
      body: m.body,
      customerId: m.customerId ?? null,
      relatedId: m.relatedId ?? null,
      direction: "outbound",
      status: "queued",
    })
    .returning();
  await enqueue(ex, "deliver_message", { messageId: row!.id }, { dedupeKey: `deliver:${row!.id}` });
  return row!;
}

export function whatsappConfigured(ctx: Ctx) {
  return Boolean(ctx.config.WHATSAPP_ACCESS_TOKEN && ctx.config.WHATSAPP_PHONE_NUMBER_ID);
}

/** Job handler: send through WhatsApp Cloud API if configured, otherwise mark as simulated. */
export async function deliverMessage(ctx: Ctx, messageId: string) {
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!m) throw notFound("Message");
  if (m.status !== "queued") return;

  if (!whatsappConfigured(ctx)) {
    await ctx.db.update(messages).set({ status: "simulated", sentAt: ctx.now() }).where(eq(messages.id, m.id));
  } else {
    // Note: outside a 24-hour customer-service window WhatsApp requires approved templates.
    // Plain text works for testing with your own number; switch to template sends before going live.
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${ctx.config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${ctx.config.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: m.phone.replace(/^\+/, ""),
          type: "text",
          text: { body: m.body },
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) {
      await ctx.db
        .update(messages)
        .set({ status: "failed", error: body.error?.message ?? `HTTP ${res.status}` })
        .where(eq(messages.id, m.id));
      throw new Error(`WhatsApp send failed: ${body.error?.message ?? res.status}`);
    }
    await ctx.db
      .update(messages)
      .set({ status: "sent", sentAt: ctx.now(), providerId: body.messages?.[0]?.id ?? null })
      .where(eq(messages.id, m.id));
  }
  ctx.events.publish({ type: "message.created", businessId: m.businessId, data: { id: m.id } });
}

export async function recordInbound(ctx: Ctx, m: { businessId: string; phone: string; body: string; customerId?: string | null }) {
  const [row] = await ctx.db
    .insert(messages)
    .values({
      businessId: m.businessId,
      phone: m.phone,
      body: m.body,
      kind: "inbound",
      direction: "inbound",
      status: "received",
      customerId: m.customerId ?? null,
      sentAt: ctx.now(),
    })
    .returning();
  ctx.events.publish({ type: "message.created", businessId: m.businessId, data: { id: row!.id } });
  return row!;
}

export async function listMessages(ex: Executor, businessId: string, opts: { phone?: string; limit?: number } = {}) {
  return ex
    .select()
    .from(messages)
    .where(opts.phone ? and(eq(messages.businessId, businessId), eq(messages.phone, opts.phone)) : eq(messages.businessId, businessId))
    .orderBy(desc(messages.createdAt))
    .limit(opts.limit ?? 200);
}
