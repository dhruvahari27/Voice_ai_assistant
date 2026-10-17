/**
 * Receptionist entry point used by the web talk page and the Python phone agent.
 * One call = one conversation: start → turn × n → end. Every turn is stored with its latency.
 */
import { badRequest, conflict } from "../lib/errors.js";
import { localParts, zonedToUtc } from "../lib/time.js";
import { findUpcomingForPhone, releaseHoldsForCall } from "../services/booking.js";
import { getBusiness, listHours, listServices } from "../services/business.js";
import { addTurn, findStaleCalls, finishCall, getCall, saveState, startCall, type CallRow, type OutcomeInsert } from "../services/calls.js";
import type { Ctx } from "../services/context.js";
import { createOpenAiCompatibleClient, llmTurn, type LlmClient } from "./llm.js";
import { R } from "./replies.js";
import { rulesTurn, type TurnEnv } from "./rules.js";
import { initialState, type ConvState } from "./state.js";
import type { ToolTrace } from "./tools.js";

export interface TurnResult {
  callId: string;
  reply: string;
  ended: boolean;
  engine: "rules" | "llm";
  latencyMs: number;
  trace: ToolTrace[];
  state: PublicState;
}

/** What the talk page shows next to the conversation. */
export interface PublicState {
  lang: string;
  flow: string | null;
  awaiting: string | null;
  service: string | null;
  date: string | null;
  time: string | null;
  hold: ConvState["hold"] | null;
  name: string | null;
  phone: string | null;
  outcome: ConvState["outcome"] | null;
}

export class Receptionist {
  private locks = new Map<string, Promise<unknown>>();
  readonly llm: LlmClient | undefined;

  constructor(private ctx: Ctx, llm?: LlmClient) {
    this.llm = llm ?? createOpenAiCompatibleClient(ctx.config);
  }

  get llmAvailable() {
    return Boolean(this.llm);
  }

  async start(input: {
    businessId: string;
    channel: CallRow["channel"];
    callerPhone?: string | null;
    callerVerified?: boolean;
    engine?: "rules" | "llm";
    lang?: "en" | "hi";
  }): Promise<TurnResult> {
    const started = Date.now();
    const engine = input.engine === "llm" && this.llm ? "llm" : "rules";
    const business = await getBusiness(this.ctx.db, input.businessId);
    const state = initialState({ lang: input.lang ?? "en" });
    if (input.callerPhone && input.callerVerified) {
      state.phone = input.callerPhone;
      state.phoneVerified = true;
    }
    const { call, customer } = await startCall(this.ctx, {
      businessId: input.businessId,
      channel: input.channel,
      callerPhone: input.callerPhone,
      callerVerified: input.callerVerified,
      engine,
      state: state as never,
    });
    let returning: { name: string | null; next?: string } | undefined;
    if (customer && input.callerVerified) {
      state.name = customer.name ?? undefined;
      if (customer.languagePref === "hinglish") state.lang = "hi";
      const upcoming = await findUpcomingForPhone(this.ctx.db, input.businessId, customer.phone, this.ctx.now());
      returning = { name: customer.name, next: upcoming[0] ? `${upcoming[0].serviceName} on ${upcoming[0].when}` : undefined };
    }
    const reply = R.greeting(state.lang, business.name, returning);
    state.lastPrompt = reply;
    await addTurn(this.ctx.db, call.id, { speaker: "agent", text: reply });
    await saveState(this.ctx.db, call.id, state as never);
    return { callId: call.id, reply, ended: false, engine, latencyMs: Date.now() - started, trace: [], state: publicState(state, []) };
  }

  /** Serialise turns per call: a second request waits for the first to finish. */
  async turn(input: { businessId: string; callId: string; text: string }): Promise<TurnResult> {
    const prev = this.locks.get(input.callId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.doTurn(input));
    this.locks.set(input.callId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(input.callId) === next) this.locks.delete(input.callId);
    }
  }

  private async doTurn(input: { businessId: string; callId: string; text: string }): Promise<TurnResult> {
    const started = Date.now();
    const text = input.text.trim().slice(0, 1000);
    if (!text) throw badRequest("Say something first.");
    const call = await getCall(this.ctx.db, input.callId, input.businessId);
    if (call.status !== "active") throw conflict("call_ended", "This call has ended.");

    // The caller's words go into the transcript BEFORE any tool runs:
    // the booking confirmation gate reads them from there.
    await addTurn(this.ctx.db, call.id, { speaker: "caller", text });

    const state = { ...initialState(), ...(call.state as Partial<ConvState>) } as ConvState;
    const env = await this.buildEnv(call, state);
    let reply: string;
    let engine = call.engine as "rules" | "llm";
    try {
      if (engine === "llm" && this.llm) {
        reply = await llmTurn(env, this.llm, await listHours(this.ctx.db, call.businessId), text);
      } else {
        reply = await rulesTurn(env, text);
      }
    } catch (err) {
      this.ctx.logger.error({ err, callId: call.id, engine }, "receptionist turn failed");
      if (engine === "llm") {
        // The model failed (network, quota, bad output): finish this turn with the rules engine.
        engine = "rules";
        state.llm = undefined;
        reply = await rulesTurn(env, text);
      } else {
        state.awaiting = "callback_offer";
        reply = R.systemError(state.lang);
      }
    }

    const latencyMs = Date.now() - started;
    await addTurn(this.ctx.db, call.id, { speaker: "agent", text: reply, latencyMs });
    await saveState(this.ctx.db, call.id, state as never, { language: state.lang, engine });
    this.ctx.events.publish({ type: "call.turn", businessId: call.businessId, data: { id: call.id } });

    if (state.ended) await this.finish(call, state);
    return { callId: call.id, reply, ended: Boolean(state.ended), engine, latencyMs, trace: env.trace, state: publicState(state, env.services) };
  }

  /** Caller hung up or closed the page. */
  async end(input: { businessId: string; callId: string }) {
    const call = await getCall(this.ctx.db, input.callId, input.businessId);
    if (call.status === "active") await this.finish(call, call.state as unknown as ConvState);
    return { callId: call.id, ended: true };
  }

  /** Job: close calls that went quiet (tab closed, network dropped). */
  async closeStaleCalls(idleMinutes = 15) {
    const stale = await findStaleCalls(this.ctx.db, new Date(this.ctx.now().getTime() - idleMinutes * 60000));
    for (const call of stale) await this.finish(call, call.state as unknown as ConvState);
    return stale.length;
  }

  private async buildEnv(call: CallRow, state: ConvState): Promise<TurnEnv> {
    const business = await getBusiness(this.ctx.db, call.businessId);
    const services = await listServices(this.ctx.db, call.businessId);
    return {
      ctx: this.ctx,
      call,
      state,
      trace: [],
      business,
      services,
      today: localParts(this.ctx.now(), business.timezone).date,
    };
  }

  private async finish(call: CallRow, rawState: ConvState) {
    const state = { ...initialState(), ...rawState } as ConvState;
    await releaseHoldsForCall(this.ctx.db, call.businessId, call.id);
    const business = await getBusiness(this.ctx.db, call.businessId);
    const services = await listServices(this.ctx.db, call.businessId, { includeInactive: true });
    const { outcome, summary } = computeOutcome(state, services, business.timezone);
    await finishCall(this.ctx, call, outcome, summary);
  }
}

const PRIMARY = ["complaint", "book", "reschedule", "cancel", "callback", "my_appointment", "human", "price", "question", "hours", "location", "services"];

export function computeOutcome(
  state: ConvState,
  services: { id: string; name: string; pricePaise: number }[],
  tz: string,
): { outcome: OutcomeInsert; summary: string } {
  const intent = PRIMARY.find((i) => state.intents.includes(i)) ?? state.intents[0] ?? "other";
  const kind = state.outcome?.kind ?? (state.answered > 0 ? "answered" : "abandoned");
  const serviceId = state.outcome?.serviceId ?? state.serviceId ?? state.unmet?.serviceId ?? null;
  const service = services.find((s) => s.id === serviceId);
  const converted = kind === "booked" || kind === "rescheduled";
  const wantedBooking = state.intents.includes("book") || Boolean(state.unmet);
  const highIntent = wantedBooking && !converted && kind !== "cancelled";
  const estValuePaise = highIntent && service ? service.pricePaise : 0;

  let reason: string | null = null;
  if (!converted && state.unmet) reason = "no_slot";
  else if (kind === "handoff") reason = state.handoffReason ?? "human_request";
  else if (kind === "callback") reason = state.callbackReason?.startsWith("Question") ? "unknown_answer" : "callback_requested";
  else if (kind === "abandoned") reason = state.turns <= 1 ? "hung_up_early" : "dropped_mid_flow";

  const requestedStart = state.unmet ? zonedToUtc(state.unmet.date, state.unmet.time, tz) : null;
  const svc = service?.name ?? "a service";
  const summary =
    {
      booked: `Booked ${svc}.`,
      rescheduled: `Rescheduled ${svc}.`,
      cancelled: `Cancelled ${svc}.`,
      callback: `Callback requested${service ? ` about ${svc}` : ""}.`,
      waitlist: `Joined waitlist for ${svc}.`,
      handoff: state.handoffReason === "complaint" ? "Complaint — handed to staff." : "Asked for a person — handed to staff.",
      answered: `Answered ${state.answered} question${state.answered === 1 ? "" : "s"}.`,
      abandoned: wantedBooking ? `Wanted ${svc} but left before booking.` : "Caller left without a result.",
    }[kind] + (state.unmet && !converted ? " Wanted time was full." : "");

  return {
    outcome: {
      intent,
      outcome: kind,
      reason,
      serviceId,
      requestedStart,
      highIntent,
      estValuePaise,
      appointmentId: converted ? (state.outcome?.refId ?? null) : null,
    },
    summary,
  };
}

function publicState(s: ConvState, services: { id: string; name: string }[]): PublicState {
  return {
    lang: s.lang,
    flow: s.flow ?? null,
    awaiting: s.awaiting ?? null,
    service: services.find((x) => x.id === s.serviceId)?.name ?? null,
    date: s.date ?? null,
    time: s.time ?? (s.window ? `${s.window.from}–${s.window.to}` : null),
    hold: s.hold ?? null,
    name: s.name ?? null,
    phone: s.phone ?? null,
    outcome: s.outcome ?? null,
  };
}
