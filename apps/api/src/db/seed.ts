import { and, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { businessHours, businesses, policies, resources, services, users } from "./schema.js";
import { AUTOCARE } from "./seed-data.js";

/** Idempotent: running it twice leaves the same data. Used by `pnpm db:seed` and the tests. */
export async function seed(db: Db) {
  const b = AUTOCARE;

  return db.transaction(async (tx) => {
    const [business] = await tx
      .insert(businesses)
      .values({ slug: b.slug, name: b.name, city: b.city, phone: b.phone, timezone: b.timezone, status: "active" })
      .onConflictDoUpdate({
        target: businesses.slug,
        set: { name: b.name, city: b.city, phone: b.phone, timezone: b.timezone, status: "active" },
      })
      .returning();
    if (!business) throw new Error("seed: business upsert returned nothing");
    const businessId = business.id;

    await tx.delete(businessHours).where(eq(businessHours.businessId, businessId));
    await tx.insert(businessHours).values(b.hours.map((h) => ({ ...h, businessId })));

    for (const r of b.resources) {
      await tx
        .insert(resources)
        .values({ ...r, businessId })
        .onConflictDoUpdate({ target: [resources.businessId, resources.name], set: { kind: r.kind, active: true } });
    }

    for (const s of b.services) {
      await tx
        .insert(services)
        .values({ ...s, businessId })
        .onConflictDoUpdate({ target: [services.businessId, services.name], set: { ...s, active: true } });
    }

    await tx
      .insert(policies)
      .values({ ...b.policy, businessId })
      .onConflictDoUpdate({ target: policies.businessId, set: b.policy });

    const owner = await tx.query.users.findFirst({
      where: and(eq(users.businessId, businessId), eq(users.role, "owner")),
    });
    if (!owner) await tx.insert(users).values({ ...b.owner, businessId });

    return business;
  });
}
