/**
 * VoiceOps AI — Phase 0 schema: business setup + customers.
 * Scheduling, calls, ledger and follow-up tables arrive in Phases 2–3.
 *
 * Conventions: snake_case columns, UUID primary keys, every tenant table has business_id,
 * money in paise (integer), times stored as timestamptz (UTC), local hours as "HH:MM" text.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const businessStatus = pgEnum("business_status", ["onboarding", "active", "paused"]);
export const userRole = pgEnum("user_role", ["owner", "staff"]);
export const resourceKind = pgEnum("resource_kind", ["bay", "chair", "room", "staff"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  phone: text("phone"),
  whatsappNumber: text("whatsapp_number"),
  city: text("city"),
  status: businessStatus("status").notNull().default("onboarding"),
  ...timestamps,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    role: userRole("role").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    authId: text("auth_id").unique(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("users_business_idx").on(t.businessId)],
);

/** One row per open interval per weekday (0 = Sunday). Two rows on one day = split shift. */
export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    opensAt: text("opens_at").notNull(),
    closesAt: text("closes_at").notNull(),
  },
  (t) => [
    index("business_hours_business_weekday_idx").on(t.businessId, t.weekday),
    check("business_hours_weekday_range", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("business_hours_open_before_close", sql`${t.opensAt} < ${t.closesAt}`),
  ],
);

export const closures = pgTable(
  "closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    reason: text("reason"),
  },
  (t) => [uniqueIndex("closures_business_date_uq").on(t.businessId, t.date)],
);

/** Something a booking occupies: a service bay, a chair, a doctor. */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: resourceKind("kind").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("resources_business_name_uq").on(t.businessId, t.name),
    index("resources_business_kind_idx").on(t.businessId, t.kind),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    durationMin: integer("duration_min").notNull(),
    bufferMin: integer("buffer_min").notNull().default(0),
    pricePaise: integer("price_paise").notNull(),
    resourceKind: resourceKind("resource_kind").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("services_business_name_uq").on(t.businessId, t.name),
    check("services_duration_positive", sql`${t.durationMin} > 0`),
    check("services_buffer_nonneg", sql`${t.bufferMin} >= 0`),
    check("services_price_nonneg", sql`${t.pricePaise} >= 0`),
  ],
);

/** Deterministic booking rules, enforced by the policy service — never by the LLM. */
export const policies = pgTable("policies", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),
  minLeadMinutes: integer("min_lead_minutes").notNull().default(60),
  maxHorizonDays: integer("max_horizon_days").notNull().default(30),
  cancelWindowHours: integer("cancel_window_hours").notNull().default(2),
  maxBookingsPerCustomerPerDay: integer("max_bookings_per_customer_per_day").notNull().default(2),
  requireConfirmation: boolean("require_confirmation").notNull().default(true),
});

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(), // E.164
    name: text("name"),
    languagePref: text("language_pref"), // en | hi | hinglish
    consentAt: timestamp("consent_at", { withTimezone: true }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [uniqueIndex("customers_business_phone_uq").on(t.businessId, t.phone)],
);

export const businessRelations = relations(businesses, ({ many, one }) => ({
  users: many(users),
  hours: many(businessHours),
  closures: many(closures),
  resources: many(resources),
  services: many(services),
  customers: many(customers),
  policy: one(policies),
}));
export const businessHoursRelations = relations(businessHours, ({ one }) => ({
  business: one(businesses, { fields: [businessHours.businessId], references: [businesses.id] }),
}));
export const servicesRelations = relations(services, ({ one }) => ({
  business: one(businesses, { fields: [services.businessId], references: [businesses.id] }),
}));
export const policiesRelations = relations(policies, ({ one }) => ({
  business: one(businesses, { fields: [policies.businessId], references: [businesses.id] }),
}));
