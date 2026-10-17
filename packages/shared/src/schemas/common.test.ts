import { describe, expect, it } from "vitest";
import { LocalTimeSchema, PhoneE164Schema, formatPaise } from "./common.js";

describe("common schemas", () => {
  it("accepts valid 24h times and rejects invalid ones", () => {
    expect(LocalTimeSchema.safeParse("09:00").success).toBe(true);
    expect(LocalTimeSchema.safeParse("20:30").success).toBe(true);
    expect(LocalTimeSchema.safeParse("24:00").success).toBe(false);
    expect(LocalTimeSchema.safeParse("9:00").success).toBe(false);
  });

  it("accepts E.164 Indian numbers", () => {
    expect(PhoneE164Schema.safeParse("+919876543210").success).toBe(true);
    expect(PhoneE164Schema.safeParse("9876543210").success).toBe(false);
  });

  it("formats paise as rupees", () => {
    expect(formatPaise(85000)).toBe("₹850");
    expect(formatPaise(150050)).toBe("₹1,500.50");
  });
});
