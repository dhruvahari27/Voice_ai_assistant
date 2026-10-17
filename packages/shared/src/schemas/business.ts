import { z } from "zod";
import { IdSchema, LocalTimeSchema, PhoneE164Schema } from "./common.js";

export const WeekdaySchema = z.number().int().min(0).max(6); // 0 = Sunday

export const BusinessHoursSchema = z.object({
  weekday: WeekdaySchema,
  opensAt: LocalTimeSchema,
  closesAt: LocalTimeSchema,
});
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const BusinessSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  name: z.string().min(1),
  timezone: z.string(),
  phone: PhoneE164Schema.nullable(),
  city: z.string().nullable(),
  hours: z.array(BusinessHoursSchema),
});
export type Business = z.infer<typeof BusinessSchema>;

export const PolicySchema = z.object({
  minLeadMinutes: z.number().int().nonnegative(),
  maxHorizonDays: z.number().int().positive(),
  cancelWindowHours: z.number().int().nonnegative(),
  maxBookingsPerCustomerPerDay: z.number().int().positive(),
  requireConfirmation: z.boolean(),
});
export type Policy = z.infer<typeof PolicySchema>;
