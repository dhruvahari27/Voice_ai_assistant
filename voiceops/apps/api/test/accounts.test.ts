import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { jobs, messages } from "../src/db/schema.js";
import { Receptionist } from "../src/receptionist/index.js";
import { confirmHold, holdSlot } from "../src/services/booking.js";
import { slugify } from "../src/services/onboarding.js";
import { makeTestEnv, type TestEnv } from "./harness.js";

let env: TestEnv;
let app: ReturnType<typeof createApp>;

const cookieOf = (res: request.Response) => String(res.headers["set-cookie"]).split(";")[0]!;
async function login(email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  return { res, cookie: cookieOf(res) };
}

beforeAll(async () => {
  env = await makeTestEnv();
  app = createApp({ ctx: env.ctx, receptionist: new Receptionist(env.ctx, undefined), dbKind: "pglite" });
});
afterAll(() => env.close());

describe("sign-up", () => {
  it("creates a business with a working setup and signs the owner in", async () => {
    const res = await request(app).post("/api/v1/auth/signup").send({
      businessName: "Sharma Motors",
      city: "Pune",
      ownerName: "Anil Sharma",
      email: "Anil@SharmaMotors.example",
      password: "brakes-and-oil-9",
      ownerPhone: "98200 11122",
      template: "car_service",
    });
    expect(res.status).toBe(201);
    expect(res.body.business.slug).toBe("sharma-motors");
    const cookie = cookieOf(res);
    const me = await request(app).get("/api/v1/auth/me").set("cookie", cookie);
    expect(me.body).toMatchObject({ user: { email: "anil@sharmamotors.example", role: "owner" }, business: { name: "Sharma Motors" }, isDemoAccount: false });
    const setup = await request(app).get("/api/v1/business").set("cookie", cookie);
    expect(setup.body.services.length).toBe(5);
    expect(setup.body.hours.length).toBe(6);
    // The new business's receptionist answers on its own public page.
    const pub = await request(app).get("/api/v1/public/sharma-motors");
    expect(pub.body.name).toBe("Sharma Motors");
  });

  it("refuses a taken email and weak passwords, with field-level messages", async () => {
    const taken = await request(app).post("/api/v1/auth/signup").send({ businessName: "X Garage", ownerName: "Xa", email: "owner@autocare.example", password: "long-enough-1" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("email_taken");
    const weak = await request(app).post("/api/v1/auth/signup").send({ businessName: "Y Garage", ownerName: "Ya", email: "y@y.example", password: "12345678" });
    expect(weak.status).toBe(400);
  });

  it("makes readable, unique slugs", () => {
    expect(slugify("Ravi's Car Spa & Wash!")).toBe("ravi-s-car-spa-wash");
    expect(slugify("सर्विस")).toMatch(/^business/);
  });
});

describe("team and roles", () => {
  it("owner adds a staff member who can work but not change settings", async () => {
    const owner = await login("owner@autocare.example", "demo1234");
    const add = await request(app).post("/api/v1/team").set("cookie", owner.cookie).send({ name: "Suresh", email: "suresh@autocare.example" });
    expect(add.status).toBe(201);
    expect(add.body.temporaryPassword).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);

    const staff = await login("suresh@autocare.example", add.body.temporaryPassword);
    expect(staff.res.status).toBe(200);
    expect((await request(app).get("/api/v1/appointments?from=2026-10-13&to=2026-10-14").set("cookie", staff.cookie)).status).toBe(200);
    const settings = await request(app).patch("/api/v1/business").set("cookie", staff.cookie).send({ name: "Hacked" });
    expect(settings.status).toBe(403);
    const addMore = await request(app).post("/api/v1/team").set("cookie", staff.cookie).send({ name: "Eve", email: "eve@x.example" });
    expect(addMore.status).toBe(403);

    // Removing someone ends their session immediately, not when the cookie expires.
    const del = await request(app).delete(`/api/v1/team/${add.body.member.id}`).set("cookie", owner.cookie);
    expect(del.status).toBe(200);
    expect((await request(app).get("/api/v1/overview").set("cookie", staff.cookie)).status).toBe(401);
  });

  it("never leaves a business without an owner", async () => {
    const owner = await login("owner@autocare.example", "demo1234");
    const me = await request(app).get("/api/v1/auth/me").set("cookie", owner.cookie);
    const demote = await request(app).patch(`/api/v1/team/${me.body.user.id}`).set("cookie", owner.cookie).send({ role: "staff" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("last_owner");
    const self = await request(app).delete(`/api/v1/team/${me.body.user.id}`).set("cookie", owner.cookie);
    expect(self.status).toBe(400);
  });
});

describe("password change", () => {
  it("needs the current password and signs out other devices", async () => {
    const add = await request(app)
      .post("/api/v1/team")
      .set("cookie", (await login("owner@autocare.example", "demo1234")).cookie)
      .send({ name: "Pooja", email: "pooja@autocare.example", password: "first-pass-123" });
    expect(add.status).toBe(201);
    const laptop = await login("pooja@autocare.example", "first-pass-123");
    const phone = await login("pooja@autocare.example", "first-pass-123");

    const wrong = await request(app).post("/api/v1/auth/password").set("cookie", laptop.cookie).send({ currentPassword: "nope", newPassword: "second-pass-456" });
    expect(wrong.status).toBe(400);
    const ok = await request(app).post("/api/v1/auth/password").set("cookie", laptop.cookie).send({ currentPassword: "first-pass-123", newPassword: "second-pass-456" });
    expect(ok.status).toBe(200);

    expect((await request(app).get("/api/v1/auth/me").set("cookie", cookieOf(ok))).status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set("cookie", phone.cookie)).status).toBe(401);
    expect((await login("pooja@autocare.example", "second-pass-456")).res.status).toBe(200);
  });
});

describe("sign-in protection", () => {
  it("limits guesses per account", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await request(app).post("/api/v1/auth/login").send({ email: "target@autocare.example", password: `guess-${i}` })).status;
    expect(last).toBe(429);
  });

  it("tells the sign-in page whether the demo is available", async () => {
    const res = await request(app).get("/api/v1/auth/options");
    expect(res.body).toMatchObject({ demoLogin: { email: "owner@autocare.example" }, signupEnabled: true });
  });
});

describe("web booking requests", () => {
  it("stay pending without reminders until staff approve them", async () => {
    const hold = await holdSlot(env.ctx, { businessId: env.businessId, serviceId: env.serviceId("Oil Change"), startsAt: env.at("2026-10-16", "15:00"), source: "web" });
    const appt = await confirmHold(env.ctx, {
      businessId: env.businessId,
      holdId: hold.holdId,
      customer: { phone: "+919800000777", name: "Web Caller" },
      actionKey: "web-pending-1",
      actor: { kind: "user", userId: "t" },
      pending: true,
    });
    expect(appt.status).toBe("pending");
    const sent = await env.ctx.db.select().from(messages).where(eq(messages.relatedId, appt.id));
    expect(sent.map((m) => m.kind)).toEqual(["booking_requested"]);
    const remindersBefore = (await env.ctx.db.select().from(jobs).where(eq(jobs.kind, "appointment_reminder"))).filter((j) => JSON.stringify(j.payload).includes(appt.id));
    expect(remindersBefore).toHaveLength(0);

    const owner = await login("owner@autocare.example", "demo1234");
    const overview = await request(app).get("/api/v1/overview").set("cookie", owner.cookie);
    expect(overview.body.today.pendingRequests.map((a: { id: string }) => a.id)).toContain(appt.id);

    const ok = await request(app).post(`/api/v1/appointments/${appt.id}/approve`).set("cookie", owner.cookie);
    expect(ok.body.appointment.status).toBe("confirmed");
    const after = await env.ctx.db.select().from(messages).where(eq(messages.relatedId, appt.id));
    expect(after.map((m) => m.kind).sort()).toEqual(["booking_confirmation", "booking_requested"]);
    const again = await request(app).post(`/api/v1/appointments/${appt.id}/approve`).set("cookie", owner.cookie);
    expect(again.status).toBe(409);
  });
});
