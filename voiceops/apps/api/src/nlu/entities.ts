import { hasPhrase, levenshtein } from "./normalize.js";

// ---------- yes / no ----------
const YES = [
  "yes", "yeah", "yep", "yup", "ya", "haan", "han", "haa", "ha", "hanji", "haanji", "ji haan", "ji", "ok", "okay",
  "okk", "sure", "confirm", "confirmed", "theek hai", "thik hai", "theek", "thik", "chalega", "chal jayega", "done",
  "bilkul", "correct", "right", "perfect", "go ahead", "please do", "kar do", "kardo", "kar dijiye", "book karo",
  "book kar do", "book it", "sounds good", "fine", "great", "accha", "acha", "achha", "of course", "absolutely",
];
const NO = [
  "no", "nope", "nah", "nahi", "nahin", "nai", "mat", "don't", "dont", "do not", "not", "never", "cancel that",
  "wrong", "galat", "rehne do", "rahne do", "leave it", "chhodo", "nhi",
];

function matchesAny(text: string, list: string[]): boolean {
  return list.some((p) => hasPhrase(text, p));
}

export function isAffirmative(text: string): boolean {
  return matchesAny(text, YES) && !matchesAny(text, NO);
}

export function isNegative(text: string): boolean {
  return matchesAny(text, NO) && !/\b(no problem|koi baat nahi|no issue)\b/.test(text);
}

// ---------- services ----------
export interface ServiceLike {
  id: string;
  name: string;
  aliases: string[];
}

/** Longest alias/name found in the text wins; one-letter typos tolerated on long words. */
export function matchService<T extends ServiceLike>(text: string, services: T[]): T | undefined {
  let best: { s: T; len: number } | undefined;
  for (const s of services) {
    for (const phrase of [s.name, ...s.aliases].map((p) => p.toLowerCase())) {
      if (phrase.length >= 2 && hasPhrase(text, phrase) && (!best || phrase.length > best.len)) {
        best = { s, len: phrase.length };
      }
    }
  }
  if (best) return best.s;
  const words = text.split(" ");
  for (const s of services) {
    for (const phrase of [s.name, ...s.aliases].map((p) => p.toLowerCase())) {
      const pw = phrase.split(" ");
      if (pw.some((w) => w.length >= 6) && pw.length <= words.length) {
        for (let i = 0; i + pw.length <= words.length; i++) {
          const window = words.slice(i, i + pw.length).join(" ");
          if (levenshtein(window, phrase) <= (phrase.length >= 10 ? 2 : 1)) return s;
        }
      }
    }
  }
  return undefined;
}

// ---------- ordinals ("the second one", "doosra wala", "last") ----------
export function parseOrdinal(text: string): number | undefined {
  if (/\b(first|1st|pehla|pehle|pahla|pahle|pehli|first one|option 1|number 1|one)\b/.test(text)) return 0;
  if (/\b(second|2nd|doosra|dusra|doosri|dusri|option 2|number 2|two)\b/.test(text)) return 1;
  if (/\b(third|3rd|teesra|tisra|teesri|option 3|number 3|three)\b/.test(text)) return 2;
  if (/\b(last|aakhri|akhri|last one)\b/.test(text)) return -1;
  return undefined;
}

// ---------- phone numbers ----------
const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

/** Indian mobile → E.164 (+91XXXXXXXXXX). Accepts spoken digits, spaces, dashes, +91/91/0 prefixes. */
export function parsePhone(text: string): string | undefined {
  let t = text.replace(/\b(double|triple)\s+(\w+)/g, (_, k: string, w: string) => {
    const d = DIGIT_WORDS[w] ?? (/^\d$/.test(w) ? w : "");
    return d ? d.repeat(k === "double" ? 2 : 3) : `${k} ${w}`;
  });
  t = t.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => DIGIT_WORDS[w] ?? w);
  const runs = t.match(/\+?[\d][\d\s-]{7,}\d/g) ?? [];
  for (const run of runs) {
    const digits = run.replace(/[^\d]/g, "");
    const plus = run.trim().startsWith("+");
    const e164 = toE164(plus ? `+${digits}` : digits);
    if (e164) return e164;
  }
  return undefined;
}

export function toE164(raw: string): string | undefined {
  const plus = raw.trim().startsWith("+");
  const d = raw.replace(/[^\d]/g, "");
  if (plus && d.length >= 10 && d.length <= 15) return `+${d}`;
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d.slice(1))) return `+91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2))) return `+${d}`;
  return undefined;
}

/** "+919876543210" → "98765 43210" for reading back. */
export function speakPhone(e164: string): string {
  const d = e164.replace(/^\+91/, "");
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : e164;
}

// ---------- names ----------
const NOT_NAMES = new Set([
  "looking", "calling", "interested", "here", "fine", "good", "not", "ok", "okay", "busy", "sorry", "available",
  "free", "the", "a", "an", "booking", "trying", "going", "coming", "bol", "speaking", "haan", "yes", "no", "nahi",
]);

const STOP = new Set(["hai", "hoon", "hu", "ji", "and", "for", "to", "from", "with", "calling", "here", "speaking"]);

export function parseName(text: string, opts: { expecting?: boolean } = {}): string | undefined {
  const patterns = [
    /\b(?:my name is|name is|name's|naam hai|mera naam|naam)\s+([a-z]+(?:\s+[a-z]+)?)/,
    /\b(?:this is|i am|i'm|im)\s+([a-z]+(?:\s+[a-z]+)?)\s*(?:here|speaking|calling)?\b/,
    /\b([a-z]+)\s+(?:bol raha|bol rahi|bol rha|bol rhi|here speaking|speaking)\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const raw = m[1].split(" ");
      if (NOT_NAMES.has(raw[0]!)) continue;
      const words = raw.filter((w) => !NOT_NAMES.has(w) && !STOP.has(w) && w.length >= 2);
      if (words.length) return titleCase(words.slice(0, 2).join(" "));
    }
  }
  if (opts.expecting) {
    const words = text
      .replace(/\b(ji|sir|madam|hai|hoon|hu|mera|naam|my|name|is|it's|its|this|the|haan|yes|ok|okay)\b/g, " ")
      .split(" ")
      .filter((w) => /^[a-z]{2,}$/.test(w) && !NOT_NAMES.has(w));
    if (words.length >= 1 && words.length <= 3) return titleCase(words.join(" "));
  }
  return undefined;
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
