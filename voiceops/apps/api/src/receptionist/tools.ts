/**
 * The receptionist's tools. The rules engine, the optional LLM and the Python phone agent all act through
 * these, so every action gets the same validation, the same safety pipeline and the same transcript entry.
 * Tools never throw for business reasons: they return { ok: false, error } so the caller can explain.
 */
import { z } from "zod";
import { formatPaise } from "@voiceops/shared";
import { AppError } from "../lib/errors.js";
import { localParts, speakDate, speakInstant, speakTime, zonedToUtc } from "../lib/time.js";
import { matchService, toE164 } from "../nlu/entities.js";
import { normalize } from "../nlu/normalize.js";
import { findSlots, nearestSlots, nextAvailableDay, spreadSlots, type Slot } from "../services/availability.js";
import {
  bookingErrorInfo,
  cancelAppointment,
  confirmHold,
  findByRef,
  findUpcomingForPhone,
  holdSlot,
  rescheduleAppointment,
} from "../services/booking.js";
import { getBusiness, listHours, listServices, openStatus, summariseHours, type ServiceRow } from "../services/business.js";
import { createCallback, createHandoff } from "../services/callbacks.js";
import { addTurn, type CallRow } from "../services/calls.js";
import type { Ctx } from "../services/context.js";
import { recordGap, searchKnowledge } from "../services/knowledge.js";
import { joinWaitlist } from "../services/waitlist.js";
import type { ConvState } from "./state.js";

export interface ToolTrace {
  name: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  ms: number;
}

export interface ToolEnv {
  ctx: Ctx;
  call: CallRow;
  state: ConvState;
  trace: ToolTrace[];
}

type ToolResult = { ok: true; [k: string]: unknown } | { ok: false; error: { code: string; message: string; [k: string]: unknown } };

interface ToolDef<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  parameters: Record<string, unknown>; // JSON Schema for LLM function calling
  run: (env: ToolEnv, args: z.infer<S>) => Promise<ToolResult>;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const str = (description: string) => ({ type: "string", description });

function fail(code: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { ok: false, error: { code, message, ...extra } };
}

async function services(env: ToolEnv) {
  return listServices(env.ctx.db, env.call.businessId);
}

async function resolveService(env: ToolEnv, ref: string): Promise<ServiceRow | undefined> {
  const all = await services(env);
  return all.find((s) => s.id === ref) ?? matchService(normalize(ref).text, all) ?? all.find((s) => s.name.toLowerCase() === ref.toLowerCase());
}

function phoneFor(env: ToolEnv, given?: string): string | undefined {
  if (env.call.callerVerified && env.call.callerPhone) return env.call.callerPhone;
  const p = given ? toE164(given) : undefined;
  return p ?? env.state.phone;
}

function slotOut(s: Slot, tz: string) {
  return { date: s.date, time: s.time, startsAt: s.startsAt.toISOString(), spoken: speakInstant(s.startsAt, tz) };
}

// ---------------------------------------------------------------------------

const getBusinessInfo: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "get_business_info",
  description: "Business name, address, opening hours, whether it is open now, and the service list with prices and durations.",
  schema: z.object({}),
  parameters: { type: "object", properties: {} },
  async run(env) {
    const b = await getBusiness(env.ctx.db, env.call.businessId);
    const hours = await listHours(env.ctx.db, b.id);
    const status = openStatus(hours, b.timezone, env.ctx.now());
    const now = localParts(env.ctx.now(), b.timezone);
    return {
      ok: true,
      name: b.name,
      address: b.address,
      phone: b.phone,
      today: now.date,
      todaySpoken: speakDate(now.date),
      timeNow: now.time,
      hours: summariseHours(hours),
      openNow: status.open,
      closesAt: status.open ? status.closesAt : undefined,
      nextOpen: !status.open && status.nextOpenDate ? `${speakDate(status.nextOpenDate)} ${speakTime(status.nextOpensAt!)}` : undefined,
      services: (await services(env)).map((s) => ({ name: s.name, price: formatPaise(s.pricePaise), durationMin: s.durationMin })),
    };
  },
};

const searchKnowledgeTool: ToolDef<z.ZodObject<{ question: z.ZodString }>> = {
  name: "search_knowledge",
  description: "Look up the business FAQ. Only answer business questions from this. If found=false, say you are not sure and offer a callback.",
  schema: z.object({ question: z.string().min(2) }),
  parameters: { type: "object", properties: { question: str("The caller's question") }, required: ["question"] },
  async run(env, { question }) {
    const match = await searchKnowledge(env.ctx.db, env.call.businessId, question);
    if (!match) {
      await recordGap(env.ctx, { businessId: env.call.businessId, question, callId: env.call.id });
      return { ok: true, found: false };
    }
    env.state.answered++;
    return { ok: true, found: true, question: match.item.question, answer: match.item.answer, score: Number(match.score.toFixed(2)) };
  },
};

const checkAvailability: ToolDef<z.ZodObject<{
  service: z.ZodString; date: typeof DATE; time: z.ZodOptional<typeof TIME>; from: z.ZodOptional<typeof TIME>; to: z.ZodOptional<typeof TIME>;
}>> = {
  name: "check_availability",
  description: "Free start times for a service on a date. Give `time` to check one exact time (returns the nearest alternatives if it is taken), or `from`/`to` for a part of the day.",
  schema: z.object({ service: z.string(), date: DATE, time: TIME.optional(), from: TIME.optional(), to: TIME.optional() }),
  parameters: {
    type: "object",
    properties: {
      service: str("Service name or alias"),
      date: str("Local date YYYY-MM-DD"),
      time: str("Exact local time HH:MM (optional)"),
      from: str("Window start HH:MM (optional)"),
      to: str("Window end HH:MM (optional)"),
    },
    required: ["service", "date"],
  },
  async run(env, a) {
    const service = await resolveService(env, a.service);
    if (!service) return fail("unknown_service", `No service called "${a.service}".`);
    const b = await getBusiness(env.ctx.db, env.call.businessId);
    const now = env.ctx.now();
    const all = await findSlots(env.ctx.db, { businessId: b.id, serviceId: service.id, date: a.date, now });
    const base = { ok: true as const, service: service.name, serviceId: service.id, date: a.date, dateSpoken: speakDate(a.date) };
    if (!all.slots.length) {
      const next = await nextAvailableDay(env.ctx.db, { businessId: b.id, serviceId: service.id, fromDate: nextDate(a.date), now, days: 10 });
      return {
        ...base,
        available: false,
        closed: all.closed ?? null,
        closureReason: all.closureReason ?? null,
        slots: [],
        nextAvailable: next ? { date: next.date, dateSpoken: speakDate(next.date), slots: spreadSlots(next.slots, 3).map((s) => slotOut(s, b.timezone)) } : null,
      };
    }
    if (a.time) {
      const exact = all.slots.find((s) => s.time === a.time);
      if (exact) return { ...base, available: true, exact: true, slots: [slotOut(exact, b.timezone)] };
      return { ...base, available: false, exact: false, requested: a.time, slots: nearestSlots(all.slots, a.time, 3).map((s) => slotOut(s, b.timezone)) };
    }
    const inWindow = all.slots.filter((s) => (!a.from || s.time >= a.from) && (!a.to || s.time < a.to));
    const pick = inWindow.length ? spreadSlots(inWindow, 3) : nearestSlots(all.slots, a.from ?? "12:00", 3);
    return { ...base, available: inWindow.length > 0, inWindow: inWindow.length > 0, slots: pick.map((s) => slotOut(s, b.timezone)), totalFree: all.slots.length };
  },
};

function nextDate(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const holdSlotTool: ToolDef<z.ZodObject<{ service: z.ZodString; date: typeof DATE; time: typeof TIME }>> = {
  name: "hold_slot",
  description: "Reserve a free slot for a few minutes while you confirm with the caller. Call before reading the booking back.",
  schema: z.object({ service: z.string(), date: DATE, time: TIME }),
  parameters: {
    type: "object",
    properties: { service: str("Service name"), date: str("YYYY-MM-DD"), time: str("HH:MM") },
    required: ["service", "date", "time"],
  },
  async run(env, a) {
    const service = await resolveService(env, a.service);
    if (!service) return fail("unknown_service", `No service called "${a.service}".`);
    const b = await getBusiness(env.ctx.db, env.call.businessId);
    try {
      const hold = await holdSlot(env.ctx, {
        businessId: b.id,
        serviceId: service.id,
        startsAt: zonedToUtc(a.date, a.time, b.timezone),
        source: env.call.channel === "phone" ? "phone" : "voice",
        callId: env.call.id,
      });
      env.state.hold = { id: hold.holdId, startsAt: hold.startsAt, when: hold.when, pricePaise: hold.pricePaise, serviceName: hold.serviceName, expiresAt: hold.expiresAt };
      env.state.serviceId = service.id;
      return { ok: true, holdId: hold.holdId, service: hold.serviceName, when: hold.when, price: formatPaise(hold.pricePaise), expiresAt: hold.expiresAt };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: bookingErrorInfo(err) };
      throw err;
    }
  },
};

const bookAppointment: ToolDef<z.ZodObject<{ holdId: z.ZodString; name: z.ZodOptional<z.ZodString>; phone: z.ZodOptional<z.ZodString> }>> = {
  name: "book_appointment",
  description: "Confirm a held slot. ONLY after reading back service, day, time and price and the caller clearly said yes. The server checks the caller's last words.",
  schema: z.object({ holdId: z.string().uuid(), name: z.string().optional(), phone: z.string().optional() }),
  parameters: {
    type: "object",
    properties: { holdId: str("From hold_slot"), name: str("Caller's name"), phone: str("Caller's 10-digit mobile (not needed on phone calls)") },
    required: ["holdId"],
  },
  async run(env, a) {
    const phone = phoneFor(env, a.phone);
    if (!phone) return fail("phone_required", "Ask for the caller's 10-digit mobile number first.");
    try {
      const appt = await confirmHold(env.ctx, {
        businessId: env.call.businessId,
        holdId: a.holdId,
        customer: { phone, name: a.name ?? env.state.name, languagePref: env.state.lang === "hi" ? "hinglish" : "en" },
        actionKey: `${env.call.id}:book:${a.holdId}`,
        actor: { kind: "agent", callId: env.call.id },
        pending: !env.call.callerVerified,
      });
      env.state.outcome = { kind: "booked", refId: appt.id, serviceId: appt.serviceId };
      env.state.hold = undefined;
      return {
        ok: true,
        status: appt.status,
        // Tell the model how to phrase it: a pending request is not a confirmed booking yet.
        ...(appt.status === "pending" ? { note: "Request saved. Staff will confirm it on WhatsApp. Don't say it's confirmed." } : {}),
        bookingRef: appt.bookingRef,
        when: appt.when,
        service: appt.serviceName,
        price: formatPaise(appt.pricePaise),
      };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: bookingErrorInfo(err) };
      throw err;
    }
  },
};

const findAppointments: ToolDef<z.ZodObject<{ phone: z.ZodOptional<z.ZodString> }>> = {
  name: "find_appointments",
  description: "Upcoming bookings for the caller's phone number.",
  schema: z.object({ phone: z.string().optional() }),
  parameters: { type: "object", properties: { phone: str("Mobile number (not needed on phone calls)") } },
  async run(env, a) {
    const phone = phoneFor(env, a.phone);
    if (!phone) return fail("phone_required", "Ask which mobile number the booking is under.");
    const list = await findUpcomingForPhone(env.ctx.db, env.call.businessId, phone, env.ctx.now());
    return {
      ok: true,
      phone,
      appointments: list.map((x) => ({ bookingRef: x.bookingRef, id: x.id, service: x.serviceName, serviceId: x.serviceId, when: x.when, startsAt: x.startsAt })),
    };
  },
};

const rescheduleTool: ToolDef<z.ZodObject<{ bookingRef: z.ZodString; holdId: z.ZodString }>> = {
  name: "reschedule_appointment",
  description: "Move an existing booking to a held slot (hold_slot first). Only after the caller confirmed the change.",
  schema: z.object({ bookingRef: z.string(), holdId: z.string().uuid() }),
  parameters: { type: "object", properties: { bookingRef: str("Existing booking reference"), holdId: str("New slot hold") }, required: ["bookingRef", "holdId"] },
  async run(env, a) {
    try {
      const appt = await rescheduleAppointment(env.ctx, {
        businessId: env.call.businessId,
        target: { bookingRef: a.bookingRef },
        holdId: a.holdId,
        actor: { kind: "agent", callId: env.call.id },
        actionKey: `${env.call.id}:reschedule:${a.holdId}`,
      });
      env.state.outcome = { kind: "rescheduled", refId: appt.id, serviceId: appt.serviceId };
      env.state.hold = undefined;
      return { ok: true, bookingRef: appt.bookingRef, when: appt.when };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: bookingErrorInfo(err) };
      throw err;
    }
  },
};

const cancelTool: ToolDef<z.ZodObject<{ bookingRef: z.ZodString; reason: z.ZodOptional<z.ZodString> }>> = {
  name: "cancel_appointment",
  description: "Cancel a booking. Only after reading it back and the caller said yes.",
  schema: z.object({ bookingRef: z.string(), reason: z.string().optional() }),
  parameters: { type: "object", properties: { bookingRef: str("Booking reference"), reason: str("Why, in a few words") }, required: ["bookingRef"] },
  async run(env, a) {
    const appt = await findByRef(env.ctx.db, env.call.businessId, a.bookingRef);
    const phone = phoneFor(env);
    // A caller can only cancel bookings under their own number.
    if (appt && phone) {
      const mine = await findUpcomingForPhone(env.ctx.db, env.call.businessId, phone, env.ctx.now());
      if (!mine.some((m) => m.id === appt.id)) return fail("not_your_booking", "That booking isn't under this caller's number.");
    }
    try {
      const done = await cancelAppointment(env.ctx, {
        businessId: env.call.businessId,
        target: { bookingRef: a.bookingRef },
        reason: a.reason ?? "Cancelled by caller",
        actor: { kind: "agent", callId: env.call.id },
        actionKey: `${env.call.id}:cancel:${a.bookingRef}`,
      });
      env.state.outcome = { kind: "cancelled", refId: done.id, serviceId: done.serviceId };
      return { ok: true, bookingRef: done.bookingRef, cancelled: done.when };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: bookingErrorInfo(err) };
      throw err;
    }
  },
};

const callbackTool: ToolDef<z.ZodObject<{
  reason: z.ZodString; name: z.ZodOptional<z.ZodString>; phone: z.ZodOptional<z.ZodString>; service: z.ZodOptional<z.ZodString>;
  preferredDate: z.ZodOptional<typeof DATE>; preferredTime: z.ZodOptional<typeof TIME>; priority: z.ZodOptional<z.ZodEnum<["high", "normal", "low"]>>;
}>> = {
  name: "create_callback",
  description: "Ask the team to call the customer back (after hours, unknown answers, anything you can't do).",
  schema: z.object({
    reason: z.string().min(2),
    name: z.string().optional(),
    phone: z.string().optional(),
    service: z.string().optional(),
    preferredDate: DATE.optional(),
    preferredTime: TIME.optional(),
    priority: z.enum(["high", "normal", "low"]).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      reason: str("What the customer needs"),
      name: str("Customer name"),
      phone: str("Mobile number"),
      service: str("Service they're interested in"),
      preferredDate: str("YYYY-MM-DD"),
      preferredTime: str("HH:MM"),
      priority: { type: "string", enum: ["high", "normal", "low"] },
    },
    required: ["reason"],
  },
  async run(env, a) {
    const phone = phoneFor(env, a.phone);
    if (!phone) return fail("phone_required", "Ask for a mobile number to call back on.");
    const b = await getBusiness(env.ctx.db, env.call.businessId);
    const service = a.service ? await resolveService(env, a.service) : env.state.serviceId ? { id: env.state.serviceId } : undefined;
    const preferredAt = a.preferredDate ? zonedToUtc(a.preferredDate, a.preferredTime ?? "10:00", b.timezone) : null;
    const cb = await createCallback(env.ctx, {
      businessId: b.id,
      phone,
      name: a.name ?? env.state.name,
      reason: a.reason,
      serviceId: service?.id ?? null,
      preferredAt,
      priority: a.priority ?? (service ? "high" : "normal"),
      callId: env.call.id,
      actor: { kind: "agent", callId: env.call.id },
    });
    env.state.outcome = { kind: "callback", refId: cb.id, serviceId: service?.id };
    return { ok: true, callbackId: cb.id, when: cb.whenText };
  },
};

const waitlistTool: ToolDef<z.ZodObject<{
  service: z.ZodString; date: typeof DATE; from: typeof TIME; to: typeof TIME; name: z.ZodOptional<z.ZodString>; phone: z.ZodOptional<z.ZodString>;
}>> = {
  name: "join_waitlist",
  description: "Add the caller to the waitlist for a day and time window when nothing suitable is free. They get a WhatsApp if a slot opens.",
  schema: z.object({ service: z.string(), date: DATE, from: TIME, to: TIME, name: z.string().optional(), phone: z.string().optional() }),
  parameters: {
    type: "object",
    properties: { service: str("Service"), date: str("YYYY-MM-DD"), from: str("HH:MM"), to: str("HH:MM"), name: str("Name"), phone: str("Mobile") },
    required: ["service", "date", "from", "to"],
  },
  async run(env, a) {
    const phone = phoneFor(env, a.phone);
    if (!phone) return fail("phone_required", "Ask for a mobile number for the WhatsApp alert.");
    const service = await resolveService(env, a.service);
    if (!service) return fail("unknown_service", `No service called "${a.service}".`);
    const entry = await joinWaitlist(env.ctx, {
      businessId: env.call.businessId,
      phone,
      name: a.name ?? env.state.name,
      serviceId: service.id,
      date: a.date,
      windowStart: a.from,
      windowEnd: a.to,
      callId: env.call.id,
      actor: { kind: "agent", callId: env.call.id },
    });
    env.state.outcome = { kind: "waitlist", refId: entry.id, serviceId: service.id };
    return { ok: true, waitlistId: entry.id, when: entry.whenText };
  },
};

const handoffTool: ToolDef<z.ZodObject<{
  reason: z.ZodEnum<["complaint", "human_request", "low_confidence"]>; summary: z.ZodString; phone: z.ZodOptional<z.ZodString>; name: z.ZodOptional<z.ZodString>;
}>> = {
  name: "request_handoff",
  description: "Hand the conversation to a human: complaints, refunds, explicit requests for a person, or when you're stuck. Include a short summary for the staff.",
  schema: z.object({ reason: z.enum(["complaint", "human_request", "low_confidence"]), summary: z.string().min(3), phone: z.string().optional(), name: z.string().optional() }),
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", enum: ["complaint", "human_request", "low_confidence"] },
      summary: str("2-3 sentences for the staff member"),
      phone: str("Mobile"),
      name: str("Name"),
    },
    required: ["reason", "summary"],
  },
  async run(env, a) {
    const phone = phoneFor(env, a.phone);
    const h = await createHandoff(env.ctx, {
      businessId: env.call.businessId,
      callId: env.call.id,
      phone: phone ?? null,
      name: a.name ?? env.state.name,
      reason: a.reason,
      summary: a.summary,
      actor: { kind: "agent", callId: env.call.id },
    });
    env.state.outcome = { kind: "handoff", refId: h.id, serviceId: env.state.serviceId };
    env.state.handoffReason = a.reason;
    return { ok: true, handoffId: h.id, transfer: env.call.channel === "phone" ? "callback" : "callback" };
  },
};

const endCall: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "end_call",
  description: "End the call after saying goodbye.",
  schema: z.object({}),
  parameters: { type: "object", properties: {} },
  async run(env) {
    env.state.ended = true;
    return { ok: true };
  },
};

export const TOOLS = [
  getBusinessInfo,
  searchKnowledgeTool,
  checkAvailability,
  holdSlotTool,
  bookAppointment,
  findAppointments,
  rescheduleTool,
  cancelTool,
  callbackTool,
  waitlistTool,
  handoffTool,
  endCall,
] as unknown as ToolDef<z.ZodTypeAny>[];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function toolSpecs() {
  return TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Validate, run, record in the transcript. */
export async function runTool(env: ToolEnv, name: string, rawArgs: unknown): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  const started = Date.now();
  let result: ToolResult;
  if (!tool) {
    result = fail("unknown_tool", `No tool named ${name}.`);
  } else {
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      result = fail("invalid_arguments", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    } else {
      try {
        result = await tool.run(env, parsed.data);
      } catch (err) {
        env.ctx.logger.error({ err, tool: name, callId: env.call.id }, "tool crashed");
        result = fail("upstream_error", "The system had a problem doing that.");
      }
    }
  }
  const ms = Date.now() - started;
  env.trace.push({ name, args: rawArgs, result, ok: result.ok, ms });
  await addTurn(env.ctx.db, env.call.id, {
    speaker: "tool",
    text: result.ok ? `${name} ✓` : `${name} ✗ ${(result as { error: { code: string } }).error.code}`,
    toolName: name,
    toolArgs: rawArgs,
    toolResult: result,
    latencyMs: ms,
  });
  return result;
}

export type { ToolResult };
