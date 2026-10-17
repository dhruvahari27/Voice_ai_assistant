/**
 * Rule-based receptionist. Works with no API keys and is fully deterministic, so it can be tested.
 *
 * Shape: each caller turn is analysed (intent + entities), then either answers what we were waiting for
 * (`state.awaiting`) or starts a new flow. A flow (`book`, `reschedule`, …) is advanced by `advance()`,
 * which asks for the next missing piece or performs the action through a tool.
 */
import { localParts, speakDate, speakRelativeDate, speakTime } from "../lib/time.js";
import { analyze, PART_WINDOWS, speakPhone, type Analysis } from "../nlu/index.js";
import { releaseHold } from "../services/booking.js";
import type { BusinessRow, ServiceRow } from "../services/business.js";
import { R, spokenPrice } from "./replies.js";
import type { ConvState, Flow, SlotOption } from "./state.js";
import { runTool, type ToolEnv, type ToolResult } from "./tools.js";

export interface TurnEnv extends ToolEnv {
  business: BusinessRow;
  services: ServiceRow[];
  today: string;
}

type A = Analysis<ServiceRow>;
type Err = { code: string; message: string; rule?: string; alternatives?: SlotOption[]; closed?: string | null };

const REPEAT = /\b(repeat|again|phir se|dobara|kya bola|what did you say|sorry what|pardon|come again)\b/;
const ANYTIME = /\b(any ?time|anytime|kabhi bhi|koi bhi time|whenever|jab bhi)\b/;

export async function rulesTurn(env: TurnEnv, raw: string): Promise<string> {
  const s = env.state;
  const a = analyze(raw, {
    today: env.today,
    services: env.services,
    expecting: s.awaiting === "time" || s.awaiting === "choose_slot" ? "time" : s.awaiting === "name" ? "name" : undefined,
  });
  if (a.lang) s.lang = a.lang;
  s.turns++;
  if (!["unknown", "greeting", "thanks", "goodbye"].includes(a.intent) && !s.intents.includes(a.intent)) s.intents.push(a.intent);
  if (a.phone && !s.phoneVerified) s.phone = a.phone;
  // Don't take "that's all" or "yes" as a name, and never a service name.
  const nameLooksReal =
    a.name &&
    !["goodbye", "thanks"].includes(a.intent) &&
    !(s.awaiting === "name" && (a.affirmative || a.negative) && a.text.split(" ").length <= 2) &&
    !env.services.some((x) => [x.name, ...x.aliases].some((n) => n.toLowerCase() === a.name!.toLowerCase()));
  if (nameLooksReal && (s.awaiting === "name" || !s.name)) s.name = a.name;

  if (REPEAT.test(a.text) && s.lastPrompt) return s.lastPrompt;

  // A complaint or a request for a person always wins.
  if (a.intent === "complaint" && s.awaiting !== "confirm") return startFlow(env, "handoff", a, { handoff: "complaint", reason: raw });
  if (a.intent === "human") return startFlow(env, "handoff", a, { handoff: "human_request", reason: raw });

  const handled = await handleAwaiting(env, a, raw);
  if (handled !== undefined) return handled;
  return route(env, a, raw);
}

// ---------------------------------------------------------------------------
// routing a fresh request
// ---------------------------------------------------------------------------

async function route(env: TurnEnv, a: A, raw: string): Promise<string> {
  const s = env.state;
  s.awaiting = undefined;
  // "Car wash on Sunday" names a service and a day: that's a booking even without the word "book".
  const NOT_BOOKING = ["price", "cancel", "reschedule", "callback", "my_appointment", "goodbye", "thanks"];
  if (a.service && (a.date || a.time) && !NOT_BOOKING.includes(a.intent)) return startFlow(env, "book", a);
  // A new day/time right after we read out their booking = move that booking.
  if (!a.service && (a.date || a.time) && s.target && !NOT_BOOKING.includes(a.intent) && a.intent !== "book") {
    return startFlow(env, "reschedule", a);
  }
  // A day/time while we're already talking about a service = book that service.
  if (!a.service && (a.date || a.time) && s.serviceId && ["unknown", "question", "greeting"].includes(a.intent)) {
    return startFlow(env, "book", { ...a, service: env.services.find((x) => x.id === s.serviceId) });
  }
  switch (a.intent) {
    case "book":
      return startFlow(env, "book", a);
    case "reschedule":
      return startFlow(env, "reschedule", a);
    case "cancel":
      return startFlow(env, "cancel", a);
    case "my_appointment":
      return startFlow(env, "lookup", a);
    case "callback":
      return startFlow(env, "callback", a, { reason: raw });
    case "price":
      return answerPrice(env, a);
    case "services":
      s.awaiting = "offer_book";
      s.answered++;
      return ask(env, R.services(s.lang, env.services.map((x) => x.name)));
    case "hours":
      return answerHours(env);
    case "location":
      s.awaiting = "anything_else";
      s.answered++;
      return ask(env, R.location(s.lang, env.business.address, env.business.name));
    case "thanks":
      s.awaiting = "anything_else";
      return ask(env, s.lang === "hi" ? "Aapka swagat hai! Aur kuch madad chahiye?" : "You're welcome! Is there anything else I can help with?");
    case "goodbye":
      return goodbye(env);
    case "greeting":
      if (!a.service && !a.date) return ask(env, R.howCanIHelp(s.lang));
      break;
    default:
      break;
  }
  // Mentions a service, a day or a time without saying "book" → they want a slot.
  if (a.service && (a.date || a.time)) return startFlow(env, "book", a);
  if (a.intent === "question" || a.text.split(" ").length >= 3) {
    const ans = await answerQuestion(env, raw);
    if (ans) return ans;
  }
  if (a.service) {
    s.serviceId = a.service.id;
    return answerPrice(env, a);
  }
  return unclear(env);
}

async function startFlow(
  env: TurnEnv,
  flow: Flow,
  a: A,
  extra: { reason?: string; handoff?: "complaint" | "human_request" | "low_confidence" } = {},
): Promise<string> {
  const s = env.state;
  if (s.hold) await dropHold(env);
  const flowIntent = ({ book: "book", reschedule: "reschedule", cancel: "cancel", callback: "callback", lookup: "my_appointment", handoff: extra.handoff === "complaint" ? "complaint" : "human" } as Record<string, string>)[flow];
  if (flowIntent && !s.intents.includes(flowIntent)) s.intents.push(flowIntent);
  s.flow = flow;
  s.options = undefined;
  s.unclear = 0;
  if (flow === "book" || flow === "reschedule") {
    s.date = undefined;
    s.time = undefined;
    s.window = undefined;
    s.unmet = undefined;
    if (flow === "book") s.target = undefined;
    applyBookingEntities(s, a, env.today);
    if (flow === "book" && a.service) s.serviceId = a.service.id;
  }
  if (flow === "cancel" || flow === "reschedule" || flow === "lookup") {
    if (!s.candidates?.length) s.target = undefined;
  }
  if (flow === "callback") {
    s.callbackReason = extra.reason ?? s.callbackReason ?? "Customer asked for a call back";
    s.callbackWhen = undefined;
    if (a.date || a.time) s.callbackWhen = { date: a.date?.date, time: a.time?.time };
    if (a.service) s.serviceId = a.service.id;
  }
  if (flow === "handoff") {
    s.handoffReason = extra.handoff ?? "human_request";
    s.callbackReason = extra.reason;
  }
  return advance(env);
}

/** Copy service/date/time from an utterance into the booking state. */
function applyBookingEntities(s: ConvState, a: A, today: string) {
  if (a.service && s.flow !== "reschedule") s.serviceId = a.service.id;
  if (a.date) s.date = a.date.date;
  if (a.time?.time) {
    s.time = a.time.time;
    s.window = undefined;
  } else if (a.time?.window) {
    s.window = a.time.window;
    s.time = undefined;
  }
  // "5 pm" with no day said, after we asked for a day: assume today.
  if (!s.date && (a.time?.time || a.time?.window) && s.awaiting === "date") s.date = today;
}

// ---------------------------------------------------------------------------
// advancing a flow: ask for what's missing, or act
// ---------------------------------------------------------------------------

async function advance(env: TurnEnv, justHeld = false): Promise<string> {
  const s = env.state;
  switch (s.flow) {
    case "book": {
      if (!s.serviceId) {
        s.awaiting = "service";
        return ask(env, R.askService(s.lang, env.services.map((x) => x.name)));
      }
      if (!s.date) {
        s.awaiting = "date";
        return ask(env, R.askDate(s.lang, serviceName(env, s.serviceId)));
      }
      if (!s.hold) {
        if (!s.time && !s.window) {
          s.awaiting = "time";
          return ask(env, R.askTime(s.lang, dateText(env, s.date)));
        }
        return findAndHold(env);
      }
      if (!s.name) {
        s.awaiting = "name";
        ask(env, R.askName(s.lang, justHeld));
        s.lastPrompt = R.askName(s.lang, false); // a re-ask shouldn't repeat "I've reserved that slot"
        return R.askName(s.lang, justHeld);
      }
      if (!s.phone) {
        s.awaiting = "phone";
        return ask(env, R.askPhone(s.lang, "confirmation"));
      }
      s.awaiting = "confirm";
      return ask(env, R.readBackBooking(s.lang, {
        service: s.hold.serviceName,
        when: s.hold.when,
        pricePaise: s.hold.pricePaise,
        name: s.name,
        phone: s.phoneVerified ? undefined : speakPhone(s.phone),
      }));
    }

    case "reschedule":
    case "cancel":
    case "lookup": {
      const found = await ensureTarget(env);
      if (found !== true) return found;
      const t = s.target!;
      if (s.flow === "lookup") {
        s.flow = undefined;
        s.awaiting = "anything_else";
        return ask(env, R.myAppointments(s.lang, (s.candidates ?? [t]).map((c) => `${c.serviceName} on ${c.when}`)));
      }
      if (s.flow === "cancel") {
        s.awaiting = "confirm";
        return ask(env, R.confirmCancel(s.lang, t.serviceName, t.when));
      }
      s.serviceId = t.serviceId;
      if (!s.date) {
        s.awaiting = "date";
        return ask(env, R.askNewTime(s.lang, t.serviceName, t.when));
      }
      if (!s.hold) {
        if (!s.time && !s.window) {
          s.awaiting = "time";
          return ask(env, R.askTime(s.lang, dateText(env, s.date)));
        }
        return findAndHold(env);
      }
      s.awaiting = "confirm";
      return ask(env, R.confirmReschedule(s.lang, t.serviceName, t.when, s.hold.when));
    }

    case "callback": {
      if (!s.phone) {
        s.awaiting = "phone";
        return ask(env, R.askPhone(s.lang, "callback"));
      }
      if (!s.callbackWhen) {
        s.awaiting = "callback_time";
        return ask(env, R.askCallbackTime(s.lang));
      }
      const when = s.callbackWhen === "any" ? {} : s.callbackWhen;
      const r = await runTool(env, "create_callback", {
        reason: s.callbackReason ?? "Call back requested",
        name: s.name,
        phone: s.phone,
        preferredDate: when.date ?? (when.time ? env.today : undefined),
        preferredTime: when.time,
        service: s.serviceId,
      });
      s.flow = undefined;
      if (!r.ok) return systemError(env);
      s.awaiting = "anything_else";
      return ask(env, R.callbackCreated(s.lang, String(r.when)));
    }

    case "waitlist": {
      if (!s.phone) {
        s.awaiting = "phone";
        return ask(env, R.askPhone(s.lang, "confirmation"));
      }
      const want = s.unmet;
      const date = want?.date ?? s.date!;
      const from = s.window?.from ?? (want ? shiftTime(want.time, -60) : "09:00");
      const to = s.window?.to ?? (want ? shiftTime(want.time, 60) : "20:00");
      const r = await runTool(env, "join_waitlist", { service: s.serviceId, date, from, to, name: s.name, phone: s.phone });
      s.flow = undefined;
      if (!r.ok) return systemError(env);
      s.awaiting = "anything_else";
      return ask(env, R.waitlisted(s.lang));
    }

    case "handoff": {
      if (!s.phone && env.call.channel !== "phone") {
        s.awaiting = "phone";
        return ask(env, R.askPhone(s.lang, "callback"));
      }
      const summary = await handoffSummary(env);
      await runTool(env, "request_handoff", { reason: s.handoffReason ?? "human_request", summary, phone: s.phone, name: s.name });
      s.flow = undefined;
      s.awaiting = "anything_else";
      return ask(env, R.handoff(s.lang, s.handoffReason ?? "human_request", s.phone && !s.phoneVerified ? speakPhone(s.phone) : undefined));
    }

    default:
      s.awaiting = "anything_else";
      return ask(env, R.anythingElse(s.lang));
  }
}

/** Find the caller's booking for change/cancel/lookup. Returns true when `state.target` is set. */
async function ensureTarget(env: TurnEnv): Promise<true | string> {
  const s = env.state;
  if (s.target) return true;
  if (!s.phone) {
    s.awaiting = "phone";
    return ask(env, R.askPhone(s.lang, "lookup"));
  }
  const r = await runTool(env, "find_appointments", { phone: s.phone });
  if (!r.ok) return systemError(env);
  const list = (r.appointments as { id: string; bookingRef: string | null; serviceId: string; service: string; when: string; startsAt: string }[]).map((x) => ({
    id: x.id,
    ref: x.bookingRef,
    serviceId: x.serviceId,
    serviceName: x.service,
    when: x.when,
    startsAt: x.startsAt,
  }));
  if (!list.length) {
    s.flow = undefined;
    s.awaiting = "offer_book";
    return ask(env, R.noUpcoming(s.lang, speakPhone(s.phone)));
  }
  s.candidates = list;
  if (list.length === 1 || s.flow === "lookup") {
    s.target = list[0];
    return true;
  }
  s.awaiting = "pick_appointment";
  return ask(env, R.pickAppointment(s.lang, list.map((c) => `${c.serviceName} on ${c.when}`)));
}

/** Check the wanted time (or window), then hold it or offer alternatives. */
async function findAndHold(env: TurnEnv): Promise<string> {
  const s = env.state;
  const r = await runTool(env, "check_availability", {
    service: s.serviceId,
    date: s.date,
    ...(s.time ? { time: s.time } : {}),
    ...(s.window ? { from: s.window.from, to: s.window.to } : {}),
  });
  if (!r.ok) return systemError(env);
  const slots = (r.slots as SlotOption[]) ?? [];
  const dText = dateText(env, s.date!);

  if (s.time && r.exact) return holdAndContinue(env, s.date!, s.time);

  if (!slots.length) {
    const next = r.nextAvailable as { date: string; slots: SlotOption[] } | null;
    if (s.time) s.unmet = { serviceId: s.serviceId!, startsAt: "", date: s.date!, time: s.time };
    if (!next?.slots.length) {
      s.awaiting = "callback_offer";
      s.callbackReason = `Wanted ${serviceName(env, s.serviceId)} around ${dText} but nothing was free`;
      return ask(env, R.nothingSoon(s.lang));
    }
    s.options = next.slots;
    s.awaiting = "choose_slot";
    return ask(env, R.dayUnavailable(s.lang, dText, Boolean(r.closed), dateText(env, next.date), next.slots.map((o) => speakTime(o.time))));
  }

  s.options = slots;
  s.awaiting = "choose_slot";
  if (s.time) {
    s.unmet = { serviceId: s.serviceId!, startsAt: "", date: s.date!, time: s.time };
    return ask(env, R.offerSlots(s.lang, dText, slots.map((o) => speakTime(o.time)), speakTime(s.time)));
  }
  if (s.window && r.inWindow === false) {
    const part = windowName(s.window, s.lang);
    s.unmet = { serviceId: s.serviceId!, startsAt: "", date: s.date!, time: s.window.from };
    return ask(env, R.offerSlots(s.lang, dText, slots.map((o) => speakTime(o.time)), part));
  }
  return ask(env, R.offerSlots(s.lang, dText, slots.map((o) => speakTime(o.time))));
}

async function holdAndContinue(env: TurnEnv, date: string, time: string): Promise<string> {
  const s = env.state;
  const r = await runTool(env, "hold_slot", { service: s.serviceId, date, time });
  if (r.ok) {
    s.date = date;
    s.time = time;
    s.options = undefined;
    return advance(env, true);
  }
  return handleBookingError(env, (r as { error: Err }).error);
}

async function handleBookingError(env: TurnEnv, e: Err): Promise<string> {
  const s = env.state;
  if (e.code === "policy_violation") {
    if (e.rule === "min_lead" || e.rule === "in_past") {
      // Too soon: offer the earliest options instead of just refusing.
      s.time = undefined;
      s.window = undefined;
      const r = await runTool(env, "check_availability", { service: s.serviceId, date: s.date });
      const slots = r.ok ? (r.slots as SlotOption[]) : [];
      if (r.ok && slots.length) {
        s.options = slots.slice(0, 3);
        s.awaiting = "choose_slot";
        return ask(env, `${e.message} ${R.offerSlots(s.lang, dateText(env, s.date!), s.options.map((o) => speakTime(o.time)))}`);
      }
      s.date = undefined;
      s.awaiting = "date";
      return ask(env, `${e.message} ${R.askOtherDay(s.lang)}`);
    }
    s.awaiting = "callback_offer";
    s.callbackReason = `Booking blocked by policy (${e.rule}): ${e.message}`;
    return ask(env, R.policyBlocked(s.lang, e.message));
  }
  if (e.code === "slot_taken" || e.code === "slot_unavailable" || e.code === "hold_not_active") {
    s.hold = undefined;
    const alts = e.alternatives ?? [];
    if (alts.length) {
      s.options = alts;
      s.awaiting = "choose_slot";
      return ask(env, R.slotJustTaken(s.lang, alts.map((o) => speakTime(o.time))));
    }
    s.time = undefined;
    s.date = undefined;
    s.awaiting = "date";
    return ask(env, R.slotJustTaken(s.lang, []));
  }
  if (e.code === "phone_required") {
    s.awaiting = "phone";
    return ask(env, R.askPhone(s.lang, "confirmation"));
  }
  return systemError(env);
}

// ---------------------------------------------------------------------------
// answering what we asked for
// ---------------------------------------------------------------------------

async function handleAwaiting(env: TurnEnv, a: A, raw: string): Promise<string | undefined> {
  const s = env.state;
  switch (s.awaiting) {
    case "service": {
      if (a.service) {
        s.serviceId = a.service.id;
        applyBookingEntities(s, a, env.today);
        return advance(env);
      }
      return sideOrReprompt(env, a, raw);
    }

    case "date": {
      if (a.date || a.time) {
        applyBookingEntities(s, a, env.today);
        if (s.date) return advance(env);
      }
      if (a.negative && s.flow === "book") return goodbyeOrElse(env);
      return sideOrReprompt(env, a, raw);
    }

    case "time": {
      if (a.time || a.date) {
        applyBookingEntities(s, a, env.today);
        return advance(env);
      }
      return sideOrReprompt(env, a, raw);
    }

    case "choose_slot": {
      const options = s.options ?? [];
      if (a.date && options[0] && a.date.date !== options[0].date) {
        s.options = undefined;
        s.time = undefined;
        s.window = undefined;
        applyBookingEntities(s, a, env.today);
        return advance(env);
      }
      let chosen: SlotOption | undefined;
      // "No, only 5 PM works" repeats the time they couldn't get: that's a no, not a new request.
      const insistsOnUnmet = a.negative && (!a.time?.time || a.time.time === s.unmet?.time || a.time.time === s.time);
      if (insistsOnUnmet && !a.date) {
        if (s.unmet && s.flow === "book") {
          s.awaiting = "waitlist_offer";
          return ask(env, R.offerWaitlist(s.lang, `${dateText(env, s.unmet.date)} around ${speakTime(s.unmet.time)}`));
        }
        s.date = undefined;
        s.time = undefined;
        s.window = undefined;
        s.awaiting = "date";
        return ask(env, R.askOtherDay(s.lang));
      }
      if (a.time?.time) {
        chosen = options.find((o) => o.time === a.time!.time);
        if (!chosen) {
          // A time we didn't offer: check it on the offered day.
          s.date = options[0]?.date ?? s.date;
          s.time = a.time.time;
          s.window = undefined;
          s.options = undefined;
          return findAndHold(env);
        }
      } else if (a.time?.window) {
        s.date = options[0]?.date ?? s.date;
        s.window = a.time.window;
        s.time = undefined;
        s.options = undefined;
        return findAndHold(env);
      } else if (a.ordinal !== undefined) {
        chosen = options.at(a.ordinal);
      } else if (a.affirmative && options.length === 1) {
        chosen = options[0];
      }
      if (chosen) return holdAndContinue(env, chosen.date, chosen.time);
      if (a.negative) {
        if (s.unmet && s.flow === "book") {
          s.awaiting = "waitlist_offer";
          return ask(env, R.offerWaitlist(s.lang, `${dateText(env, s.unmet.date)} around ${speakTime(s.unmet.time)}`));
        }
        s.date = undefined;
        s.time = undefined;
        s.window = undefined;
        s.awaiting = "date";
        return ask(env, R.askOtherDay(s.lang));
      }
      if (a.affirmative) return ask(env, s.lang === "hi" ? `Kaunsa time — ${options.map((o) => speakTime(o.time)).join(", ")}?` : `Which one — ${options.map((o) => speakTime(o.time)).join(", ")}?`);
      return sideOrReprompt(env, a, raw);
    }

    case "name": {
      if (s.name) return advance(env);
      return sideOrReprompt(env, a, raw);
    }

    case "phone": {
      if (a.phone) {
        s.phone = a.phone;
        return advance(env);
      }
      if (/\d{4,}/.test(a.text)) return ask(env, R.badPhone(s.lang));
      return sideOrReprompt(env, a, raw);
    }

    case "confirm":
      return handleConfirm(env, a, raw);

    case "waitlist_offer": {
      if (a.affirmative) {
        s.flow = "waitlist";
        return advance(env);
      }
      if (a.negative) {
        s.flow = "book";
        s.date = undefined;
        s.time = undefined;
        s.window = undefined;
        s.awaiting = "date";
        return ask(env, R.askOtherDay(s.lang));
      }
      if (a.date || a.time) {
        s.flow = "book";
        s.options = undefined;
        applyBookingEntities(s, a, env.today);
        return advance(env);
      }
      return sideOrReprompt(env, a, raw);
    }

    case "callback_offer": {
      if (a.affirmative) return startFlow(env, "callback", a, { reason: s.callbackReason });
      if (a.negative) {
        s.flow = undefined;
        s.awaiting = "anything_else";
        return ask(env, R.anythingElse(s.lang));
      }
      return undefined;
    }

    case "callback_time": {
      if (ANYTIME.test(a.text) || a.affirmative) s.callbackWhen = "any";
      else if (a.date || a.time) s.callbackWhen = { date: a.date?.date, time: a.time?.time ?? a.time?.window?.from };
      else return sideOrReprompt(env, a, raw);
      return advance(env);
    }

    case "pick_appointment": {
      const c = s.candidates ?? [];
      let pick = a.ordinal !== undefined ? c.at(a.ordinal) : undefined;
      if (!pick && a.service) pick = c.find((x) => x.serviceId === a.service!.id);
      if (!pick && a.date) pick = c.find((x) => x.startsAt && localParts(new Date(x.startsAt), env.business.timezone).date === a.date!.date);
      if (pick) {
        s.target = pick;
        return advance(env);
      }
      return sideOrReprompt(env, a, raw);
    }

    case "offer_book": {
      if (a.affirmative && a.intent !== "cancel") {
        const keepService = s.serviceId;
        const reply = await startFlow(env, "book", a);
        if (!a.service && keepService && !env.state.serviceId) env.state.serviceId = keepService;
        return env.state.serviceId && !a.service ? advance(env) : reply;
      }
      if (a.negative && a.intent === "unknown") return goodbyeOrElse(env);
      return undefined;
    }

    case "anything_else": {
      if ((a.negative && ["unknown", "goodbye", "thanks"].includes(a.intent)) || a.intent === "goodbye") return goodbye(env);
      if (a.intent === "thanks" && !a.service) return goodbye(env);
      if (a.affirmative && a.intent === "unknown" && !a.service && !a.date) {
        s.awaiting = undefined;
        return ask(env, R.howCanIHelp(s.lang));
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

async function handleConfirm(env: TurnEnv, a: A, raw: string): Promise<string> {
  const s = env.state;
  // They changed their mind about the time mid-confirmation.
  if ((a.date || a.time) && !a.affirmative && (s.flow === "book" || s.flow === "reschedule")) {
    await dropHold(env);
    applyBookingEntities(s, a, env.today);
    return advance(env);
  }

  if (a.affirmative) {
    if (s.flow === "book" && s.hold) {
      const r = await runTool(env, "book_appointment", { holdId: s.hold.id, name: s.name, phone: s.phone });
      if (!r.ok) return handleBookingError(env, (r as { error: Err }).error);
      resetBooking(s);
      s.awaiting = "anything_else";
      const booking = { when: String(r.when), ref: String(r.bookingRef) };
      return ask(env, r.status === "pending" ? R.requested(s.lang, booking) : R.booked(s.lang, booking));
    }
    if (s.flow === "reschedule" && s.hold && s.target?.ref) {
      const r = await runTool(env, "reschedule_appointment", { bookingRef: s.target.ref, holdId: s.hold.id });
      if (!r.ok) return handleBookingError(env, (r as { error: Err }).error);
      const ref = s.target.ref;
      resetBooking(s);
      s.target = undefined;
      s.candidates = undefined;
      s.awaiting = "anything_else";
      return ask(env, R.rescheduled(s.lang, String(r.when), ref));
    }
    if (s.flow === "cancel" && s.target?.ref) {
      const r = await runTool(env, "cancel_appointment", { bookingRef: s.target.ref, reason: "Cancelled by caller" });
      if (!r.ok) return handleBookingError(env, (r as { error: Err }).error);
      s.flow = undefined;
      s.target = undefined;
      s.candidates = undefined;
      s.awaiting = "anything_else";
      return ask(env, R.cancelled(s.lang));
    }
  }

  if (a.negative) {
    if (s.flow === "cancel") {
      s.flow = undefined;
      s.target = undefined;
      s.awaiting = "anything_else";
      return ask(env, R.keptBooking(s.lang));
    }
    await dropHold(env);
    s.date = undefined;
    s.time = undefined;
    s.window = undefined;
    s.awaiting = "date";
    return ask(env, R.whatToChange(s.lang));
  }

  const side = await sideAnswer(env, a, raw);
  if (side) return `${side} ${R.sayYesOrNo(s.lang)}`;
  return R.sayYesOrNo(s.lang);
}

/** Answer an unrelated question mid-flow, then repeat what we were asking. */
async function sideOrReprompt(env: TurnEnv, a: A, raw: string): Promise<string | undefined> {
  const s = env.state;
  const side = await sideAnswer(env, a, raw);
  if (side) return `${side} ${s.lastPrompt ?? ""}`.trim();
  // Started something new instead of answering ("actually, cancel my booking").
  if (["book", "reschedule", "cancel", "callback", "my_appointment"].includes(a.intent) && intentToFlow(a.intent) !== s.flow) {
    return undefined;
  }
  s.unclear++;
  if (s.unclear >= 3) return unclear(env);
  return s.lastPrompt ?? R.notUnderstood(s.lang);
}

async function sideAnswer(env: TurnEnv, a: A, raw: string): Promise<string | undefined> {
  const s = env.state;
  switch (a.intent) {
    case "price": {
      const svc = a.service ?? env.services.find((x) => x.id === s.serviceId);
      return svc ? R.price(s.lang, svc, false) : R.priceList(s.lang, env.services).replace(/ Which one.*$| Aapko kaunsi.*$/, "");
    }
    case "hours":
      return (await answerHours(env, true)) ?? undefined;
    case "location":
      return env.business.address ? (s.lang === "hi" ? `Hamara address: ${env.business.address}.` : `We're at ${env.business.address}.`) : undefined;
    case "question": {
      const r = await runTool(env, "search_knowledge", { question: raw });
      return r.ok && r.found ? String(r.answer) : undefined;
    }
    default:
      return undefined;
  }
}

function intentToFlow(intent: string): Flow | undefined {
  return ({ book: "book", reschedule: "reschedule", cancel: "cancel", callback: "callback", my_appointment: "lookup" } as Record<string, Flow>)[intent];
}

// ---------------------------------------------------------------------------
// one-shot answers
// ---------------------------------------------------------------------------

async function answerPrice(env: TurnEnv, a: A): Promise<string> {
  const s = env.state;
  const svc = a.service ?? env.services.find((x) => x.id === s.serviceId);
  if (svc) {
    s.serviceId = svc.id;
    s.awaiting = "offer_book";
    s.answered++;
    return ask(env, R.price(s.lang, svc, true));
  }
  s.awaiting = "offer_book";
  s.answered++;
  return ask(env, R.priceList(s.lang, env.services));
}

async function answerHours(env: TurnEnv, short = false): Promise<string> {
  const s = env.state;
  const r = await runTool(env, "get_business_info", {});
  if (!r.ok) return systemError(env);
  s.answered++;
  const now = { open: Boolean(r.openNow), closesAt: r.closesAt ? speakTime(String(r.closesAt)) : undefined, next: r.nextOpen ? String(r.nextOpen) : undefined };
  const text = R.hours(s.lang, String(r.hours), now);
  if (short) return text.replace(/ (Anything else\?|Aur kuch\?)$/, "");
  s.awaiting = "anything_else";
  return ask(env, text);
}

async function answerQuestion(env: TurnEnv, raw: string): Promise<string | undefined> {
  const s = env.state;
  const r = await runTool(env, "search_knowledge", { question: raw });
  if (!r.ok) return systemError(env);
  if (r.found) {
    s.awaiting = "anything_else";
    return ask(env, R.answer(s.lang, String(r.answer)));
  }
  s.awaiting = "callback_offer";
  s.callbackReason = `Question we couldn't answer: "${raw.slice(0, 200)}"`;
  return ask(env, R.dontKnow(s.lang));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ask(env: TurnEnv, text: string): string {
  env.state.lastPrompt = text;
  return text;
}

async function unclear(env: TurnEnv): Promise<string> {
  const s = env.state;
  s.unclear++;
  if (s.unclear >= 2) {
    s.awaiting = "callback_offer";
    s.callbackReason = "Caller couldn't be understood by the AI";
    return ask(env, R.stillNotUnderstood(s.lang));
  }
  return ask(env, R.notUnderstood(s.lang));
}

async function goodbye(env: TurnEnv): Promise<string> {
  const s = env.state;
  if (s.hold) await dropHold(env);
  await runTool(env, "end_call", {});
  s.awaiting = undefined;
  return R.goodbye(s.lang, env.business.name);
}

async function goodbyeOrElse(env: TurnEnv): Promise<string> {
  env.state.flow = undefined;
  env.state.awaiting = "anything_else";
  return ask(env, R.anythingElse(env.state.lang));
}

function systemError(env: TurnEnv): string {
  env.state.awaiting = "callback_offer";
  env.state.callbackReason = "Technical problem during the call";
  return ask(env, R.systemError(env.state.lang));
}

async function dropHold(env: TurnEnv) {
  if (env.state.hold) await releaseHold(env.ctx.db, env.call.businessId, env.state.hold.id);
  env.state.hold = undefined;
}

function resetBooking(s: ConvState) {
  s.flow = undefined;
  s.hold = undefined;
  s.date = undefined;
  s.time = undefined;
  s.window = undefined;
  s.options = undefined;
  s.unmet = undefined;
}

function serviceName(env: TurnEnv, id?: string) {
  return env.services.find((x) => x.id === id)?.name ?? "service";
}

function dateText(env: TurnEnv, date: string) {
  const rel = speakRelativeDate(date, env.today);
  if (rel === "today" || rel === "tomorrow") {
    return env.state.lang === "hi" ? (rel === "today" ? "aaj" : "kal") : rel;
  }
  return env.state.lang === "hi" ? speakDate(date) : `on ${speakDate(date)}`;
}

function windowName(w: { from: string; to: string }, lang: "en" | "hi") {
  const entry = Object.entries(PART_WINDOWS).find(([, v]) => v.from === w.from && v.to === w.to);
  const names: Record<string, [string, string]> = {
    morning: ["The morning", "Subah"],
    afternoon: ["The afternoon", "Dopahar"],
    evening: ["The evening", "Shaam"],
    night: ["Late evening", "Raat"],
  };
  const pair = entry ? names[entry[0]] : undefined;
  return pair ? (lang === "hi" ? pair[1] : pair[0]) : `${speakTime(w.from)}–${speakTime(w.to)}`;
}

function shiftTime(t: string, minutes: number) {
  const [h, m] = t.split(":").map(Number) as [number, number];
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function handoffSummary(env: TurnEnv): Promise<string> {
  const s = env.state;
  const parts = [
    s.handoffReason === "complaint" ? "Complaint." : "Caller asked to speak to a person.",
    s.callbackReason ? `They said: "${s.callbackReason.slice(0, 240)}".` : "",
    s.name ? `Name: ${s.name}.` : "",
    s.serviceId ? `Service mentioned: ${serviceName(env, s.serviceId)}.` : "",
    s.target ? `Related booking: ${s.target.serviceName} on ${s.target.when} (${s.target.ref}).` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export { spokenPrice };
