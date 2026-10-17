import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { clearDemoData, seedDemoHistory } from "../src/db/demo.js";
import { businesses, calls, messages, services, users, waitlistEntries } from "../src/db/schema.js";
import { registerJobs, sendDailyDigest } from "../src/jobs/handlers.js";
import { hashPassword } from "../src/lib/password.js";
import { Receptionist } from "../src/receptionist/index.js";
import { JobRunner } from "../src/services/jobs.js";
import { makeTestEnv, type TestEnv } from "./harness.js";

let env: TestEnv;
let app: ReturnType<typeof createApp>;
let runner: JobRunner;
let cookie = "";

beforeAll(async () => {
  env = await makeTestEnv();
  const receptionist = new Receptionist(env.ctx, undefined);
  runner = new JobRunner(env.ctx);
  registerJobs(runner, { receptionist });
  app = createApp({ ctx: env.ctx, receptionist, dbKind: "pglite" });
  const res = await request(app).post("/api/v1/auth/login").send({ email: "owner@autocare.example", password: "demo1234" });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
});
afterAll(() => env.close());

const authed = (method: "get" | "post" | "patch" | "put" | "delete", path: string) => request(app)[method](path).set("cookie", cookie);

describe("auth", () => {
  it("rejects a wrong password and protects dashboard routes", async () => {
    const bad = await request(app).post("/api/v1/auth/login").send({ email: "owner@autocare.example", password: "nope" });
    expect(bad.status).toBe(401);
    const anon = await request(app).get("/api/v1/overview");
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("unauthorized");
  });

  it("returns the signed-in user and business", async () => {
    const me = await authed("get", "/api/v1/auth/me");
    expect(me.body).toMatchObject({ user: { role: "owner" }, business: { slug: "autocare" } });
  });

  it("keeps businesses apart: another owner can't see AutoCare's data", async () => {
    const [other] = await env.ctx.db.insert(businesses).values({ slug: "other-shop", name: "Other Shop", status: "active" }).returning();
    await env.ctx.db.insert(users).values({ businessId: other!.id, role: "owner", name: "O", email: "o@other.example", passwordHash: await hashPassword("pw123456") });
    const login = await request(app).post("/api/v1/auth/login").send({ email: "o@other.example", password: "pw123456" });
    const otherCookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const [wash] = await env.ctx.db.select().from(services).where(eq(services.name, "Car Wash"));
    const res = await request(app).patch(`/api/v1/services/${wash!.id}`).set("cookie", otherCookie).send({ pricePaise: 1 });
    expect(res.status).toBe(404);
    const list = await request(app).get("/api/v1/business").set("cookie", otherCookie);
    expect(list.body.services).toHaveLength(0);
  });
});

describe("public talk endpoints", () => {
  it("runs a short call over HTTP and records it", async () => {
    const start = await request(app).post("/api/v1/public/autocare/calls").send({});
    expect(start.status).toBe(201);
    expect(start.body.reply).toMatch(/Namaste/);
    const t = await request(app).post(`/api/v1/public/autocare/calls/${start.body.callId}/turns`).send({ text: "what are your timings?" });
    expect(t.body.reply).toMatch(/Mon–Sat/);
    expect(t.body.trace[0]).toMatchObject({ name: "get_business_info", ok: true });
    await request(app).post(`/api/v1/public/autocare/calls/${start.body.callId}/end`).send({});
    const detail = await authed("get", `/api/v1/calls/${start.body.callId}`);
    expect(detail.body.call.status).toBe("ended");
    expect(detail.body.outcome.outcome).toBe("answered");
    expect(detail.body.turns.map((x: { speaker: string }) => x.speaker)).toEqual(["agent", "caller", "tool", "agent"]);
  });

  it("validates input", async () => {
    const res = await request(app).post("/api/v1/public/autocare/calls/not-a-uuid/turns").send({ text: "hi" });
    expect(res.status).toBe(400);
  });
});

describe("phone agent endpoints", () => {
  it("need the service token, and trust the caller ID", async () => {
    const no = await request(app).post("/api/v1/agent/calls").send({ businessSlug: "autocare" });
    expect(no.status).toBe(401);
    const yes = await request(app)
      .post("/api/v1/agent/calls")
      .set("authorization", "Bearer test-agent-token")
      .send({ businessSlug: "autocare", callerPhone: "9812345678" });
    expect(yes.status).toBe(201);
    const [call] = await env.ctx.db.select().from(calls).where(eq(calls.id, yes.body.callId));
    expect(call).toMatchObject({ channel: "phone", callerPhone: "+919812345678", callerVerified: true });
  });
});

describe("staff booking + waitlist recovery loop", () => {
  it("cancel → offer to waitlist on WhatsApp → first YES books it → the other hears it's gone", async () => {
    const [detail] = await env.ctx.db.select().from(services).where(eq(services.name, "Premium Detailing"));
    // Fill both bays Thursday 17:00.
    const book = (phone: string, key: string) =>
      authed("post", "/api/v1/appointments").send({ serviceId: detail!.id, date: "2026-10-15", time: "17:00", phone, name: "Booked", idempotencyKey: key });
    const a1 = await book("9800000001", "key-aaaaaaaa1");
    const a2 = await book("9800000002", "key-aaaaaaaa2");
    expect(a1.status).toBe(201);
    expect(a2.status).toBe(201);
    const full = await book("9800000003", "key-aaaaaaaa3");
    expect(full.status).toBe(409);

    // Two customers wait for Thursday evening.
    const rx = new Receptionist(env.ctx, undefined);
    for (const phone of ["9811111101", "9811111102"]) {
      const c = await rx.start({ businessId: env.businessId, channel: "web" });
      await rx.turn({ businessId: env.businessId, callId: c.callId, text: "premium detailing thursday 5 pm" });
      await rx.turn({ businessId: env.businessId, callId: c.callId, text: "no, only 5 pm" });
      await rx.turn({ businessId: env.businessId, callId: c.callId, text: "yes" });
      await rx.turn({ businessId: env.businessId, callId: c.callId, text: phone });
    }
    expect((await env.ctx.db.select().from(waitlistEntries)).filter((w) => w.status === "waiting").length).toBeGreaterThanOrEqual(2);

    // Staff cancels one booking → job offers the slot.
    const cancel = await authed("post", `/api/v1/appointments/${a1.body.appointment.id}/cancel`).send({ reason: "customer called" });
    expect(cancel.body.appointment.status).toBe("cancelled");
    await runner.drain();
    const offers = await env.ctx.db.select().from(messages).where(eq(messages.kind, "waitlist_offer"));
    expect(offers.map((m) => m.phone).sort()).toEqual(["+919811111101", "+919811111102"]);
    expect(offers.every((m) => m.status === "simulated")).toBe(true);

    // Second customer replies first.
    const yes2 = await authed("post", "/api/v1/messages/simulate-reply").send({ phone: "9811111102", body: "YES" });
    expect(yes2.body.action).toBe("offer_accepted");
    const yes1 = await authed("post", "/api/v1/messages/simulate-reply").send({ phone: "9811111101", body: "yes" });
    expect(yes1.body.action).not.toBe("offer_accepted");
    await runner.drain();
    const lost = await env.ctx.db.select().from(messages).where(eq(messages.kind, "waitlist_lost"));
    expect(lost.map((m) => m.phone)).toContain("+919811111101");

    const day = await authed("get", "/api/v1/appointments?from=2026-10-15&to=2026-10-15");
    const at5 = day.body.appointments.filter((a: { startsAt: string; status: string }) => a.startsAt === env.at("2026-10-15", "17:00").toISOString() && a.status === "confirmed");
    expect(at5.map((a: { customer: { phone: string } }) => a.customer.phone).sort()).toEqual(["+919800000002", "+919811111102"]);
  });

  it("customers can cancel by replying CANCEL (outside the cancel window)", async () => {
    const res = await authed("post", "/api/v1/messages/simulate-reply").send({ phone: "9811111102", body: "cancel" });
    expect(res.body.action).toBe("cancelled");
  });
});

describe("knowledge", () => {
  it("adding an answer resolves the gap and the receptionist uses it next time", async () => {
    const rx = new Receptionist(env.ctx, undefined);
    const c = await rx.start({ businessId: env.businessId, channel: "web" });
    const r1 = await rx.turn({ businessId: env.businessId, callId: c.callId, text: "do you offer tyre rotation?" });
    expect(r1.reply).toMatch(/not sure/);
    const k = await authed("get", "/api/v1/knowledge");
    const gap = k.body.gaps.find((g: { question: string }) => g.question.includes("tyre"));
    expect(gap).toBeTruthy();
    await authed("post", "/api/v1/knowledge").send({ question: "Do you do tyre rotation?", answer: "Yes, tyre rotation is ₹300 and takes 20 minutes.", tags: ["tyre", "tire", "rotation"], resolveGapId: gap.id });
    const c2 = await rx.start({ businessId: env.businessId, channel: "web" });
    const r2 = await rx.turn({ businessId: env.businessId, callId: c2.callId, text: "do you offer tyre rotation?" });
    expect(r2.reply).toMatch(/tyre rotation is ₹300/);
    const k2 = await authed("get", "/api/v1/knowledge");
    expect(k2.body.gaps.find((g: { id: string }) => g.id === gap.id)).toBeUndefined();
  });
});

describe("settings", () => {
  it("owner can change hours and the receptionist sees it immediately", async () => {
    const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "20:00" })).concat([{ weekday: 0, opensAt: "10:00", closesAt: "14:00" }]);
    const res = await authed("put", "/api/v1/hours").send({ hours });
    expect(res.status).toBe(200);
    const rx = new Receptionist(env.ctx, undefined);
    const c = await rx.start({ businessId: env.businessId, channel: "web" });
    const r = await rx.turn({ businessId: env.businessId, callId: c.callId, text: "are you open on sunday?" });
    expect(r.reply).toMatch(/Sun 10:00–14:00/);
  });

  it("rejects invalid hours", async () => {
    const res = await authed("put", "/api/v1/hours").send({ hours: [{ weekday: 1, opensAt: "20:00", closesAt: "09:00" }] });
    expect(res.status).toBe(400);
  });
});

describe("insights, digest and demo data", () => {
  it("loads demo history, computes insights with an explained estimate, then clears it", async () => {
    await seedDemoHistory(env.ctx, env.businessId);
    const res = await authed("get", "/api/v1/insights?days=14");
    expect(res.body.totals.calls).toBeGreaterThan(100);
    expect(res.body.demoShare).toBeGreaterThan(0.9);
    expect(res.body.unmet[0].label).toMatch(/Saturday/);
    expect(res.body.radar.some((c: { kind: string }) => c.kind === "value")).toBe(true);
    expect(res.body.formula).toMatch(/Σ service price/);
    const overview = await authed("get", "/api/v1/overview");
    expect(overview.status).toBe(200);
    await clearDemoData(env.ctx, env.businessId);
    const after = await authed("get", "/api/v1/insights?days=14");
    expect(after.body.demoShare).toBe(0);
  });

  it("sends the owner an evening digest", async () => {
    await sendDailyDigest(env.ctx, env.businessId, "2026-10-12");
    const [digest] = await env.ctx.db.select().from(messages).where(eq(messages.kind, "owner_digest"));
    expect(digest?.phone).toBe("+919000000001");
    expect(digest?.body).toMatch(/daily summary/);
  });
});
