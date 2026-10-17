/**
 * Spoken date and time extraction for Indian English and Hinglish.
 *   "kal shaam saade chhe baje"  → tomorrow, 18:30
 *   "next saturday at 5 pm"      → coming Saturday after today, 17:00
 *   "18 oct evening"             → 18 Oct, window 16:00–20:00
 * Everything is resolved against the business's local "today".
 */
import { addDays, hhmm, monthIndex, pad, weekdayOf } from "../lib/time.js";
import { escapeRe } from "./normalize.js";

export interface DateMatch {
  date: string;
  matched: string;
}

const WEEKDAYS: [RegExp, number][] = [
  [/\b(sunday|sun|ravivar|raviwar|itvaar|itwar|etwar|itwaar)\b/, 0],
  [/\b(monday|mon|somvar|somwar)\b/, 1],
  [/\b(tuesday|tue|tues|mangalvar|mangalwar|mangal)\b/, 2],
  [/\b(wednesday|wed|budhvar|budhwar|budh)\b/, 3],
  [/\b(thursday|thu|thur|thurs|guruvar|guruwar|brihaspativar)\b/, 4],
  [/\b(friday|fri|shukravar|shukrawar|shukra)\b/, 5],
  [/\b(saturday|sat|shanivar|shaniwar|shani)\b/, 6],
];

const MONTHS_RE = "(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)";

export function parseDate(text: string, today: string): DateMatch | undefined {
  const t = ` ${text} `;
  let m: RegExpMatchArray | null;

  if ((m = t.match(/\b(day after tomorrow|parso|parson|parsoon)\b/))) return { date: addDays(today, 2), matched: m[0] };
  if ((m = t.match(/\b(today|aaj|aj|tonight|abhi)\b/))) return { date: today, matched: m[0] };
  if ((m = t.match(/\b(tomorrow|tmrw|tommorow|tomorow|tommorrow|kal|kel)\b/))) return { date: addDays(today, 1), matched: m[0] };

  // "18 oct", "18th of october", "oct 18"
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTHS_RE}\\b`)))) {
    const d = resolveDayMonth(Number(m[1]), monthIndex(m[2]!)!, today);
    if (d) return { date: d, matched: m[0] };
  }
  if ((m = t.match(new RegExp(`\\b${MONTHS_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    const d = resolveDayMonth(Number(m[2]), monthIndex(m[1]!)!, today);
    if (d) return { date: d, matched: m[0] };
  }
  // "18/10" (Indian day/month order)
  if ((m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/))) {
    const d = resolveDayMonth(Number(m[1]), Number(m[2]), today);
    if (d) return { date: d, matched: m[0] };
  }
  // "18 tarikh", "18th"
  if ((m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(tarikh|tareekh|tarik|date)\b/)) || (m = t.match(/\b(\d{1,2})(st|nd|rd|th)\b/))) {
    const day = Number(m[1]);
    const [y, mo] = today.split("-").map(Number) as [number, number];
    let d = resolveDayMonth(day, mo, today, y);
    if (d && d < today) d = resolveDayMonth(day, mo === 12 ? 1 : mo + 1, today);
    if (d) return { date: d, matched: m[0] };
  }

  for (const [re, wd] of WEEKDAYS) {
    const wm = t.match(re);
    if (!wm) continue;
    const before = t.slice(0, wm.index);
    const isNext = /\b(next|agle|agla|coming)\s*$/.test(before);
    const todayWd = weekdayOf(today);
    let delta = (wd - todayWd + 7) % 7;
    if (isNext && delta === 0) delta = 7;
    const matched = isNext ? `${before.match(/\b(next|agle|agla|coming)\s*$/)![0]}${wm[0]}` : wm[0];
    return { date: addDays(today, delta), matched: matched.trim() };
  }
  return undefined;
}

function resolveDayMonth(day: number, month: number, today: string, year?: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ty = Number(today.slice(0, 4));
  let y = year ?? ty;
  let candidate = `${y}-${pad(month)}-${pad(day)}`;
  if (!validDate(candidate)) return undefined;
  if (year === undefined && candidate < today) {
    y += 1;
    candidate = `${y}-${pad(month)}-${pad(day)}`;
  }
  return validDate(candidate) ? candidate : undefined;
}

function validDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---------------- time ----------------

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

export const PART_WINDOWS: Record<PartOfDay, { from: string; to: string }> = {
  morning: { from: "08:00", to: "12:00" },
  afternoon: { from: "12:00", to: "16:00" },
  evening: { from: "16:00", to: "20:00" },
  night: { from: "19:00", to: "23:00" },
};

export interface TimeMatch {
  /** Exact local time when one was said. */
  time?: string;
  /** Range when only a part of day was said ("evening"). */
  window?: { from: string; to: string };
  partOfDay?: PartOfDay;
  matched: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, chhah: 6, chheh: 6, chah: 6,
  saat: 7, aath: 8, ath: 8, nau: 9, das: 10, gyarah: 11, gyara: 11, barah: 12, bara: 12,
};
const NUM = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).map(escapeRe).join("|")})`;

function num(s: string): number {
  return /^\d+$/.test(s) ? Number(s) : (NUMBER_WORDS[s] ?? NaN);
}

function detectPart(t: string): PartOfDay | undefined {
  if (/\b(morning|subah|subha|savere|sawere|morn)\b/.test(t)) return "morning";
  if (/\b(afternoon|dopahar|dopehar|dophar|dupahar|lunch|noon)\b/.test(t)) return "afternoon";
  if (/\b(evening|shaam|sham|shām|evng|eve)\b/.test(t)) return "evening";
  if (/\b(night|raat|rat|tonight)\b/.test(t)) return "night";
  return undefined;
}

/** Turn an hour said without AM/PM into 24h using the part of day or business-hour common sense. */
function to24(hour: number, minute: number, meridiem: "am" | "pm" | undefined, part: PartOfDay | undefined): number {
  let h = hour % 24;
  if (meridiem === "am") h = hour === 12 ? 0 : hour;
  else if (meridiem === "pm") h = hour === 12 ? 12 : hour + 12;
  else if (hour <= 12) {
    if (part === "morning") h = hour === 12 ? 12 : hour;
    else if (part === "afternoon") h = hour === 12 || hour >= 11 ? hour : hour + 12;
    else if (part === "evening" || part === "night") h = hour === 12 ? 12 : hour + 12;
    // No hint: 1–7 means afternoon/evening at a shop, 8–11 morning, 12 noon.
    else h = hour >= 1 && hour <= 7 ? hour + 12 : hour;
  }
  return h * 60 + minute;
}

export interface ParseTimeOptions {
  /** Accept a bare number ("6") as a time — only when the agent just asked for a time. */
  allowBareNumber?: boolean;
}

export function parseTime(text: string, opts: ParseTimeOptions = {}): TimeMatch | undefined {
  const t = ` ${text} `;
  const part = detectPart(t);
  const partWord = part ? (t.match(/\b(morning|subah|subha|savere|sawere|morn|afternoon|dopahar|dopehar|dophar|dupahar|lunch|noon|evening|shaam|sham|evng|eve|night|raat|rat|tonight)\b/)?.[0] ?? "") : "";
  let m: RegExpMatchArray | null;
  const result = (mins: number, matched: string): TimeMatch => ({
    time: hhmm(mins),
    partOfDay: part,
    matched: [partWord, matched.trim()].filter(Boolean).join(" "),
  });

  // Hindi fractions: dedh (1:30), dhai (2:30), saade X (X:30), sava X (X:15), paune X (X-1:45)
  if ((m = t.match(/\b(dedh|derh)\b/))) return result(to24(1, 30, undefined, part), m[0]);
  if ((m = t.match(/\b(dhai|dhaai|adhai)\b/))) return result(to24(2, 30, undefined, part), m[0]);
  if ((m = t.match(new RegExp(`\\b(saade|sade|sadhe|saadhe|sare)\\s+${NUM}\\b(\\s+baje)?`)))) {
    const h = num(m[2]!);
    if (h >= 1 && h <= 12) return result(to24(h, 30, undefined, part), m[0]);
  }
  if ((m = t.match(new RegExp(`\\b(sava|savaa|sawa)\\s+${NUM}\\b(\\s+baje)?`)))) {
    const h = num(m[2]!);
    if (h >= 1 && h <= 12) return result(to24(h, 15, undefined, part), m[0]);
  }
  if ((m = t.match(new RegExp(`\\b(paune|pone|paun)\\s+${NUM}\\b(\\s+baje)?`)))) {
    const h = num(m[2]!);
    if (h >= 1 && h <= 12) return result(to24(h === 1 ? 12 : h - 1, 45, undefined, part), m[0]);
  }
  // English: half past X, quarter past X, quarter to X
  if ((m = t.match(new RegExp(`\\bhalf past ${NUM}\\b`)))) return result(to24(num(m[1]!), 30, undefined, part), m[0]);
  if ((m = t.match(new RegExp(`\\bquarter past ${NUM}\\b`)))) return result(to24(num(m[1]!), 15, undefined, part), m[0]);
  if ((m = t.match(new RegExp(`\\bquarter to ${NUM}\\b`)))) {
    const h = num(m[1]!);
    return result(to24(h === 1 ? 12 : h - 1, 45, undefined, part), m[0]);
  }
  // 6:30, 6:30 pm, 18:30
  if ((m = t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|a m|p m)?\b/))) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 23 && min < 60) {
      const mer = m[3] ? (m[3].replace(" ", "") as "am" | "pm") : undefined;
      return result(h > 12 ? h * 60 + min : to24(h, min, mer, part), m[0]);
    }
  }
  // 6 pm, 6pm, six pm
  if ((m = t.match(new RegExp(`\\b${NUM}\\s*(am|pm|a m|p m)\\b`)))) {
    const h = num(m[1]!);
    if (h >= 1 && h <= 12) return result(to24(h, 0, m[2]!.replace(" ", "") as "am" | "pm", part), m[0]);
  }
  // 6 baje, chhe baje, 6 o'clock, at 6
  if ((m = t.match(new RegExp(`\\b${NUM}\\s*(baje|bje|baj|o'clock|oclock|o clock)\\b`)))) {
    const h = num(m[1]!);
    if (h >= 1 && h <= 23) return result(h > 12 ? h * 60 : to24(h, 0, undefined, part), m[0]);
  }
  if ((m = t.match(new RegExp(`\\b(at|around|by|after)\\s+${NUM}\\b`)))) {
    const h = num(m[2]!);
    if (h >= 1 && h <= 12) return result(to24(h, 0, undefined, part), m[0]);
  }
  // "evening 6", "shaam 6"
  if (part && (m = t.match(new RegExp(`\\b${escapeRe(partWord)}\\s+${NUM}\\b`)))) {
    const h = num(m[1]!);
    if (h >= 1 && h <= 12) return { ...result(to24(h, 0, undefined, part), m[0]), matched: m[0].trim() };
  }
  if (opts.allowBareNumber && (m = t.match(new RegExp(`^\\s*${NUM}\\s*(wala|vala|baje)?\\s*$`)))) {
    const h = num(m[1]!);
    if (h >= 1 && h <= 12) return result(to24(h, 0, undefined, part), m[0]);
  }
  if (part) return { window: PART_WINDOWS[part], partOfDay: part, matched: partWord };
  return undefined;
}
