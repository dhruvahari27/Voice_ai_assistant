/**
 * Self-serve sign-up: create a business, its owner, and a starting setup the receptionist can use
 * right away. "car_service" copies the AutoCare catalogue (services, bays, FAQs) so a new garage
 * only edits prices; "blank" gives one example service to replace.
 */
import { eq } from "drizzle-orm";
import { businessHours, businesses, knowledgeItems, policies, resources, services, users } from "../db/schema.js";
import { AUTOCARE } from "../db/seed-data.js";
import { conflict } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import type { Db } from "../db/client.js";

export type Template = "car_service" | "blank";

export interface SignupInput {
  businessName: string;
  city?: string;
  businessPhone?: string;
  timezone: string;
  ownerName: string;
  email: string;
  password: string;
  ownerPhone?: string;
  template: Template;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 2 ? base : `business-${base}`.replace(/-+$/, "");
}

async function uniqueSlug(db: Db, name: string) {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [taken] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)).limit(1);
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createBusinessWithOwner(db: Db, input: SignupInput) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw conflict("email_taken", "An account with this email already exists. Sign in instead.");
  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(db, input.businessName);

  return db.transaction(async (tx) => {
    const [business] = await tx
      .insert(businesses)
      .values({
        slug,
        name: input.businessName.trim(),
        city: input.city?.trim() || null,
        phone: input.businessPhone || null,
        ownerPhone: input.ownerPhone || null,
        timezone: input.timezone,
        status: "active",
      })
      .returning();
    const businessId = business!.id;

    const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "19:00", businessId }));
    await tx.insert(businessHours).values(hours);
    await tx.insert(policies).values({ ...AUTOCARE.policy, businessId });

    if (input.template === "car_service") {
      await tx.insert(resources).values(AUTOCARE.resources.map((r) => ({ ...r, businessId })));
      await tx.insert(services).values(AUTOCARE.services.map((s) => ({ ...s, businessId })));
      await tx.insert(knowledgeItems).values(
        AUTOCARE.knowledge
          // Answers that name AutoCare's own prices or premises need the new owner's words.
          .filter((k) => !/parking|lounge|pickup/i.test(`${k.question} ${k.answer}`))
          .map((k) => ({ ...k, businessId })),
      );
    } else {
      await tx.insert(resources).values({ name: "Desk 1", kind: "staff" as const, businessId });
      await tx.insert(services).values({
        name: "Consultation",
        aliases: ["consultation", "appointment", "visit", "meeting"],
        durationMin: 30,
        bufferMin: 0,
        pricePaise: 0,
        resourceKind: "staff" as const,
        businessId,
      });
    }

    const [owner] = await tx
      .insert(users)
      .values({ businessId, role: "owner", name: input.ownerName.trim(), email, phone: input.ownerPhone || null, passwordHash })
      .returning();
    return { business: business!, owner: owner! };
  });
}
