import { z } from "zod";

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.enum(["ok", "down"]),
  redis: z.enum(["ok", "down"]),
  version: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
