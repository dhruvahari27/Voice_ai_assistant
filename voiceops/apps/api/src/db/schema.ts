/**
 * VoiceOps AI database schema.
 *
 * Conventions
 * - snake_case columns, UUID primary keys, every tenant table has business_id.
 * - Money is integer paise. Instants are timestamptz (UTC). Opening hours are "HH:MM" local text.
 * - Holds live in `appointments` with status = 'held'. One exclusion constraint (migration 0001)
 *   covers held, pending and confirmed rows, so two bookings can never overlap on one resource.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- enums ----------
export const businessStatus = pgEnum("business_status", ["onboarding", "active", "paused"]);
export const userRole = pgEnum("user_role", ["owner", "staff"]);
export const resourceKind = pgEnum("resource_kind", ["bay", "chair", "room", "staff"]);
export const appointmentStatus = pgEnum("appointment_status", [
  "held",
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
  "expired",
]);
export const bookingSource = pgEnum("booking_source", ["voice", "web", "phone", "staff", "whatsapp"]);
export const callChannel = pgEnum("call_channel", ["web", "phone", "text"]);
export const callStatus = pgEnum("call_status", ["active", "ended"]);
export const speaker = pgEnum("speaker", ["caller", "agent", "tool", "system"]);
export const callOutcomeKind = pgEnum("call_outcome_kind", [
  "booked",
  "rescheduled",
  "cancelled",
  "answered",
  "callback",
  "waitlist",
  "handoff",
  "abandoned",
]);
export const priority = pgEnum("priority", ["high", "normal", "low"]);
export const followupStatus = pgEnum("followup_status", ["open", "done", "cancelled"]);
export const waitlistStatus = pgEnum("waitlist_status", ["waiting", "offered", "booked", "expired", "cancelled"]);
export const offerStatus = pgEnum("offer_status", ["pending", "accepted", "lost", "expired"]);
export const messageChannel = pgEnum("message_channel", ["whatsapp", "sms"]);
export const messageDirection = pgEnum("message_direction", ["outbound", "inbound"]);
export const messageStatus = pgEnum("message_status", ["queued", "sent", "simulated", "failed", "received"]);
export const jobStatus = pgEnum("job_status", ["pending", "running", "done", "failed"]);
export const actorKind = pgEnum("actor_kind", ["agent", "user", "system", "customer"]);

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());
const businessRef = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" });

// ---------- business setup ----------
export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  phone: text("phone"),
  ownerPhone: text("owner_phone"),
  whatsappNumber: text("whatsapp_number"),
  city: text("city"),
  address: text("address"),
  status: businessStatus("status").notNull().default("onboarding"),
  createdAt,
  updatedAt,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    role: userRole("role").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_business_idx").on(t.businessId)],
);

/** One row per open interval per weekday (0 = Sunday). Two rows on one day = split shift. */
export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
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
    businessId: businessRef(),
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
    businessId: businessRef(),
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
    businessId: businessRef(),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    durationMin: integer("duration_min").notNull(),
    bufferMin: integer("buffer_min").notNull().default(0),
    pricePaise: integer("price_paise").notNull(),
    resourceKind: resourceKind("resource_kind").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt,
    updatedAt,
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
  slotStepMinutes: integer("slot_step_minutes").notNull().default(30),
  holdSeconds: integer("hold_seconds").notNull().default(300),
  callbackSlaMinutes: integer("callback_sla_minutes").notNull().default(120),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
});

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [index("knowledge_business_idx").on(t.businessId)],
);

export const knowledgeGaps = pgTable(
  "knowledge_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    question: text("question").notNull(),
    normalized: text("normalized").notNull(),
    count: integer("count").notNull().default(1),
    lastCallId: uuid("last_call_id"),
    resolved: boolean("resolved").notNull().default(false),
    isDemo: boolean("is_demo").notNull().default(false),
    lastAskedAt: timestamp("last_asked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("knowledge_gaps_business_norm_uq").on(t.businessId, t.normalized)],
);

// ---------- customers ----------
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    phone: text("phone").notNull(), // E.164
    name: text("name"),
    languagePref: text("language_pref"), // en | hinglish
    consentAt: timestamp("consent_at", { withTimezone: true }),
    notes: text("notes"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex("customers_business_phone_uq").on(t.businessId, t.phone)],
);

// ---------- calls ----------
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    channel: callChannel("channel").notNull(),
    callerPhone: text("caller_phone"),
    callerVerified: boolean("caller_verified").notNull().default(false),
    language: text("language"),
    engine: text("engine").notNull().default("rules"), // rules | llm
    status: callStatus("status").notNull().default("active"),
    state: jsonb("state").notNull().default(sql`'{}'::jsonb`),
    summary: text("summary"),
    isDemo: boolean("is_demo").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("calls_business_started_idx").on(t.businessId, t.startedAt)],
);

export const callTurns = pgTable(
  "call_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    speaker: speaker("speaker").notNull(),
    text: text("text").notNull(),
    toolName: text("tool_name"),
    toolArgs: jsonb("tool_args"),
    toolResult: jsonb("tool_result"),
    latencyMs: integer("latency_ms"),
    createdAt,
  },
  (t) => [uniqueIndex("call_turns_call_seq_uq").on(t.callId, t.seq)],
);

export const callOutcomes = pgTable(
  "call_outcomes",
  {
    callId: uuid("call_id")
      .primaryKey()
      .references(() => calls.id, { onDelete: "cascade" }),
    businessId: businessRef(),
    intent: text("intent").notNull(),
    outcome: callOutcomeKind("outcome").notNull(),
    reason: text("reason"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    requestedStart: timestamp("requested_start", { withTimezone: true }),
    highIntent: boolean("high_intent").notNull().default(false),
    estValuePaise: integer("est_value_paise").notNull().default(0),
    appointmentId: uuid("appointment_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt,
  },
  (t) => [index("call_outcomes_business_created_idx").on(t.businessId, t.createdAt)],
);

// ---------- scheduling ----------
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    status: appointmentStatus("status").notNull(),
    source: bookingSource("source").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** endsAt + service buffer: the range the resource is actually occupied. */
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    bookingRef: text("booking_ref"),
    pricePaise: integer("price_paise").notNull().default(0),
    callId: uuid("call_id"),
    notes: text("notes"),
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("appointments_business_ref_uq").on(t.businessId, t.bookingRef),
    index("appointments_business_starts_idx").on(t.businessId, t.startsAt),
    index("appointments_customer_idx").on(t.customerId),
    check("appointments_range_valid", sql`${t.startsAt} < ${t.endsAt} AND ${t.endsAt} <= ${t.blockedUntil}`),
    check(
      "appointments_customer_required",
      sql`${t.status} IN ('held', 'expired') OR ${t.customerId} IS NOT NULL`,
    ),
  ],
);

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    date: date("date").notNull(), // local date wanted
    windowStart: text("window_start").notNull(), // "HH:MM" local
    windowEnd: text("window_end").notNull(),
    status: waitlistStatus("status").notNull().default("waiting"),
    callId: uuid("call_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [index("waitlist_business_date_idx").on(t.businessId, t.date, t.status)],
);

/** A freed slot offered to several waitlisted customers; the first YES wins. */
export const waitlistOffers = pgTable(
  "waitlist_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => waitlistEntries.id, { onDelete: "cascade" }),
    holdId: uuid("hold_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    status: offerStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [index("waitlist_offers_hold_idx").on(t.holdId)],
);

// ---------- follow-up ----------
export const callbacks = pgTable(
  "callbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    callId: uuid("call_id"),
    name: text("name"),
    phone: text("phone").notNull(),
    reason: text("reason").notNull(),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    preferredAt: timestamp("preferred_at", { withTimezone: true }),
    priority: priority("priority").notNull().default("normal"),
    status: followupStatus("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt,
  },
  (t) => [index("callbacks_business_status_idx").on(t.businessId, t.status, t.dueAt)],
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    callId: uuid("call_id"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    phone: text("phone"),
    reason: text("reason").notNull(), // complaint | human_request | low_confidence | other
    summary: text("summary").notNull(),
    priority: priority("priority").notNull().default("high"),
    status: followupStatus("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notes: text("notes"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt,
  },
  (t) => [index("handoffs_business_status_idx").on(t.businessId, t.status)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    phone: text("phone").notNull(),
    channel: messageChannel("channel").notNull().default("whatsapp"),
    direction: messageDirection("direction").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    status: messageStatus("status").notNull(),
    relatedId: uuid("related_id"),
    providerId: text("provider_id"),
    error: text("error"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt,
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("messages_business_created_idx").on(t.businessId, t.createdAt), index("messages_phone_idx").on(t.phone)],
);

// ---------- safety, audit, jobs ----------
/** Idempotency: one row per write action key. A retried tool call returns the stored result. */
export const actionLedger = pgTable(
  "action_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    actionKey: text("action_key").notNull(),
    tool: text("tool").notNull(),
    argsHash: text("args_hash").notNull(),
    result: jsonb("result"),
    callId: uuid("call_id"),
    createdAt,
  },
  (t) => [uniqueIndex("action_ledger_business_key_uq").on(t.businessId, t.actionKey)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: businessRef(),
    actor: actorKind("actor").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt,
  },
  (t) => [index("audit_business_created_idx").on(t.businessId, t.createdAt)],
);

/** Postgres-backed job queue (no Redis). Workers claim rows with FOR UPDATE SKIP LOCKED. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    createdAt,
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_due_idx").on(t.status, t.runAt), uniqueIndex("jobs_dedupe_uq").on(t.dedupeKey)],
);

// ---------- relations (for db.query.*) ----------
export const businessRelations = relations(businesses, ({ many, one }) => ({
  hours: many(businessHours),
  services: many(services),
  resources: many(resources),
  policy: one(policies),
}));
export const businessHoursRelations = relations(businessHours, ({ one }) => ({
  business: one(businesses, { fields: [businessHours.businessId], references: [businesses.id] }),
}));
export const servicesRelations = relations(services, ({ one }) => ({
  business: one(businesses, { fields: [services.businessId], references: [businesses.id] }),
}));
export const resourcesRelations = relations(resources, ({ one }) => ({
  business: one(businesses, { fields: [resources.businessId], references: [businesses.id] }),
}));
export const policiesRelations = relations(policies, ({ one }) => ({
  business: one(businesses, { fields: [policies.businessId], references: [businesses.id] }),
}));
