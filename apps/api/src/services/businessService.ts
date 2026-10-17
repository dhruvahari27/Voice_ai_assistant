import { and, asc, eq } from "drizzle-orm";
import type { Business, Service } from "@voiceops/shared";
import type { Db } from "../db/client.js";
import { businessHours, businesses, services } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

/**
 * Read-side of business setup. Every query is scoped to one business —
 * tenant isolation lives here in the service layer, not in the routes.
 */
export function createBusinessService(db: Db) {
  async function requireBusinessId(slug: string): Promise<string> {
    const [row] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)).limit(1);
    if (!row) throw notFound("Business");
    return row.id;
  }

  return {
    requireBusinessId,

    async getBusiness(slug: string): Promise<Business> {
      const [b] = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1);
      if (!b) throw notFound("Business");
      const hours = await db
        .select({ weekday: businessHours.weekday, opensAt: businessHours.opensAt, closesAt: businessHours.closesAt })
        .from(businessHours)
        .where(eq(businessHours.businessId, b.id))
        .orderBy(asc(businessHours.weekday), asc(businessHours.opensAt));
      return {
        id: b.id,
        slug: b.slug,
        name: b.name,
        timezone: b.timezone,
        phone: b.phone,
        city: b.city,
        hours,
      };
    },

    async listServices(slug: string, opts: { includeInactive?: boolean } = {}): Promise<Service[]> {
      const businessId = await requireBusinessId(slug);
      const rows = await db
        .select()
        .from(services)
        .where(
          opts.includeInactive
            ? eq(services.businessId, businessId)
            : and(eq(services.businessId, businessId), eq(services.active, true)),
        )
        .orderBy(asc(services.name));
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        aliases: s.aliases,
        durationMin: s.durationMin,
        bufferMin: s.bufferMin,
        pricePaise: s.pricePaise,
        resourceKind: s.resourceKind,
        active: s.active,
      }));
    },
  };
}

export type BusinessService = ReturnType<typeof createBusinessService>;
