import { and, asc, count, desc, eq, lt, sql } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { callOutcomes, callTurns, calls, customers, services } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";
import { findCustomerByPhone } from "./customers.js";

export type CallRow = typeof calls.$inferSelect;
export type TurnRow = typeof callTurns.$inferSelect;
export type OutcomeInsert = Omit<typeof callOutcomes.$inferInsert, "callId" | "businessId">;

export async function startCall(
  ctx: Ctx,
  input: {
    businessId: string;
    channel: CallRow["channel"];
    callerPhone?: string | null;
    callerVerified?: boolean;
    engine: "rules" | "llm";
    state: Record<string, unknown>;
  },
) {
  const customer = input.callerPhone ? await findCustomerByPhone(ctx.db, input.businessId, input.callerPhone) : null;
  const [row] = await ctx.db
    .insert(calls)
    .values({
      businessId: input.businessId,
      channel: input.channel,
      callerPhone: input.callerPhone ?? null,
      callerVerified: input.callerVerified ?? false,
      customerId: customer?.id ?? null,
      engine: input.engine,
      state: input.state,
      startedAt: ctx.now(),
    })
    .returning();
  ctx.events.publish({ type: "call.started", businessId: input.businessId, data: { id: row!.id } });
  return { call: row!, customer };
}

export async function getCall(ex: Executor, callId: string, businessId?: string) {
  const [row] = await ex
    .select()
    .from(calls)
    .where(businessId ? and(eq(calls.id, callId), eq(calls.businessId, businessId)) : eq(calls.id, callId))
    .limit(1);
  if (!row) throw notFound("Call");
  return row;
}

export async function addTurn(
  ex: Executor,
  callId: string,
  t: { speaker: TurnRow["speaker"]; text: string; toolName?: string; toolArgs?: unknown; toolResult?: unknown; latencyMs?: number },
) {
  const [row] = await ex
    .insert(callTurns)
    .values({
      callId,
      seq: sql`(SELECT COALESCE(MAX(seq), 0) + 1 FROM call_turns WHERE call_id = ${callId})`,
      speaker: t.speaker,
      text: t.text,
      toolName: t.toolName ?? null,
      toolArgs: (t.toolArgs ?? null) as never,
      toolResult: (t.toolResult ?? null) as never,
      latencyMs: t.latencyMs ?? null,
    })
    .returning();
  return row!;
}

export async function saveState(ex: Executor, callId: string, state: Record<string, unknown>, patch: Partial<CallRow> = {}) {
  await ex.update(calls).set({ state, ...patch }).where(eq(calls.id, callId));
}

export async function finishCall(ctx: Ctx, call: CallRow, outcome: OutcomeInsert, summary: string) {
  await ctx.db.transaction(async (tx) => {
    await tx.update(calls).set({ status: "ended", endedAt: ctx.now(), summary }).where(eq(calls.id, call.id));
    await tx
      .insert(callOutcomes)
      .values({ ...outcome, callId: call.id, businessId: call.businessId, createdAt: ctx.now() })
      .onConflictDoUpdate({ target: callOutcomes.callId, set: { ...outcome } });
  });
  ctx.events.publish({ type: "call.ended", businessId: call.businessId, data: { id: call.id } });
}

export async function listTurns(ex: Executor, callId: string) {
  return ex.select().from(callTurns).where(eq(callTurns.callId, callId)).orderBy(asc(callTurns.seq));
}

export async function getCallDetail(ex: Executor, businessId: string, callId: string) {
  const call = await getCall(ex, callId, businessId);
  const [turns, [outcome], [customer]] = await Promise.all([
    listTurns(ex, callId),
    ex.select().from(callOutcomes).where(eq(callOutcomes.callId, callId)).limit(1),
    call.customerId ? ex.select().from(customers).where(eq(customers.id, call.customerId)).limit(1) : Promise.resolve([]),
  ]);
  return { call, turns, outcome: outcome ?? null, customer: customer ?? null };
}

export async function listCalls(ex: Executor, businessId: string, opts: { limit?: number; before?: Date } = {}) {
  const turnCounts = ex
    .select({ callId: callTurns.callId, n: count().as("n") })
    .from(callTurns)
    .where(sql`${callTurns.speaker} IN ('caller', 'agent')`)
    .groupBy(callTurns.callId)
    .as("tc");
  return ex
    .select({
      id: calls.id,
      channel: calls.channel,
      status: calls.status,
      callerPhone: calls.callerPhone,
      engine: calls.engine,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      summary: calls.summary,
      isDemo: calls.isDemo,
      customerName: customers.name,
      customerPhone: customers.phone,
      intent: callOutcomes.intent,
      outcome: callOutcomes.outcome,
      reason: callOutcomes.reason,
      highIntent: callOutcomes.highIntent,
      estValuePaise: callOutcomes.estValuePaise,
      serviceName: services.name,
      turns: turnCounts.n,
    })
    .from(calls)
    .leftJoin(customers, eq(customers.id, calls.customerId))
    .leftJoin(callOutcomes, eq(callOutcomes.callId, calls.id))
    .leftJoin(services, eq(services.id, callOutcomes.serviceId))
    .leftJoin(turnCounts, eq(turnCounts.callId, calls.id))
    .where(and(eq(calls.businessId, businessId), opts.before ? lt(calls.startedAt, opts.before) : undefined))
    .orderBy(desc(calls.startedAt))
    .limit(opts.limit ?? 50);
}

/** Active calls with no activity for a while: the caller hung up or closed the tab. */
export async function findStaleCalls(ex: Executor, idleBefore: Date) {
  return ex
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.status, "active"),
        sql`COALESCE((SELECT MAX(created_at) FROM call_turns WHERE call_id = ${calls.id}), ${calls.startedAt}) < ${idleBefore.toISOString()}::timestamptz`,
      ),
    )
    .limit(50);
}
