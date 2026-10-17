import { and, count, eq } from "drizzle-orm";
import { hashPassword } from "../lib/password.js";
import type { Db } from "./client.js";
import { businessHours, businesses, knowledgeItems, policies, resources, services, users } from "./schema.js";
import { AUTOCARE } from "./seed-data.js";

/** Idempotent: running it twice leaves the same data. Returns the business. */
export async function seed(db: Db) {
  const b = AUTOCARE;
  const passwordHash = await hashPassword(b.owner.password);

  return db.transaction(async (tx) => {
    const profile = {
      name: b.name,
      city: b.city,
      address: b.address,
      phone: b.phone,
      ownerPhone: b.ownerPhone,
      timezone: b.timezone,
      status: "active" as const,
    };
    const [business] = await tx
      .insert(businesses)
      .values({ slug: b.slug, ...profile })
      .onConflictDoUpdate({ target: businesses.slug, set: profile })
      .returning();
    const businessId = business!.id;

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

    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(knowledgeItems).where(eq(knowledgeItems.businessId, businessId));
    if (n === 0) await tx.insert(knowledgeItems).values(b.knowledge.map((k) => ({ ...k, businessId })));

    const owner = await tx.query.users.findFirst({ where: and(eq(users.businessId, businessId), eq(users.role, "owner")) });
    if (!owner) {
      await tx.insert(users).values({
        businessId,
        role: "owner",
        name: b.owner.name,
        email: b.owner.email,
        phone: b.owner.phone,
        passwordHash,
      });
    }
    return business!;
  });
}

/** True when the database has no business yet (first start). */
export async function isEmpty(db: Db) {
  const [row] = await db.select({ n: count() }).from(businesses);
  return (row?.n ?? 0) === 0;
}
