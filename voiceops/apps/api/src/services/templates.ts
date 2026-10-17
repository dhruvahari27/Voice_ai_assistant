import { formatPaise } from "@voiceops/shared";

/** WhatsApp/SMS wording. Plain, short, with the booking reference and how to change it. */
export const templates = {
  bookingConfirmation: (b: { name: string }, a: { serviceName: string; when: string; ref: string; pricePaise: number }) =>
    `✅ Booking confirmed at ${b.name}\n${a.serviceName} — ${a.when}\nRef: ${a.ref} · ${formatPaise(a.pricePaise)}\n\nTo change or cancel, call us or reply CHANGE. This booking was made by our AI assistant.`,

  bookingRequested: (b: { name: string }, a: { serviceName: string; when: string; ref: string; pricePaise: number }) =>
    `📝 Booking request received at ${b.name}\n${a.serviceName} — ${a.when}\nRef: ${a.ref} · ${formatPaise(a.pricePaise)}\n\nThe slot is reserved for you. Our team will confirm it here shortly. Reply CANCEL if you didn't ask for this.`,

  reminder: (b: { name: string }, a: { serviceName: string; when: string; ref: string }, lead: "24h" | "2h") =>
    `⏰ Reminder: your ${a.serviceName} at ${b.name} is ${lead === "24h" ? "tomorrow" : "in 2 hours"} — ${a.when}.\nRef: ${a.ref}. Reply CANCEL if you can't make it, so someone else can take the slot.`,

  rescheduled: (b: { name: string }, a: { serviceName: string; when: string; ref: string }) =>
    `🔁 Your ${a.serviceName} at ${b.name} has moved to ${a.when}.\nRef: ${a.ref}.`,

  cancellation: (b: { name: string }, a: { serviceName: string; when: string; ref: string }) =>
    `❌ Your ${a.serviceName} on ${a.when} at ${b.name} is cancelled (Ref: ${a.ref}). Call us anytime to book again.`,

  waitlistJoined: (b: { name: string }, w: { serviceName: string; when: string }) =>
    `📝 You're on the waitlist at ${b.name} for ${w.serviceName}, ${w.when}. If a slot opens we'll message you here — reply YES to grab it.`,

  waitlistOffer: (b: { name: string }, o: { serviceName: string; when: string; minutes: number }) =>
    `🎉 A slot just opened at ${b.name}: ${o.serviceName}, ${o.when}.\nReply YES within ${o.minutes} minutes to book it. First to reply gets it.`,

  offerAccepted: (b: { name: string }, a: { serviceName: string; when: string; ref: string }) =>
    `✅ It's yours! ${a.serviceName} at ${b.name}, ${a.when}. Ref: ${a.ref}.`,

  offerLost: (b: { name: string }) =>
    `Sorry, that slot at ${b.name} was just taken by someone else. You're still on the waitlist and we'll message you if another opens.`,

  callbackAck: (b: { name: string }, c: { when: string }) =>
    `📞 Thanks for calling ${b.name}. Our team will call you back ${c.when}.`,

  ownerHandoff: (h: { reason: string; summary: string; phone: string | null }) =>
    `⚠️ VoiceOps handoff (${h.reason.replace("_", " ")})\nCaller: ${h.phone ?? "unknown"}\n${h.summary}\nOpen the dashboard → Inbox.`,

  ownerCallbackOverdue: (c: { name: string | null; phone: string; reason: string; overdueMin: number }) =>
    `⏱️ Callback overdue by ${c.overdueMin} min: ${c.name ?? "Customer"} (${c.phone}) — ${c.reason}`,

  ownerDigest: (d: {
    date: string;
    calls: number;
    booked: number;
    callbacksOpen: number;
    handoffsOpen: number;
    topGap?: string;
    unmet?: string;
  }) =>
    [
      `📊 VoiceOps daily summary — ${d.date}`,
      `Calls answered: ${d.calls}`,
      `Booked by AI: ${d.booked}`,
      `Callbacks waiting: ${d.callbacksOpen}`,
      `Handoffs open: ${d.handoffsOpen}`,
      d.unmet ? `Most-wanted full slot: ${d.unmet}` : null,
      d.topGap ? `Question we couldn't answer: "${d.topGap}"` : null,
    ]
      .filter(Boolean)
      .join("\n"),

  inboundAck: (b: { name: string }) =>
    `Thanks for your message to ${b.name}. Our team will get back to you shortly.`,
};
