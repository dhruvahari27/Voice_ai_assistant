import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { customers } from "../db/schema.js";
import { badRequest } from "../lib/errors.js";
import { toE164 } from "../nlu/entities.js";

export type CustomerRow = typeof customers.$inferSelect;

export function normalizePhone(raw: string): string {
  const e164 = toE164(raw);
  if (!e164) throw badRequest(`"${raw}" is not a valid mobile number`);
  return e164;
}

export async function findCustomerByPhone(ex: Executor, businessId: string, phone: string) {
  const [c] = await ex
    .select()
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.phone, phone)))
    .limit(1);
  return c ?? null;
}

/** Find by phone or create; fills in a name if we didn't have one. */
export async function upsertCustomer(
  ex: Executor,
  businessId: string,
  input: { phone: string; name?: string | null; languagePref?: string | null; consent?: boolean },
): Promise<CustomerRow> {
  const phone = normalizePhone(input.phone);
  const [row] = await ex
    .insert(customers)
    .values({
      businessId,
      phone,
      name: input.name ?? null,
      languagePref: input.languagePref ?? null,
      consentAt: input.consent ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [customers.businessId, customers.phone],
      set: {
        name: sql`COALESCE(${customers.name}, EXCLUDED.name)`,
        languagePref: sql`COALESCE(EXCLUDED.language_pref, ${customers.languagePref})`,
        consentAt: sql`COALESCE(${customers.consentAt}, EXCLUDED.consent_at)`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}
