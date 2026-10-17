import { parseDate, parseTime, type DateMatch, type TimeMatch } from "./datetime.js";
import { isAffirmative, isNegative, matchService, parseName, parseOrdinal, parsePhone, type ServiceLike } from "./entities.js";
import { classify, type Intent } from "./intent.js";
import { normalize } from "./normalize.js";

export * from "./datetime.js";
export * from "./entities.js";
export * from "./intent.js";
export { normalize } from "./normalize.js";

export interface Analysis<S extends ServiceLike = ServiceLike> {
  text: string;
  lang: "en" | "hi" | undefined;
  intent: Intent;
  intents: Intent[];
  affirmative: boolean;
  negative: boolean;
  service?: S;
  date?: DateMatch;
  time?: TimeMatch;
  phone?: string;
  name?: string;
  ordinal?: number;
}

export interface AnalyzeContext<S extends ServiceLike> {
  today: string;
  services: S[];
  expecting?: "time" | "name" | "phone" | string;
}

/** One pass over a caller utterance: language, intent, yes/no and every entity we use. */
export function analyze<S extends ServiceLike>(raw: string, ctx: AnalyzeContext<S>): Analysis<S> {
  const n = normalize(raw);
  const englishWords = n.tokens.filter((t) => /^[a-z]+$/.test(t) && !/^(ok|okay|hi|hello)$/.test(t)).length;
  const lang: Analysis["lang"] = n.hindiScore >= 1 ? "hi" : englishWords >= 3 ? "en" : undefined;

  const phone = parsePhone(n.text);
  // Strip the phone and date before looking for a time, so "9876543210" and "18 oct" aren't read as hours.
  let rest = phone ? n.text.replace(/\+?[\d][\d\s-]{7,}\d/, " ") : n.text;
  const date = parseDate(rest, ctx.today);
  if (date) rest = rest.replace(date.matched, " ");
  const time = parseTime(rest, { allowBareNumber: ctx.expecting === "time" });
  const { intent, all } = classify(n.text);

  return {
    text: n.text,
    lang,
    intent,
    intents: all,
    affirmative: isAffirmative(n.text),
    negative: isNegative(n.text),
    service: matchService(n.text, ctx.services),
    date,
    time,
    phone,
    name: parseName(n.text, { expecting: ctx.expecting === "name" }),
    ordinal: parseOrdinal(n.text),
  };
}
