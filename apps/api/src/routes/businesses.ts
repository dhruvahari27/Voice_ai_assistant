import { Router } from "express";
import { z } from "zod";
import type { ServiceListResponse } from "@voiceops/shared";
import type { BusinessService } from "../services/businessService.js";
import { parse } from "../lib/validate.js";

const SlugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]{2,64}$/, "Invalid business slug") });
const ServiceQuery = z.object({ includeInactive: z.enum(["true", "false"]).optional() });

/**
 * Public read routes, scoped by business slug.
 * Phase 4 adds auth: the signed-in user's business replaces the slug for dashboard routes.
 */
export function businessRouter(deps: { businesses: BusinessService }) {
  const router = Router();

  router.get("/businesses/:slug", async (req, res) => {
    const { slug } = parse(SlugParams, req.params);
    res.json({ business: await deps.businesses.getBusiness(slug) });
  });

  router.get("/businesses/:slug/services", async (req, res) => {
    const { slug } = parse(SlugParams, req.params);
    const { includeInactive } = parse(ServiceQuery, req.query);
    const body: ServiceListResponse = {
      services: await deps.businesses.listServices(slug, { includeInactive: includeInactive === "true" }),
    };
    res.json(body);
  });

  return router;
}
