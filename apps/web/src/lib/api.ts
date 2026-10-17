import {
  ApiErrorSchema,
  BusinessSchema,
  HealthResponseSchema,
  ServiceListResponseSchema,
  type Business,
  type HealthResponse,
  type Service,
} from "@voiceops/shared";
import { z } from "zod";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch JSON and validate it with the same Zod schema the API uses. */
async function getJson<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, okStatuses = [200]): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const body: unknown = await res.json().catch(() => null);
  if (!okStatuses.includes(res.status)) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(res.status, "unknown", `Request failed (${res.status})`);
  }
  return schema.parse(body);
}

export const api = {
  // /health returns 503 with a body when a dependency is down; still parse it.
  health: (): Promise<HealthResponse> => getJson("/health", HealthResponseSchema, [200, 503]),
  business: async (slug: string): Promise<Business> =>
    (await getJson(`/api/v1/businesses/${slug}`, z.object({ business: BusinessSchema }))).business,
  services: async (slug: string): Promise<Service[]> =>
    (await getJson(`/api/v1/businesses/${slug}/services`, ServiceListResponseSchema)).services,
};
