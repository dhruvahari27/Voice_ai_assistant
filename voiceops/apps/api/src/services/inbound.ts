/**
 * Customer replies on WhatsApp/SMS (via webhook, or the "simulate reply" button in the dashboard).
 *   YES     → accept a waitlist offer if they have one
 *   CANCEL  → cancel their next booking (policy applies)
 *   other   → acknowledge; staff see it in Messages
 */
import { AppError } from "../lib/errors.js";
import { isAffirmative } from "../nlu/entities.js";
import { normalize } from "../nlu/normalize.js";
import { cancelAppointment, findUpcomingForPhone } from "./booking.js";
import { getBusiness } from "./business.js";
import type { Ctx } from "./context.js";
import { findCustomerByPhone, normalizePhone } from "./customers.js";
import { queueMessage, recordInbound } from "./messages.js";
import { templates } from "./templates.js";
import { acceptOffer } from "./waitlist.js";

export async function processInbound(ctx: Ctx, input: { businessId: string; phone: string; body: string }) {
  const phone = normalizePhone(input.phone);
  const business = await getBusiness(ctx.db, input.businessId);
  const customer = await findCustomerByPhone(ctx.db, input.businessId, phone);
  await recordInbound(ctx, { businessId: input.businessId, phone, body: input.body, customerId: customer?.id });
  const text = normalize(input.body).text;

  if (isAffirmative(text) || /^\s*(y|yes|haan|ha)\s*$/.test(text)) {
    const offer = await acceptOffer(ctx, { businessId: input.businessId, phone });
    if (offer?.result === "booked") return { action: "offer_accepted", appointmentId: offer.appointment.id };
    if (offer?.result === "lost") return { action: "offer_lost" };
    if (offer?.result === "expired") {
      await queueMessage(ctx.db, { businessId: input.businessId, phone, kind: "offer_expired", body: `Sorry, that offer from ${business.name} has expired. You're still on the waitlist.` });
      return { action: "offer_expired" };
    }
  }

  if (/\b(cancel|radd)\b/.test(text)) {
    const [next] = await findUpcomingForPhone(ctx.db, input.businessId, phone, ctx.now());
    if (next) {
      try {
        await cancelAppointment(ctx, {
          businessId: input.businessId,
          target: { appointmentId: next.id },
          reason: "Customer replied CANCEL",
          actor: { kind: "customer", phone },
          actionKey: `wa-cancel:${next.id}`,
        });
        return { action: "cancelled", appointmentId: next.id };
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        await queueMessage(ctx.db, { businessId: input.businessId, phone, kind: "cancel_refused", body: `${err.message} Please call ${business.phone ?? "us"}.` });
        return { action: "cancel_refused", reason: err.message };
      }
    }
  }

  await queueMessage(ctx.db, { businessId: input.businessId, phone, customerId: customer?.id, kind: "inbound_ack", body: templates.inboundAck(business) });
  return { action: "acknowledged" };
}
