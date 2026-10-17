import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { appointments, callOutcomes, callbacks, calls, handoffs, knowledgeGaps, waitlistEntries } from "../src/db/schema.js";
import { Receptionist } from "../src/receptionist/index.js";
import type { ChatMessage, LlmClient } from "../src/receptionist/llm.js";
import { confirmHold, holdSlot } from "../src/services/booking.js";
import { makeTestEnv, type TestEnv } from "./harness.js";

let env: TestEnv;
let rx: Receptionist;
beforeAll(async () => {
  env = await makeTestEnv(); // Monday 12 Oct 2026, 10:00 IST
  rx = new Receptionist(env.ctx, undefined);
});
afterAll(() => env.close());

/** Drive a web call turn by turn; returns helpers and the transcript so far. */
async function conversation(opts: { channel?: "web" | "phone"; callerPhone?: string; engine?: "rules" | "llm"; receptionist?: Receptionist } = {}) {
  const r = opts.receptionist ?? rx;
  const start = await r.start({
    businessId: env.businessId,
    channel: opts.channel ?? "web",
    callerPhone: opts.callerPhone,
    callerVerified: Boolean(opts.callerPhone),
    engine: opts.engine,
  });
  const log: string[] = [`AGENT: ${start.reply}`];
  return {
    callId: start.callId,
    greeting: start.reply,
    log,
    async say(text: string) {
      const res = await r.turn({ businessId: env.businessId, callId: start.callId, text });
      log.push(`CALLER: ${text}`, `AGENT: ${res.reply}`);
      return res;
    },
  };
}

async function bookExisting(phone: string, date: string, time: string, service = "Car Wash") {
  const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId(service), startsAt: env.at(date, time), source: "staff" });
  return confirmHold(env.ctx, { businessId: env.businessId, holdId: hold.holdId, customer: { phone, name: "Existing" }, actionKey: `seed-${phone}-${date}-${time}`, actor: { kind: "user", userId: "t" } });
}

describe("booking in Hinglish (the blueprint's example)", () => {
  it("offers evening slots, holds, collects details, reads back and books on 'haan'", async () => {
    const c = await conversation();
    let r = await c.say("Bhai, kal evening mein car detailing ke liye slot hai?");
    expect(r.state.lang).toBe("hi");
    expect(r.reply).toMatch(/4 PM.*6 PM|khaali|available/);
    expect(r.state.awaiting).toBe("choose_slot");

    r = await c.say("6 baje wala");
    expect(r.state.hold?.when).toBe("Tuesday, 13 October, 6 PM");
    expect(r.reply).toMatch(/naam/i);

    r = await c.say("Rahul Sharma");
    expect(r.reply).toMatch(/mobile number/);
    r = await c.say("98765 43210");
    expect(r.state.awaiting).toBe("confirm");
    expect(r.reply).toContain("Premium Detailing");
    expect(r.reply).toContain("3,499 rupees");

    r = await c.say("haan ji, kar do");
    expect(r.reply).toMatch(/Ho gaya/);
    expect(r.trace.find((t) => t.name === "book_appointment")?.ok).toBe(true);

    r = await c.say("nahi bas, dhanyavaad");
    expect(r.ended).toBe(true);

    // Web callers aren't verified, so the booking waits for staff approval.
    const [appt] = await env.ctx.db.select().from(appointments).where(and(eq(appointments.callId, c.callId), eq(appointments.status, "pending")));
    expect(appt?.startsAt.toISOString()).toBe(env.at("2026-10-13", "18:00").toISOString());
    const [outcome] = await env.ctx.db.select().from(callOutcomes).where(eq(callOutcomes.callId, c.callId));
    expect(outcome).toMatchObject({ intent: "book", outcome: "booked", highIntent: false });
  });
});

describe("booking in English", () => {
  it("books an exact time directly", async () => {
    const c = await conversation();
    let r = await c.say("Hi, I'd like to book a car wash tomorrow at 11 am");
    expect(r.state.hold?.when).toBe("Tuesday, 13 October, 11 AM");
    r = await c.say("My name is Priya");
    r = await c.say("9811122233");
    expect(r.reply).toMatch(/Shall I book it\?/);
    r = await c.say("yes please");
    expect(r.reply).toMatch(/I've reserved Tuesday, 13 October, 11 AM for you and sent it to the team/);
    expect(r.reply).toMatch(/reference is [A-Z2-9 ]+\./);
  });

  it("confirms straight away on a phone call, where caller ID is trusted", async () => {
    const c = await conversation({ channel: "phone", callerPhone: "+919811100099" });
    await c.say("I'd like to book a car wash on thursday at 2 pm");
    let r = await c.say("Meera");
    if (/mobile/i.test(r.reply)) r = await c.say("9811100099");
    expect(r.reply).toMatch(/Shall I book it\?/);
    r = await c.say("yes");
    expect(r.reply).toMatch(/Done! You're booked for Thursday, 15 October, 2 PM/);
    const [appt] = await env.ctx.db.select().from(appointments).where(eq(appointments.callId, c.callId));
    expect(appt?.status).toBe("confirmed");
  });

  it("does not book on an unclear answer at the confirmation step", async () => {
    const c = await conversation();
    await c.say("book an oil change on wednesday at 3 pm");
    await c.say("Amit");
    await c.say("9822233344");
    const r = await c.say("hmm");
    expect(r.reply).toMatch(/yes or no/);
    const live = await env.ctx.db.select().from(appointments).where(and(eq(appointments.callId, c.callId), eq(appointments.status, "confirmed")));
    expect(live).toHaveLength(0);
  });

  it("answers a side question mid-booking and goes back to the pending question", async () => {
    const c = await conversation();
    await c.say("I want to book AC service tomorrow at 2 pm");
    const r = await c.say("how much does it cost?");
    expect(r.reply).toContain("1,999 rupees");
    expect(r.reply).toMatch(/May I have your name\?/);
  });

  it("asks one question at a time when details are missing", async () => {
    const c = await conversation();
    let r = await c.say("I need an appointment");
    expect(r.state.awaiting).toBe("service");
    r = await c.say("general service");
    expect(r.state.awaiting).toBe("date");
    r = await c.say("thursday");
    expect(r.state.awaiting).toBe("time");
    r = await c.say("morning");
    expect(r.state.awaiting).toBe("choose_slot");
    r = await c.say("the first one");
    expect(r.state.hold?.when).toMatch(/Thursday, 15 October, 9 AM/);
  });
});

describe("full slots → alternatives → waitlist", () => {
  it("offers nearby times, then the waitlist, and records the unmet demand", async () => {
    await bookExisting("+919700000001", "2026-10-14", "17:00", "Premium Detailing");
    await bookExisting("+919700000002", "2026-10-14", "17:00", "Premium Detailing");
    const c = await conversation();
    let r = await c.say("I want premium detailing on wednesday at 5 pm");
    expect(r.reply).toMatch(/5 PM isn't available on Wednesday, 14 October, but I have/);
    r = await c.say("no, only 5 pm works");
    expect(r.state.awaiting).toBe("waitlist_offer");
    r = await c.say("yes add me");
    expect(r.reply).toMatch(/mobile number/);
    r = await c.say("9876512345");
    expect(r.reply).toMatch(/You're on the waitlist/);
    const entries = await env.ctx.db.select().from(waitlistEntries).where(eq(waitlistEntries.callId, c.callId));
    expect(entries[0]).toMatchObject({ date: "2026-10-14", windowStart: "16:00", windowEnd: "18:00" });
    await c.say("no thanks");
    const [o] = await env.ctx.db.select().from(callOutcomes).where(eq(callOutcomes.callId, c.callId));
    expect(o).toMatchObject({ outcome: "waitlist", reason: "no_slot", highIntent: true, estValuePaise: 349900 });
    expect(o?.requestedStart?.toISOString()).toBe(env.at("2026-10-14", "17:00").toISOString());
  });

  it("moves to the next open day when the shop is closed", async () => {
    const c = await conversation();
    const r = await c.say("car wash on sunday");
    expect(r.state.awaiting).toBe("time");
    const r2 = await c.say("10 am");
    expect(r2.reply).toMatch(/closed on Sunday, 18 October\. The next opening is on Monday, 19 October/);
  });
});

describe("questions", () => {
  it("answers from the FAQ", async () => {
    const c = await conversation();
    const r = await c.say("do you provide pickup and drop?");
    expect(r.reply).toMatch(/free pickup and drop within 5 km/);
  });

  it("says it doesn't know, records the gap and offers a callback", async () => {
    const c = await conversation();
    let r = await c.say("do you sell car insurance policies?");
    expect(r.reply).toMatch(/not sure/);
    r = await c.say("yes please");
    expect(r.reply).toMatch(/mobile number/);
    r = await c.say("9898989898");
    expect(r.reply).toMatch(/When is a good time/);
    r = await c.say("tomorrow morning");
    expect(r.reply).toMatch(/our team will call you back/);
    const gaps = await env.ctx.db.select().from(knowledgeGaps).where(eq(knowledgeGaps.businessId, env.businessId));
    expect(gaps.some((g) => g.question.includes("insurance"))).toBe(true);
    const cbs = await env.ctx.db.select().from(callbacks).where(eq(callbacks.callId, c.callId));
    expect(cbs[0]?.reason).toMatch(/insurance/);
  });

  it("gives prices and opening hours", async () => {
    const c = await conversation();
    let r = await c.say("car wash kitne ka hai?");
    expect(r.reply).toMatch(/Car Wash 499 rupees ka hai/);
    r = await c.say("haan");
    expect(r.state.flow).toBe("book");
    expect(r.state.awaiting).toBe("date");
    const c2 = await conversation();
    r = await c2.say("what are your timings");
    expect(r.reply).toMatch(/Mon–Sat 09:00–20:00; Sun closed/);
    expect(r.reply).toMatch(/open right now until 8 PM/);
  });
});

describe("handoff", () => {
  it("routes a complaint to staff with a summary", async () => {
    const c = await conversation();
    let r = await c.say("I want to complain, my car got scratched during the last service");
    expect(r.reply).toMatch(/mobile number/);
    r = await c.say("9765432109");
    expect(r.reply).toMatch(/flagged this to our manager/);
    const [h] = await env.ctx.db.select().from(handoffs).where(eq(handoffs.callId, c.callId));
    expect(h).toMatchObject({ reason: "complaint", priority: "high" });
    expect(h?.summary).toMatch(/scratched/);
  });
});

describe("existing bookings", () => {
  it("reschedules after looking the caller up by phone", async () => {
    await bookExisting("+919900000011", "2026-10-14", "10:00", "AC Service");
    const c = await conversation();
    let r = await c.say("I need to reschedule my appointment");
    expect(r.reply).toMatch(/mobile number the booking is under/);
    r = await c.say("99000 00011");
    expect(r.reply).toMatch(/Your AC Service is on Wednesday, 14 October, 10 AM/);
    r = await c.say("friday 4 pm");
    expect(r.reply).toMatch(/move your AC Service from Wednesday, 14 October, 10 AM to Friday, 16 October, 4 PM/);
    r = await c.say("yes");
    expect(r.reply).toMatch(/your booking is now Friday, 16 October, 4 PM/);
  });

  it("cancels in Hinglish", async () => {
    await bookExisting("+919900000022", "2026-10-15", "12:00", "Oil Change");
    const c = await conversation();
    let r = await c.say("meri booking cancel karni hai, number 9900000022");
    expect(r.reply).toMatch(/Oil Change.*cancel kar doon/);
    r = await c.say("haan");
    expect(r.reply).toMatch(/cancel ho gayi/);
    const live = await env.ctx.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.businessId, env.businessId), eq(appointments.startsAt, env.at("2026-10-15", "12:00")), inArray(appointments.status, ["confirmed"])));
    expect(live.filter((a) => a.serviceId === env.serviceId("Oil Change"))).toHaveLength(0);
  });

  it("greets a returning phone caller by name and skips asking for the number", async () => {
    await bookExisting("+919900000033", "2026-10-16", "11:00", "Car Wash");
    const c = await conversation({ channel: "phone", callerPhone: "+919900000033" });
    expect(c.greeting).toMatch(/Namaste Existing, welcome back/);
    expect(c.greeting).toMatch(/Car Wash on Friday, 16 October, 11 AM/);
    const r = await c.say("book an oil change on saturday at 10 am");
    expect(r.reply).not.toMatch(/mobile number/);
    expect(r.state.awaiting).toBe("confirm");
  });
});

describe("Hinglish lifecycle phrasing", () => {
  it("'mera appointment shift karna hai' reschedules; a bare new time after a lookup moves the booking", async () => {
    await bookExisting("+919900000044", "2026-10-14", "15:00", "Car Wash");
    const c = await conversation({ channel: "phone", callerPhone: "+919900000044" });
    let r = await c.say("mera appointment shift karna hai");
    expect(r.state.flow).toBe("reschedule");
    expect(r.reply).toMatch(/Car Wash.*naya din/i);
    r = await c.say("parso subah 11 baje");
    expect(r.state.awaiting).toBe("confirm");
    r = await c.say("haan");
    expect(r.reply).toMatch(/Ho gaya — booking ab Wednesday, 14 October, 11 AM/);

    const c2 = await conversation({ channel: "phone", callerPhone: "+919900000044" });
    await c2.say("meri booking kab hai?");
    r = await c2.say("friday shaam 5 baje kar do");
    expect(r.state.flow).toBe("reschedule");
    expect(r.state.awaiting).toBe("confirm");
  });

  it("a day and time after a price question books that service", async () => {
    const c = await conversation();
    await c.say("oil change kitne ka hai?");
    const r = await c.say("theek hai, saturday 4 baje");
    expect(r.state.flow).toBe("book");
    expect(r.state.service).toBe("Oil Change");
    expect(r.state.hold?.when).toMatch(/Saturday, 17 October, 4 PM/);
  });
});

describe("abandoned calls", () => {
  it("records a hang-up mid-booking as a high-intent lost opportunity", async () => {
    const c = await conversation();
    await c.say("general service tomorrow evening");
    await rx.end({ businessId: env.businessId, callId: c.callId });
    const [o] = await env.ctx.db.select().from(callOutcomes).where(eq(callOutcomes.callId, c.callId));
    expect(o).toMatchObject({ outcome: "abandoned", highIntent: true, estValuePaise: 449900 });
    const held = await env.ctx.db.select().from(appointments).where(and(eq(appointments.callId, c.callId), eq(appointments.status, "held")));
    expect(held).toHaveLength(0);
    const [call] = await env.ctx.db.select().from(calls).where(eq(calls.id, c.callId));
    expect(call?.status).toBe("ended");
  });
});

describe("LLM mode (scripted model)", () => {
  /** A fake model that plays a fixed script of tool calls and replies. */
  function scripted(steps: ((msgs: ChatMessage[]) => ChatMessage)[]): LlmClient {
    let i = 0;
    return { complete: async (msgs) => steps[Math.min(i++, steps.length - 1)]!(msgs) };
  }
  const toolCall = (name: string, args: unknown): ChatMessage => ({
    role: "assistant",
    content: null,
    tool_calls: [{ id: `c${Math.random()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
  const lastTool = (msgs: ChatMessage[]) => JSON.parse(msgs.filter((m) => m.role === "tool").at(-1)!.content!);

  it("can't book until the caller actually says yes, because the server checks the transcript", async () => {
    let holdId = "";
    const model = scripted([
      () => toolCall("hold_slot", { service: "Car Wash", date: "2026-10-17", time: "12:00" }),
      (msgs) => {
        holdId = lastTool(msgs).holdId;
        // A misbehaving model tries to book without asking.
        return toolCall("book_appointment", { holdId, name: "Neha", phone: "9811100000" });
      },
      (msgs) => {
        expect(lastTool(msgs).error.code).toBe("needs_confirmation");
        return { role: "assistant", content: "Car Wash on Saturday at 12 PM for 499 rupees. Shall I book it?" };
      },
      () => toolCall("book_appointment", { holdId, name: "Neha", phone: "9811100000" }),
      (msgs) => ({ role: "assistant", content: `Done, reference ${lastTool(msgs).bookingRef}.` }),
    ]);
    const llmRx = new Receptionist(env.ctx, model);
    const c = await conversation({ engine: "llm", receptionist: llmRx });
    let r = await c.say("car wash saturday 12 baje, Neha, 9811100000");
    expect(r.engine).toBe("llm");
    expect(r.reply).toMatch(/Shall I book it/);
    const none = await env.ctx.db.select().from(appointments).where(and(eq(appointments.callId, c.callId), eq(appointments.status, "confirmed")));
    expect(none).toHaveLength(0);
    r = await c.say("yes");
    expect(r.reply).toMatch(/Done, reference [A-Z]{2}-/);
  });

  it("falls back to the rules engine when the model fails", async () => {
    const broken: LlmClient = { complete: async () => { throw new Error("quota exceeded"); } };
    const c = await conversation({ engine: "llm", receptionist: new Receptionist(env.ctx, broken) });
    const r = await c.say("what are your timings");
    expect(r.engine).toBe("rules");
    expect(r.reply).toMatch(/Mon–Sat/);
  });
});
