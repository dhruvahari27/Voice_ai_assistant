import { z } from "zod";

/** Money is always stored and sent as integer paise (₹1 = 100 paise). */
export const PaiseSchema = z.number().int().nonnegative();

/** "HH:MM" in 24-hour local business time. */
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24-hour)");

/** Indian mobile numbers in E.164, e.g. +919876543210. */
export const PhoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Expected E.164 phone number, e.g. +919876543210");

export const IdSchema = z.string().uuid();

/** Standard error body returned by every API route. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}
