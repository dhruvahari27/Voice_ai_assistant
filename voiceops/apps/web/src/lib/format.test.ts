import { describe, expect, it } from "vitest";
import { addDays, currentTimezone, fmtLocalTime, fmtPhone, fmtTime, pct, setTimezone } from "./format";

describe("format helpers", () => {
  it("formats Indian mobile numbers for reading", () => {
    expect(fmtPhone("+919876543210")).toBe("98765 43210");
    expect(fmtPhone(null)).toBe("Unknown");
  });
  it("formats local times and dates", () => {
    expect(fmtLocalTime("18:30").toLowerCase().replace(/\s/g, " ")).toMatch(/6:30\spm/);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("formats percentages", () => {
    expect(pct(0.456)).toBe("46%");
    expect(pct(null)).toBe("–");
  });
});

describe("business timezone", () => {
  it("shows times in the business's zone, not the viewer's", () => {
    const iso = "2026-10-14T06:30:00Z";
    setTimezone("Asia/Kolkata");
    expect(fmtTime(iso)).toMatch(/12:00\s?pm/i);
    setTimezone("Asia/Dubai");
    expect(fmtTime(iso)).toMatch(/10:30\s?am/i);
    setTimezone("Not/AZone");
    expect(currentTimezone()).toBe("Asia/Dubai");
    setTimezone("Asia/Kolkata");
  });
});
