import { formatPaise } from "@voiceops/shared";

export { formatPaise };

/**
 * The business's timezone. Dates are shown in the shop's local time, whatever the viewer's
 * computer is set to. Set once from /auth/me (see App.tsx).
 */
let TZ = "Asia/Kolkata";
export function setTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    TZ = tz;
  } catch {
    /* keep the previous zone */
  }
}
export function currentTimezone() {
  return TZ;
}

export function fmtTime(iso: string, tz = TZ) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function fmtDate(iso: string, tz = TZ) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
}

export function fmtDateTime(iso: string, tz = TZ) {
  return `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)}`;
}

/** "YYYY-MM-DD" → "Tue 13 Oct" */
export function fmtLocalDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** "18:30" → "6:30 pm" */
export function fmtLocalTime(t: string) {
  const [h, m] = t.split(":").map(Number) as [number, number];
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
}

export function relative(iso: string, now = Date.now()) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const text = mins < 1 ? "just now" : mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
  if (mins < 1) return text;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

/** "+919876543210" → "98765 43210" */
export function fmtPhone(e164: string | null | undefined) {
  if (!e164) return "Unknown";
  const d = e164.replace(/^\+91/, "");
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : e164;
}

export function todayLocal(tz = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function pct(x: number | null | undefined) {
  return x == null ? "–" : `${Math.round(x * 100)}%`;
}

export const OUTCOME_LABEL: Record<string, string> = {
  booked: "Booked",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  answered: "Answered",
  callback: "Callback",
  waitlist: "Waitlist",
  handoff: "Handed to staff",
  abandoned: "Left early",
};

export const INTENT_LABEL: Record<string, string> = {
  book: "New booking",
  reschedule: "Reschedule",
  cancel: "Cancel",
  my_appointment: "Check booking",
  callback: "Call back",
  price: "Prices",
  hours: "Timings",
  location: "Address",
  services: "Services",
  question: "Question",
  complaint: "Complaint",
  human: "Asked for a person",
  other: "Other",
};

export const REASON_LABEL: Record<string, string> = {
  no_slot: "Wanted time was full",
  unknown_answer: "Question we couldn't answer",
  callback_requested: "Asked for a call back",
  hung_up_early: "Hung up at the greeting",
  dropped_mid_flow: "Left mid-booking",
  complaint: "Complaint",
  human_request: "Asked for a person",
  low_confidence: "AI was unsure",
};

export const TOOL_LABEL: Record<string, string> = {
  get_business_info: "Looked up hours",
  search_knowledge: "Searched FAQs",
  check_availability: "Checked availability",
  hold_slot: "Held the slot",
  book_appointment: "Booked",
  find_appointments: "Found bookings",
  reschedule_appointment: "Moved booking",
  cancel_appointment: "Cancelled booking",
  create_callback: "Created callback",
  join_waitlist: "Added to waitlist",
  request_handoff: "Alerted staff",
  end_call: "Ended call",
};
