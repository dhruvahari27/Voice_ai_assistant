import type { ZodType, ZodTypeDef } from "zod";
import { badRequest } from "./errors.js";

/** Parse untrusted input with a Zod schema; throw a 400 with field errors on failure. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw badRequest(
      result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "),
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
