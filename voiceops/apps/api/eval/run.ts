/**
 * Scenario evaluation: scripted callers talk to the receptionist; each scenario is scored on what
 * ended up in the database (the call outcome), not on how the replies sound.
 *
 *   pnpm --filter @voiceops/api eval            → table + pass rate
 *   pnpm --filter @voiceops/api eval -- --verbose  → full transcripts of failures
 *
 * Runs on a fresh in-memory database with a fixed clock (Mon 12 Oct 2026, 10:00 IST).
 */
import { eq } from "drizzle-orm";
import { callOutcomes } from "../src/db/schema.js";
import { Receptionist } from "../src/receptionist/index.js";
import { confirmHold, holdSlot } from "../src/services/booking.js";
import { makeTestEnv } from "../test/harness.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

const verbose = process.argv.includes("--verbose");

async function runScenario(env: Awaited<ReturnType<typeof makeTestEnv>>, rx: Receptionist, sc: Scenario) {
  for (const b of sc.setup ?? []) {
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId(b.service), startsAt: env.at(b.date, b.time), source: "staff" });
    await confirmHold(env.ctx, {
      businessId: env.businessId,
      holdId: hold.holdId,
      customer: { phone: b.phone, name: b.name ?? "Existing" },
      actionKey: `eval:${sc.id}:${b.date}:${b.time}:${b.phone}`,
      actor: { kind: "user", userId: "eval" },
    });
  }
  const start = await rx.start({ businessId: env.businessId, channel: sc.callerPhone ? "phone" : "web", callerPhone: sc.callerPhone, callerVerified: Boolean(sc.callerPhone) });
  const log = [`AGENT: ${start.reply}`];
  let ended = false;
  for (const line of sc.turns) {
    const r = await rx.turn({ businessId: env.businessId, callId: start.callId, text: line });
    log.push(`CALLER: ${line}`, `AGENT: ${r.reply}`);
    if (r.ended) {
      ended = true;
      break;
    }
  }
  if (!ended) await rx.end({ businessId: env.businessId, callId: start.callId });
  const [o] = await env.ctx.db.select().from(callOutcomes).where(eq(callOutcomes.callId, start.callId));
  const ok = o?.outcome === sc.expect;
  return { ok, got: o?.outcome ?? "none", log };
}

const env = await makeTestEnv();
const rx = new Receptionist(env.ctx, undefined);
const results: { sc: Scenario; ok: boolean; got: string; log: string[] }[] = [];
for (const sc of SCENARIOS) {
  try {
    results.push({ sc, ...(await runScenario(env, rx, sc)) });
  } catch (err) {
    results.push({ sc, ok: false, got: `crash: ${(err as Error).message}`, log: [] });
  }
}
await env.close();

const byCat = new Map<string, { pass: number; total: number }>();
for (const r of results) {
  const c = byCat.get(r.sc.category) ?? { pass: 0, total: 0 };
  c.total++;
  if (r.ok) c.pass++;
  byCat.set(r.sc.category, c);
}
console.log("\nScenario results\n");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.sc.id.padEnd(34)} expected ${r.sc.expect.padEnd(11)} got ${r.got}`);
console.log("\nBy category");
for (const [cat, c] of byCat) console.log(`  ${cat.padEnd(14)} ${c.pass}/${c.total}`);
const pass = results.filter((r) => r.ok).length;
console.log(`\nTotal: ${pass}/${results.length} (${Math.round((pass / results.length) * 100)}%)\n`);
if (verbose) {
  for (const r of results.filter((x) => !x.ok)) console.log(`\n--- ${r.sc.id}\n${r.log.join("\n")}`);
}
process.exitCode = pass === results.length ? 0 : 1;
