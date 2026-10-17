/**
 * Time-zone helpers built on Intl (no dependencies).
 * Instants are JS Dates (UTC). Local values are plain strings: date "YYYY-MM-DD", time "HH:MM".
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weekday: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
}

export function localParts(instant: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(instant)) p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${pad(hour)}:${pad(minute)}`,
    weekday: WEEKDAY_INDEX[p.weekday ?? "Sun"] ?? 0,
    minutes: hour * 60 + minute,
  };
}

/** Offset of `tz` from UTC at `instant`, in minutes (Asia/Kolkata → +330). */
function offsetMinutes(instant: Date, tz: string): number {
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(instant)) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Local wall-clock time in `tz` → UTC instant. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle DST edges in zones that have them.
  let guess = naive - offsetMinutes(new Date(naive), tz) * 60000;
  guess = naive - offsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess);
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Calendar arithmetic on a local date string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60000);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function dayName(weekday: number): string {
  return DAY_NAMES[weekday] ?? "";
}

/** "6:30 PM" */
export function speakTime(time: string): string {
  const mins = minutesOf(time);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${pad(m)}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** "Saturday, 18 October" */
export function speakDate(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${dayName(weekdayOf(date))}, ${d} ${MONTH_NAMES[m - 1]}`;
}

/** "Saturday, 18 October, 6:30 PM" for an instant in the business time zone. */
export function speakInstant(instant: Date, tz: string): string {
  const p = localParts(instant, tz);
  return `${speakDate(p.date)}, ${speakTime(p.time)}`;
}

/** Relative wording when it helps: "today", "tomorrow", else the date. */
export function speakRelativeDate(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  return speakDate(date);
}

export function monthIndex(name: string): number | undefined {
  const n = name.toLowerCase().slice(0, 3);
  const i = MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(n));
  return i >= 0 ? i + 1 : undefined;
}
