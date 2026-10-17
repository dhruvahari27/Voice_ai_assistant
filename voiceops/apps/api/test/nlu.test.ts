import { describe, expect, it } from "vitest";
import { analyze, classify, isAffirmative, isNegative, matchService, normalize, parseDate, parseName, parsePhone, parseTime } from "../src/nlu/index.js";

// Monday 12 Oct 2026 is "today" in these tests.
const TODAY = "2026-10-12";

const services = [
  { id: "wash", name: "Car Wash", aliases: ["wash", "dhulai", "car dhona"] },
  { id: "detail", name: "Premium Detailing", aliases: ["detailing", "polish", "car detailing"] },
  { id: "oil", name: "Oil Change", aliases: ["oil", "engine oil"] },
  { id: "ac", name: "AC Service", aliases: ["ac", "air conditioning"] },
  { id: "general", name: "General Service", aliases: ["service", "full service", "servicing"] },
];

const t = (s: string, bare = false) => parseTime(normalize(s).text, { allowBareNumber: bare });
const d = (s: string) => parseDate(normalize(s).text, TODAY)?.date;

describe("dates", () => {
  it.each([
    ["today", "2026-10-12"],
    ["aaj", "2026-10-12"],
    ["kal", "2026-10-13"],
    ["tomorrow evening", "2026-10-13"],
    ["parso", "2026-10-14"],
    ["day after tomorrow", "2026-10-14"],
    ["saturday", "2026-10-17"],
    ["shanivar ko", "2026-10-17"],
    ["next monday", "2026-10-19"],
    ["monday", "2026-10-12"],
    ["agle somvar", "2026-10-19"],
    ["18 oct", "2026-10-18"],
    ["18th of october", "2026-10-18"],
    ["oct 18", "2026-10-18"],
    ["5 jan", "2027-01-05"],
    ["20/10", "2026-10-20"],
    ["20 tarikh", "2026-10-20"],
    ["10 tarikh", "2026-11-10"],
    ["कल", "2026-10-13"],
    ["परसों शाम", "2026-10-14"],
  ])("%s → %s", (input, expected) => {
    expect(d(input)).toBe(expected);
  });

  it("returns nothing when no date is said", () => {
    expect(d("i want a car wash")).toBeUndefined();
  });
});

describe("times", () => {
  it.each([
    ["6 pm", "18:00"],
    ["6pm", "18:00"],
    ["10 am", "10:00"],
    ["6:30", "18:30"],
    ["6.30 pm", "18:30"],
    ["18:30", "18:30"],
    ["11:15", "11:15"],
    ["6 baje", "18:00"],
    ["chhe baje", "18:00"],
    ["shaam 6 baje", "18:00"],
    ["subah 10 baje", "10:00"],
    ["saade chhe", "18:30"],
    ["kal shaam saade chhe baje", "18:30"],
    ["saade 5 baje", "17:30"],
    ["sava 4", "16:15"],
    ["paune 5", "16:45"],
    ["dedh baje", "13:30"],
    ["dhai baje", "14:30"],
    ["half past 5", "17:30"],
    ["quarter to 6", "17:45"],
    ["at 11", "11:00"],
    ["evening 6", "18:00"],
    ["12 baje", "12:00"],
    ["शाम 6 बजे", "18:00"],
    ["साढ़े छह बजे", "18:30"],
  ])("%s → %s", (input, expected) => {
    expect(t(input)?.time).toBe(expected);
  });

  it("returns a window for a part of day only", () => {
    expect(t("kal shaam")?.window).toEqual({ from: "16:00", to: "20:00" });
    expect(t("morning")?.window).toEqual({ from: "08:00", to: "12:00" });
    expect(t("dopahar mein")?.window).toEqual({ from: "12:00", to: "16:00" });
  });

  it("accepts a bare number only when a time was asked for", () => {
    expect(t("6")).toBeUndefined();
    expect(t("6", true)?.time).toBe("18:00");
    expect(t("5 wala", true)?.time).toBe("17:00");
  });

  it("does not read a phone number or a date as a time", () => {
    const a = analyze("my number is 98765 43210", { today: TODAY, services });
    expect(a.time).toBeUndefined();
    expect(a.phone).toBe("+919876543210");
    const b = analyze("18 oct 5 pm", { today: TODAY, services });
    expect(b.date?.date).toBe("2026-10-18");
    expect(b.time?.time).toBe("17:00");
  });
});

describe("services", () => {
  it.each([
    ["car detailing ke liye slot hai", "detail"],
    ["gaadi ki dhulai karwani hai", "wash"],
    ["oil change", "oil"],
    ["engine oil badalna hai", "oil"],
    ["ac gas refill", "ac"],
    ["full service chahiye", "general"],
    ["premium detailling please", "detail"],
  ])("%s → %s", (input, expected) => {
    expect(matchService(normalize(input).text, services)?.id).toBe(expected);
  });

  it("prefers the longest match", () => {
    // "car detailing" beats the bare word "service" type collisions
    expect(matchService("car detailing service", services)?.id).toBe("detail");
  });
});

describe("intents", () => {
  it.each([
    ["Bhai kal evening mein car detailing ke liye slot hai?", "book"],
    ["I want to book an oil change", "book"],
    ["I need to reschedule my appointment", "reschedule"],
    ["meri booking cancel kar do", "cancel"],
    ["how much is a car wash", "price"],
    ["car wash kitne ka hai", "price"],
    ["what are your timings", "hours"],
    ["where are you located", "location"],
    ["I want to complain about my last service", "complaint"],
    ["can I talk to the manager", "human"],
    ["please call me back tomorrow", "callback"],
    ["do you provide pickup and drop", "question"],
    ["thank you", "thanks"],
    ["bye", "goodbye"],
    ["is saturday 5 pm available", "book"],
  ])("%s → %s", (input, expected) => {
    expect(classify(normalize(input).text).intent).toBe(expected);
  });
});

describe("yes / no", () => {
  it.each(["haan", "haan ji", "yes please", "ok book it", "theek hai", "chalega", "kar do", "हाँ", "ji haan bilkul"])(
    "%s is yes",
    (s) => expect(isAffirmative(normalize(s).text)).toBe(true),
  );
  it.each(["no", "nahi", "nahi chahiye", "don't book", "rehne do", "नहीं"])("%s is no", (s) => {
    const text = normalize(s).text;
    expect(isAffirmative(text)).toBe(false);
    expect(isNegative(text)).toBe(true);
  });
});

describe("phone and name", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["nine eight seven six five four three two one zero", "+919876543210"],
    ["double nine eight seven six five four three two one", "+919987654321"],
  ])("%s → %s", (input, expected) => {
    expect(parsePhone(normalize(input).text)).toBe(expected);
  });

  it("rejects numbers that aren't Indian mobiles", () => {
    expect(parsePhone("12345")).toBeUndefined();
    expect(parsePhone("1234567890")).toBeUndefined();
  });

  it.each([
    ["my name is rahul sharma", "Rahul Sharma"],
    ["mera naam priya hai", "Priya"],
    ["this is amit", "Amit"],
    ["rahul bol raha hoon", "Rahul"],
  ])("%s → %s", (input, expected) => {
    expect(parseName(normalize(input).text)).toBe(expected);
  });

  it("reads a bare name only when one was asked for", () => {
    expect(parseName("neha")).toBeUndefined();
    expect(parseName("neha", { expecting: true })).toBe("Neha");
    expect(parseName("i am looking for a wash")).toBeUndefined();
  });
});

describe("analyze", () => {
  it("pulls everything out of the blueprint's example sentence", () => {
    const a = analyze("Bhai, kal evening mein car detailing ke liye slot hai?", { today: TODAY, services });
    expect(a).toMatchObject({ lang: "hi", intent: "book" });
    expect(a.service?.id).toBe("detail");
    expect(a.date?.date).toBe("2026-10-13");
    expect(a.time?.window).toEqual({ from: "16:00", to: "20:00" });
  });

  it("detects English", () => {
    expect(analyze("I would like to book a car wash tomorrow", { today: TODAY, services }).lang).toBe("en");
  });
});
