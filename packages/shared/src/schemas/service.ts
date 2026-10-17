import { z } from "zod";
import { IdSchema, PaiseSchema } from "./common.js";

export const ResourceKindSchema = z.enum(["bay", "chair", "room", "staff"]);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

export const ServiceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()),
  durationMin: z.number().int().positive(),
  bufferMin: z.number().int().nonnegative(),
  pricePaise: PaiseSchema,
  resourceKind: ResourceKindSchema,
  active: z.boolean(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const ServiceListResponseSchema = z.object({
  services: z.array(ServiceSchema),
});
export type ServiceListResponse = z.infer<typeof ServiceListResponseSchema>;

export const CreateServiceInputSchema = ServiceSchema.omit({ id: true, active: true }).extend({
  aliases: z.array(z.string().min(1)).default([]),
  bufferMin: z.number().int().nonnegative().default(0),
});
export type CreateServiceInput = z.infer<typeof CreateServiceInputSchema>;
