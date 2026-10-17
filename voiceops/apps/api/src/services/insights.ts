/**
 * Call intelligence computed from call outcomes, callbacks and the knowledge-gap log.
 * Nothing is stored twice: every number here is derived on request.
 */
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { formatPaise } from "@voiceops/shared";
import type { Executor } from "../db/client.js";
import { callOutcomes, callbacks, calls, handoffs, knowledgeGaps, services } from "../db/schema.js";
import { addMinutes, dayName, localParts, speakTime } from "../lib/time.js";
import { getBusiness } from "./business.js";

const PART = (h: number) => (h < 12 ? "morning" : h < 16 ? "afternoon" : "evening");

export async function getInsights(ex: Executor, businessId: string, opts: { days: number; now: Date }) {
  const business = await getBusiness(ex, businessId);
  const tz = business.timezone;
  const since = addMinutes(opts.now, -opts.days * 24 * 60);
  const prevSince = addMinutes(since, -opts.days * 24 * 60);

  const rows = await ex
    .select({
      callId: calls.id,
      startedAt: calls.startedAt,
      isDemo: calls.isDemo,
      intent: callOutcomes.intent,
      outcome: callOutcomes.outcome,
      reason: callOutcomes.reason,
      highIntent: callOutcomes.highIntent,
      estValuePaise: callOutcomes.estValuePaise,
      requestedStart: callOutcomes.requestedStart,
      serviceId: callOutcomes.serviceId,
      serviceName: services.name,
    })
    .from(calls)
    .innerJoin(callOutcomes, eq(callOutcomes.callId, calls.id))
    .leftJoin(services, eq(services.id, callOutcomes.serviceId))
    .where(and(eq(calls.businessId, businessId), gte(calls.startedAt, prevSince)));

  const current = rows.filter((r) => r.startedAt >= since);
  const previous = rows.filter((r) => r.startedAt < since);
  const demoShare = current.length ? current.filter((r) => r.isDemo).length / current.length : 0;

  const tally = <K extends string>(items: { [k: string]: unknown }[], key: string) => {
    const m = new Map<K, number>();
    for (const i of items) {
      const k = (i[key] ?? "other") as K;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count);
  };

  const booked = current.filter((r) => r.outcome === "booked" || r.outcome === "rescheduled").length;
  const bookingIntent = current.filter((r) => r.intent === "book" || r.highIntent || r.outcome === "booked").length;
  const lost = current.filter((r) => r.highIntent && r.outcome !== "booked" && r.outcome !== "rescheduled");
  const opportunityPaise = lost.reduce((sum, r) => sum + r.estValuePaise, 0);

  // Peak hours: calls by local weekday × hour.
  const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of current) {
    const p = localParts(r.startedAt, tz);
    heat[p.weekday]![Math.floor(p.minutes / 60)]!++;
  }
  let peak = { weekday: 0, hour: 0, count: 0 };
  heat.forEach((row, wd) => row.forEach((n, h) => {
    if (n > peak.count) peak = { weekday: wd, hour: h, count: n };
  }));
  const hourTotals = Array.from({ length: 24 }, (_, h) => heat.reduce((s, row) => s + row[h]!, 0));
  let bestWindow = { from: 0, count: 0 };
  for (let h = 0; h < 22; h++) {
    const n = hourTotals[h]! + hourTotals[h + 1]! + hourTotals[h + 2]!;
    if (n > bestWindow.count) bestWindow = { from: h, count: n };
  }

  // Unmet demand: wanted times that were full, grouped by weekday + part of day.
  const unmetMap = new Map<string, { weekday: number; part: string; count: number; services: Map<string, number> }>();
  for (const r of current.filter((x) => x.requestedStart && x.outcome !== "booked" && x.outcome !== "rescheduled")) {
    const p = localParts(r.requestedStart!, tz);
    const part = PART(Math.floor(p.minutes / 60));
    const key = `${p.weekday}-${part}`;
    const e = unmetMap.get(key) ?? { weekday: p.weekday, part, count: 0, services: new Map() };
    e.count++;
    if (r.serviceName) e.services.set(r.serviceName, (e.services.get(r.serviceName) ?? 0) + 1);
    unmetMap.set(key, e);
  }
  const unmet = [...unmetMap.values()]
    .sort((a, b) => b.count - a.count)
    .map((u) => ({
      label: `${dayName(u.weekday)} ${u.part}`,
      weekday: u.weekday,
      part: u.part,
      count: u.count,
      topService: [...u.services.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }));

  // Service demand now vs previous period.
  const svcNow = tally<string>(current.filter((r) => r.serviceName), "serviceName");
  const svcPrev = new Map(tally<string>(previous.filter((r) => r.serviceName), "serviceName").map((x) => [x.key, x.count]));
  const serviceDemand = svcNow.map((s) => {
    const before = svcPrev.get(s.key) ?? 0;
    const bookedN = current.filter((r) => r.serviceName === s.key && r.outcome === "booked").length;
    return { service: s.key, requests: s.count, booked: bookedN, previous: before, change: before >= 5 ? (s.count - before) / before : null };
  });
  const rising = serviceDemand.filter((s) => s.previous >= 5 && (s.change ?? 0) >= 0.25).sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0];

  const gaps = await ex
    .select({ id: knowledgeGaps.id, question: knowledgeGaps.question, count: knowledgeGaps.count, isDemo: knowledgeGaps.isDemo })
    .from(knowledgeGaps)
    .where(and(eq(knowledgeGaps.businessId, businessId), eq(knowledgeGaps.resolved, false)))
    .orderBy(desc(knowledgeGaps.count))
    .limit(5);

  const [openHigh] = await ex
    .select({ n: count() })
    .from(callbacks)
    .where(and(eq(callbacks.businessId, businessId), eq(callbacks.status, "open"), eq(callbacks.priority, "high")));
  const [openCallbacks] = await ex.select({ n: count() }).from(callbacks).where(and(eq(callbacks.businessId, businessId), eq(callbacks.status, "open")));
  const [openHandoffs] = await ex.select({ n: count() }).from(handoffs).where(and(eq(handoffs.businessId, businessId), eq(handoffs.status, "open")));

  // Response latency of the agent (time from caller's words to reply text).
  const lat = (await ex.execute(sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY t.latency_ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms) AS p95
    FROM call_turns t JOIN calls c ON c.id = t.call_id
    WHERE c.business_id = ${businessId} AND t.speaker = 'agent' AND t.latency_ms IS NOT NULL
      AND c.started_at >= ${since.toISOString()}::timestamptz AND c.is_demo = false
  `)) as unknown as { rows: { p50: number | null; p95: number | null }[] };

  const radar: { kind: string; tone: "urgent" | "warn" | "info" | "good"; title: string; detail: string; link?: string }[] = [];
  if ((openHigh?.n ?? 0) > 0) {
    radar.push({ kind: "followup", tone: "urgent", title: `${openHigh!.n} high-intent lead${openHigh!.n === 1 ? "" : "s"} need a call back`, detail: "Callers who wanted to book but couldn't finish. Call them first.", link: "/inbox" });
  }
  if (unmet[0] && unmet[0].count >= 2) {
    radar.push({ kind: "unmet", tone: "warn", title: `${unmet[0].count} callers couldn't get ${unmet[0].label}`, detail: `${unmet[0].topService ? `Mostly ${unmet[0].topService}. ` : ""}Consider adding capacity or a staff shift then.`, link: "/insights" });
  }
  if (gaps[0] && gaps[0].count >= 2) {
    radar.push({ kind: "gap", tone: "warn", title: `${gaps[0].count} callers asked: "${gaps[0].question}"`, detail: "The assistant had no answer. Add one in Knowledge and it will answer next time.", link: "/knowledge" });
  }
  if (rising) {
    radar.push({ kind: "trend", tone: "info", title: `${rising.service} demand up ${Math.round((rising.change ?? 0) * 100)}%`, detail: `${rising.requests} requests vs ${rising.previous} in the previous ${opts.days} days.` });
  }
  if (bestWindow.count > 0) {
    radar.push({ kind: "peak", tone: "info", title: `Busiest calls: ${speakTime(`${String(bestWindow.from).padStart(2, "0")}:00`)}–${speakTime(`${String(bestWindow.from + 3).padStart(2, "0")}:00`)}`, detail: `${bestWindow.count} of ${current.length} calls came in this window. Make sure someone is free for handoffs.` });
  }
  if (opportunityPaise > 0) {
    radar.push({
      kind: "value",
      tone: "good",
      title: `Estimated recoverable opportunity: ${formatPaise(opportunityPaise)}`,
      detail: `Estimate = sum of service prices for ${lost.length} high-intent calls that didn't end in a booking. Not revenue — it assumes every one could be won back.`,
    });
  }

  return {
    days: opts.days,
    demoShare,
    totals: {
      calls: current.length,
      previousCalls: previous.length,
      booked,
      bookingIntent,
      conversion: bookingIntent ? booked / bookingIntent : null,
      answered: current.filter((r) => r.outcome === "answered").length,
      callbacks: current.filter((r) => r.outcome === "callback").length,
      handoffs: current.filter((r) => r.outcome === "handoff").length,
      abandoned: current.filter((r) => r.outcome === "abandoned").length,
      opportunityPaise,
      lostLeads: lost.length,
      openCallbacks: openCallbacks?.n ?? 0,
      openHandoffs: openHandoffs?.n ?? 0,
      latencyP50: lat.rows[0]?.p50 ?? null,
      latencyP95: lat.rows[0]?.p95 ?? null,
    },
    intents: tally<string>(current, "intent"),
    outcomes: tally<string>(current, "outcome"),
    reasons: tally<string>(lost.filter((r) => r.reason), "reason"),
    heatmap: heat,
    hourTotals,
    unmet,
    serviceDemand,
    gaps,
    radar,
    formula: "Estimated opportunity = Σ service price of high-intent calls that did not end in a booking.",
  };
}

/** Numbers for the owner's evening WhatsApp. */
export async function dailyNumbers(ex: Executor, businessId: string, from: Date, to: Date) {
  const rows = await ex
    .select({ outcome: callOutcomes.outcome })
    .from(callOutcomes)
    .innerJoin(calls, eq(calls.id, callOutcomes.callId))
    .where(and(eq(calls.businessId, businessId), gte(calls.startedAt, from), sql`${calls.startedAt} < ${to.toISOString()}::timestamptz`, eq(calls.isDemo, false)));
  return { calls: rows.length, booked: rows.filter((r) => r.outcome === "booked").length };
}
