import { hasPhrase } from "./normalize.js";

export type Intent =
  | "complaint"
  | "human"
  | "cancel"
  | "reschedule"
  | "my_appointment"
  | "callback"
  | "book"
  | "price"
  | "hours"
  | "location"
  | "services"
  | "goodbye"
  | "thanks"
  | "greeting"
  | "question"
  | "unknown";

/** Ordered by priority: a complaint that mentions booking is still a complaint. */
const RULES: [Intent, (string | RegExp)[]][] = [
  ["complaint", [
    "complaint", "complain", "shikayat", "not happy", "unhappy", "bad service", "worst", "kharab", "bekar", "bakwas",
    "refund", "damage", "damaged", "scratch", "scratched", "poor service", "very bad", "disappointed", "angry",
    /\b(problem|issue) (with|in) (my|the|last|previous)\b/, /\bpichli (baar|service)\b/,
  ]],
  ["human", [
    "human", "real person", "a person", "talk to someone", "speak to someone", "talk to a person", "manager", "owner",
    "insaan", "kisi se baat", "staff se baat", "receptionist se", "connect me", "transfer", "agent", "representative",
    /\b(baat|baat karni|baat karna) (hai|karni hai|karwa)\b.*\b(manager|owner|staff|aadmi|insaan)\b/,
  ]],
  ["cancel", [
    "cancel", "radd", "cancellation", "nahi aa paunga", "nahi aa paungi", "nahi aa sakta", "nahi aa sakti",
    "don't need the appointment", "call off",
  ]],
  ["reschedule", [
    "reschedule", "re schedule", "postpone", "prepone", "change my appointment", "change the appointment",
    "change my booking", "change the time", "change time", "move my", "shift my", "shift the", "badalna", "badal do",
    "badal sakte", "time change", "date change", "another time", "different time", "aage kar", "peeche kar",
    "shift karna", "shift kar", "shift karni", "change karna", "change kar", "change karni", "reschedule karna",
    "time badalna", "date badalna", "din badalna", "aage badha", "postpone karna",
    /\b(appointment|booking)\b.*\b(shift|change|move|badal\w*)\b/,
  ]],
  ["my_appointment", [
    "my appointment", "my booking", "meri booking", "mera appointment", "meri appointment", "when is my",
    "booking status", "appointment status", "kab hai meri", "kab hai mera",
  ]],
  ["callback", [
    "call back", "callback", "call me back", "call me later", "baad mein call", "phone karna", "phone kar",
    "call kar dena", "call karna", "wapas call", "vapas call", "ring me",
  ]],
  ["book", [
    "book", "booking", "appointment", "slot", "schedule", "reserve", "available", "availability", "free slot",
    "chahiye", "karwana", "karwani", "karana", "lagwana", "aana hai", "aa sakta", "aa sakti", "le aau", "le aaun",
    "le aana", "service karwani", "gaadi deni", "drop my car", "bring my car", "come in", "visit",
  ]],
  ["price", [
    "price", "prices", "cost", "costs", "charges", "charge", "rate", "rates", "kitna", "kitne", "kitne ka", "fees",
    "fee", "how much", "paise", "keemat", "rupees", "rs", "pricing", "quote", "estimate",
  ]],
  ["hours", [
    "timing", "timings", "hours", "open", "opening", "close", "closing", "closed", "khula", "band", "kab tak",
    "kab se", "working hours", "sunday", "holiday",
  ]],
  ["location", ["address", "location", "where are you", "kahan", "kidhar", "directions", "map", "located", "pata"]],
  ["services", ["what services", "which services", "services do you", "kya kya", "what do you do", "what all", "menu"]],
  ["goodbye", ["bye", "goodbye", "good bye", "that's all", "thats all", "nothing else", "bas itna", "bas", "no thanks", "chalo bye"]],
  ["thanks", ["thank you", "thanks", "thank", "dhanyavaad", "shukriya", "thnx", "thx"]],
  ["greeting", ["hello", "hi", "hey", "namaste", "namaskar", "good morning", "good evening", "good afternoon", "hii", "helo"]],
];

const QUESTION_HINTS = /\b(do you|can you|is there|are there|does|kya|what|which|how|why|can i|could|will you|milega|hota hai|hai kya)\b|\?/;

export interface IntentResult {
  intent: Intent;
  /** Every intent whose keywords matched, in priority order. */
  all: Intent[];
}

export function classify(text: string): IntentResult {
  const all: Intent[] = [];
  for (const [intent, rules] of RULES) {
    if (rules.some((r) => (typeof r === "string" ? hasPhrase(text, r) : r.test(text)))) all.push(intent);
  }
  // "hours" picks up "open"/"close" in unrelated sentences; only trust it without a stronger action intent.
  const strong = all.filter((i) => !["greeting", "thanks"].includes(i));
  let intent: Intent = strong[0] ?? all[0] ?? (QUESTION_HINTS.test(text) ? "question" : "unknown");
  // A question that mentions "service" is usually about prices or offerings, not a booking.
  if (intent === "book" && QUESTION_HINTS.test(text) && all.includes("price")) intent = "price";
  // "Is Saturday 5 pm available?" is a booking attempt, even phrased as a question.
  if (intent === "hours" && all.includes("book")) intent = "book";
  return { intent, all };
}
