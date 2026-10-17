/** Conversation state, stored as JSON on the call row between turns. */

export type Lang = "en" | "hi";

export type Flow = "book" | "reschedule" | "cancel" | "callback" | "waitlist" | "handoff" | "lookup";

export type Awaiting =
  | "service"
  | "date"
  | "time"
  | "choose_slot"
  | "name"
  | "phone"
  | "confirm"
  | "waitlist_offer"
  | "callback_offer"
  | "callback_time"
  | "pick_appointment"
  | "offer_book"
  | "anything_else";

export interface SlotOption {
  startsAt: string;
  date: string;
  time: string;
}

export interface ConvState {
  lang: Lang;
  flow?: Flow;
  awaiting?: Awaiting;
  serviceId?: string;
  date?: string;
  time?: string;
  window?: { from: string; to: string };
  options?: SlotOption[];
  hold?: { id: string; startsAt: string; when: string; pricePaise: number; serviceName: string; expiresAt: string };
  target?: { id: string; ref: string | null; serviceId: string; serviceName: string; when: string; startsAt: string };
  candidates?: { id: string; ref: string | null; serviceId: string; serviceName: string; when: string; startsAt: string }[];
  name?: string;
  phone?: string;
  phoneVerified?: boolean;
  /** What the caller originally wanted but couldn't get (unmet demand). */
  unmet?: { serviceId: string; startsAt: string; date: string; time: string };
  callbackReason?: string;
  callbackWhen?: { date?: string; time?: string } | "any";
  /** The last question asked, so we can repeat it after a side question. */
  lastPrompt?: string;
  handoffReason?: "complaint" | "human_request" | "low_confidence";
  /** Intents seen this call, first one is the primary. */
  intents: string[];
  answered: number;
  unclear: number;
  turns: number;
  /** Set by tools when something durable happened. */
  outcome?: { kind: "booked" | "rescheduled" | "cancelled" | "callback" | "waitlist" | "handoff"; refId?: string; serviceId?: string };
  ended?: boolean;
  /** LLM mode: message history in OpenAI format. */
  llm?: unknown[];
}

export function initialState(partial: Partial<ConvState> = {}): ConvState {
  return { lang: "en", intents: [], answered: 0, unclear: 0, turns: 0, ...partial };
}
